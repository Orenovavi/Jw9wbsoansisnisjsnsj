import axios from "axios";
import crypto from "crypto";

const APP = "https://app.unlimitedai.chat";
const API = `${APP}/api/chat`;
const TIMEOUT = 180000;
const STREAM_IDLE_TIMEOUT = 90000;
const MAX_HISTORY = 60;
const MAX_LEN = 4000;

const MODELS = {
  standard: "chat-model-reasoning",
  s: "chat-model-reasoning",
  default: "chat-model-reasoning",
  normal: "chat-model-reasoning",
  pro: "chat-model-reasoning-with-search",
  search: "chat-model-reasoning-with-search",
  web: "chat-model-reasoning-with-search",
  p: "chat-model-reasoning-with-search",
};

const DEFAULT_MODEL = "chat-model-reasoning";

const PERSONAS = {
  default: null,
  asisten: "Kamu adalah asisten AI yang ramah, sopan, dan membantu. Jawab dengan bahasa Indonesia yang natural dan mudah dipahami.",
  coding: "Kamu adalah expert programmer. Jawab pertanyaan coding dengan contoh kode yang jelas, singkat, dan production-ready.",
  guru: "Kamu adalah guru yang sabar. Jelaskan konsep rumit dengan analogi sederhana dan bertahap.",
  kreatif: "Kamu adalah penulis kreatif. Jawab dengan gaya bahasa yang puitis, imajinatif, dan menarik.",
  singkat: "Jawab SANGAT SINGKAT. Maksimal 2 kalimat. Tidak ada basa-basi.",
  islami: "Kamu adalah asisten Islami. Jawab dengan adab dan rujuk dalil jika relevan.",
};

const VALID_LOCALES = ["id", "en", "ar", "zh", "ja", "ko", "es", "fr", "de", "ru"];

const BRAND_PATTERNS = [
  [/unlimitedai\.chat/gi, "AI"],
  [/unlimitedai/gi, "AI"],
  [/unlimited\s*ai\.chat/gi, "AI"],
  [/unlimited\s*ai/gi, "AI"],
  [/unlimited\s*chat/gi, "AI"],
  [/app\.unlimitedai\.chat/gi, ""],
  [/https?:\/\/[^\s]*unlimited[^\s]*/gi, ""],
  [/powered\s+by\s+[^\s.]*\.?/gi, ""],
];

const AI_LEAK_PATTERNS = [
  /\bsaya\s+adalah\s+ai\b/gi,
  /\baku\s+adalah\s+ai\b/gi,
  /\bsaya\s+sebuah\s+ai\b/gi,
  /\bsebagai\s+ai\b/gi,
  /\bi\s+am\s+an?\s+ai\b/gi,
  /\blanguage\s+model\b/gi,
  /\bchatbot\b/gi,
];

const DEVICE_ID = `CLIENT_${crypto.randomBytes(12).toString("hex")}`;

const uid = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
const isStr = (v) => typeof v === "string" && v.length > 0;

const resolveModel = (inp) => {
  if (!inp) return DEFAULT_MODEL;
  const k = String(inp).toLowerCase().trim();
  if (MODELS[k]) return MODELS[k];
  if (k.startsWith("chat-model-")) return k;
  return DEFAULT_MODEL;
};

const resolveLocale = (inp) => {
  if (!inp) return "id";
  const k = String(inp).toLowerCase().trim();
  return VALID_LOCALES.includes(k) ? k : "id";
};

const resolvePersona = (inp) => {
  if (!inp) return "default";
  const k = String(inp).toLowerCase().trim();
  return PERSONAS[k] ? k : "default";
};

const nuclearFilter = (text) => {
  if (!text) return text;
  return text
    .split(/\n/)
    .filter((line) => !/unlimited/i.test(line))
    .join("\n")
    .trim();
};

const cleanReply = (text) => {
  if (!text) return text;

  let out = String(text);

  for (const [pattern, replacement] of BRAND_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  for (const pattern of AI_LEAK_PATTERNS) {
    out = out.replace(pattern, "");
  }

  out = nuclearFilter(out);

  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[,.\-:;]+\s*/g, "")
    .replace(/\.\s*\./g, ".")
    .trim();

  return out;
};

const um = (text) => ({
  id: uid(),
  role: "user",
  parts: [{ type: "text", text: String(text).slice(0, MAX_LEN) }],
});

const am = (text) => ({
  id: uid(),
  role: "assistant",
  parts: [{ type: "text", text: String(text || "") }],
});

const streamChat = (payload, locale) =>
  new Promise(async (resolve, reject) => {
    let res;
    try {
      res = await axios.post(API, payload, {
        timeout: TIMEOUT,
        responseType: "stream",
        validateStatus: () => true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Content-Type": "application/json",
          "x-next-intl-locale": locale,
          Origin: APP,
          Referer: `${APP}/${locale}`,
        },
      });
    } catch (e) {
      return reject(e);
    }

    if (res.status >= 400) {
      let body = "";
      for await (const c of res.data) body += c;
      let msg = body;
      try {
        const j = JSON.parse(body);
        msg = j.error || j.message || body;
      } catch {}
      return reject(new Error(`HTTP ${res.status}: ${msg.slice(0, 200)}`));
    }

    let buf = "";
    let acc = "";
    let done = false;

    const finish = (extra = {}) => {
      if (done) return;
      done = true;
      try { res.data.destroy(); } catch {}
      resolve({ reply: acc.trim(), ...extra });
    };

    const timer = setTimeout(() => finish({ warning: "timeout" }), STREAM_IDLE_TIMEOUT);

    const onLine = (line) => {
      const t = line.trim();
      if (!t) return;
      try {
        const o = JSON.parse(t);

        if (o.code === "turnstile_required" || o.code === "quota_exceeded") {
          clearTimeout(timer);
          if (!done) {
            done = true;
            try { res.data.destroy(); } catch {}
            reject(new Error("RATE_LIMIT"));
          }
          return;
        }

        if (o.type === "delta" && typeof o.delta === "string") {
          acc += o.delta;
        }

        if (o.type === "finish" || o.type === "done" || o.done === true) {
          clearTimeout(timer);
          finish();
        }
      } catch {}
    };

    res.data.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) onLine(l);
    });

    res.data.on("end", () => {
      clearTimeout(timer);
      if (buf) onLine(buf);
      finish();
    });

    res.data.on("error", () => {
      clearTimeout(timer);
      if (!done) { done = true; reject(new Error("NETWORK")); }
    });
  });

const ask = async (message, opts = {}) => {
  const chatId = isStr(opts.chatId) ? opts.chatId : uid();
  const model = resolveModel(opts.model);
  const locale = resolveLocale(opts.locale);
  const persona = resolvePersona(opts.persona);

  const cleanMessage = String(message).trim().slice(0, MAX_LEN);
  if (!cleanMessage) throw new Error("Parameter 'message' wajib diisi");

  const history = Array.isArray(opts.history)
    ? opts.history
        .filter((h) => h && h.role && Array.isArray(h.parts))
        .slice(-MAX_HISTORY)
    : [];

  const personaPrompt = PERSONAS[persona];
  const personaHistory = personaPrompt
    ? [um(personaPrompt), am("Baik, saya mengerti.")]
    : [];

  const messages = [...personaHistory, ...history, um(cleanMessage)].slice(-MAX_HISTORY);

  const payload = {
    chatId,
    messages,
    selectedChatModel: model,
    selectedCharacterId: null,
    selectedStoryId: null,
    turnstileToken: null,
    deviceId: DEVICE_ID,
    locale,
  };

  const res = await streamChat(payload, locale);

  if (!isStr(res.reply)) {
    throw new Error("Tidak ada balasan dari AI");
  }

  const cleaned = cleanReply(res.reply);

  if (!isStr(cleaned)) {
    throw new Error("Balasan kosong setelah filter");
  }

  return {
    chat_id: chatId,
    message: cleanMessage,
    reply: cleaned,
    model,
    locale,
    persona,
    warning: res.warning || null,
  };
};

export default {
  name: "ChatGPT",
  category: "ai",
  description: "Chatbot AI dengan streaming, multi-turn session, persona, dan search mode",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    message: {
      type: "string",
      required: true,
      description: "Pesan atau pertanyaan untuk AI",
    },
    chat_id: {
      type: "string",
      required: false,
      description: "UUID session untuk lanjutkan percakapan (opsional)",
    },
    model: {
      type: "string",
      required: false,
      description: "Model: standard, pro, search (default: standard)",
    },
    persona: {
      type: "string",
      required: false,
      description: `Persona: ${Object.keys(PERSONAS).join(", ")} (default: default)`,
    },
    locale: {
      type: "string",
      required: false,
      description: `Bahasa: ${VALID_LOCALES.join(", ")} (default: id)`,
    },
    history: {
      type: "array",
      required: false,
      description: "Array history percakapan (opsional, untuk multi-turn manual)",
    },
  },
  execute: async (req) => {
    const message = req.query.message || req.body?.message;
    const chatId = req.query.chat_id || req.body?.chat_id;
    const model = req.query.model || req.body?.model;
    const persona = req.query.persona || req.body?.persona;
    const locale = req.query.locale || req.body?.locale;
    const history = req.body?.history;

    if (!isStr(message)) {
      throw new Error("Parameter 'message' wajib diisi");
    }

    const startTime = Date.now();

    try {
      const result = await ask(message, {
        chatId,
        model,
        persona,
        locale,
        history,
      });

      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      return {
        ...result,
        process_time: elapsed,
      };
    } catch (err) {
      const status = err.response?.status;

      if (err.message === "RATE_LIMIT") {
        throw new Error("Rate limit. Tunggu beberapa saat lalu coba lagi");
      }
      if (err.message === "NETWORK") {
        throw new Error("Koneksi terputus ke server AI");
      }
      if (status === 401 || status === 403) {
        throw new Error("Akses ditolak");
      }
      if (status === 429) {
        throw new Error("Rate limit. Tunggu beberapa saat lalu coba lagi");
      }
      if (status >= 500) {
        throw new Error("Server AI sedang down");
      }
      if (err.code === "ECONNABORTED") {
        throw new Error("Request timeout");
      }

      throw new Error(err.message || "Gagal menghubungi AI");
    }
  },
};
