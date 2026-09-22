import axios from "axios";

const DOMAINS = ["in.pinterest.com", "id.pinterest.com", "www.pinterest.com", "fi.pinterest.com"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const APP_VERSION = "c1e40b0";
const OP_TIMEOUT = 15000;
const SESSION_TTL = 30 * 60 * 1000;

let session = { cookie: "", csrf: "", domain: DOMAINS[0], expires: 0 };

const isString = (v) => typeof v === "string" && v.length > 0;

const withTimeout = (promise, ms = OP_TIMEOUT) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
  ]);

const extractText = (val) => {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object") return val.format || val.text || val.string || null;
  return null;
};

const isValidPinterestUrl = (url) => {
  if (!url) return false;
  return /pinterest\.[a-z.]+\/pin\//i.test(url) || /pin\.it\//i.test(url);
};

const extractPinId = (url) => {
  if (!url) return null;
  const m = url.match(/\/pin\/(\d+)/);
  if (m) return m[1];
  if (url.includes("pin.it/")) return url.split("pin.it/")[1]?.split(/[/?#]/)[0] || null;
  return null;
};

const isPinIt = (url) => /pin\.it\//i.test(url || "");

const isHls = (url) => isString(url) && (url.includes(".m3u8") || url.includes("hls"));

const fetchSession = async () => {
  if (isString(session.cookie) && Date.now() < session.expires) return session;

  for (const domain of DOMAINS) {
    try {
      const res = await axios.get(`https://${domain}/`, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: OP_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true
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
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "X-APP-VERSION": APP_VERSION,
  "X-CSRFToken": s.csrf,
  "X-Pinterest-PWS-Handler": "www/[username]/[slug].js",
  "Cookie": s.cookie,
  "Referer": `https://${s.domain}/`
});

const resolveShort = async (url) => {
  if (!isPinIt(url)) return { url, resolved: false };

  const methods = ["HEAD", "GET"];

  for (const method of methods) {
    try {
      const res = await axios({
        method,
        url,
        headers: { "User-Agent": UA },
        maxRedirects: 0,
        timeout: OP_TIMEOUT,
        validateStatus: () => true
      });

      const location = res.headers?.location;
      if (isString(location)) {
        return { url: location, resolved: true };
      }
    } catch (err) {
      const location = err.response?.headers?.location;
      if (isString(location)) {
        return { url: location, resolved: true };
      }
    }
  }

  return { url, resolved: false };
};

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
  if (!videos?.video_list) return null;

  const list = videos.video_list;
  const mp4 =
    list.V_720P?.url ||
    list.V_480P?.url ||
    list.V_360P?.url ||
    list.V_240P?.url ||
    null;

  const hls =
    list.V_HLSV4?.url ||
    list.V_HLSV3?.url ||
    null;

  return {
    mp4: mp4 || (hls && !isHls(hls) ? hls : null),
    hls: hls && isHls(hls) ? hls : null,
    needsConversion: !mp4 && Boolean(hls)
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
    video: videoInfo?.mp4 || null,
    video_hls: videoInfo?.hls || null,
    video_needs_conversion: videoInfo?.needsConversion || false,
    is_video: Boolean(videoInfo?.mp4 || videoInfo?.hls),
    domain: pin.domain || null,
    source_url: pin.link || null,
    saves: pin.repin_count || 0,
    comments: pin.comment_count || 0,
    created_at: pin.created_at || null,
    url: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null
  };
};

const detectError = (data, httpStatus) => {
  if (httpStatus === 403) return "Rate limit Pinterest. Tunggu 5-10 menit lalu coba lagi.";
  if (httpStatus === 404) return "Pin tidak ditemukan atau sudah dihapus.";
  if (httpStatus === 429) return "Terlalu banyak request. Coba lagi nanti.";

  const err = data?.resource_response?.error;
  if (err?.message) return err.message;

  return "Pin tidak ditemukan atau sudah dihapus.";
};

export default {
  name: "Pinterest Downloader",
  category: "downloader",
  description: "Ambil detail pin Pinterest lengkap dengan caption, media URL, dan statistik",
  method: ["GET", "POST"],
  cache: 60,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL Pinterest (pin.it atau pinterest.com/pin/...)"
    }
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;

    if (!url) {
      throw new Error("Parameter 'url' wajib diisi");
    }

    if (!isValidPinterestUrl(url)) {
      throw new Error("URL tidak valid, harus dari pinterest.com atau pin.it");
    }

    const startTime = Date.now();

    const short = await resolveShort(url);

    if (isPinIt(url) && !short.resolved) {
      throw new Error("Gagal resolve shortlink pin.it. Coba pakai URL lengkap pinterest.com/pin/...");
    }

    const resolved = short.url;
    const pinId = extractPinId(resolved);

    if (!pinId) {
      throw new Error("Pin ID tidak ditemukan dalam URL. Format: pinterest.com/pin/<angka>/");
    }

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
            validateStatus: () => true
          })
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

        if (pin.video_needs_conversion) {
          pin.video_note = "Video hanya tersedia dalam format HLS (.m3u8). Butuh FFmpeg untuk convert ke MP4.";
        }

        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

        return {
          ...pin,
          original_url: url,
          resolved_url: resolved,
          was_shortlink: isPinIt(url),
          domain_used: domain,
          domains_tried: triedDomains,
          process_time: elapsed
        };
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }

    throw new Error(`Semua domain gagal (${triedDomains.join(", ")}): ${lastError || "Pinterest menolak request"}`);
  }
};
