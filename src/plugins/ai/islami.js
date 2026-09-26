import axios from "axios";
import crypto from "crypto";

const BASE = "https://app.helvast.com";
const API = `${BASE}/api/chat`;
const TIMEOUT = 60000;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
  Origin: BASE,
  Referer: `${BASE}/`,
};

const isString = (v) => typeof v === "string" && v.length > 0;

const buildSessionId = (input) => {
  if (isString(input)) {
    const cleaned = input.replace(/[^a-f0-9-]/gi, "").slice(0, 36);
    if (cleaned.length === 36) return cleaned;
  }
  return crypto.randomUUID();
};

const parseNumber = (input, fallback) => {
  const n = parseInt(input);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const askAI = async (message, opts = {}) => {
  if (!isString(message)) throw new Error("Parameter 'message' wajib diisi");

  const sessionId = buildSessionId(opts.sessionId);
  const userId = parseNumber(opts.userId, 1);
  const workspaceId = parseNumber(opts.workspaceId, 2);
  const browserLanguage = isString(opts.browserLanguage)
    ? opts.browserLanguage.slice(0, 5)
    : "id";

  const payload = {
    message: message.slice(0, 2000),
    userId,
    workspaceId,
    sessionId,
    history: [{ role: "user", text: message.slice(0, 2000) }],
    browserLanguage,
  };

  const { data } = await axios.post(API, payload, {
    headers: HEADERS,
    timeout: TIMEOUT,
    validateStatus: (s) => s < 600,
  });

  if (!data || !isString(data.reply)) {
    throw new Error(data?.error || "Response tidak valid dari server AI");
  }

  return {
    session_id: data.sessionId || sessionId,
    message,
    reply: data.reply,
    has_answer: data.has_answer ?? null,
    confidence: data.confidence ?? null,
    semantic_search_used: data.semantic_search_used ?? null,
  };
};

export default {
  name: "Islami AI",
  category: "ai",
  description: "Chatbot Islami (multi-turn session)",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    message: {
      type: "string",
      required: true,
      description: "Pertanyaan atau pesan",
    },
    session_id: {
      type: "string",
      required: false,
      description: "UUID session untuk lanjutkan percakapan",
    },
    user_id: {
      type: "number",
      required: false,
      description: "User ID (default: 1)",
    },
    workspace_id: {
      type: "number",
      required: false,
      description: "Workspace ID (default: 2)",
    },
    language: {
      type: "string",
      required: false,
      description: "Kode bahasa (default: id)",
    },
  },
  execute: async (req) => {
    const message = req.query.message || req.body?.message;
    const sessionId = req.query.session_id || req.body?.session_id;
    const userId = req.query.user_id || req.body?.user_id;
    const workspaceId = req.query.workspace_id || req.body?.workspace_id;
    const language = req.query.language || req.body?.language;

    if (!message) throw new Error("Parameter 'message' wajib diisi");

    const startTime = Date.now();

    try {
      const result = await askAI(message, {
        sessionId,
        userId,
        workspaceId,
        browserLanguage: language,
      });

      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      return { ...result, process_time: elapsed };
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data;

      if (status === 401 || status === 403) {
        throw new Error("Akses ditolak. Coba lagi nanti.");
      }
      if (status === 429) {
        throw new Error("Rate limit. Tunggu beberapa saat lalu coba lagi.");
      }
      if (status >= 500) {
        throw new Error("Server AI sedang down. Coba lagi nanti.");
      }
      if (detail && typeof detail === "string" && detail.length < 200) {
        throw new Error(detail);
      }

      throw new Error(err.message || "Gagal menghubungi AI");
    }
  },
};
