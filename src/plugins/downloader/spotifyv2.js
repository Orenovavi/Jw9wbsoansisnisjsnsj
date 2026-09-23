import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const BASE = "https://spotsaver.net";
const YTM_API = "https://music.youtube.com/youtubei/v1/search";
const YTM_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";
const YTM_VERSION = "1.20260915.14.00";
const Y2MATE_API = "https://eta.etacloud.org";
const Y2MATE_KEY = "c6a644f406b57d0dd83837c868a7482e";
const UA =
  "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const client = axios.create({
  timeout: 90000,
  headers: {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    Referer: BASE + "/id/",
    Origin: BASE,
  },
  validateStatus: (s) => s < 600,
  transformResponse: [(v) => v],
});

const y2mateClient = axios.create({
  timeout: 90000,
  headers: {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    Origin: "https://y2mate.gs",
    Referer: "https://y2mate.gs/",
  },
  validateStatus: (s) => s < 600,
  transformResponse: [(v) => v],
});

const parseJson = (d) => {
  if (typeof d === "string") {
    try {
      return JSON.parse(d);
    } catch {
      return null;
    }
  }
  return d;
};

const sanitizeFilename = (name) =>
  String(name || "track")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

const hasFfmpeg = () => {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const tagAudio = (filePath, meta) => {
  if (!hasFfmpeg()) return false;
  try {
    const args = ["-y", "-i", JSON.stringify(filePath)];
    if (meta.title) args.push("-metadata", "title=" + JSON.stringify(meta.title));
    if (meta.artist) args.push("-metadata", "artist=" + JSON.stringify(meta.artist));
    if (meta.album) args.push("-metadata", "album=" + JSON.stringify(meta.album));
    const tmp = filePath.replace(/\.mp3$/i, ".tagged.mp3");
    args.push("-codec", "copy", JSON.stringify(tmp));
    execSync("ffmpeg " + args.join(" "), { stdio: "ignore" });
    fs.unlinkSync(filePath);
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    return false;
  }
};

const spotsaverSearch = async (q) => {
  const r = await client.get(BASE + "/api/spotify", { params: { q } });
  const d = parseJson(r.data);
  if (r.status >= 400 || !d?.items) throw new Error("Search gagal");
  return d.items;
};

const spotsaverInfo = async (url) => {
  const r = await client.get(BASE + "/api/spotify", { params: { url } });
  const d = parseJson(r.data);
  if (r.status >= 400 || !d?.items) throw new Error("Info gagal");
  return d.items;
};

const pickTrack = (t) => ({
  id: t.id ?? null,
  title: t.title ?? null,
  artist: t.artist ?? null,
  album: t.album ?? null,
  duration: t.duration ?? null,
  thumbnail: t.thumbnail ?? null,
  previewUrl: t.previewUrl ?? t.preview_url ?? null,
  spotifyUrl:
    t.id && String(t.id).length === 22
      ? "https://open.spotify.com/track/" + t.id
      : null,
});

const ytmSearch = async (query) => {
  const body = {
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion: YTM_VERSION,
        hl: "id",
        gl: "ID",
      },
    },
    query,
    params: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  };

  const r = await axios.post(
    YTM_API + "?key=" + YTM_KEY + "&prettyPrint=false",
    body,
    {
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        "X-Goog-Api-Key": YTM_KEY,
        "X-YouTube-Client-Name": "67",
        "X-YouTube-Client-Version": YTM_VERSION,
        Origin: "https://music.youtube.com",
        Referer: "https://music.youtube.com/",
      },
      timeout: 20000,
      validateStatus: (s) => s < 600,
      transformResponse: [(v) => v],
    }
  );

  let d = r.data;
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {}
  }

  const out = [];
  const tabs = d?.contents?.tabbedSearchResultsRenderer?.tabs || [];

  for (const tab of tabs) {
    const secs = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    for (const sec of secs) {
      const shelf = sec.musicShelfRenderer;
      if (!shelf) continue;
      for (const it of shelf.contents || []) {
        const item = it.musicResponsiveListItemRenderer;
        if (!item) continue;
        const vid = item?.playlistItemData?.videoId || null;
        const flexTexts = (item.flexColumns || [])
          .map((col) => {
            const runs =
              col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            return runs.map((x) => x.text).join("").trim();
          })
          .filter(Boolean);
        const thumb =
          item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
        const image =
          Array.isArray(thumb) && thumb.length
            ? thumb[thumb.length - 1].url
            : null;

        if (vid && flexTexts[0]) {
          out.push({
            videoId: vid,
            title: flexTexts[0],
            subtitle: flexTexts[1] || null,
            thumbnail: image,
          });
        }
      }
    }
  }

  return out;
};

const y2mateAuth = async () => {
  const r = await y2mateClient.get(Y2MATE_API + "/api/v1/auth", {
    params: { api_key: Y2MATE_KEY, _: Date.now() },
  });
  const d = parseJson(r.data);
  if (!d?.key) throw new Error("y2mate auth gagal");
  return d.key;
};

const y2mateInit = async (key) => {
  const r = await y2mateClient.get(Y2MATE_API + "/api/v1/init", {
    params: { _: Date.now() },
    headers: { Authorization: "Bearer " + key },
  });
  const d = parseJson(r.data);
  if (!d?.convertURL) throw new Error("y2mate init gagal");
  return d;
};

const y2mateConvert = async (url, videoId) => {
  const base = url.split("&v=")[0];
  const r = await y2mateClient.get(base, {
    params: { v: videoId, f: "mp3", _: Date.now() },
  });
  const d = parseJson(r.data);
  if (!d) throw new Error("y2mate convert invalid");
  if (Number(d.error) > 0) throw new Error("y2mate convert error: " + d.error);
  return d;
};

const y2mateProgress = async (progressUrl) => {
  const r = await y2mateClient.get(progressUrl, { params: { _: Date.now() } });
  const d = parseJson(r.data);
  if (!d) throw new Error("y2mate progress invalid");
  if (Number(d.error) > 0) throw new Error("y2mate progress error: " + d.error);
  return d;
};

const y2mateGetMp3 = async (videoId) => {
  const auth = await y2mateAuth();
  const init = await y2mateInit(auth);
  let currentUrl = init.convertURL;
  let downloadURL = null;
  let progressURL = null;

  for (let i = 0; i < 20; i++) {
    const d = await y2mateConvert(currentUrl, videoId);
    if (d.downloadURL) {
      downloadURL = d.downloadURL;
      break;
    }
    if (d.progressURL) progressURL = d.progressURL;
    if (d.redirectURL) {
      currentUrl = d.redirectURL;
      await new Promise((x) => setTimeout(x, 1500));
      continue;
    }
    break;
  }

  if (!downloadURL && progressURL) {
    for (let i = 0; i < 30; i++) {
      await new Promise((x) => setTimeout(x, 3000));
      const d = await y2mateProgress(progressURL);
      if (d.downloadURL) {
        downloadURL = d.downloadURL;
        break;
      }
      if (d.redirectURL) {
        const rd = await y2mateConvert(d.redirectURL, videoId);
        if (rd.downloadURL) {
          downloadURL = rd.downloadURL;
          break;
        }
        if (rd.progressURL) progressURL = rd.progressURL;
      }
      if (Number(d.progress) >= 3) break;
    }
  }

  if (!downloadURL) throw new Error("downloadURL tidak ditemukan");
  return downloadURL + "&v=" + videoId + "&f=mp3&r=y2mate.gs";
};

const saveAudio = async (audioUrl, outPath) => {
  const writer = fs.createWriteStream(outPath);
  const r = await axios.get(audioUrl, {
    responseType: "stream",
    timeout: 0,
    maxContentLength: Infinity,
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      Origin: "https://y2mate.gs",
      Referer: "https://y2mate.gs/",
    },
    validateStatus: (s) => s < 600,
  });

  if (r.status >= 400) {
    writer.close();
    try {
      fs.unlinkSync(outPath);
    } catch {}
    throw new Error("Download gagal: HTTP " + r.status);
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    r.data.on("data", (c) => (size += c.length));
    r.data.pipe(writer);
    writer.on("finish", () => resolve({ path: outPath, size }));
    writer.on("error", reject);
    r.data.on("error", reject);
  });
};

const downloadTrack = async (queryOrUrl) => {
  let searchQuery = queryOrUrl;
  let title = null;
  let artist = null;
  let album = null;
  let thumbnail = null;

  if (/open\.spotify\.com/i.test(queryOrUrl)) {
    const info = await spotsaverInfo(queryOrUrl.split("?")[0]);
    const track = info[0];
    if (track) {
      searchQuery = track.title + (track.artist ? " " + track.artist : "");
      title = track.title;
      artist = track.artist;
      album = track.album;
      thumbnail = track.thumbnail;
    }
  }

  const yt = await ytmSearch(searchQuery);
  if (!yt.length) throw new Error("Tidak ada hasil di YouTube Music");
  const top = yt[0];

  const mp3Url = await y2mateGetMp3(top.videoId);

  const tmpDir = path.join(os.tmpdir(), "spotify-dl");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const rawName = title ? (artist ? title + " - " + artist : title) : top.title;
  const safeName = sanitizeFilename(rawName) + ".mp3";
  const filePath = path.join(tmpDir, `${Date.now()}-${safeName}`);

  await saveAudio(mp3Url, filePath);
  tagAudio(filePath, { title: title || top.title, artist, album });

  return {
    title: title || top.title,
    artist: artist || top.subtitle || null,
    album,
    thumbnail: thumbnail || top.thumbnail,
    videoId: top.videoId,
    filePath,
    size: fs.statSync(filePath).size,
  };
};

export default {
  name: "Spotify Downloader",
  category: "downloader",
  description: "Cari lagu dan download sebagai MP3 (via YouTube Music + y2mate)",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    query: {
      type: "string",
      required: false,
      description: "Judul lagu atau URL Spotify",
    },
    mode: {
      type: "string",
      required: false,
      description: "Mode: 'search' (hanya cari), 'info' (detail dari URL), 'dl' (download)",
    },
  },
  execute: async (req, res) => {
    const query = req.query.query || req.body?.query;
    const mode = (req.query.mode || req.body?.mode || "dl").toLowerCase();
    const jsonMode = String(req.query.json || req.body?.json) === "true";

    if (!query) {
      res.status(400).json({
        status: false,
        message: "Parameter 'query' wajib diisi",
      });
      return;
    }

    const startTime = Date.now();

    try {
      if (mode === "search") {
        const items = await spotsaverSearch(query);
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

        res.json({
          status: true,
          result: {
            mode: "search",
            query,
            total: items.length,
            items: items.map(pickTrack),
            process_time: elapsed,
          },
        });
        return;
      }

      if (mode === "info") {
        if (!/open\.spotify\.com/i.test(query)) {
          throw new Error("Mode info butuh URL Spotify");
        }
        const items = await spotsaverInfo(query.split("?")[0]);
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

        res.json({
          status: true,
          result: {
            mode: "info",
            url: query,
            total: items.length,
            items: items.map(pickTrack),
            process_time: elapsed,
          },
        });
        return;
      }

      const result = await downloadTrack(query);
      const buffer = fs.readFileSync(result.filePath);
      const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

      try {
        fs.unlinkSync(result.filePath);
      } catch {}

      if (jsonMode) {
        res.json({
          status: true,
          result: {
            title: result.title,
            artist: result.artist,
            album: result.album,
            thumbnail: result.thumbnail,
            videoId: result.videoId,
            size: buffer.length,
            size_formatted: `${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
            base64: buffer.toString("base64"),
            process_time: elapsed,
          },
        });
        return;
      }

      const filename = `${sanitizeFilename(result.title)}.mp3`;

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      res.end(buffer);
    } catch (err) {
      console.error("[Spotify] Error:", err.message);

      res.status(500).json({
        status: false,
        message: err.message || "Gagal download dari Spotify",
      });
    }
  },
};
