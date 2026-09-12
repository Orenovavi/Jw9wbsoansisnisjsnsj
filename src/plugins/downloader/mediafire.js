import { safeFetch } from "../../function.js";

export default {
  name: "MediaFire Downloader",
  category: "downloader",
  description: "Mengambil informasi file dan direct download URL dari MediaFire",
  method: ["GET", "POST"],
  cache: 60,

  params: {
    url: {
      type: "string",
      required: true,
      description: "URL file MediaFire"
    }
  },

  execute: async (req, res) => {
    const url = req.query.url || req.body?.url;

    if (!url) {
      const error = new Error(
        "Parameter 'url' wajib diisi (URL MediaFire)"
      );
      error.statusCode = 400;
      throw error;
    }

    let target;

    try {
      target = new URL(url);
    } catch {
      const error = new Error("URL tidak valid");
      error.statusCode = 400;
      throw error;
    }

    const hostname = target.hostname.toLowerCase();

    if (
      !hostname.endsWith("mediafire.com") &&
      !hostname.endsWith("mfi.re")
    ) {
      const error = new Error(
        "URL harus berasal dari MediaFire"
      );
      error.statusCode = 400;
      throw error;
    }

    const response = await safeFetch(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      },
      15000
    );

    if (!response.ok) {
      const error = new Error(
        `MediaFire mengembalikan HTTP ${response.status}`
      );
      error.statusCode = response.status >= 500 ? 502 : 400;
      throw error;
    }

    const html = await response.text();

    // Direct download link MediaFire biasanya berada
    // pada elemen dengan id="downloadButton".
    const downloadMatch = html.match(
      /id=["']downloadButton["'][^>]*href=["']([^"']+)["']/i
    );

    const alternateDownloadMatch = html.match(
      /href=["'](https?:\/\/download[^"']+\.mediafire\.com[^"']*)["']/i
    );

    const downloadUrl =
      downloadMatch?.[1] ||
      alternateDownloadMatch?.[1];

    if (!downloadUrl) {
      const error = new Error(
        "Direct download URL tidak ditemukan. File mungkin sudah dihapus, private, atau struktur MediaFire berubah."
      );
      error.statusCode = 404;
      throw error;
    }

    // Ambil nama file dari halaman.
    const filenameMatch =
      html.match(
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
      ) ||
      html.match(
        /<title[^>]*>(.*?)<\/title>/i
      );

    let filename =
      filenameMatch?.[1]
        ?.replace(/&amp;/g, "&")
        ?.trim() || "unknown";

    // Bersihkan title MediaFire.
    filename = filename
      .replace(/\s*-\s*MediaFire.*$/i, "")
      .trim();

    // Ambil ukuran jika tersedia.
    const sizeMatch = html.match(
      /(?:File Size|filesize|size)[^<]{0,100}?([0-9.,]+\s*(?:KB|MB|GB|TB|B))/i
    );

    const size = sizeMatch?.[1] || null;

    return {
      filename,
      size,
      download_url: downloadUrl,
      source_url: url
    };
  }
};
