/**
 * Pinterest Downloader REST API
 * Author: Newputz
 * Version: 4.0 (Video Fixed)
 * 
 * Fix: video null → multi field_set + VideoResource fallback + story_pin_data parser
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
const isHls = (url) => isString(url) && (url.includes(".m3u8") || url.includes("hls"));

const extractPinId = (url) => {
  if (!url) return null;
  const patterns = [/\/pin\/(\d+)/, /pin\/(\d+)/, /\/(\d{15,20})(?:[/?#]|$)/];
  for (const re of patterns) {
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
    } catch {
      continue;
    }
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
  "X-Pinterest-PWS-Handler": "www/[username]/[slug].js",
  Cookie: s.cookie,
  Referer: `https://${s.domain}/`,
});

// ═══════════════════════════════════════════
//  RESOLVE SHORTLINK
// ═══════════════════════════════════════════
const resolveShort = async (url) => {
  if (!url || !isPinIt(url)) {
    return { url, resolved: true, was_short: false, shortCode: null };
  }

  const shortCode = url.match(/pin\.it\/([A-Za-z0-9]+)/)?.[1] || null;
  if (!shortCode) return { url, resolved: false, was_short: true, shortCode: null };

  const HEADERS = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };

  const attempts = [
    { method: "HEAD", maxRedirects: 0 },
    { method: "GET", maxRedirects: 0 },
    { method: "GET", maxRedirects: 1 },
    { method: "GET", maxRedirects: 5 },
  ];

  for (const attempt of attempts) {
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

      for (const candidate of candidates) {
        const match = candidate.match(/\/pin\/(\d+)/);
        if (match) {
          return {
            url: `https://www.pinterest.com/pin/${match[1]}/`,
            resolved: true,
            was_short: true,
            shortCode,
          };
        }
      }

      if (res.data && typeof res.data === "string") {
        const canonical = res.data.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
        const pinMatch = canonical?.match(/\/pin\/(\d+)/);
        if (pinMatch) {
          return {
            url: `https://www.pinterest.com/pin/${pinMatch[1]}/`,
            resolved: true,
            was_short: true,
            shortCode,
          };
        }
      }
    } catch (err) {
      const candidates = [
        err.response?.headers?.location,
        err.request?.res?.responseUrl,
        err.request?._redirectable?._currentUrl,
      ].filter(Boolean);

      for (const candidate of candidates) {
        const match = candidate.match(/\/pin\/(\d+)/);
        if (match) {
          return {
            url: `https://www.pinterest.com/pin/${match[1]}/`,
            resolved: true,
            was_short: true,
            shortCode,
          };
        }
      }
    }
  }

  return { url, resolved: false, was_short: true, shortCode };
};

// ═══════════════════════════════════════════
//  BUILD URLS
// ═══════════════════════════════════════════
const buildPinUrl = (domain, pinId, fieldSet = "auth_web_main_pin") => {
  const payload = {
    options: {
      id: pinId,
      field_set_key: fieldSet,
      fetch_visual_search_objects: true,
    },
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

  const mp4 =
    list.V_720P?.url ||
    list.V_540P?.url ||
    list.V_480P?.url ||
    list.V_360P?.url ||
    list.V_240P?.url ||
    null;

  const hls =
    list.V_HLSV4?.url ||
    list.V_HLSV3_MOBILE?.url ||
    list.V_HLSV3?.url ||
    list.V_HLSV2?.url ||
    list.V_HLSV1?.url ||
    null;

  const safeMp4 = mp4 && !isHls(mp4) ? mp4 : null;
  const safeHls = hls && isHls(hls) ? hls : null;

  return {
    mp4: safeMp4,
    hls: safeHls,
    needsConversion: !safeMp4 && Boolean(safeHls),
    keys,
  };
};

// ═══════════════════════════════════════════
//  PARSE PIN
// ═══════════════════════════════════════════
const parsePin = (pin) => {
  if (!pin) return null;

  let videoList = pin.videos?.video_list || null;

  // ⚡ Fallback 1: story_pin_data (pin story/reel)
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

  // Detect pin video dari berbagai sumber
  const isVideo =
    Boolean(videoInfo.mp4 || videoInfo.hls) ||
    pin.is_video === true ||
    pin.videos?.video_list !== undefined;

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

    const videoList = vr.video_list || vr.videos?.video_list || null;
    return videoList || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
//  DETECT ERROR
// ═══════════════════════════════════════════
const detectError = (data, httpStatus) => {
  if (httpStatus === 403) return "Rate limit Pinterest. Tunggu 5-10 menit lalu coba lagi.";
  if (httpStatus === 404) return "Pin tidak ditemukan atau sudah dihapus.";
  if (httpStatus === 429) return "Terlalu banyak request. Coba lagi nanti.";

  const err = data?.resource_response?.error;
  if (err?.message) return err.message;

  return "Pin tidak ditemukan atau sudah dihapus.";
};

// ═══════════════════════════════════════════
//  CORE SCRAPER
// ═══════════════════════════════════════════
async function scrapePinterest(url) {
  if (!isValidPinterestUrl(url)) {
    throw new Error("URL tidak valid. Harus dari pinterest.com/pin/<angka>/ atau pin.it/<kode>");
  }

  const startTime = Date.now();
  const short = await resolveShort(url);

  if (!short.resolved) {
    throw new Error(
      "Gagal resolve shortlink pin.it. Coba buka link di browser, lalu copy URL lengkap dari address bar.",
    );
  }

  const resolved = short.url;
  const pinId = extractPinId(resolved);
  if (!pinId) throw new Error(`Pin ID tidak ditemukan di URL: ${resolved}`);

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
          lastError = detectError(data, res.status);
          continue;
        }

        const rawPin = data.resource_response.data;
        const pin = parsePin(rawPin);
        if (!pin) {
          lastError = "Gagal parsing data pin.";
          continue;
        }

        // ⚡ Kalau is_video true tapi video & video_hls masih null → coba VideoResource
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
          pin.video_note = "Video hanya tersedia HLS (.m3u8). Butuh FFmpeg untuk convert.";
        }

        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

        return {
          ...pin,
          field_set_used: fieldSet,
          original_url: url,
          resolved_url: resolved,
          was_shortlink: short.was_short,
          short_code: short.shortCode || null,
          domain_used: domain,
          domains_tried: triedDomains,
          field_sets_tried: triedFieldSets,
          process_time: elapsed,
        };
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }
  }

  throw new Error(
    `Semua gagal (${triedDomains.join(", ")}): ${lastError || "Pinterest menolak request"}`,
  );
}

// ═══════════════════════════════════════════
//  PLUGIN EXPORT
// ═══════════════════════════════════════════
export default {
  name: "Pinterest Downloader",
  category: "downloader",
  description:
    "Ambil detail pin Pinterest lengkap dengan caption, media URL, dan statistik. Support URL lengkap & shortlink pin.it. Fix video null via multi field_set + VideoResource fallback.",
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
      description: "Kalau true → hanya return kalau ada video, kalau bukan video throw error",
    },
  },

  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const type = String(req.query.type || req.body?.type || "all").toLowerCase();
    const direct = req.query.direct === "true" || req.body?.direct === true;
    const videoOnly = req.query.video_only === "true" || req.body?.video_only === true;

    if (!url) throw new Error("Parameter 'url' wajib diisi");
    if (!isValidPinterestUrl(url)) {
      throw new Error("URL tidak valid. Harus dari pinterest.com/pin/<angka>/ atau pin.it/<kode>");
    }

    const pin = await scrapePinterest(url);

    // ⚡ Video only mode → throw kalau bukan video
    if (videoOnly && !pin.is_video) {
      throw new Error("Pin ini bukan video (tidak ada media video).");
    }

    // ⚡ Video only + video masih null → throw dengan info debug
    if (videoOnly && pin.is_video && !pin.video && !pin.video_hls) {
      throw new Error(
        "Video terdeteksi tapi URL kosong. Variants tersedia: " +
          (pin.video_variants?.join(", ") || "tidak ada"),
      );
    }

    // ── Mode redirect ──
    if (direct) {
      let target = null;
      if (type === "video") target = pin.video || pin.video_hls;
      else if (type === "image") target = pin.image;
      else target = pin.video || pin.video_hls || pin.image;

      if (!target) throw new Error("Media tidak ditemukan");
      return { redirect: target };
    }

    // ── Mode filter ──
    if (type === "video") {
      if (!pin.is_video) throw new Error("Pin ini bukan video");
      return {
        ...pin,
        image: null,
        thumbnail: null,
      };
    }

    if (type === "image") {
      if (pin.is_video) throw new Error("Pin ini bukan gambar");
      return {
        ...pin,
        video: null,
        video_hls: null,
        video_variants: [],
      };
    }

    // ── Mode default ──
    return pin;
  },
};
