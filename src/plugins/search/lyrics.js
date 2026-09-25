import axios from "axios";
import { getLyrics } from "@fantox01/lyrics-scraper";

const LRCLIB_API = "https://lrclib.net/api";
const USER_AGENT = "JustPutu-Lyrics/1.0 (https://github.com/justputu)";
const TIMEOUT = 20000;
const MAX_RESULTS = 5;

const isString = (v) => typeof v === "string" && v.length > 0;

const cleanQuery = (q) => String(q || "").trim().replace(/\s+/g, " ");

const parseQuery = (query) => {
  const clean = cleanQuery(query);

  const separators = [" - ", " – ", " — ", " by "];
  for (const sep of separators) {
    const parts = clean.split(sep);
    if (parts.length === 2) {
      return {
        title: parts[0].trim(),
        artist: parts[1].trim(),
        raw: clean,
      };
    }
  }

  return { title: clean, artist: null, raw: clean };
};

const lrclibHeaders = () => ({
  "User-Agent": USER_AGENT,
  Accept: "application/json",
});

const lrclibSearch = async (params) => {
  const { data } = await axios.get(`${LRCLIB_API}/search`, {
    params,
    headers: lrclibHeaders(),
    timeout: TIMEOUT,
    validateStatus: (s) => s < 600,
  });

  return Array.isArray(data) ? data : [];
};

const lrclibGet = async (params) => {
  const { data, status } = await axios.get(`${LRCLIB_API}/get`, {
    params,
    headers: lrclibHeaders(),
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (status === 404) return null;
  if (status >= 400) return null;

  return data;
};

const findLrclib = async (parsed) => {
  const attempts = [
    { q: parsed.raw },
    { track_name: parsed.title, artist_name: parsed.artist },
    { track_name: parsed.title },
  ].filter((p) => Object.values(p).every(isString));

  let candidates = [];

  for (const params of attempts) {
    try {
      const results = await lrclibSearch(params);
      if (results.length > 0) {
        candidates = results;
        break;
      }
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) return null;

  const best =
    candidates.find((c) => !c.instrumental) || candidates[0];

  const full = await lrclibGet({
    track_name: best.trackName,
    artist_name: best.artistName,
    album_name: best.albumName || undefined,
    duration: best.duration || undefined,
  });

  return full || best;
};

const findGenius = async (parsed) => {
  try {
    const data = await getLyrics(parsed.raw);
    if (data?.status !== 200) return null;
    return data;
  } catch {
    return null;
  }
};

const normalizeLrclib = (data) => ({
  source: "lrclib",
  title: data.trackName || data.name,
  artist: data.artistName,
  album: data.albumName || null,
  duration: data.duration || null,
  instrumental: Boolean(data.instrumental),
  lyrics: data.plainLyrics || null,
  synced_lyrics: data.syncedLyrics || null,
  thumbnail: null,
  release_date: null,
});

const normalizeGenius = (data) => ({
  source: "genius",
  title: data.album?.split(" by ")?.[0] || null,
  artist: data.artist || null,
  album: data.album || null,
  duration: null,
  instrumental: false,
  lyrics: data.lyrics || null,
  synced_lyrics: null,
  thumbnail: data.thumbnail || null,
  release_date: data.release_date || null,
  url: data.url || null,
});

export default {
  name: "Lyrics Finder",
  category: "search",
  description: "Cari lirik lagu berdasarkan judul (multi-source: LRCLIB + Genius)",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Judul lagu. Format: 'Shape of You' atau 'Ed Sheeran - Shape of You'",
    },
    source: {
      type: "string",
      required: false,
      description: "Paksa source: 'lrclib' atau 'genius'. Default: auto",
    },
    include_synced: {
      type: "boolean",
      required: false,
      description: "Sertakan synced lyrics (.lrc) kalau ada (default: true)",
    },
  },
  execute: async (req) => {
    const rawQuery = req.query.query || req.body?.query;
    const forceSource = (req.query.source || req.body?.source || "").toLowerCase();
    const includeSynced =
      String(req.query.include_synced ?? req.body?.include_synced ?? "true") ===
      "true";

    if (!rawQuery) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();
    const parsed = parseQuery(rawQuery);

    let result = null;

    if (!forceSource || forceSource === "lrclib") {
      result = await findLrclib(parsed);
      if (result && !forceSource) {
        result = normalizeLrclib(result);
      }
    }

    if (!result && (!forceSource || forceSource === "genius")) {
      const geniusData = await findGenius(parsed);
      if (geniusData) {
        result = normalizeGenius(geniusData);
      }
    }

    if (!result) {
      throw new Error(
        `Lirik tidak ditemukan untuk: ${rawQuery}. Coba format 'Judul - Artis' atau ejaan berbeda.`
      );
    }

    if (!includeSynced && result.synced_lyrics) {
      delete result.synced_lyrics;
    }

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      query: rawQuery,
      parsed: {
        title: parsed.title,
        artist: parsed.artist,
      },
      ...result,
      lyrics_length: result.lyrics?.length || 0,
      process_time: elapsed,
    };
  },
};
