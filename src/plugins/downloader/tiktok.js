import axios from 'axios';

const API_URL = 'https://www.tikwm.com/api/';
const TIMEOUT = 30000;

const HEADERS = {
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Origin': 'https://www.tikwm.com',
  'Referer': 'https://www.tikwm.com/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
};

const isValidTikTokUrl = (url) => {
  if (!url) return false;
  return /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(url);
};

const formatNumber = (num) => {
  const n = parseInt(num);
  if (isNaN(n)) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
};

const fetchTikwm = async (url) => {
  const { data } = await axios.post(
    API_URL,
    new URLSearchParams({ url, hd: '1' }).toString(),
    { headers: HEADERS, timeout: TIMEOUT }
  );

  if (data?.code !== 0 || !data?.data) {
    throw new Error(data?.msg || 'Gagal mengambil data dari TikTok');
  }

  return data.data;
};

const buildMediaList = (res) => {
  const media = [];

  const isSlide = !res.size && !res.wm_size && !res.hd_size;

  if (isSlide && Array.isArray(res.images)) {
    for (const img of res.images) {
      media.push({ type: 'photo', url: img });
    }
    return media;
  }

  if (res.hdplay) media.push({ type: 'nowatermark_hd', url: res.hdplay });
  if (res.play) media.push({ type: 'nowatermark', url: res.play });
  if (res.wmplay) media.push({ type: 'watermark', url: res.wmplay });

  return media;
};

const buildResult = (res) => ({
  id: res.id,
  title: res.title,
  region: res.region || null,
  duration: res.duration ? `${res.duration} detik` : null,
  duration_seconds: res.duration || 0,
  is_slide: !res.size && !res.wm_size && !res.hd_size,
  cover: res.cover || null,
  media: buildMediaList(res),
  music: res.music_info
    ? {
        id: res.music_info.id,
        title: res.music_info.title,
        author: res.music_info.author,
        album: res.music_info.album || null,
        url: res.music || res.music_info.play,
      }
    : null,
  stats: {
    views: formatNumber(res.play_count),
    likes: formatNumber(res.digg_count),
    comments: formatNumber(res.comment_count),
    shares: formatNumber(res.share_count),
    downloads: formatNumber(res.download_count),
  },
  author: res.author
    ? {
        id: res.author.id,
        username: res.author.unique_id,
        nickname: res.author.nickname,
        avatar: res.author.avatar,
      }
    : null,
});

export default {
  name: 'TikTok Downloader',
  category: 'downloader',
  description: 'Download video/slide TikTok tanpa watermark beserta info musik dan statistik',
  method: ['GET', 'POST'],
  cache: 120,
  params: {
    url: {
      type: 'string',
      required: true,
      description: 'URL video TikTok (tiktok.com, vm.tiktok.com, vt.tiktok.com)',
    },
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;

    if (!url) {
      throw new Error("Parameter 'url' wajib diisi");
    }

    if (!isValidTikTokUrl(url)) {
      throw new Error('URL tidak valid, harus dari tiktok.com');
    }

    const startTime = Date.now();

    const raw = await fetchTikwm(url);
    const result = buildResult(raw);

    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      ...result,
      original_url: url,
      process_time: elapsed,
    };
  },
};
