import { safeFetch } from "../../function.js";
import youtubedl from "youtube-dl-exec";

const VALID_FORMATS = ["mp3", "mp4", "m4a", "webm"];

const CONFIG = {
  timeout: { ytdlp: 60000, cobalt: 30000, piped: 20000, ymcdn: 15000 },
  retries: { ytdlp: 1, cobalt: 2, piped: 3, ymcdn: 2 },
  pollInterval: 1000,
  pollMax: 30,
  cacheTTL: 120,
};

const COBALT_INSTANCES = [
  "https://api.cobalt.tools",
  "https://co.wuk.sh",
  "https://cobalt-api.kwiatekmiki.com",
];

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.projectsegfau.lt",
  "https://pipedapi.tokhmi.xyz",
  "https://pipedapi.moomoo.me",
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const isString = (v) => typeof v === "string" && v.length > 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cacheBust = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const extractVideoId = (url) => {
  if (!isString(url)) return null;
  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
};

const formatDuration = (sec) => {
  if (!sec || isNaN(sec)) return null;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

const jsonFetch = async (url, opts = {}) => {
  const res = await safeFetch(
    url,
    {
      method: opts.method || "GET",
      headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
      body: opts.body,
    },
    opts.timeout || 15000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

/* ============ PROVIDER: yt-dlp ============ */
const providerYtdlp = async (url, format) => {
  const isAudio = format === "mp3" || format === "m4a";
  const formatId = isAudio ? "bestaudio/best" : "best[ext=mp4]/best";

  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
  });

  const downloadUrl = await youtubedl(url, {
    format: formatId,
    getUrl: true,
    noCheckCertificates: true,
    noWarnings: true,
  });

  return {
    title: info.title,
    duration: info.duration,
    duration_formatted: formatDuration(info.duration),
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    views: info.view_count,
    download_url: downloadUrl.trim(),
    provider: "yt-dlp",
  };
};

/* ============ PROVIDER: Cobalt ============ */
const providerCobalt = async (url, format) => {
  const isAudio = format === "mp3" || format === "m4a";
  const body = JSON.stringify({
    url,
    vQuality: "1080",
    isAudioOnly: isAudio,
    isNoTTWatermark: true,
    filenamePattern: "basic",
  });

  for (const instance of COBALT_INSTANCES) {
    try {
      const data = await jsonFetch(`${instance}/api/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body,
        timeout: CONFIG.timeout.cobalt,
      });

      if (data.status === "error" || !data.url) continue;

      return {
        title: data.filename || "YouTube Media",
        duration: null,
        duration_formatted: null,
        thumbnail: null,
        uploader: null,
        views: null,
        download_url: data.url,
        provider: `cobalt (${instance.replace("https://", "")})`,
      };
    } catch {
      continue;
    }
  }

  throw new Error("Semua Cobalt instance gagal");
};

/* ============ PROVIDER: Piped ============ */
const providerPiped = async (url, format) => {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Video ID tidak ditemukan");

  const isAudio = format === "mp3" || format === "m4a";

  for (const instance of PIPED_INSTANCES) {
    try {
      const data = await jsonFetch(`${instance}/streams/${videoId}`, {
        timeout: CONFIG.timeout.piped,
      });

      if (!data?.title) continue;

      const streams = isAudio ? data.audioStreams || [] : data.videoStreams || [];
      const best = streams
        .filter((s) => s.url && s.mimeType)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

      if (!best) continue;

      return {
        title: data.title,
        duration: data.duration,
        duration_formatted: formatDuration(data.duration),
        thumbnail: data.thumbnailUrl,
        uploader: data.uploader,
        views: data.views,
        download_url: best.url,
        provider: `piped (${instance.replace("https://", "")})`,
      };
    } catch {
      continue;
    }
  }

  throw new Error("Semua Piped instance gagal");
};

/* ============ PROVIDER: ymcdn ============ */
const providerYmcdn = async (url, format) => {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("Video ID tidak ditemukan");

  const HEADERS = { Referer: "https://id.ytmp3.mobi/" };

  const init = await jsonFetch(
    `https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471&_=${cacheBust()}`,
    { timeout: CONFIG.timeout.ymcdn, headers: HEADERS }
  );

  if (init.error !== 0 || !isString(init.convertURL)) {
    throw new Error(`Init gagal: ${init.error}`);
  }

  const conv = await jsonFetch(
    `${init.convertURL}&v=${videoId}&f=${format}&_=${cacheBust()}`,
    { timeout: CONFIG.timeout.ymcdn, headers: HEADERS }
  );

  if (conv.error !== 0 || !isString(conv.progressURL)) {
    throw new Error(`Convert gagal: ${conv.error}`);
  }

  for (let i = 0; i < CONFIG.pollMax; i++) {
    const prog = await jsonFetch(conv.progressURL, {
      timeout: CONFIG.timeout.ymcdn,
      headers: HEADERS,
    });

    if (prog.error !== 0) throw new Error(`Progress error: ${prog.error}`);

    if (prog.progress === 3 && isString(prog.downloadURL)) {
      return {
        title: conv.title || prog.title || "YouTube Media",
        duration: prog.duration || null,
        duration_formatted: formatDuration(prog.duration),
        thumbnail: prog.thumbnail || null,
        uploader: null,
        views: null,
        download_url: prog.downloadURL,
        provider: "ymcdn.org",
      };
    }

    await sleep(CONFIG.pollInterval);
  }

  throw new Error("Timeout ymcdn");
};

/* ============ PROVIDER MAP ============ */
const PROVIDERS = {
  ytdlp: providerYtdlp,
  cobalt: providerCobalt,
  piped: providerPiped,
  ymcdn: providerYmcdn,
};

const DEFAULT_ORDER = ["ytdlp", "cobalt", "piped", "ymcdn"];

const runProviders = async (url, format, order) => {
  const tried = [];
  let lastError = null;

  for (const name of order) {
    const fn = PROVIDERS[name];
    if (!fn) continue;

    const retries = CONFIG.retries[name] || 1;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await fn(url, format);
        if (!result?.download_url) throw new Error("download_url kosong");
        return { ...result, providers_tried: tried };
      } catch (err) {
        lastError = err;
        if (attempt < retries) await sleep(1000);
      }
    }

    tried.push(name);
  }

  throw new Error(
    `Semua provider gagal (${tried.join(", ")}). Terakhir: ${lastError?.message || "unknown"}`
  );
};

/* ============ EXPORT API ============ */
export default {
  name: "YouTube Downloader",
  category: "downloader",
  description: "Download YouTube audio/video via multi-provider (yt-dlp + Cobalt + Piped + ymcdn)",
  method: ["GET", "POST"],
  cache: CONFIG.cacheTTL,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL YouTube (watch, shorts, youtu.be)",
    },
    format: {
      type: "string",
      required: false,
      description: `Format output: ${VALID_FORMATS.join(", ")} (default: mp3)`,
    },
    provider: {
      type: "string",
      required: false,
      description: "Paksa provider: ytdlp, cobalt, piped, ymcdn (default: auto)",
    },
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const rawFormat = (req.query.format || req.body?.format || "mp3").toLowerCase();
    const format = VALID_FORMATS.includes(rawFormat) ? rawFormat : "mp3";
    const forceProvider = (req.query.provider || req.body?.provider || "").toLowerCase();

    if (!url) throw new Error("Parameter 'url' wajib diisi");

    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error(
        "URL YouTube tidak valid. Format: youtube.com/watch?v=xxx, youtu.be/xxx, atau youtube.com/shorts/xxx"
      );
    }

    const startTime = Date.now();

    const order =
      forceProvider && PROVIDERS[forceProvider]
        ? [forceProvider]
        : DEFAULT_ORDER;

    const result = await runProviders(url, format, order);

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      video_id: videoId,
      title: result.title,
      duration: result.duration,
      duration_formatted: result.duration_formatted,
      thumbnail: result.thumbnail,
      uploader: result.uploader,
      views: result.views,
      format,
      download_url: result.download_url,
      provider: result.provider,
      providers_tried: result.providers_tried,
      original_url: url,
      process_time: elapsed,
    };
  },
};
