import axios from "axios";

const BASE_URL = "https://dezncone.vercel.app";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const TIMEOUT = 30000;
const CACHE_TTL = 30 * 1000;
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 20;

// ============================================================
// RATE LIMIT
// ============================================================
const rateLimitMap = new Map();

const checkRateLimit = (key) => {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const resetIn = Math.ceil((RATE_LIMIT_WINDOW - (now - entry.start)) / 1000);
    return { allowed: false, resetIn };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
};

// ============================================================
// CACHE
// ============================================================
const cache = new Map();

const getCache = (key) => {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return e.value;
};

const setCache = (key, value) => {
  if (cache.size >= 200) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 40);
    for (const [k] of oldest) cache.delete(k);
  }
  cache.set(key, { value, ts: Date.now() });
};

// ============================================================
// REQUEST KE API DEZNCONE
// ============================================================
const searchPinterest = async (query) => {
  const res = await axios.get(`${BASE_URL}/api/search/pinterestv2`, {
    params: { query },
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: `${BASE_URL}/`,
      Origin: BASE_URL,
    },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw new Error(`API HTTP ${res.status}`);
  }

  return res.data;
};

// ============================================================
// AMBIL URL GAMBAR DARI RESULT (struktur dezncone)
// ============================================================
const getImageUrls = (data) => {
  // Format standar dezncone: { status, creator, result: [...] }
  const list = data?.result || data?.data?.result || data?.results || data?.data || [];

  if (!Array.isArray(list)) return [];

  const urls = [];

  for (const item of list) {
    // Kalau item berupa string URL langsung
    if (typeof item === "string" && item.startsWith("http")) {
      urls.push(item);
      continue;
    }

    // Kalau item berupa object
    if (item && typeof item === "object") {
      const url =
        item.image ||
        item.image_url ||
        item.url ||
        item.src ||
        item.original ||
        item.origin ||
        item.link ||
        item.download_url ||
        (Array.isArray(item.images) ? item.images[0] : null);

      if (typeof url === "string" && url.startsWith("http")) {
        urls.push(url);
      }

      // Kalau ada nested images
      if (Array.isArray(item.images)) {
        for (const img of item.images) {
          if (typeof img === "string" && img.startsWith("http")) urls.push(img);
          else if (img?.url) urls.push(img.url);
        }
      }
    }
  }

  // Dedupe
  return [...new Set(urls)];
};

// ============================================================
// PLUGIN EXPORT — ROUTE: /api/Search/femboy
// ============================================================
export default {
  name: "Femboy Search",
  category: "image",
  description: "Ambil gambar femboy random dari Pinterest.",
  method: ["GET"],
  route: "/api/Search/femboy",
  cache: 0,
  params: {
    userId: {
      type: "string",
      required: false,
      description: "ID user untuk rate limit",
    },
  },
  execute: async (req) => {
    const userId = req.query.userId || req.ip || "anon";

    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      throw new Error(`Rate limit. Coba lagi dalam ${rate.resetIn} detik.`);
    }

    const cacheKey = "femboy:v2";
    const cached = getCache(cacheKey);
    if (cached) {
      return { ...cached, from_cache: true, remaining_quota: rate.remaining };
    }

    const startTime = Date.now();

    try {
      const data = await searchPinterest("femboy");

      // Validasi response
      if (!data) throw new Error("Response kosong dari API Pinterest");

      if (data.status === false) {
        throw new Error(`API error: ${data.message || data.msg || "unknown"}`);
      }

      const images = getImageUrls(data);

      if (images.length === 0) {
        throw new Error("Tidak ada gambar di response Pinterest");
      }

      const picked = images[Math.floor(Math.random() * images.length)];
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      const final = {
        image_url: picked,
        total_found: images.length,
        remaining_quota: rate.remaining,
        process_time: elapsed,
      };

      setCache(cacheKey, final);

      console.log(`[Femboy] OK | user=${userId} | ${elapsed}`);
      return final;
    } catch (err) {
      console.error(`[Femboy] FAIL | user=${userId} | ${err.message}`);
      throw new Error(`Gagal ambil gambar: ${err.message}`);
    }
  },
};
