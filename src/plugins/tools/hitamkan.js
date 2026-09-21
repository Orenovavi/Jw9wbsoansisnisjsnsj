import axios from "axios";

const API_URL = "https://negro.consulting/api/process-image";
const TIMEOUT = 30000;
const VALID_FILTERS = ["coklat", "hitam", "putih", "abu", "sepia", "invert", "grayscale"];

const fetchImageBuffer = async (url) => {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: TIMEOUT,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });
  return Buffer.from(res.data);
};

const decodeBase64 = (input) => {
  const clean = input.replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(clean, "base64");
};

const processImage = async (buffer, filter) => {
  const { data } = await axios.post(
    API_URL,
    {
      imageData: buffer.toString("base64"),
      filter
    },
    {
      headers: { "content-type": "application/json" },
      timeout: TIMEOUT
    }
  );

  if (!data || data.status !== "success") {
    throw new Error(data?.message || "API negro.consulting gagal memproses gambar");
  }

  const base64Part = data.processedImageUrl?.split(",")[1];
  if (!base64Part) {
    throw new Error("Response API tidak mengandung gambar");
  }

  return Buffer.from(base64Part, "base64");
};

const detectMime = (buffer) => {
  const hex = buffer.slice(0, 4).toString("hex").toUpperCase();
  if (hex.startsWith("FFD8FF")) return "image/jpeg";
  if (hex.startsWith("89504E47")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (hex.startsWith("52494646")) return "image/webp";
  return "image/jpeg";
};

const detectExt = (mime) => {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "jpg";
};

export default {
  name: "Hitamkan Image",
  category: "tools",
  description: "Apply filter warna ke gambar (coklat, hitam, sepia, dll) via negro.consulting",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    url: {
      type: "string",
      required: false,
      description: "URL gambar yang akan diproses (wajib jika tanpa base64)"
    },
    base64: {
      type: "string",
      required: false,
      description: "Data base64 gambar (wajib jika tanpa url)"
    },
    filter: {
      type: "string",
      required: false,
      description: `Filter warna: ${VALID_FILTERS.join(", ")} (default: coklat)`
    },
    download: {
      type: "boolean",
      required: false,
      description: "Auto-download file (default: false)"
    },
    json: {
      type: "boolean",
      required: false,
      description: "Return JSON base64 (default: false, return gambar)"
    }
  },
  execute: async (req, res) => {
    const p = { ...req.query, ...req.body };

    if (!p.url && !p.base64) {
      res.status(400).json({
        status: false,
        creator: "JustPutu's",
        message: "Parameter 'url' atau 'base64' wajib diisi"
      });
      return;
    }

    const filter = (p.filter || "coklat").toLowerCase();
    const isDownload = String(p.download) === "true";
    const asJson = String(p.json) === "true";

    try {
      const inputBuffer = p.url
        ? await fetchImageBuffer(p.url)
        : decodeBase64(p.base64);

      if (!inputBuffer || inputBuffer.length === 0) {
        throw new Error("Buffer gambar kosong");
      }

      if (inputBuffer.length > 5 * 1024 * 1024) {
        throw new Error("Ukuran gambar terlalu besar (max 5 MB)");
      }

      const processedBuffer = await processImage(inputBuffer, filter);
      const mime = detectMime(processedBuffer);
      const ext = detectExt(mime);

      if (asJson) {
        return {
          filter,
          input_size: inputBuffer.length,
          output_size: processedBuffer.length,
          size_formatted: `${(processedBuffer.length / 1024).toFixed(2)} KB`,
          mime,
          base64: processedBuffer.toString("base64"),
          dataUri: `data:${mime};base64,${processedBuffer.toString("base64")}`
        };
      }

      const filename = `hitamkan-${Date.now()}.${ext}`;

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", processedBuffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        isDownload
          ? `attachment; filename="${filename}"`
          : `inline; filename="${filename}"`
      );

      res.end(processedBuffer);
    } catch (err) {
      res.status(500).json({
        status: false,
        creator: "JustPutu's",
        message: err.message || "Gagal memproses gambar"
      });
    }
  }
};
