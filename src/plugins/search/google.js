import axios from "axios";
import * as cheerio from "cheerio";
import { HttpsProxyAgent } from "https-proxy-agent";

const MAX_RESULTS = 5;
const TIMEOUT = 25000;
const PROXY_TIMEOUT = 10000;
const PROXY_REFRESH_INTERVAL = 5 * 60 * 1000;
const PROXY_MAX_POOL = 200;

const PROXY_SOURCES = [
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt",
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
];

const BROWSER_PROFILES = [
  {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Sec-CH-UA": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  },
  {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Sec-CH-UA":
      '"Chromium";v="121", "Not(A:Brand";v="24", "Google Chrome";v="121"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"macOS"',
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  },
  {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Sec-CH-UA":
      '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Linux"',
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
    "Upgrade-Insecure-Requests": "1",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  },
];

let proxyPool = [];
let proxyIndex = 0;
let lastProxyFetch = 0;

const pickProfile = () =>
  BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];

const log = (...args) => console.log("[GSearch]", ...args);
const logWarn = (...args) => console.warn("[GSearch]", ...args);

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
  if (url.startsWith("/")) return `https://www.google.com${url}`;
  return url;
};

const fetchProxies = async () => {
  const now = Date.now();
  if (now - lastProxyFetch < PROXY_REFRESH_INTERVAL && proxyPool.length > 0) {
    return proxyPool;
  }

  log("Refreshing proxy pool...");
  const all = new Set();

  for (const source of PROXY_SOURCES) {
    try {
      const { data } = await axios.get(source, {
        timeout: PROXY_TIMEOUT,
        headers: { "User-Agent": pickProfile()["User-Agent"] },
      });

      const lines = String(data).split("\n");

      for (const line of lines) {
        const clean = line.trim();
        if (!clean || clean.startsWith("#")) continue;
        if (!/^\d+\.\d+\.\d+\.\d+:\d+$/.test(clean)) continue;
        all.add(`http://${clean}`);
        if (all.size >= PROXY_MAX_POOL) break;
      }

      log(`Source OK: ${source} → ${all.size} total`);
    } catch (err) {
      logWarn(`Source fail: ${source} → ${err.message}`);
    }

    if (all.size >= PROXY_MAX_POOL) break;
  }

  proxyPool = [...all];
  lastProxyFetch = now;
  proxyIndex = 0;

  log(`Proxy pool updated: ${proxyPool.length} proxies`);
  return proxyPool;
};

const getNextProxy = async () => {
  await fetchProxies();
  if (proxyPool.length === 0) return null;

  const proxy = proxyPool[proxyIndex % proxyPool.length];
  proxyIndex++;
  return proxy;
};

const isValidProxy = async (proxyUrl) => {
  try {
    const agent = new HttpsProxyAgent(proxyUrl);
    const { status } = await axios.get("https://www.google.com/generate_204", {
      httpsAgent: agent,
      proxy: false,
      timeout: 6000,
      validateStatus: () => true,
    });
    return status === 204 || status === 200;
  } catch {
    return false;
  }
};

const extractGoogle = async (data, limit) => {
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
        $el
          .find("div.VwiC3b, span.aCOpRe, div[data-sncf]")
          .first()
          .text()
          .trim() || $el.find("span").last().text().trim();

      if (!title || !link) return;

      const cleanLink = cleanUrl(link);
      if (!cleanLink?.startsWith("http")) return;
      if (cleanLink.includes("google.com/search")) return;
      if (results.find((r) => r.link === cleanLink)) return;

      results.push({ title, link: cleanLink, description: desc || null });
    });

    if (results.length >= limit) break;
  }

  return results;
};

const searchGoogle = async (query, limit) => {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=id&num=${limit + 5}`;
  const maxAttempts = Math.min(proxyPool.length || 3, 4);

  for (let i = 0; i < maxAttempts; i++) {
    const proxyUrl = await getNextProxy();
    const profile = pickProfile();

    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    try {
      log(`Attempt ${i + 1}/${maxAttempts} via ${proxyUrl || "direct"}`);

      const { data, status } = await axios.get(url, {
        headers: {
          ...profile,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        httpsAgent: agent,
        proxy: false,
        timeout: TIMEOUT,
        validateStatus: () => true,
        maxRedirects: 5,
      });

      if (status === 403 || status === 429) {
        logWarn(`Blocked (HTTP ${status}), rotate proxy...`);
        continue;
      }

      if (status !== 200 || typeof data !== "string") {
        logWarn(`Bad response (HTTP ${status})`);
        continue;
      }

      if (data.includes("detected unusual traffic") || data.includes("captcha-form")) {
        logWarn("CAPTCHA detected, rotate proxy...");
        continue;
      }

      const results = await extractGoogle(data, limit);
      if (results.length > 0) {
        log(`Google OK: ${results.length} results via ${proxyUrl || "direct"}`);
        return { engine: "google", results, proxy: proxyUrl || "direct" };
      }

      logWarn("No results from Google, trying next...");
    } catch (err) {
      logWarn(`Attempt ${i + 1} failed: ${err.message}`);
      continue;
    }
  }

  return { engine: null, results: [], tried: maxAttempts };
};

const searchDuckDuckGo = async (query, limit) => {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const profile = pickProfile();

  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": profile["User-Agent"],
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": profile["Accept-Language"],
      },
      timeout: TIMEOUT,
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
      if (!cleanLink?.startsWith("http")) return;

      results.push({ title, link: cleanLink, description: desc || null });
    });

    log(`DDG OK: ${results.length} results`);
    return { engine: "duckduckgo", results, proxy: "none" };
  } catch (err) {
    logWarn(`DDG fail: ${err.message}`);
    return { engine: null, results: [] };
  }
};

const smartSearch = async (query, limit) => {
  await fetchProxies();

  const google = await searchGoogle(query, limit);
  if (google.results.length > 0) return google;

  log("Google semua attempt gagal, fallback ke DuckDuckGo...");
  return searchDuckDuckGo(query, limit);
};

export default {
  name: "Google Search",
  category: "search",
  description:
    "Cari apa saja di Google (proxy rotation + browser headers, fallback DuckDuckGo)",
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

    if (!query) throw new Error("Parameter 'query' wajib diisi");

    const startTime = Date.now();

    const { engine, results, proxy, tried } = await smartSearch(query, limit);

    if (!results.length) {
      throw new Error(
        `Tidak ada hasil untuk: ${query}. Semua sumber gagal (proxy pool: ${proxyPool.length}).`
      );
    }

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      query,
      engine_used: engine,
      proxy_used: proxy || null,
      attempts: tried || 1,
      proxy_pool_size: proxyPool.length,
      total: results.length,
      results,
      process_time: elapsed,
    };
  },
};
