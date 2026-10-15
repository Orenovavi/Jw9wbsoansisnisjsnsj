/**
 * Pinterest Downloader REST API
 * Author: Newputz
 * Version: 6.0
 * API Source: https://pin.vinayop.cloud
 * 
 * Features:
 *   ✦ Video + Image support (auto-detect)
 *   ✦ No API key needed
 *   ✦ HLS handled server-side
 *   ✦ Direct download URL
 *   ✦ Multi-format output
 *   ✦ Pin metadata lengkap
 *   ✦ Smart cache + retry
 */

import axios from "axios";

// ═══════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════
const API_BASE = "https://pin.vinayop.cloud";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const OP_TIMEOUT = 45000;
const CACHE_TTL = 5 * 60 * 1000;
const MAX_RETRIES = 2;

// Simple in-memory cache
const cache = new Map();

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const isValidPinterestUrl = (url) => {
  if (!url) return false;
  return /pinterest\.[a-z.]+\/pin\/\d+/i.test(url) || /pin\.it\/[A-Za-z0-9]+/i.test(url);
};

const isVideoUrl = (url) => url && (url.includes(".mp4") || url.includes("video") || url.includes(".m3u8"));

const getCacheKey = (url, type) => `${type}:${url}`;

const getFromCache = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
};

const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
  // Limit size
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════
//  FETCH META (via POST /pin)
// ═══════════════════════════════════════════
async function fetchPinMeta(url) {
  const cacheKey = getCacheKey(url, "meta");
  const cached = getFromCache(cacheKey);
  if (cached) return { ...cached, _cached: true };

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await axios.post(
        `${API_BASE}/pin`,
        { url },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": UA,
            Accept: "application/json",
          },
          timeout: OP_TIMEOUT,
        },
      );
      setCache(cacheKey, data);
      return data;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES) await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`Gagal fetch metadata: ${lastError?.message || "unknown"}`);
}

// ═══════════════════════════════════════════
//  PARSE RESPONSE
// ═══════════════════════════════════════════
function parsePinResponse(raw, originalUrl) {
  if (!raw) return null;

  // Support berbagai format response
  const d = raw.result || raw.data || raw;

  // Deteksi video & image URL
  const videoUrl =
    d.video ||
    d.video_url ||
    d.videoUrl ||
    d.mp4 ||
    d.media?.video ||
    d.medias?.find?.((m) => m.type === "video")?.url ||
    null;

  const imageUrl =
    d.image ||
    d.image_url ||
    d.imageUrl ||
    d.thumbnail ||
    d.media?.image ||
    d.medias?.find?.((m) => m.type === "image")?.url ||
    null;

  const isVideo = !!videoUrl || d.type === "video" || d.is_video === true;

  return {
    pin_id: d.pin_id || d.id || extractPinId(originalUrl) || null,
    title: d.title || d.name || "Pinterest Media",
    description: d.description || d.desc || null,
    author: d.author || d.username || d.fullname || d.user || null,
    board: d.board || null,
    type: isVideo ? "video" : "image",
    is_video: isVideo,
    image: imageUrl,
    video: videoUrl,
    thumbnail: d.thumbnail || imageUrl,
    url: d.url || d.pin_url || originalUrl,
    download_url: isVideo ? videoUrl : imageUrl,
    stats: {
      saves: d.saves ?? d.repin_count ?? 0,
      comments: d.comments ?? d.comment_count ?? 0,
      likes: d.likes ?? 0,
    },
    original_url: originalUrl,
  };
}

function extractPinId(url) {
  if (!url) return null;
  const m = url.match(/\/pin\/(\d+)/);
  return m ? m[1] : null;
}

// ═══════════════════════════════════════════
//  GET DOWNLOAD URL (via GET /v1/pin/...)
// ═══════════════════════════════════════════
function getVideoDownloadUrl(url) {
  return `${API_BASE}/v1/pin/video?url=${encodeURIComponent(url)}`;
}

function getImageDownloadUrl(url) {
  return `${API_BASE}/v1/pin/img?url=${encodeURIComponent(url)}`;
}

// ═══════════════════════════════════════════
//  PLUGIN EXPORT
// ═══════════════════════════════════════════
export default {
  name: "Pinterest Downloader",
  category: "downloader",
  description:
    "Download gambar/video Pinterest lengkap dengan metadata. Support URL pin.it & pinterest.com/pin/. Video + image auto-detect.",
  method: ["GET", "POST"],
  cache: 60,

  params: {
    url: {
      type: "string",
      required: true,
      description: "URL Pinterest (pin.it/xxx atau pinterest.com/pin/xxx)",
    },
    type: {
      type: "string",
      required: false,
      description: "Filter: video | image | all (default: all)",
    },
    direct: {
      type: "boolean",
      required: false,
      description: "Kalau true → return { redirect: '<direct_download_url>' }",
    },
    raw: {
      type: "boolean",
      required: false,
      description: "Kalau true → return response mentah dari API",
    },
  },

  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const type = String(req.query.type || req.body?.type || "all").toLowerCase();
    const direct = req.query.direct === "true" || req.body?.direct === true;
    const rawMode = req.query.raw === "true" || req.body?.raw === true;

    // ── Validasi ──
    if (!url) throw new Error("Parameter 'url' wajib diisi");
    if (!isValidPinterestUrl(url)) {
      throw new Error("URL tidak valid. Harus dari pinterest.com/pin/<angka>/ atau pin.it/<kode>");
    }

    const startTime = Date.now();

    // ── Raw mode: return mentah dari API ──
    if (rawMode) {
      const raw = await fetchPinMeta(url);
      return {
        ...raw,
        _meta: {
          source: API_BASE,
          process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        },
      };
    }

    // ── Fetch metadata ──
    const raw = await fetchPinMeta(url);
    const pin = parsePinResponse(raw, url);
    if (!pin) throw new Error("Gagal parsing response dari API Pinterest");

    // ── Filter type ──
    if (type === "video") {
      if (!pin.is_video) throw new Error("Pin ini bukan video (tidak ada media video)");
      pin.image = null;
      pin.thumbnail = null;
      pin.download_url = pin.video;
    } else if (type === "image") {
      if (pin.is_video) throw new Error("Pin ini bukan gambar (pin video)");
      pin.video = null;
      pin.download_url = pin.image;
    }

    // ── Redirect mode ──
    if (direct) {
      let target = null;
      if (type === "video") target = getVideoDownloadUrl(url);
      else if (type === "image") target = getImageDownloadUrl(url);
      else target = pin.is_video ? getVideoDownloadUrl(url) : getImageDownloadUrl(url);

      if (!target) throw new Error("Media tidak ditemukan");

      return {
        redirect: target,
        type: pin.is_video ? "video" : "image",
        pin_id: pin.pin_id,
      };
    }

    // ── Output lengkap ──
    return {
      ...pin,
      download: {
        url: pin.download_url,
        direct_video: getVideoDownloadUrl(url),
        direct_image: getImageDownloadUrl(url),
      },
      _meta: {
        source: API_BASE,
        cached: raw._cached || false,
        process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        version: "6.0",
        author: "Newputz",
      },
    };
  },
};
