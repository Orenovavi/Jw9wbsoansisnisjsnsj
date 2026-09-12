import { ProxyAgent } from "undici";
import { safeFetch } from "../../function.js";

// ============================================================
// CONFIG
// ============================================================

const PROXY_SOURCES = [
  "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.txt",
  "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/https/data.txt"
];

const PROXY_REFRESH = 5 * 60 * 1000; // 5 menit
const PROXY_COOLDOWN = 10 * 60 * 1000; // 10 menit

const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 5;

// ============================================================
// INTERNAL PROXY POOL
// ============================================================

let proxyPool = [];
let deadProxies = new Map();
let lastProxyRefresh = 0;
let refreshing = null;

// ============================================================
// LOAD FREE PROXIES
// ============================================================

async function loadProxies(force = false) {
  const now = Date.now();

  if (
    !force &&
    proxyPool.length > 0 &&
    now - lastProxyRefresh < PROXY_REFRESH
  ) {
    return proxyPool;
  }

  if (refreshing) {
    return refreshing;
  }

  refreshing = (async () => {
    const found = new Set();

    for (const source of PROXY_SOURCES) {
      try {
        const response = await fetch(source, {
          headers: {
            "User-Agent": "Mozilla/5.0 REST-API-ProxyPool"
          },
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) continue;

        const text = await response.text();

        for (const line of text.split(/\r?\n/)) {
          const value = line.trim();

          if (!value) continue;
          if (value.startsWith("#")) continue;

          const proxy = normalizeProxy(value);

          if (proxy) {
            found.add(proxy);
          }
        }
      } catch (error) {
        console.error(
          "[MEDIAFIRE] Proxy source error:",
          error.message
        );
      }
    }

    const available = [...found].filter(
      proxy => !isDead(proxy)
    );

    proxyPool = shuffle(available);
    lastProxyRefresh = Date.now();

    console.log(
      `[MEDIAFIRE] Loaded ${proxyPool.length} proxies`
    );

    return proxyPool;
  })();

  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

// ============================================================
// NORMALIZE PROXY
// ============================================================

function normalizeProxy(value) {
  try {
    let proxy = value.trim();

    if (!proxy.includes("://")) {
      proxy = `http://${proxy}`;
    }

    const parsed = new URL(proxy);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }

    if (!parsed.hostname || !parsed.port) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

// ============================================================
// DEAD PROXY MANAGEMENT
// ============================================================

function markDead(proxy) {
  deadProxies.set(proxy, Date.now());

  proxyPool = proxyPool.filter(
    item => item !== proxy
  );

  console.log(
    `[MEDIAFIRE] Proxy removed: ${proxy}`
  );
}

function isDead(proxy) {
  const timestamp = deadProxies.get(proxy);

  if (!timestamp) {
    return false;
  }

  if (Date.now() - timestamp >= PROXY_COOLDOWN) {
    deadProxies.delete(proxy);
    return false;
  }

  return true;
}

// ============================================================
// RANDOMIZE
// ============================================================

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

// ============================================================
// GET NEXT PROXY
// ============================================================

async function getProxy() {
  if (!proxyPool.length) {
    await loadProxies(true);
  }

  if (!proxyPool.length) {
    return null;
  }

  return proxyPool.shift();
}

// ============================================================
// FETCH THROUGH PROXY
// ============================================================

async function fetchThroughProxy(
  url,
  options = {},
  timeout = REQUEST_TIMEOUT
) {
  const proxy = await getProxy();

  if (!proxy) {
    throw new Error(
      "Tidak ada proxy yang tersedia."
    );
  }

  let agent;

  try {
    agent = new ProxyAgent(proxy);

    const response = await fetch(url, {
      ...options,
      dispatcher: agent,
      signal: AbortSignal.timeout(timeout)
    });

    // Proxy berhasil digunakan.
    // Masukkan kembali ke pool untuk penggunaan berikutnya.
    proxyPool.push(proxy);

    return response;
  } catch (error) {
    // Proxy dianggap mati.
    markDead(proxy);

    throw error;
  } finally {
    try {
      await agent?.close();
    } catch {}
  }
}

// ============================================================
// MEDIAFIRE REQUEST WITH RETRY
// ============================================================

async function fetchMediaFire(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchThroughProxy(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",

            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "en-US,en;q=0.9"
          }
        },
        REQUEST_TIMEOUT
      );

      if (!response.ok) {
        throw new Error(
          `MediaFire HTTP ${response.status}`
        );
      }

      return response;
    } catch (error) {
      lastError = error;

      console.error(
        `[MEDIAFIRE] Attempt ${attempt}/${MAX_RETRIES}:`,
        error.message
      );

      if (attempt < MAX_RETRIES) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError ||
    new Error("Semua proxy gagal.");
}

// ============================================================
// PLUGIN
// ============================================================

export default {
  name: "MediaFire Downloader",

  category: "downloader",

  description:
    "Mengambil informasi file dan direct download URL MediaFire",

  method: ["GET", "POST"],

  cache: 60,

  params: {
    url: {
      type: "string",
      required: true,
      description:
        "URL file MediaFire"
    }
  },

  execute: async (req, res) => {
    const url =
      req.query.url ||
      req.body?.url;

    if (!url) {
      const error = new Error(
        "Parameter 'url' wajib diisi."
      );

      error.statusCode = 400;

      throw error;
    }

    let target;

    try {
      target = new URL(url);
    } catch {
      const error = new Error(
        "URL tidak valid."
      );

      error.statusCode = 400;

      throw error;
    }

    const hostname =
      target.hostname.toLowerCase();

    if (
      !hostname.endsWith("mediafire.com") &&
      !hostname.endsWith("mfi.re")
    ) {
      const error = new Error(
        "URL harus berasal dari MediaFire."
      );

      error.statusCode = 400;

      throw error;
    }

    // Pastikan pool tersedia.
    await loadProxies();

    const response =
      await fetchMediaFire(url);

    const html =
      await response.text();

    // ========================================================
    // DOWNLOAD BUTTON
    // ========================================================

    let downloadUrl = null;

    const downloadMatch = html.match(
      /id=["']downloadButton["'][^>]*href=["']([^"']+)["']/i
    );

    if (downloadMatch?.[1]) {
      downloadUrl =
        decodeHtml(downloadMatch[1]);
    }

    // Fallback.
    if (!downloadUrl) {
      const fallback = html.match(
        /href=["'](https?:\/\/[^"']*mediafire[^"']*)["']/i
      );

      if (fallback?.[1]) {
        downloadUrl =
          decodeHtml(fallback[1]);
      }
    }

    if (!downloadUrl) {
      const error = new Error(
        "Direct download URL tidak ditemukan."
      );

      error.statusCode = 404;

      throw error;
    }

    // ========================================================
    // FILE NAME
    // ========================================================

    let filename = "unknown";

    const filenameMatch =
      html.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
      ) ||
      html.match(
        /<title[^>]*>(.*?)<\/title>/i
      );

    if (filenameMatch?.[1]) {
      filename = decodeHtml(
        filenameMatch[1]
      )
        .replace(
          /\s*-\s*MediaFire.*$/i,
          ""
        )
        .trim();
    }

    // ========================================================
    // FILE SIZE
    // ========================================================

    let size = null;

    const sizeMatch = html.match(
      /(?:File Size|filesize)[^<]{0,150}?([0-9.,]+\s*(?:B|KB|MB|GB|TB))/i
    );

    if (sizeMatch?.[1]) {
      size = sizeMatch[1];
    }

    return {
      filename,
      size,

      download_url: downloadUrl,

      source_url: url,

      proxy_pool: {
        enabled: true,
        retries: MAX_RETRIES
      }
    };
  }
};

// ============================================================
// HELPERS
// ============================================================

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}
