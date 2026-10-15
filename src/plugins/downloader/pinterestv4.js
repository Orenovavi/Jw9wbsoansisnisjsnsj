import axios from "axios";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

// ═══════════════════════════════════════════
//  PLUGIN CONFIG
// ═══════════════════════════════════════════
const pluginConfig = {
  name: "pindlv4",
  alias: ["pinterestv4", "pinv4", "pindl4", "pin"],
  category: "download",
  description: "Download gambar/video Pinterest (v4 - internal scraper)",
  usage: ".pindlv4 <url>",
  example: ".pindlv4 https://pin.it/xxx",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 1,
  isEnabled: true,
};

// ═══════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════
const DOMAINS = ["in.pinterest.com", "id.pinterest.com", "www.pinterest.com", "fi.pinterest.com"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const APP_VERSION = "c1e40b0";
const OP_TIMEOUT = 15000;
const SESSION_TTL = 30 * 60 * 1000;

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
//  PARSER
// ═══════════════════════════════════════════
const buildPinUrl = (domain, pinId) => {
  const payload = { options: { id: pinId, field_set_key: "detailed" }, context: {} };
  const data = encodeURIComponent(JSON.stringify(payload));
  return `https://${domain}/resource/PinResource/get/?source_url=%2Fpin%2F${pinId}%2F&data=${data}`;
};

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
  if (!videos?.video_list) return { mp4: null, hls: null, needsConversion: false };

  const list = videos.video_list;
  const mp4 = list.V_720P?.url || list.V_480P?.url || list.V_360P?.url || list.V_240P?.url || null;
  const hls = list.V_HLSV4?.url || list.V_HLSV3?.url || null;

  const safeMp4 = mp4 && !isHls(mp4) ? mp4 : null;
  const safeHls = hls && isHls(hls) ? hls : null;

  return {
    mp4: safeMp4,
    hls: safeHls,
    needsConversion: !safeMp4 && Boolean(safeHls),
  };
};

const parsePin = (pin) => {
  if (!pin) return null;
  const videoInfo = pickBestVideo(pin.videos);
  const imageUrl = pickBestImage(pin.images);

  return {
    pin_id: pin.id || null,
    title: extractText(pin.title) || extractText(pin.grid_title) || null,
    description: extractText(pin.description) || extractText(pin.closeup_description) || null,
    username: pin.pinner?.username || null,
    fullname: extractText(pin.pinner?.full_name) || null,
    board: pin.board?.name || null,
    image: imageUrl,
    thumbnail: pin.images?.["236x"]?.url || null,
    video: videoInfo.mp4,
    video_hls: videoInfo.hls,
    video_needs_conversion: videoInfo.needsConversion,
    is_video: Boolean(videoInfo.mp4 || videoInfo.hls),
    domain: pin.domain || null,
    source_url: pin.link || null,
    saves: pin.repin_count || 0,
    comments: pin.comment_count || 0,
    created_at: pin.created_at || null,
    url: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
  };
};

const detectError = (data, httpStatus) => {
  if (httpStatus === 403) return "Rate limit Pinterest. Tunggu 5-10 menit.";
  if (httpStatus === 404) return "Pin tidak ditemukan atau sudah dihapus.";
  if (httpStatus === 429) return "Terlalu banyak request. Coba lagi nanti.";
  const err = data?.resource_response?.error;
  if (err?.message) return err.message;
  return "Pin tidak ditemukan atau sudah dihapus.";
};

// ═══════════════════════════════════════════
//  MAIN SCRAPER
// ═══════════════════════════════════════════
async function scrapePinterest(url) {
  if (!isValidPinterestUrl(url)) {
    throw new Error("URL tidak valid. Harus pinterest.com/pin/<angka>/ atau pin.it/<kode>");
  }

  const short = await resolveShort(url);
  if (!short.resolved) {
    throw new Error("Gagal resolve shortlink pin.it. Coba copy URL lengkap dari browser.");
  }

  const resolved = short.url;
  const pinId = extractPinId(resolved);
  if (!pinId) throw new Error(`Pin ID tidak ditemukan di URL: ${resolved}`);

  const s = await fetchSession();
  const triedDomains = [];
  let lastError = null;

  for (const domain of [s.domain, ...DOMAINS.filter((d) => d !== s.domain)]) {
    triedDomains.push(domain);
    try {
      const res = await withTimeout(
        axios.get(buildPinUrl(domain, pinId), {
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

      const pin = parsePin(data.resource_response.data);
      if (!pin) {
        lastError = "Gagal parsing data pin.";
        continue;
      }

      return {
        ...pin,
        original_url: url,
        resolved_url: resolved,
        was_shortlink: short.was_short,
        short_code: short.shortCode || null,
        domain_used: domain,
        domains_tried: triedDomains,
      };
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  throw new Error(`Semua domain gagal: ${lastError || "Pinterest menolak request"}`);
}

// ═══════════════════════════════════════════
//  FFMPEG HLS → MP4
// ═══════════════════════════════════════════
async function convertHlsToMp4(hlsUrl) {
  const tempDir = path.join(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const outPath = path.join(tempDir, `pin_${Date.now()}.mp4`);

  await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-user_agent", UA,
      "-headers", "Referer: https://www.pinterest.com/\r\n",
      "-i", hlsUrl,
      "-c", "copy",
      "-bsf:a", "aac_adtstoasc",
      outPath,
    ]);
    ff.stderr.on("data", () => {});
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg gagal convert HLS"))));
    ff.on("error", (err) => reject(err));
  });

  return outPath;
}

// ═══════════════════════════════════════════
//  CAPTION
// ═══════════════════════════════════════════
function buildCaption(r) {
  const desc = r.description
    ? r.description.substring(0, 150) + (r.description.length > 150 ? "..." : "")
    : "-";
  return (
    `📌 *${r.title || "Pinterest Media"}*\n` +
    `📝 ${desc}\n\n` +
    `👤 ${r.fullname || "-"} (@${r.username || "-"})\n` +
    `📋 Board: ${r.board || "-"}\n` +
    `💾 Saves: ${r.saves ?? 0} • 💬 ${r.comments ?? 0}\n` +
    `🔗 ${r.url}`
  );
}

// ═══════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════
async function handler(m, { sock }) {
  const url = m.text?.trim();

  if (!url) {
    return m.reply(
      `📌 *ᴘɪɴᴛᴇʀᴇsᴛ ᴅᴏᴡɴʟᴏᴀᴅ ᴠ4*\n\n` +
        `> Download gambar/video dari Pinterest\n\n` +
        `*ᴄᴏɴᴛᴏʜ:*\n` +
        `> \`${m.prefix}${pluginConfig.name} https://pin.it/xxx\`\n` +
        `> \`${m.prefix}${pluginConfig.name} https://pinterest.com/pin/xxx\``,
    );
  }

  if (!isValidPinterestUrl(url)) {
    return m.reply("❌ URL tidak valid. Gunakan link Pinterest (pinterest.com/pin/... atau pin.it/...).");
  }

  m.react("🕕");

  let hlsFile = null;

  try {
    const r = await scrapePinterest(url);
    const caption = buildCaption(r);

    // ── VIDEO ──
    if (r.is_video) {
      // 1. MP4 langsung
      if (r.video) {
        try {
          const buf = await axios.get(r.video, {
            responseType: "arraybuffer",
            timeout: 90000,
            headers: { "User-Agent": UA, Referer: "https://www.pinterest.com/" },
          });
          await sock.sendMedia(m.chat, Buffer.from(buf.data), caption, m, {
            type: "video",
            mimetype: "video/mp4",
            fileName: `pinterest_${r.pin_id || Date.now()}.mp4`,
            contextInfo: { forwardingScore: 99, isForwarded: true },
          });
        } catch {
          // Fallback kirim URL langsung
          await sock.sendMedia(m.chat, r.video, caption, m, {
            type: "video",
            mimetype: "video/mp4",
            fileName: `pinterest_${r.pin_id || Date.now()}.mp4`,
            contextInfo: { forwardingScore: 99, isForwarded: true },
          });
        }
      }
      // 2. HLS → convert pakai ffmpeg
      else if (r.video_hls) {
        try {
          hlsFile = await convertHlsToMp4(r.video_hls);
          await sock.sendMedia(m.chat, fs.readFileSync(hlsFile), caption, m, {
            type: "video",
            mimetype: "video/mp4",
            fileName: `pinterest_${r.pin_id || Date.now()}.mp4`,
            contextInfo: { forwardingScore: 99, isForwarded: true },
          });
        } catch (ffErr) {
          // Fallback: kirim link HLS
          await m.reply(
            `⚠️ Gagal convert video ke MP4 (${ffErr.message}).\n\n🔗 Link HLS:\n${r.video_hls}`,
          );
        }
      } else {
        throw new Error("Video URL tidak ditemukan.");
      }
    }
    // ── IMAGE ──
    else if (r.image) {
      await sock.sendMedia(m.chat, r.image, caption, m, {
        type: "image",
        contextInfo: { forwardingScore: 99, isForwarded: true },
      });
    } else {
      throw new Error("Tidak ada media yang bisa di-download.");
    }

    m.react("✅");
  } catch (error) {
    console.error("[PinDLv4] Error:", error);
    m.react("☢");
    m.reply(`❌ *Gagal download Pinterest*\n\n> ${error.message || "Unknown error"}`);
  } finally {
    if (hlsFile && fs.existsSync(hlsFile)) {
      try { fs.unlinkSync(hlsFile); } catch {}
    }
  }
}

export { pluginConfig as config, handler };
