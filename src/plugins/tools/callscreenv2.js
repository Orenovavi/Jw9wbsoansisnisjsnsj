import axios from "axios";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

GlobalFonts.registerFromPath(
  path.join(__dirname, "../../media/fonts/Roboto-Bold.ttf"),
  "Roboto Bold"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../../media/fonts/Roboto-Regular.ttf"),
  "Roboto"
);

const FONT_REGULAR = "Roboto";
const FONT_BOLD = "Roboto Bold";

const DEFAULT_TEMPLATE = "https://cdn.zass.in/Ve8lvjKtSl.jpg";

const MIME_MAP = {
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  png: { ext: "png", mime: "image/png" }
};

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

const fitFontSize = (ctx, text, maxWidth, startSize, fontFamily) => {
  let size = startSize;
  while (size > 10) {
    ctx.font = `${size}px ${fontFamily}`;
    const width = ctx.measureText(text).width;
    if (width <= maxWidth) return size;
    size -= 2;
  }
  return 10;
};

const generateCallScreen = async (config) => {
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

  const drawText = (text, x, y, options = {}) => {
    const {
      fontFamily = FONT_REGULAR,
      fontSize = Math.round(24 * scale),
      fillStyle = "#FFFFFF",
      textAlign = "center",
      textBaseline = "top",
      shadowColor = "rgba(0, 0, 0, 0.75)",
      shadowBlur = Math.round(8 * scale),
      shadowOffsetX = 0,
      shadowOffsetY = Math.round(2 * scale),
      maxWidth = null
    } = options;

    ctx.save();
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = fillStyle;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;

    if (maxWidth) ctx.fillText(text, x, y, maxWidth);
    else ctx.fillText(text, x, y);

    ctx.restore();
  };

  const nameFontSize = Math.round(width * 0.030);
  const durationFontSize = Math.round(width * 0.020);
  const statusFontSize = Math.round(width * 0.018);
  const nameY = Math.round(height * 0.040);
  const maxTextWidth = Math.round(width * 0.86);

  const finalNameSize = fitFontSize(ctx, name, maxTextWidth, nameFontSize, FONT_BOLD);
  const finalDurationSize = fitFontSize(ctx, duration, maxTextWidth, durationFontSize, FONT_REGULAR);
  const finalStatusSize = status
    ? fitFontSize(ctx, status, maxTextWidth, statusFontSize, FONT_REGULAR)
    : statusFontSize;

  const durationY = nameY + Math.round(finalNameSize * 1.35);
  const statusY = durationY + Math.round(finalDurationSize * 1.4);

  drawText(name, width / 2, nameY, {
    fontFamily: FONT_BOLD,
    fontSize: finalNameSize,
    fillStyle: "#FFFFFF",
    maxWidth: maxTextWidth
  });

  drawText(duration, width / 2, durationY, {
    fontFamily: FONT_REGULAR,
    fontSize: finalDurationSize,
    fillStyle: "#C8C8C8",
    shadowColor: "rgba(0, 0, 0, 0.6)",
    shadowBlur: Math.round(6 * scale),
    shadowOffsetY: Math.round(1 * scale),
    maxWidth: maxTextWidth
  });

  if (status) {
    drawText(status, width / 2, statusY, {
      fontFamily: FONT_REGULAR,
      fontSize: finalStatusSize,
      fillStyle: "#9A9A9A",
      shadowColor: "rgba(0, 0, 0, 0.5)",
      shadowBlur: Math.round(5 * scale),
      shadowOffsetY: Math.round(1 * scale),
      maxWidth: maxTextWidth
    });
  }

  if (outputFormat === "png") {
    return canvas.toBuffer("image/png");
  }

  return canvas.toBuffer("image/jpeg", quality);
};

export default {
  name: "Call Screen Generator",
  category: "tools",
  description: "Generate gambar fake call screen dari template + foto profil. Hasil langsung berupa gambar.",
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
    format: {
      type: "string",
      required: false,
      description: "Format output: jpeg atau png (default: jpeg)"
    },
    quality: {
      type: "number",
      required: false,
      description: "Kualitas output 1-100 (default: 95)"
    },
    download: {
      type: "boolean",
      required: false,
      description: "Set true untuk auto-download file (default: false)"
    },
    json: {
      type: "boolean",
      required: false,
      description: "Set true untuk return JSON base64 (default: false, return gambar)"
    }
  },
  execute: async (req, res) => {
    const p = { ...req.query, ...req.body };

    if (!p.profileUrl) {
      res.status(400).json({
        status: false,
        creator: "JustPutu's",
        message: "Parameter 'profileUrl' wajib diisi"
      });
      return;
    }

    const outputFormat = ["jpeg", "jpg", "png"].includes(
      (p.format || "jpeg").toLowerCase()
    )
      ? (p.format || "jpeg").toLowerCase()
      : "jpeg";

    const quality = Math.min(Math.max(parseInt(p.quality) || 95, 1), 100);
    const isDownload = String(p.download) === "true";
    const asJson = String(p.json) === "true";

    try {
      const buffer = await generateCallScreen({
        templateUrl: DEFAULT_TEMPLATE,
        profileUrl: p.profileUrl,
        name: p.name || "Unknown",
        duration: p.duration || "00:00:00",
        status: p.status || "",
        outputFormat,
        quality
      });

      const info = MIME_MAP[outputFormat] || MIME_MAP.jpeg;

      if (asJson) {
        return {
          name: p.name || "Unknown",
          duration: p.duration || "00:00:00",
          status: p.status || null,
          format: outputFormat,
          quality,
          size: buffer.length,
          size_formatted: `${(buffer.length / 1024).toFixed(2)} KB`,
          mime: info.mime,
          base64: buffer.toString("base64"),
          dataUri: `data:${info.mime};base64,${buffer.toString("base64")}`
        };
      }

      const filename = `callscreen-${Date.now()}.${info.ext}`;

      res.setHeader("Content-Type", info.mime);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        isDownload
          ? `attachment; filename="${filename}"`
          : `inline; filename="${filename}"`
      );

      res.end(buffer);
    } catch (err) {
      res.status(500).json({
        status: false,
        creator: "JustPutu's",
        message: err.message || "Gagal generate call screen"
      });
    }
  }
};
