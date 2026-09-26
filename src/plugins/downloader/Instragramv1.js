import axios from "axios";
import crypto from "crypto";

const TIMEOUT = 30000;
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE = 200;

const cache = new Map();

const IG_APP_IDS = [
  "936619743392459",
  "567067343352427",
  "124024574287414",
];

const GRAPHQL_QUERIES = [
  {
    name: "post_info_v1",
    queryId: "8845758582119845",
    buildVars: (sc) => ({
      shortcode: sc,
      __relay_internal__pv__PolarisFeedShareMenurelayprovider: true,
    }),
  },
  {
    name: "post_info_v2",
    queryId: "17851374694183129",
    buildVars: (sc) => ({ shortcode: sc }),
  },
];

const SHORTCODE_RE = /instagram\.com\/(?:p|reel|reels|tv|share)\/([A-Za-z0-9_-]+)/;
const USERNAME_RE = /instagram\.com\/([A-Za-z0-9_.]+)\/?(?:\?|$)/;

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

const isString = (v) => typeof v === "string" && v.length > 0;

const getCached = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCached = (key, value) => {
  if (cache.size >= MAX_CACHE) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 50);
    for (const [k] of oldest) cache.delete(k);
  }
  cache.set(key, { value, ts: Date.now() });
};

const extractShortcode = (url) => {
  if (!isString(url)) return null;
  const m = url.match(SHORTCODE_RE);
  return m ? m[1] : null;
};

const extractUsername = (url) => {
  if (!isString(url)) return null;
  if (url.includes("/p/") || url.includes("/reel/")) return null;
  const m = url.match(USERNAME_RE);
  if (!m) return null;
  const u = m[1];
  if (["p", "reel", "reels", "tv", "share", "explore", "stories"].includes(u)) return null;
  return u;
};

const buildHeaders = (appId) => ({
  "User-Agent": pickUA(),
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "X-IG-App-ID": appId,
  "X-Requested-With": "XMLHttpRequest",
  "X-ASBD-ID": "129477",
  "X-IG-WWW-Claim": "0",
  Origin: "https://www.instagram.com",
  Referer: "https://www.instagram.com/",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
});

const graphqlFetch = async (shortcode, query, appId) => {
  const variables = JSON.stringify(query.buildVars(shortcode));
  const url = `https://www.instagram.com/graphql/query/?query_id=${query.queryId}&variables=${encodeURIComponent(variables)}`;

  const res = await axios.get(url, {
    headers: buildHeaders(appId),
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw new Error(`GraphQL HTTP ${res.status}`);
  }

  return res.data;
};

const apiV1Fetch = async (shortcode, appId) => {
  const pageRes = await axios.get(
    `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
    {
      headers: buildHeaders(appId),
      timeout: TIMEOUT,
      validateStatus: () => true,
      maxRedirects: 5,
    }
  );

  if (pageRes.status === 200 && pageRes.data?.items) {
    return { items: pageRes.data.items, source: "page_a1" };
  }

  const htmlRes = await axios.get(`https://www.instagram.com/p/${shortcode}/`, {
    headers: {
      "User-Agent": pickUA(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (htmlRes.status !== 200 || typeof htmlRes.data !== "string") {
    throw new Error(`Page HTTP ${htmlRes.status}`);
  }

  const match = htmlRes.data.match(
    /<script type="application\/ld\+json">([^<]+)<\/script>/
  );

  if (match) {
    try {
      const json = JSON.parse(match[1]);
      return { ld: json, source: "ld_json" };
    } catch {}
  }

  const ogImage = htmlRes.data.match(
    /<meta property="og:image" content="([^"]+)"/
  );
  const ogVideo = htmlRes.data.match(
    /<meta property="og:video" content="([^"]+)"/
  );
  const ogTitle = htmlRes.data.match(
    /<meta property="og:title" content="([^"]+)"/
  );
  const ogDesc = htmlRes.data.match(
    /<meta property="og:description" content="([^"]+)"/
  );

  if (ogImage || ogVideo) {
    return {
      og: {
        image: ogImage?.[1] || null,
        video: ogVideo?.[1] || null,
        title: ogTitle?.[1] || null,
        description: ogDesc?.[1] || null,
      },
      source: "og_tags",
    };
  }

  throw new Error("Semua metode gagal ambil data");
};

const parseMediaNode = (node) => {
  if (!node) return null;

  const isVideo = node.is_video || node.media_type === 2 || node.video_url || node.video_versions;

  const images = [];
  if (Array.isArray(node.image_versions2?.candidates)) {
    for (const c of node.image_versions2.candidates) {
      images.push({ url: c.url, width: c.width, height: c.height });
    }
  }
  if (Array.isArray(node.display_resources)) {
    for (const r of node.display_resources) {
      images.push({ url: r.src, width: r.config_width || r.width, height: r.config_height || r.height });
    }
  }
  if (node.display_url) images.push({ url: node.display_url, width: 0, height: 0 });

  const dedup = [...new Map(images.map((i) => [i.url, i])).values()];
  dedup.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const videos = [];
  if (Array.isArray(node.video_versions)) {
    for (const v of node.video_versions) {
      videos.push({ url: v.url, width: v.width, height: v.height });
    }
  }
  if (Array.isArray(node.video_resources)) {
    for (const v of node.video_resources) {
      videos.push({ url: v.src, width: v.config_width || v.width, height: v.config_height || v.height });
    }
  }
  if (node.video_url) videos.push({ url: node.video_url, width: 0, height: 0 });

  const dedupV = [...new Map(videos.map((v) => [v.url, v])).values()];
  dedupV.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const user = node.user || node.owner || {};

  return {
    id: node.pk || node.id || node.media_id || null,
    shortcode: node.code || node.shortcode || null,
    type: isVideo ? "video" : node.media_type === 8 ? "carousel" : "photo",
    caption: node.caption?.text || node.caption || node.edge_media_to_caption?.edges?.[0]?.node?.text || null,
    taken_at: node.taken_at || node.taken_at_timestamp || null,
    like_count: node.like_count || node.edge_liked_by?.count || null,
    comment_count: node.comment_count || node.edge_media_to_comment?.count || null,
    view_count: node.view_count || node.play_count || null,
    dimensions: {
      width: node.original_width || node.dimensions?.width || null,
      height: node.original_height || node.dimensions?.height || null,
    },
    user: {
      id: user.pk || user.id || null,
      username: user.username || null,
      full_name: user.full_name || null,
      profile_pic: user.profile_pic_url || null,
      is_verified: user.is_verified || false,
    },
    image: dedup[0] || null,
    images: dedup.slice(0, 5),
    video: dedupV[0] || null,
    videos: dedupV.slice(0, 5),
    carousel: Array.isArray(node.carousel_media)
      ? node.carousel_media.map(parseMediaNode).filter(Boolean)
      : null,
    music: node.music_metadata
      ? {
          title: node.music_metadata.music_info?.title || null,
          artist: node.music_metadata.music_info?.display_artist || null,
          url: node.music_metadata.music_info?.audio_asset?.url || null,
        }
      : null,
  };
};

const parseGraphQLResponse = (data) => {
  if (!data?.data) return null;

  const info =
    data.data.xdt_api__v1__media__shortcode__web_info ||
    data.data.xdt_shortcode_media ||
    data.data.shortcode_media;

  if (!info) return null;

  const items = info.items || info.edges || [info];
  const first = items[0]?.node || items[0];
  if (!first) return null;

  return parseMediaNode(first);
};

const parseLdJson = (ld) => {
  if (!ld) return null;

  const img = ld.image;
  const vid = ld.video;

  return {
    id: null,
    shortcode: null,
    type: vid ? "video" : "photo",
    caption: ld.caption || ld.description || null,
    taken_at: ld.uploadDate ? Math.floor(new Date(ld.uploadDate).getTime() / 1000) : null,
    like_count: ld.interactionStatistic?.find((s) => s.interactionType?.includes("Like"))?.userInteractionCount || null,
    comment_count: ld.interactionStatistic?.find((s) => s.interactionType?.includes("Comment"))?.userInteractionCount || null,
    view_count: ld.interactionStatistic?.find((s) => s.interactionType?.includes("Watch"))?.userInteractionCount || null,
    dimensions: img
      ? { width: img.width || null, height: img.height || null }
      : null,
    user: {
      id: null,
      username: ld.author?.alternateName || ld.author?.name || null,
      full_name: ld.author?.name || null,
      profile_pic: null,
      is_verified: false,
    },
    image: img ? { url: img.url || img, width: img.width || 0, height: img.height || 0 } : null,
    images: img ? [{ url: img.url || img, width: img.width || 0, height: img.height || 0 }] : [],
    video: vid ? { url: vid.url || vid, width: vid.width || 0, height: vid.height || 0 } : null,
    videos: vid ? [{ url: vid.url || vid, width: vid.width || 0, height: vid.height || 0 }] : [],
    carousel: null,
    music: null,
  };
};

const parseOgTags = (og) => {
  if (!og) return null;

  return {
    id: null,
    shortcode: null,
    type: og.video ? "video" : "photo",
    caption: og.description || og.title || null,
    taken_at: null,
    like_count: null,
    comment_count: null,
    view_count: null,
    dimensions: null,
    user: {
      id: null,
      username: null,
      full_name: og.title || null,
      profile_pic: null,
      is_verified: false,
    },
    image: og.image ? { url: og.image, width: 0, height: 0 } : null,
    images: og.image ? [{ url: og.image, width: 0, height: 0 }] : [],
    video: og.video ? { url: og.video, width: 0, height: 0 } : null,
    videos: og.video ? [{ url: og.video, width: 0, height: 0 }] : [],
    carousel: null,
    music: null,
  };
};

const fetchMedia = async (url) => {
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    throw new Error("URL Instagram tidak valid. Format: instagram.com/p/<shortcode> atau /reel/<shortcode>");
  }

  const cached = getCached(shortcode);
  if (cached) return { ...cached, from_cache: true };

  const errors = [];

  for (const appId of IG_APP_IDS) {
    for (const query of GRAPHQL_QUERIES) {
      try {
        const data = await graphqlFetch(shortcode, query, appId);
        const parsed = parseGraphQLResponse(data);
        if (parsed) {
          const result = { ...parsed, source: `graphql:${query.name}` };
          setCached(shortcode, result);
          return result;
        }
      } catch (e) {
        errors.push(`graphql/${query.name}/${appId.slice(0, 5)}: ${e.message}`);
      }
    }
  }

  for (const appId of IG_APP_IDS) {
    try {
      const data = await apiV1Fetch(shortcode, appId);

      if (data.items) {
        const parsed = parseMediaNode(data.items[0]);
        if (parsed) {
          const result = { ...parsed, source: data.source };
          setCached(shortcode, result);
          return result;
        }
      }

      if (data.ld) {
        const parsed = parseLdJson(data.ld);
        if (parsed) {
          const result = { ...parsed, source: "ld_json" };
          setCached(shortcode, result);
          return result;
        }
      }

      if (data.og) {
        const parsed = parseOgTags(data.og);
        if (parsed) {
          const result = { ...parsed, source: "og_tags" };
          setCached(shortcode, result);
          return result;
        }
      }
    } catch (e) {
      errors.push(`v1/${appId.slice(0, 5)}: ${e.message}`);
    }
  }

  throw new Error(
    `Gagal ambil media. Semua metode gagal:\n${errors.slice(0, 3).join("\n")}`
  );
};

export default {
  name: "Instagram Downloader",
  category: "downloader",
  description: "Download media Instagram (post, reels, carousel, video) dengan metadata lengkap",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL Instagram (post, reel, atau IGTV)",
    },
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;

    if (!isString(url)) {
      throw new Error("Parameter 'url' wajib diisi");
    }

    if (!url.includes("instagram.com")) {
      throw new Error("URL harus dari instagram.com");
    }

    const startTime = Date.now();
    const result = await fetchMedia(url);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      ...result,
      original_url: url,
      process_time: elapsed,
    };
  },
};
