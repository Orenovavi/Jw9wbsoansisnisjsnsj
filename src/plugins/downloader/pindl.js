import { safeFetch } from "../../function.js";

/* ============================================================
 * Provider internal (tidak diekspos ke response / error publik)
 * ============================================================ */
const PROVIDERS = [
  {
    name: "p1",
    fn: async (url) => {
      const res = await safeFetch(
        `https://btch-downloader-api-green.vercel.app/api/download/pinterest?url=${encodeURIComponent(url)}`,
        { headers: { "User-Agent": "Mozilla/5.0" } },
        20000
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.success) throw new Error("no-success");

      const raw = data?.normalized?.media || data?.result?.media || [];
      if (!Array.isArray(raw) || !raw.length) throw new Error("empty");

      return raw.map((m) => ({
        type: m.type === "video" ? "video" : "image",
        url: m.url,
        quality: m.quality || null,
        thumbnail: m.thumbnail || null,
      }));
    },
  },
  {
    name: "p2",
    fn: async (url) => {
      const res = await safeFetch(
        "https://pin.vinayop.cloud/pin",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
          },
          body: JSON.stringify({ url }),
        },
        20000
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const raw = payload?.data || payload?.result || payload;

      if (!raw || typeof raw !== "object") throw new Error("invalid");

      const items = [];
      if (raw.video) {
        items.push({
          type: "video",
          url: raw.video,
          quality: raw.quality || null,
          thumbnail: raw.thumbnail || null,
        });
      }
      if (raw.image) {
        items.push({
          type: "image",
          url: raw.image,
          quality: null,
          thumbnail: raw.thumbnail || null,
        });
      }
      if (Array.isArray(raw.medias)) {
        for (const m of raw.medias) {
          if (!m?.url) continue;
          items.push({
            type: m.type === "video" ? "video" : "image",
            url: m.url,
            quality: m.quality || null,
            thumbnail: m.thumbnail || null,
          });
        }
      }
      if (!items.length) throw new Error("empty");
      return items;
    },
  },
];

/* ============================================================
 * Resolver — coba semua provider, simpan error internal saja
 * ============================================================ */
const resolveMedia = async (url) => {
  const internalErrors = [];

  for (const p of PROVIDERS) {
    try {
      const media = await p.fn(url);
      return { media, source: p.name };
    } catch (err) {
      internalErrors.push(`${p.name}=${err.message}`);
    }
  }

  // error publik tidak membocorkan detail provider
  const err = new Error("Gagal mengambil media dari Pinterest, coba lagi nanti");
  err.internal = internalErrors.join(" | ");
  throw err;
};

/* ============================================================
 * Handler utama
 * ============================================================ */
export default {
  name: "Pinterest Downloader",
  category: "downloader",
  description: "Download video dan gambar dari Pinterest",
  method: ["GET", "POST"],
  params: {
    url: {
      type: "string",
      required: true,
      description:
        "URL Pin Pinterest (contoh: https://pin.it/xxxx atau https://www.pinterest.com/pin/123)",
    },
    type: {
      type: "string",
      required: false,
      description: "Filter tipe media: 'video' atau 'image' (opsional)",
    },
  },
  execute: async (req) => {
    const inputUrl = req.query.url || req.body?.url;
    const filterType = (req.query.type || req.body?.type || "").toLowerCase();

    if (!inputUrl) throw new Error("Parameter 'url' wajib disertakan");
    if (!inputUrl.startsWith("http://") && !inputUrl.startsWith("https://")) {
      throw new Error("Format URL tidak valid (harus diawali http:// atau https://)");
    }
    if (!/(^|\.)pinterest\./i.test(inputUrl) && !/pin\.it/i.test(inputUrl)) {
      throw new Error("URL bukan berasal dari Pinterest");
    }
    if (filterType && filterType !== "video" && filterType !== "image") {
      throw new Error("Parameter 'type' hanya boleh 'video' atau 'image'");
    }

    const { media } = await resolveMedia(inputUrl);

    const filtered = filterType
      ? media.filter((m) => m.type === filterType)
      : media;

    if (filtered.length === 0) {
      throw new Error(
        filterType
          ? `Tidak ada media bertipe '${filterType}' pada Pin ini`
          : "Tidak ada media yang dapat diunduh dari Pin ini"
      );
    }

    return {
      status: true,
      url: inputUrl,
      type: filterType || "all",
      total: filtered.length,
      media: filtered.map((m, i) => ({
        index: i + 1,
        type: m.type,
        quality: m.quality,
        thumbnail: m.thumbnail,
        download_url: m.url,
      })),
      created_at: new Date().toISOString(),
    };
  },
};
