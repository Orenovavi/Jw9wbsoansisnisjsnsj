import { safeFetch } from "../../function.js";

// ============================================================
// SEARCH PINTEREST
// ============================================================
const searchPinterest = async (query) => {
  const targetUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/?data=${encodeURIComponent(JSON.stringify({ options: { query } }))}`;

  const response = await safeFetch(targetUrl, {
    method: "HEAD",
    headers: {
      "screen-dpr": "4",
      "x-pinterest-pws-handler": "www/search/[scope].js"
    }
  }, 15000);

  const linkHeader = response.headers.get("link") || "";
  return [...linkHeader.matchAll(/<(https:\/\/i\.pinimg\.com\/[^>]+)>/g)].map((m) => m[1]);
};

// ============================================================
// PLUGIN EXPORT — ROUTE: /api/Search/femboy
// ============================================================
export default {
  name: "Femboy Search",
  category: "search",
  description: "Ambil gambar femboy random dari Pinterest",
  method: ["GET", "POST"],
  params: {
    limit: {
      type: "number",
      required: false,
      description: "Jumlah gambar yang dikembalikan (default 5, max 20)"
    }
  },
  execute: async (req) => {
    const rawLimit = req.query.limit || req.body?.limit || 5;
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 5, 1), 20);

    const urls = await searchPinterest("femboy");

    if (!urls.length) {
      throw new Error("Tidak ada gambar ditemukan");
    }

    const picked = urls[Math.floor(Math.random() * urls.length)];
    const results = urls.slice(0, limit);

    return {
      query: "femboy",
      count: results.length,
      image: picked,
      results
    };
  }
};
