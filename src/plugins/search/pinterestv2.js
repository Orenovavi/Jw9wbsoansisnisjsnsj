import * as Pinterest from "@myno_21/pinterest-scraper";

const extractPinId = (url) => {
  if (!url) return null;
  const match = url.match(/\/pin\/(\d+)/);
  if (match) return match[1];
  if (url.includes("pin.it/")) {
    return url.split("pin.it/")[1]?.split(/[/?#]/)[0] || null;
  }
  return null;
};

const isValidPinterestUrl = (url) => {
  if (!url) return false;
  return /pinterest\.[a-z.]+\/pin\//.test(url) || /pin\.it\//.test(url);
};

export default {
  name: "Pinterest Search",
  category: "search",
  description: "Cari pin di Pinterest berdasarkan kata kunci, lengkap dengan caption/deskripsi",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian"
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil maksimal (default: 10)"
    }
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const limit = Math.min(parseInt(req.query.limit || req.body?.limit || 10), 20);

    if (!query) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();
    const results = [];

    // Search Pinterest
    const searchData = await Pinterest.searchPins(query, limit);

    if (!searchData || searchData.length === 0) {
      throw new Error("Tidak ada hasil ditemukan untuk kata kunci tersebut");
    }

    // Ambil caption untuk setiap pin (opsional, tapi butuh request tambahan)
    for (const pin of searchData) {
      const pinId = extractPinId(pin.link);
      let description = pin.description || null;

      // Kalau caption belum ada, coba ambil detail pin
      if (!description && pinId) {
        try {
          const detail = await Pinterest.getPins(pinId);
          description = detail.description || null;
        } catch {
          // skip kalau gagal
        }
      }

      results.push({
        pin_id: pinId,
        title: pin.title || null,
        description,
        image: pin.image || null,
        link: pin.link || null
      });
    }

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      query,
      total: results.length,
      results,
      process_time: elapsed
    };
  }
};
