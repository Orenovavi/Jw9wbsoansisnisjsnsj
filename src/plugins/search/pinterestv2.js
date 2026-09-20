import nexo from "nexo-aio-downloader";

const isValidPinterestUrl = (url) => {
  if (!url) return false;
  return (
    /pinterest\.[a-z.]+\/pin\//.test(url) ||
    /pin\.it\//.test(url)
  );
};

const extractPinId = (url) => {
  if (!url) return null;
  const match = url.match(/\/pin\/(\d+)/);
  if (match) return match[1];
  if (url.includes("pin.it/")) {
    return url.split("pin.it/")[1]?.split(/[/?#]/)[0] || null;
  }
  return null;
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
      const data = await nexo.pinterest.download(url);

      if (!data || !data.status) {
        throw new Error(data?.message || "Media tidak ditemukan atau pin sudah dihapus");
      }

      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      return {
        pin_id: pinId,
        title: data.data?.title || null,
        description: data.data?.description || data.data?.caption || null,
        tags: data.data?.tags || [],
        username: data.data?.username || null,
        media_url: data.data?.url || data.data?.media || null,
        thumbnail: data.data?.thumbnail || data.data?.image || null,
        original_url: url,
        process_time: elapsed
      };
    } catch (error) {
      if (error.message.includes("Unsupported site")) {
        throw new Error("URL Pinterest tidak dikenali");
      }
      throw new Error(`Gagal mengambil data Pinterest: ${error.message}`);
    }
  }
};
