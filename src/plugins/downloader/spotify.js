import axios from "axios";

const API_META = "https://spotify.dlapi.app/api/Gettrack";
const API_CONVERT = "https://master.dlapi.app/api/v1/convert";
const API_TASK = "https://master.dlapi.app/api/v1/tasks";

const TOKEN = "pGLXoCsVu0hcstAecIDwlrlbcrUzv0e1cWBJ0yuB";

const MAX_POLLING = 60;
const POLLING_INTERVAL = 3000;

const isValidSpotifyUrl = (url) => {
  return /^(https?:\/\/)?(open\.)?spotify\.com\/(track|album|playlist|artist)\/[a-zA-Z0-9]+/.test(url);
};

const createClient = () =>
  axios.create({
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Spotmate/1.0"
    },
    timeout: 15000
  });

const getMetadata = async (client, url) => {
  const { data } = await client.get(API_META, {
    params: { spotify_url: url }
  });

  if (!data) throw new Error("API metadata kosong");
  return data;
};

const convertTrack = async (client, url, format) => {
  const { data: init } = await client.post(API_CONVERT, { url, format });

  if (init?.download_url) return init.download_url;

  const taskId = init?.task_id || init?.id;
  if (!taskId) throw new Error("Task ID tidak diterima dari server");

  for (let i = 0; i < MAX_POLLING; i++) {
    await new Promise((r) => setTimeout(r, POLLING_INTERVAL));

    const { data: status } = await client.get(`${API_TASK}/${taskId}`);

    if (status?.status === "finished" || status?.status === "completed") {
      const resultUrl = status?.result?.download_url || status?.download_url;
      if (!resultUrl) throw new Error("Download URL tidak ditemukan dalam response");
      return resultUrl;
    }

    if (status?.status === "failed") {
      throw new Error("Proses konversi gagal di sisi server");
    }
  }

  throw new Error("Timeout: proses konversi melebihi batas waktu");
};

export default {
  name: "Spotify Downloader",
  category: "downloader",
  description: "Download track/album/playlist Spotify dalam format MP3",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL Spotify (track/album/playlist/artist)"
    },
    format: {
      type: "string",
      required: false,
      description: "Format output: mp3 (default: mp3)"
    }
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const format = (req.query.format || req.body?.format || "mp3").toLowerCase();

    if (!url) {
      throw new Error("Parameter 'url' wajib diisi");
    }

    if (!isValidSpotifyUrl(url)) {
      throw new Error("URL Spotify tidak valid");
    }

    const startTime = Date.now();
    const client = createClient();

    const data = await getMetadata(client, url);
    const targetUrl = data?.external_urls?.spotify || url;
    const downloadUrl = await convertTrack(client, targetUrl, format);

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      title: data.name,
      artist: data.artists?.map((a) => a.name).join(", ") || null,
      album: data.album?.name || null,
      duration_ms: data.duration_ms || null,
      duration_formatted: data.duration_ms
        ? `${Math.floor(data.duration_ms / 60000)}:${String(Math.floor((data.duration_ms % 60000) / 1000)).padStart(2, "0")}`
        : null,
      cover: data.album?.images?.[0]?.url || null,
      format,
      download_url: downloadUrl,
      original_url: url,
      process_time: elapsed
    };
  }
};
