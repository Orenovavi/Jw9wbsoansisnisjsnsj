import * as Pinterest from "@myno_21/pinterest-scraper";

const extractPinId = (url) => {
  if (!url) return null;

  // Format: pinterest.com/pin/123456789/
  const match = url.match(/\/pin\/(\d+)/);
  if (match) return match[1];

  // Format: pin.it/AbC123
  if (url.includes("pin.it/")) {
    return url.split("pin.it/")[1]?.split(/[/?#]/)[0] || null;
  }

  return null;
};

const isValidPinterestUrl = (url) => {
  if (!url) return false;
  return (
    /pinterest\.[a-z.]+\/pin\//.test(url) ||
    /pin\.it\//.test(url)
  );
};

export default {
  name: "Pinterest Downloader",
  category: "downloader",
  description: "Download media Pinterest beserta caption/deskripsi pin",
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

    const pinId = extractPinId(url);
    if (!pinId) {
      throw new Error("Pin ID tidak ditemukan dalam URL");
    }

    const startTime = Date.now();

    try {
      const data = await Pinterest.getPins(pinId);

      if (!data || !data.post) {
        throw new Error("Media tidak ditemukan atau pin sudah dihapus");
      }

      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      return {
        pin_id: pinId,
        title: data.title || null,
        description: data.description || null,
        tags: data.tags || [],
        username: data.username || null,
        followers: data.followers || null,
        media_url: data.post,
        thumbnail: data.image || null,
        comments: data.comments || 0,
        original_url: url,
        process_time: elapsed
      };
    } catch (error) {
      if (error.message.includes("not found") || error.message.includes("404")) {
        throw new Error("Pin tidak ditemukan atau sudah dihapus");
      }
      throw new Error(`Gagal mengambil data Pinterest: ${error.message}`);
    }
  }
};
