import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://spotidown.app";
const HOME_PATH = "/en6";
const TIMEOUT = 30000;

const FALLBACK_APIS = [
  {
    name: "pika",
    fn: async (query) => {
      const { data } = await axios.get("https://pika-spotify.vercel.app/dl/", {
        params: { name: query },
        timeout: TIMEOUT,
        validateStatus: () => true,
      });

      if (!data?.download_url) throw new Error("pika: no download_url");

      return {
        title: data.name || data.title || null,
        artist: Array.isArray(data.artists) ? data.artists.join(", ") : data.artists || null,
        album: data.album || null,
        duration: data.duration || null,
        image: data.image || data.thumbnail || null,
        download_url: data.download_url,
        track_id: data.id || null,
      };
    },
  },
  {
    name: "dlapi",
    fn: async (query) => {
      const { data: search } = await axios.get(
        "https://spotify.dlapi.app/api/Gettrack",
        {
          params: { spotify_url: query },
          timeout: TIMEOUT,
          validateStatus: () => true,
          headers: { Authorization: "Bearer pGLXoCsVu0hcstAecIDwlrlbcrUzv0e1cWBJ0yuB" },
        }
      );

      if (!search?.name) throw new Error("dlapi: not found");

      const { data: conv } = await axios.post(
        "https://master.dlapi.app/api/v1/convert",
        { url: search.external_urls?.spotify || query, format: "mp3" },
        {
          timeout: TIMEOUT,
          validateStatus: () => true,
          headers: { Authorization: "Bearer pGLXoCsVu0hcstAecIDwlrlbcrUzv0e1cWBJ0yuB" },
        }
      );

      if (conv?.download_url) {
        return {
          title: search.name,
          artist: search.artists?.map((a) => a.name).join(", ") || null,
          album: search.album?.name || null,
          duration: search.duration_ms
            ? `${Math.floor(search.duration_ms / 60000)}:${String(Math.floor((search.duration_ms % 60000) / 1000)).padStart(2, "0")}`
            : null,
          image: search.album?.images?.[0]?.url || null,
          download_url: conv.download_url,
          track_id: search.id || null,
        };
      }

      throw new Error("dlapi: conversion failed");
    },
  },
];

const searchSpotiDown = async (query) => {
  const homeRes = await axios.get(`${BASE_URL}${HOME_PATH}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", Accept: "*/*" },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  const cookieHeader = (homeRes.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const $1 = cheerio.load(homeRes.data);
  const hiddenInputs = {};
  $1('form[name="spotifyurl"] input[type="hidden"]').each((_, el) => {
    const name = $1(el).attr("name");
    const val = $1(el).attr("value") || "";
    if (name) hiddenInputs[name] = val;
  });

  const paramsAction = new URLSearchParams();
  paramsAction.append("url", query);
  for (const [k, v] of Object.entries(hiddenInputs)) paramsAction.append(k, v);

  const actionRes = await axios.post(`${BASE_URL}/action`, paramsAction.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: BASE_URL,
      Referer: `${BASE_URL}${HOME_PATH}`,
      "X-Requested-With": "XMLHttpRequest",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  const actionData = typeof actionRes.data === "string" ? JSON.parse(actionRes.data) : actionRes.data;

  if (actionData?.error) throw new Error(actionData.message || "Gagal mencari lagu");

  const $2 = cheerio.load(actionData?.data || "");
  const firstForm = $2('form[name="submitspurl"]').first();
  if (!firstForm.length) throw new Error("Lagu tidak ditemukan");

  const rawData = firstForm.find('input[name="data"]').val();
  const baseVal = firstForm.find('input[name="base"]').val();
  const tokenVal = firstForm.find('input[name="token"]').val();

  if (!rawData || !tokenVal) throw new Error("Data track tidak lengkap");

  let trackMeta = {};
  try {
    trackMeta = JSON.parse(Buffer.from(rawData, "base64").toString("utf-8"));
  } catch {}

  const paramsTrack = new URLSearchParams();
  paramsTrack.append("data", rawData);
  paramsTrack.append("base", baseVal || "");
  paramsTrack.append("token", tokenVal);

  const trackRes = await axios.post(`${BASE_URL}/action/track`, paramsTrack.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: BASE_URL,
      Referer: `${BASE_URL}${HOME_PATH}`,
      "X-Requested-With": "XMLHttpRequest",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  const trackRespData = typeof trackRes.data === "string" ? JSON.parse(trackRes.data) : trackRes.data;

  let downloadUrl = null;
  if (!trackRespData?.error && trackRespData?.data) {
    const $dl = cheerio.load(trackRespData.data);
    downloadUrl = $dl("a.abutton[href]").attr("href") || null;
  }

  if (!downloadUrl) throw new Error("SpotiDown tidak kasih download URL");

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

const searchWithFallback = async (query) => {
  const errors = [];

  try {
    const result = await searchSpotiDown(query);
    return { ...result, source: "spotidown" };
  } catch (err) {
    errors.push(`spotidown: ${err.message}`);
  }

  for (const fallback of FALLBACK_APIS) {
    try {
      const result = await fallback.fn(query);
      return { ...result, source: fallback.name };
    } catch (err) {
      errors.push(`${fallback.name}: ${err.message}`);
    }
  }

  throw new Error(`Semua source gagal:\n${errors.join("\n")}`);
};

export default {
  name: "Spotify Search",
  category: "search",
  description: "Cari lagu Spotify dengan multi-source fallback",
  method: ["GET", "POST"],
  cache: 120,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Judul lagu atau artis",
    },
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;

    if (!query || typeof query !== "string") {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();

    const result = await searchWithFallback(query.trim());

    if (!result.download_url) {
      throw new Error("Semua source kasih hasil tapi download URL kosong");
    }

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      ...result,
      query: query.trim(),
      process_time: elapsed,
    };
  },
};
