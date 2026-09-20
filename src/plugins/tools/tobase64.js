import axios from "axios";

const fetchBuffer = async (url) => {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  return Buffer.from(res.data);
};

const detectMime = (buffer) => {
  const hex = buffer.slice(0, 4).toString("hex").toUpperCase();

  if (hex.startsWith("FFD8FF")) return "image/jpeg";
  if (hex.startsWith("89504E47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("52494646")) return "image/webp";
  if (hex.startsWith("25504446")) return "application/pdf";
  if (hex.startsWith("504B0304")) return "application/zip";
  if (hex.startsWith("1F8B08")) return "application/gzip";
  if (hex.startsWith("4D5A")) return "application/x-msdownload";
  if (hex.startsWith("00000018") || hex.startsWith("00000020")) return "video/mp4";

  return "application/octet-stream";
};

export default {
  name: "To Base64",
  category: "tools",
  description: "Konversi file dari URL menjadi string base64 (dengan atau tanpa data URI prefix)",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL file yang akan dikonversi ke base64"
    },
    dataUri: {
      type: "boolean",
      required: false,
      description: "Sertakan prefix data URI (default: false)"
    }
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const dataUri = String(req.query.dataUri || req.body?.dataUri) === "true";

    if (!url) {
      throw new Error("Parameter 'url' wajib diisi");
    }

    if (!/^https?:\/\//i.test(url)) {
      throw new Error("URL harus dimulai dengan http:// atau https://");
    }

    const startTime = Date.now();
    const buffer = await fetchBuffer(url);

    if (!buffer || buffer.length === 0) {
      throw new Error("File kosong atau gagal diunduh");
    }

    const mime = detectMime(buffer);
    const base64 = buffer.toString("base64");
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      mime,
      size: buffer.length,
      size_formatted: `${(buffer.length / 1024).toFixed(2)} KB`,
      base64: dataUri ? `data:${mime};base64,${base64}` : base64,
      process_time: elapsed
    };
  }
};
