import axios from "axios";

const API_URL = "https://www.tikwm.com/api/feed/search";
const TIMEOUT = 30000;
const MAX_RESULTS = 20;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.tikwm.com/",
};

const isString = (v) => typeof v === "string" && v.length > 0;

const formatNumber = (n) => {
  const num = parseInt(n);
  if (isNaN(num)) return 0;
  return num;
};

const formatDuration = (sec) => {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const parseVideo = (item) => {
  if (!item) return null;

  const videoId =
    item.video_id ||
    item.id ||
    item.aweme_id ||
    (item.play && item.play.match(/\/([a-z0-9]+)\//i)?.[1]) ||
    null;

  const author = item.author || {};
  const music = item.music_info || item.music || {};

  return {
    video_id: videoId,
    title: (item.title || "").trim() || null,
    description: (item.title || "").trim() || null,
    cover: item.cover || item.origin_cover || item.dynamic_cover || null,
    duration: item.duration || null,
    duration_formatted: formatDuration(item.duration),
    region: item.region || null,
    play_count: formatNumber(item.play_count),
    like_count: formatNumber(item.digg_count),
    comment_count: formatNumber(item.comment_count),
    share_count: formatNumber(item.share_count),
    download_count: formatNumber(item.download_count),
    author: {
      id: author.id || null,
      username: author.unique_id || author.uniqueId || null,
      nickname: author.nickname || null,
      avatar: author.avatar || null,
    },
    music: {
      id: music.id || null,
      title: music.title || null,
      author: music.author || null,
      url: music.play || item.music || null,
    },
    video_url: item.play || null,
    video_url_hd: item.hdplay || null,
    video_url_wm: item.wmplay || null,
    share_url:
      item.share_url ||
      (videoId && author.unique_id
        ? `https://www.tiktok.com/@${author.unique_id}/video/${videoId}`
        : null),
  };
};

const searchTikTok = async (keywords, count = 12) => {
  const params = {
    keywords: keywords.trim(),
    count: Math.min(Math.max(count, 1), MAX_RESULTS),
  };

  const { data } = await axios.get(API_URL, {
    params,
    headers: HEADERS,
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (data?.code !== 0) {
    throw new Error(data?.msg || "Gagal mencari video TikTok");
  }

  const videos = data?.data?.videos || [];
  if (!videos.length) return [];

  return videos.map(parseVideo).filter(Boolean);
};

export default {
  name: "TikTok Search",
  category: "search",
  description: "Cari video TikTok berdasarkan keyword",
  method: ["GET", "POST"],
  cache: 120,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian",
    },
    count: {
      type: "number",
      required: false,
      description: "Jumlah hasil (default: 12, max: 20)",
    },
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const count = Math.min(
      Math.max(parseInt(req.query.count || req.body?.count || 12), 1),
      MAX_RESULTS
    );

    if (!isString(query)) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();
    const results = await searchTikTok(query, count);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    if (!results.length) {
      throw new Error(`Tidak ada hasil untuk: ${query}`);
    }

    return {
      query: query.trim(),
      total: results.length,
      results,
      process_time: elapsed,
    };
  },
};
