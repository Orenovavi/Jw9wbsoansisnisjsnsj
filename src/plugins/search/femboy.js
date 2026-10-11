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
// FETCH PINTEREST
// ============================================================
const fetchFemboy = async () => {
  const queries = ["femboy", "femboy aesthetic", "femboy outfit", "femboy cute"];
  const query = queries[Math.floor(Math.random() * queries.length)];

  const res = await axios.get(`${BASE_URL}/api/search/pinterestv2`, {
    params: { query, limit: 20 },
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw new Error(`Pinterest API HTTP ${res.status}`);
  }

  return res.data;
};

// Ekstrak semua URL gambar dari response
const extractImages = (data) => {
  const urls = new Set();

  const walk = (node) => {
    if (!node) return;

    if (typeof node === "string") {
      if (node.startsWith("http") && (node.includes("pinimg.com") || /\.(jpg|jpeg|png|webp|gif)/i.test(node))) {
        urls.add(node);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        const val = node[key];
        if (
          typeof val === "string" &&
          val.startsWith("http") &&
          (key.toLowerCase().includes("image") ||
            key.toLowerCase().includes("url") ||
            key.toLowerCase().includes("src") ||
            key.toLowerCase().includes("thumb") ||
            key.toLowerCase().includes("origin"))
        ) {
          urls.add(val);
        } else {
          walk(val);
        }
      }
    }
  };

  walk(data);
  return [...urls];
};

// ============================================================
// PLUGIN EXPORT — ROUTE: /api/Search/femboy
// ============================================================
export default {
  name: "Femboy Search",
  category: "image",
  description: "Ambil gambar femboy random dari Pinterest.",
  method: ["GET"],
  route: "/api/search/femboy",
  cache: 0,
  params: {
    userId: {
      type: "string",
      required: false,
      description: "ID user untuk rate limit (opsional)",
    },
  },
  execute: async (req) => {
    const userId = req.query.userId || req.ip || "anon";

    const rate = checkRateLimit(userId);
    if (!rate.allowed) {
      throw new Error(`Rate limit. Coba lagi dalam ${rate.resetIn} detik.`);
    }

    const cacheKey = "femboy:random";
    const cached = getCache(cacheKey);
    if (cached) {
      return { ...cached, from_cache: true, remaining_quota: rate.remaining };
    }

    const startTime = Date.now();

    try {
      const raw = await fetchFemboy();
      const images = extractImages(raw);

      if (images.length === 0) {
        throw new Error("Tidak ada gambar ditemukan");
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
