import { safeFetch } from "../../function.js";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

const extractFileId = (url) => {
  let match = url.match(/\/file(?:_premium)?\/([a-zA-Z0-9]+)/);
  if (!match) match = url.match(/[?&]([a-zA-Z0-9]{11,})/);
  return match ? match[1] : null;
};

const fetchPage = async (fileId) => {
  const url = `https://www.mediafire.com/file/${fileId}`;
  const response = await safeFetch(url, { headers: HEADERS }, 15000);
  if (!response.ok) throw new Error("Gagal mengakses halaman MediaFire");
  return response.text();
};

const parseDirectLink = (html) => {
  const match =
    html.match(/<a[^>]*class="[^"]*input[^"]*popsok[^"]*"[^>]*href="([^"]+)"/) ||
    html.match(/<a[^>]*id="downloadButton"[^>]*href="([^"]+)"/);

  if (!match) {
    const allMatches = [...html.matchAll(/href="(https?:\/\/[^"]*download[^"]*)"/g)];
    const found = allMatches.find((m) =>
      m[1].includes("mediafire.com") && m[1].includes("download")
    );
    return found ? found[1] : null;
  }

  return match[1];
};

const parseFilename = (html) => {
  const match = html.match(/<title>([^<]+)<\/title>/);
  if (!match) return "Unknown";
  return match[1].replace(" - MediaFire", "").replace("MediaFire", "").trim();
};

export default {
  name: "MediaFire Downloader",
  category: "downloader",
  description: "Mengambil direct download link dari MediaFire",
  method: ["GET", "POST"],
  cache: 60,
  params: {
    url: {
      type: "string",
      required: true,
      description: "URL file MediaFire"
    }
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;

    if (!url) {
      throw new Error("Parameter 'url' wajib diisi (URL file MediaFire)");
    }

    if (!url.includes("mediafire.com")) {
      throw new Error("URL tidak valid, harus dari mediafire.com");
    }

    const fileId = extractFileId(url);
    if (!fileId) {
      throw new Error("File ID tidak ditemukan dalam URL");
    }

    const startTime = Date.now();
    const html = await fetchPage(fileId);
    const directLink = parseDirectLink(html);

    if (!directLink) {
      throw new Error("Direct download link tidak ditemukan, file mungkin telah dihapus");
    }

    const filename = parseFilename(html);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      file_id: fileId,
      filename,
      direct_link: directLink,
      original_url: url,
      process_time: elapsed
    };
  }
};
