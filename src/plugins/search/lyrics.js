import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://genius.com";
const TIMEOUT = 20000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
};

const isValidLyricsUrl = (url) => {
  if (!url) return false;
  return /\.com\/.+lyrics/.test(url);
};

const scrapeLyrics = async (url) => {
  const response = await axios.get(url, {
    timeout: TIMEOUT,
    headers: HEADERS,
    validateStatus: (status) => status < 500,
  });

  if (response.status >= 400) {
    throw new Error(`Gagal akses halaman: HTTP ${response.status}`);
  }

  const $ = cheerio.load(response.data);

  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const titleMatch = ogTitle.match(/–\s*(.+)/);
  const artistMatch = ogTitle.match(/^(.+?)(?:\s*–|$)/);

  let title = titleMatch ? titleMatch[1].trim() : $("h1").first().text().trim();
  let artist = artistMatch ? artistMatch[1].trim() : null;

  title = title.replace(/Lyrics/gi, "").trim();
  if (artist) artist = artist.replace(/Lyrics/gi, "").trim();

  const lyricsContainers = [
    "div[data-lyrics-container='true']",
    "div.lyrics",
    "div[class*='Lyrics__Container']",
  ];

  let lyricsParts = [];

  for (const container of lyricsContainers) {
    $(container).each((i, el) => {
      const text = $(el)
        .html()
        .replace(/<br\s*\/?>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();

      if (text) lyricsParts.push(text);
    });

    if (lyricsParts.length > 0) break;
  }

  const lyrics = lyricsParts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!lyrics) {
    throw new Error("Lirik tidak ditemukan di halaman ini");
  }

  return {
    title,
    artist,
    lyrics,
  };
};

const searchLyrics = async (query) => {
  const searchUrl = `${BASE_URL}/api/search/song?q=${encodeURIComponent(query)}`;

  const response = await axios.get(searchUrl, {
    timeout: TIMEOUT,
    headers: {
      "User-Agent": HEADERS["User-Agent"],
      Accept: "application/json",
    },
    validateStatus: (status) => status < 500,
  });

  if (response.status >= 400) {
    throw new Error(`Pencarian gagal: HTTP ${response.status}`);
  }

  const songs = response.data?.response?.sections?.[0]?.hits || [];

  return songs.map((hit) => ({
    title: hit.result?.title || null,
    artist: hit.result?.artist_names || null,
    url: hit.result?.url || null,
    thumbnail: hit.result?.song_art_image_thumbnail_url || null,
    release_date: hit.result?.release_date_for_display || null,
  }));
};

export default {
  name: "Lyrics Finder",
  category: "search",
  description: "Cari dan ambil lirik lagu dari berbagai sumber",
  method: ["GET", "POST"],
  cache: 600,
  params: {
    url: {
      type: "string",
      required: false,
      description: "URL halaman lirik (wajib jika mode=lyrics)",
    },
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (wajib jika mode=search)",
    },
    mode: {
      type: "string",
      required: false,
      description:
        "Mode: 'lyrics' (scrape dari URL) atau 'search' (cari lagu). Default: auto",
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil pencarian (default: 10)",
    },
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const query = req.query.query || req.body?.query;
    const mode = (req.query.mode || req.body?.mode || "").toLowerCase();
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || req.body?.limit || 10), 1),
      30
    );

    if (!url && !query) {
      throw new Error("Parameter 'url' atau 'query' wajib diisi");
    }

    const startTime = Date.now();

    let actualMode = mode;

    if (!actualMode) {
      actualMode = url ? "lyrics" : "search";
    }

    if (actualMode === "lyrics") {
      if (!url) throw new Error("Mode 'lyrics' butuh parameter 'url'");
      if (!isValidLyricsUrl(url)) {
        throw new Error(
          "URL tidak valid. Harus dari domain lirik (format: .../xxx-lyrics)"
        );
      }

      const result = await scrapeLyrics(url);
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      return {
        mode: "lyrics",
        url,
        ...result,
        lyrics_length: result.lyrics.length,
        process_time: elapsed,
      };
    }

    if (actualMode === "search") {
      if (!query) throw new Error("Mode 'search' butuh parameter 'query'");

      const results = await searchLyrics(query);
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      if (!results.length) {
        throw new Error(`Tidak ada hasil untuk: ${query}`);
      }

      return {
        mode: "search",
        query,
        total: results.length,
        results: results.slice(0, limit),
        process_time: elapsed,
      };
    }

    throw new Error("Mode tidak valid. Gunakan 'lyrics' atau 'search'");
  },
};
