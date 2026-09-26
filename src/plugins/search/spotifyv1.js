import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://spotidown.app";
const HOME_PATH = "/en6";
const TIMEOUT = 30000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const isString = (v) => typeof v === "string" && v.length > 0;

const parseJson = (data) => {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return { raw: data };
    }
  }
  return data;
};

const buildHeaders = (cookie = null, referer = null) => {
  const h = {
    "User-Agent": USER_AGENT,
    Accept: "*/*",
  };
  if (cookie) h.Cookie = cookie;
  if (referer) h.Referer = referer;
  return h;
};

const extractCookies = (setCookie) => {
  if (!Array.isArray(setCookie)) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
};

const decodeBase64 = (str) => {
  try {
    return Buffer.from(str, "base64").toString("utf-8");
  } catch {
    return null;
  }
};

const searchSpotiDown = async (query) => {
  const homeRes = await axios.get(`${BASE_URL}${HOME_PATH}`, {
    headers: buildHeaders(),
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  const cookieHeader = extractCookies(homeRes.headers["set-cookie"]);

  const $1 = cheerio.load(homeRes.data);
  const hiddenInputs = {};
  $1('form[name="spotifyurl"] input[type="hidden"]').each((_, el) => {
    const name = $1(el).attr("name");
    const val = $1(el).attr("value") || "";
    if (name) hiddenInputs[name] = val;
  });

  const paramsAction = new URLSearchParams();
  paramsAction.append("url", query);
  for (const [k, v] of Object.entries(hiddenInputs)) {
    paramsAction.append(k, v);
  }

  const actionRes = await axios.post(
    `${BASE_URL}/action`,
    paramsAction.toString(),
    {
      headers: {
        ...buildHeaders(cookieHeader, `${BASE_URL}${HOME_PATH}`),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: BASE_URL,
        "X-Requested-With": "XMLHttpRequest",
      },
      timeout: TIMEOUT,
      validateStatus: () => true,
    }
  );

  const actionData = parseJson(actionRes.data);

  if (actionData.error) {
    throw new Error(actionData.message || "Gagal mencari lagu");
  }

  const $2 = cheerio.load(actionData.data || "");
  const firstForm = $2('form[name="submitspurl"]').first();

  if (!firstForm.length) {
    throw new Error("Lagu tidak ditemukan");
  }

  const rawData = firstForm.find('input[name="data"]').val();
  const baseVal = firstForm.find('input[name="base"]').val();
  const tokenVal = firstForm.find('input[name="token"]').val();

  if (!isString(rawData) || !isString(tokenVal)) {
    throw new Error("Data track tidak lengkap");
  }

  let trackMeta = {};
  const decoded = decodeBase64(rawData);
  if (decoded) {
    try {
      trackMeta = JSON.parse(decoded);
    } catch {
      trackMeta = {};
    }
  }

  const paramsTrack = new URLSearchParams();
  paramsTrack.append("data", rawData);
  paramsTrack.append("base", baseVal || "");
  paramsTrack.append("token", tokenVal);

  const trackRes = await axios.post(
    `${BASE_URL}/action/track`,
    paramsTrack.toString(),
    {
      headers: {
        ...buildHeaders(cookieHeader, `${BASE_URL}${HOME_PATH}`),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: BASE_URL,
        "X-Requested-With": "XMLHttpRequest",
      },
      timeout: TIMEOUT,
      validateStatus: () => true,
    }
  );

  const trackRespData = parseJson(trackRes.data);

  let downloadUrl = null;
  if (!trackRespData.error && trackRespData.data) {
    const $dl = cheerio.load(trackRespData.data);
    downloadUrl = $dl("a.abutton[href]").attr("href") || null;
  }

  return {
    title: trackMeta.name || null,
    artist: trackMeta.artist || null,
    album: trackMeta.album || null,
    duration: trackMeta.duration || null,
    image: trackMeta.cover || null,
    download_url: downloadUrl,
    track_id: trackMeta.id || null,
  };
};

export default {
  name: "Spotify Search",
  category: "search",
  description: "Cari lagu Spotify dan dapatkan link download MP3",
  method: ["GET", "POST"],
  cache: 120,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Judul lagu atau artis (contoh: alan walker faded)",
    },
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;

    if (!isString(query)) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();

    try {
      const result = await searchSpotiDown(query.trim());
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      if (!result.download_url) {
        throw new Error("Link download tidak tersedia untuk lagu ini");
      }

      return {
        ...result,
        query: query.trim(),
        process_time: elapsed,
      };
    } catch (err) {
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
        throw new Error(`Timeout saat mengambil data (${elapsed})`);
      }

      throw new Error(err.message || "Gagal mencari lagu");
    }
  },
};
