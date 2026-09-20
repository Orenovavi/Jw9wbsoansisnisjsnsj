import axios from "axios";

const FONT_FAMILY = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const DEFAULT_TEMPLATE = "https://cdn.zass.in/Ve8lvjKtSl.jpg";

const toBuffer = async (src) => {
  if (!src) throw new Error("Sumber gambar wajib diisi");
  if (Buffer.isBuffer(src)) return src;

  if (typeof src === "string" && /^https?:\/\//.test(src)) {
    const res = await axios.get(src, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    return Buffer.from(res.data);
  }

  if (typeof src === "string" && src.startsWith("data:")) {
    const clean = src.replace(/^data:[^;]+;base64,/, "");
    return Buffer.from(clean, "base64");
  }

  throw new Error("Format sumber gambar tidak didukung");
};

const generateCallScreen = async (config) => {
  const sharpImport = await import("sharp");
  const sharp = sharpImport.default || sharpImport;

  const canvasImport = await import("canvas");
  const { createCanvas, loadImage } = canvasImport.default || canvasImport;

  const {
    templateUrl = DEFAULT_TEMPLATE,
    profileUrl,
    name = "Unknown",
    duration = "00:00:00",
    status = "",
    outputFormat = "jpeg",
    quality = 95
  } = config;

  const [templateBuf, profileBuf] = await Promise.all([
    toBuffer(templateUrl),
    toBuffer(profileUrl)
  ]);

  const [templateImg, profileImgRaw] = await Promise.all([
    loadImage(templateBuf),
    loadImage(profileBuf)
  ]);

  const width = templateImg.width;
  const height = templateImg.height;
  const scale = width / 1080;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.patternQuality = "best";
  ctx.quality = "best";

  ctx.drawImage(templateImg, 0, 0, width, height);

  const avatarSize = Math.round(width * 0.5304);
  const avatarX = Math.round((width - avatarSize) / 2);
  const avatarY = Math.round(height * 0.274);
  const avatarRadius = avatarSize / 2;
  const avatarCenterX = avatarX + avatarRadius;
  const avatarCenterY = avatarY + avatarRadius;

  const profileCanvas = createCanvas(avatarSize, avatarSize);
  const profileCtx = profileCanvas.getContext("2d");
  profileCtx.imageSmoothingEnabled = true;
  profileCtx.imageSmoothingQuality = "high";

  const srcW = profileImgRaw.width;
  const srcH = profileImgRaw.height;
  const srcSize = Math.min(srcW, srcH);
  const srcX = (srcW - srcSize) / 2;
  const srcY = (srcH - srcSize) / 2;

  profileCtx.drawImage(
    profileImgRaw,
    srcX, srcY, srcSize, srcSize,
    0, 0, avatarSize, avatarSize
  );

  const shadowBlur = Math.round(20 * scale);
  const shadowOffset = Math.round(6 * scale);

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetY = shadowOffset;
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(profileCanvas, avatarX, avatarY, avatarSize, avatarSize);
  ctx.restore();

  const ringWidth = Math.max(2, Math.round(3 * scale));
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCenterX, avatarCenterY, avatarRadius - ringWidth / 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = ringWidth;
  ctx.stroke();
  ctx.restore();

  const drawTextWithShadow = (text, x, y, options = {}) => {
    const {
      font = `${Math.round(24 * scale)}px ${FONT_FAMILY}`,
      fillStyle = "#FFFFFF",
      textAlign = "center",
      textBaseline = "top",
      shadowColor = "rgba(0, 0, 0, 0.75)",
      shadowBlur = Math.round(8 * scale),
      shadowOffsetX = 0,
      shadowOffsetY = Math.round(2 * scale),
      maxWidth = null,
      stroke = false,
      strokeColor = "rgba(0, 0, 0, 0.4)",
      strokeWidth = Math.max(1, Math.round(2 * scale))
    } = options;

    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fillStyle;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;

    if (stroke) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = strokeColor;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      if (maxWidth) ctx.strokeText(text, x, y, maxWidth);
      else ctx.strokeText(text, x, y);
    }

    if (maxWidth) ctx.fillText(text, x, y, maxWidth);
    else ctx.fillText(text, x, y);

    ctx.restore();
  };

  const nameFontSize = Math.round(width * 0.030);
  const durationFontSize = Math.round(width * 0.020);
  const statusFontSize = Math.round(width * 0.018);
  const nameY = Math.round(height * 0.040);
  const durationY = nameY + Math.round(nameFontSize * 1.35);
  const statusY = durationY + Math.round(durationFontSize * 1.4);
  const maxTextWidth = Math.round(width * 0.86);

  drawTextWithShadow(name, width / 2, nameY, {
    font: `700 ${nameFontSize}px ${FONT_FAMILY}`,
    fillStyle: "#FFFFFF",
    maxWidth: maxTextWidth
  });

  drawTextWithShadow(duration, width / 2, durationY, {
    font: `400 ${durationFontSize}px ${FONT_FAMILY}`,
    fillStyle: "#C8C8C8",
    shadowColor: "rgba(0, 0, 0, 0.6)",
    shadowBlur: Math.round(6 * scale),
    shadowOffsetY: Math.round(1 * scale),
    maxWidth: maxTextWidth
  });

  if (status) {
    drawTextWithShadow(status, width / 2, statusY, {
      font: `400 ${statusFontSize}px ${FONT_FAMILY}`,
      fillStyle: "#9A9A9A",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      shadowBlur: Math.round(5 * scale),
      shadowOffsetY: Math.round(1 * scale),
      maxWidth: maxTextWidth
    });
  }

  const canvasBuffer = canvas.toBuffer("image/png", {
    compressionLevel: 0,
    filters: canvas.PNG_ALL_FILTERS
  });

  let pipeline = sharp(canvasBuffer, { failOn: "none" }).withMetadata(false);
  pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.5, m2: 0.5 });

  if (outputFormat === "png") {
    pipeline = pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: false
    });
  } else if (outputFormat === "webp") {
    pipeline = pipeline.webp({ quality, effort: 6 });
  } else {
    pipeline = pipeline.jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: "4:4:4"
    });
  }

  return await pipeline.toBuffer();
};

const uploadToTelegraph = async (buffer) => {
  const FormData = (await import("form-data")).default;
  const { fileTypeFromBuffer } = await import("file-type");

  const form = new FormData();
  const type = await fileTypeFromBuffer(buffer);
  const ext = type?.ext || "jpg";

  form.append("file", buffer, { filename: `callscreen.${ext}` });

  const { data } = await axios.post("https://telegra.ph/upload", form, {
    headers: { ...form.getHeaders() },
    timeout: 60000
  });

  if (!data?.[0]?.src) throw new Error("Upload ke Telegraph gagal");
  return `https://telegra.ph${data[0].src}`;
};

export default {
  name: "Call Screen Generator",
  category: "tools",
  description: "Generate gambar fake call screen, hasil otomatis di-upload ke Telegraph",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    profileUrl: {
      type: "string",
      required: true,
      description: "URL foto profil untuk avatar"
    },
    name: {
      type: "string",
      required: false,
      description: "Nama yang ditampilkan (default: Unknown)"
    },
    duration: {
      type: "string",
      required: false,
      description: "Durasi panggilan (default: 00:00:00)"
    },
    status: {
      type: "string",
      required: false,
      description: "Status panggilan (misal: Panggilan suara)"
    },
    outputFormat: {
      type: "string",
      required: false,
      description: "Format output: jpeg, png, webp (default: jpeg)"
    },
    quality: {
      type: "number",
      required: false,
      description: "Kualitas output 1-100 (default: 95)"
    }
  },
  execute: async (req) => {
    const p = { ...req.query, ...req.body };

    if (!p.profileUrl) {
      throw new Error("Parameter 'profileUrl' wajib diisi");
    }

    const outputFormat = ["jpeg", "jpg", "png", "webp"].includes(
      (p.outputFormat || "jpeg").toLowerCase()
    )
      ? (p.outputFormat || "jpeg").toLowerCase()
      : "jpeg";

    const quality = Math.min(Math.max(parseInt(p.quality) || 95, 1), 100);

    const startTime = Date.now();

    const buffer = await generateCallScreen({
      templateUrl: DEFAULT_TEMPLATE,
      profileUrl: p.profileUrl,
      name: p.name || "Unknown",
      duration: p.duration || "00:00:00",
      status: p.status || "",
      outputFormat,
      quality
    });

    const url = await uploadToTelegraph(buffer);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      name: p.name || "Unknown",
      duration: p.duration || "00:00:00",
      status: p.status || null,
      format: outputFormat,
      quality,
      size: buffer.length,
      size_formatted: `${(buffer.length / 1024).toFixed(2)} KB`,
      url,
      process_time: elapsed
    };
  }
};
