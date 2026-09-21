import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

GlobalFonts.registerFromPath(
  path.join(__dirname, "../../media/fonts/Roboto-Bold.ttf"),
  "Roboto Bold"
);
GlobalFonts.registerFromPath(
  path.join(__dirname, "../../media/fonts/Roboto-Regular.ttf"),
  "Roboto"
);

const BRAT_GREEN = "#8ACE00";
const TEXT_COLOR = "#000000";
const CANVAS_SIZE = 1000;
const FONT_FAMILY = "Roboto Bold";

const MIME_MAP = {
  png: { ext: "png", mime: "image/png" },
  jpeg: { ext: "jpg", mime: "image/jpeg" }
};

const measureText = (ctx, text, fontSize) => {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  return ctx.measureText(text).width;
};

const wrapText = (ctx, text, maxWidth, fontSize) => {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = measureText(ctx, testLine, fontSize);

    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
};

const fitFontSize = (ctx, text, maxWidth, maxHeight, startSize) => {
  let size = startSize;
  let lines = [];

  while (size > 20) {
    lines = wrapText(ctx, text, maxWidth, size);
    const lineHeight = size * 1.1;
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= maxHeight) {
      return { fontSize: size, lines, lineHeight };
    }
    size -= 4;
  }

  lines = wrapText(ctx, text, maxWidth, size);
  return { fontSize: size, lines, lineHeight: size * 1.1 };
};

const generateBrat = async (config) => {
  const {
    text = "brat",
    background = BRAT_GREEN,
    color = TEXT_COLOR,
    blur = 2,
    lowercase = true,
    size = CANVAS_SIZE,
    outputFormat = "png",
    quality = 95
  } = config;

  const displayText = lowercase ? text.toLowerCase() : text;

  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const padding = size * 0.06;
  const maxWidth = size - padding * 2;
  const maxHeight = size - padding * 2;

  const { fontSize, lines, lineHeight } = fitFontSize(
    ctx,
    displayText,
    maxWidth,
    maxHeight,
    Math.round(size * 0.22)
  );

  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const totalHeight = lines.length * lineHeight;
  const startY = (size - totalHeight) / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padding, startY + i * lineHeight);
  }

  if (blur > 0) {
    const blurred = createCanvas(size, size);
    const bctx = blurred.getContext("2d");
    bctx.filter = `blur(${blur}px)`;
    bctx.drawImage(canvas, 0, 0);

    const final = createCanvas(size, size);
    const fctx = final.getContext("2d");
    fctx.drawImage(blurred, 0, 0);

    if (outputFormat === "jpeg") {
      return final.toBuffer("image/jpeg", quality);
    }
    return final.toBuffer("image/png");
  }

  if (outputFormat === "jpeg") {
    return canvas.toBuffer("image/jpeg", quality);
  }
  return canvas.toBuffer("image/png");
};

export default {
  name: "Brat Generator",
  category: "tools",
  description: "Generate gambar brat-style (Charli XCX) dengan text custom",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    text: {
      type: "string",
      required: true,
      description: "Text yang akan ditampilkan"
    },
    background: {
      type: "string",
      required: false,
      description: "Warna background (hex, default: #8ACE00)"
    },
    color: {
      type: "string",
      required: false,
      description: "Warna text (hex, default: #000000)"
    },
    blur: {
      type: "number",
      required: false,
      description: "Blur intensity 0-5 (default: 2)"
    },
    lowercase: {
      type: "boolean",
      required: false,
      description: "Convert text ke lowercase (default: true)"
    },
    size: {
      type: "number",
      required: false,
      description: "Ukuran canvas (default: 1000)"
    },
    format: {
      type: "string",
      required: false,
      description: "Format output: png atau jpeg (default: png)"
    },
    download: {
      type: "boolean",
      required: false,
      description: "Auto-download file (default: false)"
    },
    json: {
      type: "boolean",
      required: false,
      description: "Return JSON base64 (default: false)"
    }
  },
  execute: async (req, res) => {
    const p = { ...req.query, ...req.body };

    if (!p.text) {
      res.status(400).json({
        status: false,
        creator: "JustPutu's",
        message: "Parameter 'text' wajib diisi"
      });
      return;
    }

    const outputFormat = ["png", "jpeg", "jpg"].includes(
      (p.format || "png").toLowerCase()
    )
      ? (p.format || "png").toLowerCase()
      : "png";

    const blur = Math.min(Math.max(parseInt(p.blur) || 2, 0), 5);
    const size = Math.min(Math.max(parseInt(p.size) || 1000, 200), 2000);
    const quality = Math.min(Math.max(parseInt(p.quality) || 95, 1), 100);
    const lowercase = String(p.lowercase || "true") === "true";
    const isDownload = String(p.download) === "true";
    const asJson = String(p.json) === "true";

    try {
      const buffer = await generateBrat({
        text: p.text,
        background: p.background || BRAT_GREEN,
        color: p.color || TEXT_COLOR,
        blur,
        lowercase,
        size,
        outputFormat,
        quality
      });

      const info = MIME_MAP[outputFormat] || MIME_MAP.png;

      if (asJson) {
        return {
          text: p.text,
          format: outputFormat,
          size,
          blur,
          size_bytes: buffer.length,
          size_formatted: `${(buffer.length / 1024).toFixed(2)} KB`,
          mime: info.mime,
          base64: buffer.toString("base64"),
          dataUri: `data:${info.mime};base64,${buffer.toString("base64")}`
        };
      }

      const filename = `brat-${Date.now()}.${info.ext}`;

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
        message: err.message || "Gagal generate gambar brat"
      });
    }
  }
};
