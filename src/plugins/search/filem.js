import axios from "axios";

const BASE = "https://zaammoviesnr.netlify.app";
const API = `${BASE}/.netlify/functions/zaam-movies`;
const TIMEOUT = 30000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: `${BASE}/`,
};

const VALID_ACTIONS = ["latest", "upcoming", "top_rated", "popular", "search"];

const isString = (v) => typeof v === "string" && v.length > 0;

const normalizeItem = (raw) => {
  if (!raw || typeof raw !== "object") return null;

  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  };

  return {
    title: pick("title", "judul", "name", "nama") || "Tanpa Judul",
    poster: pick("poster", "image", "thumbnail", "img", "cover"),
    rating: pick("rating", "score", "vote_average", "nilai"),
    type: pick("type", "tipe", "category") || "movie",
    year: pick("year", "tahun", "release_date", "date"),
    slug: pick("slug", "id", "url", "link", "href"),
    synopsis: pick("synopsis", "sinopsis", "description", "deskripsi", "overview"),
    genre: pick("genre", "genres", "kategori"),
    duration: pick("duration", "durasi", "runtime"),
  };
};

const extractList = (payload) => {
  if (!payload) return [];

  const r = payload.results !== undefined ? payload.results : payload;

  if (Array.isArray(r)) return r.map(normalizeItem).filter(Boolean);
  if (r && Array.isArray(r.data)) return r.data.map(normalizeItem).filter(Boolean);

  return [];
};

const fetchAction = async (action, params = {}) => {
  const res = await axios.get(API, {
    params: { action, ...params },
    headers: HEADERS,
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = res.data;
  const items = extractList(data);

  if (items.length === 0) {
    throw new Error(`Tidak ada hasil untuk action: ${action}`);
  }

  return { items, raw: data };
};

export default {
  name: "Film",
  category: "search",
  description: "Cari & lihat daftar film terbaru, populer, dan top rated",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    action: {
      type: "string",
      required: false,
      description: `Action: ${VALID_ACTIONS.join(", ")} (default: latest)`,
    },
    q: {
      type: "string",
      required: false,
      description: "Query pencarian (wajib jika action=search)",
    },
    page: {
      type: "number",
      required: false,
      description: "Nomor halaman (opsional)",
    },
  },
  execute: async (req) => {
    const rawAction = (req.query.action || req.body?.action || "latest").toLowerCase();
    const action = VALID_ACTIONS.includes(rawAction) ? rawAction : "latest";
    const q = req.query.q || req.body?.q;
    const page = req.query.page || req.body?.page;

    if (action === "search" && !isString(q)) {
      throw new Error("Parameter 'q' wajib diisi untuk action=search");
    }

    const startTime = Date.now();

    const params = {};
    if (action === "search") params.q = q.trim();
    if (page) params.page = parseInt(page);

    const { items } = await fetchAction(action, params);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      action,
      query: action === "search" ? q.trim() : null,
      total: items.length,
      items,
      process_time: elapsed,
    };
  },
};
