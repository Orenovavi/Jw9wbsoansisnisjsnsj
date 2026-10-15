/**
 * Pinterest Downloader REST API
 * Author: Newputz
 * Version: 5.0 (Internal Scraper - Video Fixed)
 * 
 * Endpoints:
 *   GET  /api/pinterest?url=...              → Info pin (JSON)
 *   GET  /api/pinterest?url=...&type=video   → Filter video only
 *   GET  /api/pinterest?url=...&type=image   → Filter image only
 *   GET  /api/pinterest?url=...&direct=true  → Redirect ke media
 *   GET  /api/pinterest/download?url=...     → Proxy download (stream)
 *   POST /api/pinterest                      → Same, body { url }
 */

import axios from "axios";

// ═══════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════
const DOMAINS = ["in.pinterest.com", "id.pinterest.com", "www.pinterest.com", "fi.pinterest.com"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const APP_VERSION = "c1e40b0";
const OP_TIMEOUT = 15000;
const SESSION_TTL = 30 * 60 * 1000;
const FIELD_SETS = ["auth_web_main_pin", "detailed", "embed"];

let session = { cookie: "", csrf: "", domain: DOMAINS[0], expires: 0 };

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
const isString = (v) => typeof v === "string" && v.length > 0;
const isHls = (url) => isString(url) && (url.includes(".m3u8") || url.includes("hls"));

const withTimeout = (promise, ms = OP_TIMEOUT) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);

const extractText = (val) => {
  if (!val) return null;
  if (typeof val === "string") {
    const t = val.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof val === "object") {
    const t = val.format || val.text || val.string || null;
    if (!t) return null;
    const trimmed = String(t).trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const isValidPinterestUrl = (url) => {
  if (!url) return false;
  return /pinterest\.[a-z.]+\/pin\/\d+/i.test(url) || /pin\.it\/[A-Za-z0-9]+/i.test(url);
};

const isPinIt = (url) => /pin\.it\//i.test(url || "");

const extractPinId = (url) => {
  if (!url) return null;
  for (const re of [/\/pin\/(\d+)/, /pin\/(\d+)/, /\/(\d{15,20})(?:[/?#]|$)/]) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
};

// ═══════════════════════════════════════════
//  SESSION
// ═══════════════════════════════════════════
const fetchSession = async () => {
  if (isString(session.cookie) && Date.now() < session.expires) return session;

  for (const domain of DOMAINS) {
    try {
      const res = await axios.get(`https://${domain}/`, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: OP_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true,
      });

      const setCookie = res.headers["set-cookie"] || [];
      const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
      const csrf = cookie.match(/csrftoken=([^;]+)/)?.[1] || "";

      if (isString(cookie)) {
        session = { cookie, csrf, domain, expires: Date.now() + SESSION_TTL };
        return session;
      }
    } catch { continue; }
  }
  return { cookie: "", csrf: "", domain: DOMAINS[0] };
};

const buildHeaders = (s) => ({
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "X-APP-VERSION": APP_VERSION,
  "X-CSRFToken": s.csrf,
  Cookie: s.cookie,
  Referer: `https://${s.domain}/`,
});

// ═══════════════════════════════════════════
//  RESOLVE SHORTLINK
// ═══════════════════════════════════════════
const resolveShort = async (url) => {
  if (!url || !isPinIt(url)) return { url, resolved: true, was_short: false, shortCode: null };

  const shortCode = url.match(/pin\.it\/([A-Za-z0-9]+)/)?.[1] || null;
  if (!shortCode) return { url, resolved: false, was_short: true, shortCode: null };

  const HEADERS = { "User-Agent": UA, Accept: "text/html" };

  for (const attempt of [
    { method: "HEAD", maxRedirects: 0 },
    { method: "GET", maxRedirects: 0 },
    { method: "GET", maxRedirects: 5 },
  ]) {
    try {
      const res = await axios({
        method: attempt.method,
        url: `https://pin.it/${shortCode}`,
        headers: HEADERS,
        maxRedirects: attempt.maxRedirects,
        timeout: 10000,
        validateStatus: () => true,
      });

      const candidates = [
        res.headers?.location,
        res.request?.res?.responseUrl,
        res.request?.responseURL,
        res.request?._redirectable?._currentUrl,
      ].filter(Boolean);

      for (const c of candidates) {
        const m = c.match(/\/pin\/(\d+)/);
        if (m) return { url: `https://www.pinterest.com/pin/${m[1]}/`, resolved: true, was_short: true, shortCode };
      }

      if (typeof res.data === "string") {
        const canonical = res.data.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
        const m = canonical?.match(/\/pin\/(\d+)/);
        if (m) return { url: `https://www.pinterest.com/pin/${m[1]}/`, resolved: true, was_short: true, shortCode };
      }
    } catch (err) {
      const candidates = [
        err.response?.headers?.location,
        err.request?.res?.responseUrl,
        err.request?._redirectable?._currentUrl,
      ].filter(Boolean);
      for (const c of candidates) {
        const m = c.match(/\/pin\/(\d+)/);
        if (m) return { url: `https://www.pinterest.com/pin/${m[1]}/`, resolved: true, was_short: true, shortCode };
      }
    }
  }
  return { url, resolved: false, was_short: true, shortCode };
};

// ═══════════════════════════════════════════
//  BUILD URLs
// ═══════════════════════════════════════════
const buildPinUrl = (domain, pinId, fieldSet = "auth_web_main_pin") => {
  const payload = {
    options: { id: pinId, field_set_key: fieldSet, fetch_visual_search_objects: true },
    context: {},
  };
  const data = encodeURIComponent(JSON.stringify(payload));
  return `https://${domain}/resource/PinResource/get/?source_url=%2Fpin%2F${pinId}%2F&data=${data}`;
};

const buildVideoUrl = (domain, pinId) => {
  const payload = { options: { pin_id: pinId }, context: {} };
  const data = encodeURIComponent(JSON.stringify(payload));
  return `https://${domain}/resource/VideoResource/get/?source_url=%2Fpin%2F${pinId}%2F&data=${data}`;
};

// ═══════════════════════════════════════════
//  PICKERS
// ═══════════════════════════════════════════
const pickBestImage = (images) => {
  if (!images) return null;
  return (
    images.orig?.url ||
    images["736x"]?.url ||
    images["564x"]?.url ||
    images["474x"]?.url ||
    images["236x"]?.url ||
    null
  );
};

const pickBestVideo = (videos) => {
  if (!videos?.video_list) return { mp4: null, hls: null, needsConversion: false, keys: [] };
  const list = videos.video_list;
  const keys = Object.keys(list);

  const mp4 = list.V_720P?.url || list.V_540P?.url || list.V_480P?.url || list.V_360P?.url || list.V_240P?.url || null;
  const hls = list.V_HLSV4?.url || list.V_HLSV3_MOBILE?.url || list.V_HLSV3?.url || list.V_HLSV2?.url || list.V_HLSV1?.url || null;

  const safeMp4 = mp4 && !isHls(mp4) ? mp4 : null;
  const safeHls = hls && isHls(hls) ? hls : null;

  return { mp4: safeMp4, hls: safeHls, needsConversion: !safeMp4 && Boolean(safeHls), keys };
};

const parsePin = (pin) => {
  if (!pin) return null;

  let videoList = pin.videos?.video_list || null;

  // Fallback story_pin_data
  if (!videoList && pin.story_pin_data) {
    const pages = pin.story_pin_data?.pages || [];
    for (const page of pages) {
      const block = (page.blocks || []).find((b) => b.video);
      if (block?.video?.video_list) {
        videoList = block.video.video_list;
        break;
      }
    }
  }

  const videoInfo = pickBestVideo({ video_list: videoList });
  const imageUrl = pickBestImage(pin.images);

  const isVideo =
    Boolean(videoInfo.mp4 || videoInfo.hls) ||
    pin.is_video === true ||
    (pin.videos?.video_list && Object.keys(pin.videos.video_list).length > 0);

  return {
    pin_id: pin.id || null,
    title: extractText(pin.title) || extractText(pin.grid_title) || null,
    description:
      extractText(pin.description) ||
      extractText(pin.closeup_description) ||
      extractText(pin.grid_description) ||
      null,
    username: pin.pinner?.username || null,
    fullname: extractText(pin.pinner?.full_name) || null,
    board: pin.board?.name || null,
    image: imageUrl,
    thumbnail: pin.images?.["236x"]?.url || null,
    video: videoInfo.mp4,
    video_hls: videoInfo.hls,
    video_variants: videoInfo.keys,
    video_needs_conversion: videoInfo.needsConversion,
    is_video: isVideo,
    domain: pin.domain || null,
    source_url: pin.link || null,
    saves: pin.repin_count || 0,
    comments: pin.comment_count || 0,
    created_at: pin.created_at || null,
    url: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
  };
};

// ═══════════════════════════════════════════
//  VIDEO RESOURCE FALLBACK
// ═══════════════════════════════════════════
async function fetchVideoResource(domain, pinId, s) {
  try {
    const res = await withTimeout(
      axios.get(buildVideoUrl(domain, pinId), {
        headers: buildHeaders({ ...s, domain }),
        timeout: OP_TIMEOUT,
        validateStatus: () => true,
      }),
    );
    const vr = res.data?.resource_response?.data;
    if (!vr) return null;
    return vr.video_list || vr.videos?.video_list || null;
  } catch { return null; }
}

// ═══════════════════════════════════════════
//  CORE SCRAPER
// ═══════════════════════════════════════════
async function scrapePinterest(url) {
  if (!isValidPinterestUrl(url)) {
    throw new Error("URL tidak valid. Harus pinterest.com/pin/<angka>/ atau pin.it/<kode>");
  }

  const startTime = Date.now();
  const short = await resolveShort(url);
  if (!short.resolved) throw new Error("Gagal resolve shortlink pin.it.");

  const pinId = extractPinId(short.url);
  if (!pinId) throw new Error(`Pin ID tidak ditemukan: ${short.url}`);

  const s = await fetchSession();
  const triedDomains = [];
  const triedFieldSets = [];
  let lastError = null;

  for (const domain of [s.domain, ...DOMAINS.filter((d) => d !== s.domain)]) {
    triedDomains.push(domain);

    for (const fieldSet of FIELD_SETS) {
      triedFieldSets.push(`${domain}/${fieldSet}`);
      try {
        const res = await withTimeout(
          axios.get(buildPinUrl(domain, pinId, fieldSet), {
            headers: buildHeaders({ ...s, domain }),
            timeout: OP_TIMEOUT,
            validateStatus: () => true,
          }),
        );

        const data = res.data;
        if (data?.resource_response?.status !== "success") {
          lastError = data?.resource_response?.error?.message || "response not success";
          continue;
        }

        const pin = parsePin(data.resource_response.data);
        if (!pin) {
          lastError = "Gagal parsing pin";
          continue;
        }

        // ⚡ VideoResource fallback
        if (pin.is_video && !pin.video && !pin.video_hls) {
          const videoList = await fetchVideoResource(domain, pinId, s);
          if (videoList) {
            const vInfo = pickBestVideo({ video_list: videoList });
            pin.video = vInfo.mp4;
            pin.video_hls = vInfo.hls;
            pin.video_variants = vInfo.keys;
            pin.video_needs_conversion = vInfo.needsConversion;
          }
        }

        if (pin.video_needs_conversion) {
          pin.video_note = "Video hanya tersedia HLS (.m3u8). Perlu ffmpeg untuk convert.";
        }

        return {
          ...pin,
          field_set_used: fieldSet,
          original_url: url,
          resolved_url: short.url,
          was_shortlink: short.was_short,
          short_code: short.shortCode || null,
          domain_used: domain,
          domains_tried: triedDomains,
          field_sets_tried: triedFieldSets,
          process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        };
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }
  }

  throw new Error(`Semua gagal: ${lastError || "Pinterest menolak request"}`);
}

// ═══════════════════════════════════════════
//  PLUGIN EXPORT
// ═══════════════════════════════════════════
export default {
  name: "Pinterest Downloader",
  category: "downloader",
  description:
    "Ambil detail pin Pinterest lengkap dengan caption, media URL, dan statistik. Support URL lengkap & shortlink pin.it. Internal scraper (bukan third-party API).",
  method: ["GET", "POST"],
  cache: 60,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL Pinterest (pinterest.com/pin/... atau pin.it/...)",
    },
    type: {
      type: "string",
      required: false,
      description: "Filter: video | image | all (default: all)",
    },
    direct: {
      type: "boolean",
      required: false,
      description: "Kalau true → return { redirect: '<media_url>' }",
    },
    video_only: {
      type: "boolean",
      required: false,
      description: "Kalau true → throw error kalau bukan video",
    },
  },

  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const type = String(req.query.type || req.body?.type || "all").toLowerCase();
    const direct = req.query.direct === "true" || req.body?.direct === true;
    const videoOnly = req.query.video_only === "true" || req.body?.video_only === true;

    if (!url) throw new Error("Parameter 'url' wajib diisi");
    if (!isValidPinterestUrl(url)) {
      throw new Error("URL tidak valid. Harus pinterest.com/pin/<angka>/ atau pin.it/<kode>");
    }

    const pin = await scrapePinterest(url);

    // ── video_only mode ──
    if (videoOnly) {
      if (!pin.is_video) throw new Error("Pin ini bukan video.");
      if (!pin.video && !pin.video_hls) {
        throw new Error(
          "Video terdeteksi tapi URL kosong. Variants: " +
            (pin.video_variants?.join(", ") || "tidak ada"),
        );
      }
    }

    // ── redirect mode ──
    if (direct) {
      let target = null;
      if (type === "video") target = pin.video || pin.video_hls;
      else if (type === "image") target = pin.image;
      else target = pin.video || pin.video_hls || pin.image;

      if (!target) throw new Error("Media tidak ditemukan");
      return { redirect: target };
    }

    // ── filter type ──
    if (type === "video") {
      if (!pin.is_video) throw new Error("Pin ini bukan video");
      return { ...pin, image: null, thumbnail: null };
    }

    if (type === "image") {
      if (pin.is_video) throw new Error("Pin ini bukan gambar");
      return { ...pin, video: null, video_hls: null, video_variants: [] };
    }

    return pin;
  },
};
