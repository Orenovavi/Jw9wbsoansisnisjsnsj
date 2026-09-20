import axios from "axios";

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest"
};

let sessionCache = {
  cookie: null,
  csrf: null,
  expiresAt: 0
};

const getSession = async () => {
  // Cache 30 menit
  if (sessionCache.cookie && Date.now() < sessionCache.expiresAt) {
    return sessionCache;
  }

  try {
    const res = await axios.get("https://in.pinterest.com/", {
      headers: {
        "User-Agent": BASE_HEADERS["User-Agent"],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    const setCookies = res.headers["set-cookie"] || [];
    const cookies = setCookies
      .map((c) => c.split(";")[0])
      .join("; ");

    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : "";

    sessionCache = {
      cookie: cookies,
      csrf,
      expiresAt: Date.now() + 30 * 60 * 1000
    };

    return sessionCache;
  } catch (err) {
    return { cookie: "", csrf: "" };
  }
};

const buildHeaders = (session) => ({
  ...BASE_HEADERS,
  "X-CSRFToken": session.csrf,
  "Referer": "https://in.pinterest.com/",
  "Cookie": session.cookie
});

const buildSearchUrl = (query) => {
  const payload = {
    options: {
      query,
      scope: "pins",
      rs: "typed",
      bookmarks: [""]
    },
    context: {}
  };
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `https://in.pinterest.com/resource/BaseSearchResource/get/?source_url=%2Fsearch%2Fpins%2F%3Fq%3D${encodeURIComponent(query)}&data=${encoded}`;
};

const parseResults = (data, limit) => {
  const raw = data?.resource_response?.data?.results || [];
  return raw.slice(0, limit).map((pin) => ({
    pin_id: pin.id || null,
    title: pin.grid_title || pin.title || null,
    description: pin.description || null,
    username: pin.pinner?.username || null,
    fullname: pin.pinner?.full_name || null,
    image:
      pin.images?.orig?.url ||
      pin.images?.["736x"]?.url ||
      pin.images?.["564x"]?.url ||
      pin.images?.["236x"]?.url ||
      null,
    thumbnail: pin.images?.["236x"]?.url || null,
    width: pin.images?.orig?.width || null,
    height: pin.images?.orig?.height || null,
    link: pin.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
    is_video: Boolean(pin.videos)
  }));
};

export default {
  name: "Pinterest Search",
  category: "search",
  description: "Cari pin Pinterest lengkap dengan judul dan deskripsi",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    query: { type: "string", required: true, description: "Kata kunci pencarian" },
    limit: { type: "number", required: false, description: "Jumlah hasil (default: 20)" }
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const limit = Math.min(parseInt(req.query.limit || req.body?.limit || 20), 50);

    if (!query) throw new Error("Parameter 'query' wajib diisi");

    const startTime = Date.now();
    const session = await getSession();

    const { data } = await axios.get(buildSearchUrl(query), {
      headers: buildHeaders(session),
      timeout: 20000
    });

    if (data?.resource_response?.status !== "success") {
      throw new Error(
        data?.resource_response?.error?.message || "Pinterest menolak request"
      );
    }

    const results = parseResults(data, limit);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return { query, total: results.length, results, process_time: elapsed };
  }
};
