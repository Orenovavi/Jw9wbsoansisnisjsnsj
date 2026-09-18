import * as cheerio from "cheerio";
import { safeFetch } from "../../function.js";

const BASE_URL = "https://mcpedl.org";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Referer": "https://mcpedl.org/"
};

const extractId = (url) => {
  if (!url) return "";
  return url.replace(/\/$/, "").split("/").pop();
};

const parseSearchResults = ($, max) => {
  return $("article")
    .map((i, el) => {
      if (i >= max) return null;

      const href = $(el).find("a").first().attr("href") || "";
      const id = extractId(href);

      if (!id) return null;

      return {
        title: $(el).find(".entry-title, h2, h3").text().trim() || "No title",
        id,
        link: href,
        image:
          $(el).find("img").attr("data-src") ||
          $(el).find("img").attr("src") ||
          null
      };
    })
    .get()
    .filter(Boolean);
};

export default {
  name: "MCPEDL Search",
  category: "search",
  description: "Cari addon, mod, texture pack Minecraft PE dari mcpedl.org",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian (misal: furniture, realistic shader)"
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil maksimal (default: 10)"
    }
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const max = parseInt(req.query.limit || req.body?.limit || 10);

    if (!query) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    const response = await safeFetch(url, { headers: HEADERS }, 15000);

    if (!response.ok) {
      throw new Error(`Gagal mengakses MCPEDL (HTTP ${response.status})`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const results = parseSearchResults($, max);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      query,
      total: results.length,
      results,
      process_time: elapsed
    };
  }
};
