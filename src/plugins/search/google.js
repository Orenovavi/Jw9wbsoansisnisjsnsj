import axios from "axios";
import * as cheerio from "cheerio";

const MAX_RESULTS = 5;
const TIMEOUT = 20000;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
];

const pickUA = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

const truncate = (str, max = 200) => {
  if (!str) return "";
  return str.length > max ? str.slice(0, max).trim() + "..." : str;
};

const cleanUrl = (url) => {
  if (!url) return "";
  if (url.startsWith("/url?q=")) {
    const match = url.match(/\/url\?q=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  if (url.startsWith("/")) {
    return `https://www.google.com${url}`;
  }
  return url;
};

const extractFromGoogle = async (query, limit) => {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=id&num=${limit + 5}`;

  const { data } = await axios.get(url, {
    timeout: TIMEOUT,
    headers: {
      "User-Agent": pickUA(),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    validateStatus: (s) => s < 600,
  });

  if (typeof data !== "string") {
    throw new Error("Response bukan HTML");
  }

  if (data.includes("detected unusual traffic") || data.includes("captcha")) {
    throw new Error("CAPTCHA_DETECTED");
  }

  const $ = cheerio.load(data);
  const results = [];

  const containers = ["div.g", "div[data-hveid]", "div.MjjYud"];

  for (const container of containers) {
    $(container).each((i, el) => {
      if (results.length >= limit) return false;

      const $el = $(el);
      const title = $el.find("h3").first().text().trim();
      const link = $el.find("a").first().attr("href");
      const desc =
        $el.find("div.VwiC3b, span.aCOpRe, div[data-sncf]").first().text().trim() ||
        $el.find("span").last().text().trim();

      if (!title || !link) return;

      const cleanLink = cleanUrl(link);
      if (!cleanLink || !cleanLink.startsWith("http")) return;
      if (cleanLink.includes("google.com/search")) return;

      const exists = results.find((r) => r.link === cleanLink);
      if (exists) return;

      results.push({
        title,
        link: cleanLink,
        description: desc || null,
      });
    });

    if (results.length >= limit) break;
  }

  return results;
};

const extractFromDuckDuckGo = async (query, limit) => {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const { data } = await axios.get(url, {
    timeout: TIMEOUT,
    headers: {
      "User-Agent": pickUA(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    },
    validateStatus: (s) => s < 600,
  });

  const $ = cheerio.load(data);
  const results = [];

  $(".result").each((i, el) => {
    if (results.length >= limit) return false;

    const title = $(el).find(".result__title").text().trim();
    const link = $(el).find(".result__url").attr("href");
    const desc = $(el).find(".result__snippet").text().trim();

    if (!title || !link) return;

    const cleanLink = cleanUrl(link);
    if (!cleanLink || !cleanLink.startsWith("http")) return;

    results.push({
      title,
      link: cleanLink,
      description: desc || null,
    });
  });

  return results;
};

const searchGoogle = async (query, limit) => {
  const engines = [
    { name: "google", fn: extractFromGoogle },
    { name: "duckduckgo", fn: extractFromDuckDuckGo },
  ];

  const tried = [];
  let lastError = null;

  for (const engine of engines) {
    tried.push(engine.name);

    try {
      const results = await engine.fn(query, limit);
      if (results && results.length > 0) {
        return { engine: engine.name, results, tried };
      }
    } catch (err) {
      lastError = err;
      continue;
    }
  }

  return { engine: null, results: [], tried, error: lastError?.message };
};

export default {
  name: "Google Search",
  category: "search",
  description: "Cari apa saja di Google (scraping, tanpa API key)",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian",
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil (default: 5, max: 10)",
    },
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || req.body?.limit || 5), 1),
      10
    );

    if (!query) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();

    const { engine, results, tried, error } = await searchGoogle(query, limit);

    if (!results.length) {
      const errMsg =
        error === "CAPTCHA_DETECTED"
          ? "Google minta CAPTCHA. Coba lagi 2-5 menit."
          : error
          ? `Gagal ambil hasil: ${error}`
          : `Tidak ada hasil untuk: ${query}`;

      throw new Error(errMsg);
    }

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      query,
      engine_used: engine,
      engines_tried: tried,
      total: results.length,
      results,
      process_time: elapsed,
    };
  },
};
