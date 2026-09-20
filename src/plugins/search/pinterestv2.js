import axios from "axios";

const DOMAINS = ["in.pinterest.com", "id.pinterest.com", "www.pinterest.com", "fi.pinterest.com"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const APP_VERSION = "c1e40b0";

let session = { cookie: "", csrf: "", domain: DOMAINS[0], expires: 0 };

// Ambil session dari homepage (otomatis)
const fetchSession = async () => {
  if (session.cookie && Date.now() < session.expires) return session;

  for (const domain of DOMAINS) {
    try {
      const res = await axios.get(`https://${domain}/`, {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: () => true
      });

      const setCookie = res.headers["set-cookie"] || [];
      const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
      const csrf = cookie.match(/csrftoken=([^;]+)/)?.[1] || "";

      if (cookie) {
        session = { cookie, csrf, domain, expires: Date.now() + 30 * 60 * 1000 };
        return session;
      }
    } catch { continue; }
  }
  return { cookie: "", csrf: "", domain: DOMAINS[0] };
};

const buildHeaders = (s) => ({
  "User-Agent": UA,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "X-Requested-With": "XMLHttpRequest",
  "X-APP-VERSION": APP_VERSION,
  "X-CSRFToken": s.csrf,
  "X-Pinterest-PWS-Handler": "www/search/[scope].js",
  "Cookie": s.cookie,
  "Referer": `https://${s.domain}/`
});

const buildSearchUrl = (domain, query, pageSize = 25) => {
  const payload = {
    options: {
      query,
      scope: "pins",
      rs: "typed",
      page_size: pageSize,
      bookmarks: [""],
      isPrefetch: false,
      auto_correction_disabled: false,
      redux_normalize_feed: true
    },
    context: {}
  };
  const data = encodeURIComponent(JSON.stringify(payload));
  const sourceUrl = encodeURIComponent(`/search/pins/?q=${query}&rs=typed`);
  return `https://${domain}/resource/BaseSearchResource/get/?source_url=${sourceUrl}&data=${data}`;
};

const parsePin = (pin) => ({
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
});

export default {
  name: "Pinterest Search",
  category: "search",
  description: "Cari pin Pinterest lengkap dengan judul & deskripsi",
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
    const s = await fetchSession();
    let lastError = null;

    for (const domain of [s.domain, ...DOMAINS.filter((d) => d !== s.domain)]) {
      try {
        const { data } = await axios.get(buildSearchUrl(domain, query), {
          headers: buildHeaders({ ...s, domain }),
          timeout: 20000,
          validateStatus: () => true
        });

        if (data?.resource_response?.status === "success") {
          const raw = data.resource_response.data?.results || [];
          const results = raw.slice(0, limit).map(parsePin);
          return {
            query,
            domain_used: domain,
            total: results.length,
            results,
            process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
          };
        }
        lastError = data?.resource_response?.error?.message || "Pinterest menolak request";
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }
    throw new Error(lastError || "Semua domain Pinterest menolak request");
  }
};
