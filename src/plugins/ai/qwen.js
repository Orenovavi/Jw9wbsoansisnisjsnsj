import axios from "axios";

const BASE_URL = "https://bandelbanget.xyz/v1";
const API_KEY = "sk-qwen-517691dd9c4bf873f1d8ef17f83caa0766acec96b6685fd1";
const MODEL = "qwen"; // Model name, bisa disesuaikan jika API mendukung model lain

const headers = {
  "Authorization": `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "BandelAI-Plugin/1.0"
};

/**
 * Mengirim pesan ke model Qwen melalui API relay.
 * @param {string} prompt - Pesan yang akan dikirim.
 * @param {string} [systemPrompt] - System prompt opsional.
 * @returns {Promise<Object>} - Response JSON dari API.
 */
const chatCompletion = async (prompt, systemPrompt) => {
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push({ role: "user", content: prompt });

  try {
    const response = await axios.post(`${BASE_URL}/chat/completions`, {
      model: MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false
    }, {
      headers: headers,
      timeout: 60000 // Timeout 60 detik, karena AI bisa lambat
    });

    return response.data;
  } catch (error) {
    // Menangani error dari API
    if (error.response) {
      throw new Error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      throw new Error("API Error: Tidak ada response dari server (mungkin masalah jaringan atau timeout)");
    } else {
      throw new Error(`Request Error: ${error.message}`);
    }
  }
};

export default {
  name: "Qwen AI Chat",
  category: "ai",
  description: "Berinteraksi dengan model Qwen melalui API relay bandelbanget.xyz",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    prompt: {
      type: "string",
      required: true,
      description: "Pesan atau pertanyaan untuk AI"
    },
    system: {
      type: "string",
      required: false,
      description: "System prompt untuk memberikan konteks/peran kepada AI"
    }
  },
  execute: async (req) => {
    const prompt = req.query.prompt || req.body?.prompt;
    const systemPrompt = req.query.system || req.body?.system;

    if (!prompt) {
      throw new Error("Parameter 'prompt' wajib diisi");
    }

    const startTime = Date.now();
    
    const data = await chatCompletion(prompt, systemPrompt);

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    // Mengambil konten balasan dari struktur response OpenAI-compatible
    const reply = data.choices?.[0]?.message?.content || "Tidak ada balasan dari AI";

    return {
      model: data.model || MODEL,
      reply: reply,
      usage: data.usage || null,
      process_time: elapsed
    };
  }
};
