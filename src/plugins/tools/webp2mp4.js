import axios from "axios";
import cheerio from "cheerio";
import FormData from "form-data";

const fetchBuffer = async (url) => {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  return Buffer.from(res.data);
};

const decodeBase64 = (input) => {
  const clean = input.replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(clean, "base64");
};

const uploadToEzgif = async (buffer) => {
  const form = new FormData();
  form.append("new-image-url", "");
  form.append("new-image", buffer, { filename: "data.webp" });

  const { data: html } = await axios.post(
    "https://s6.ezgif.com/webp-to-mp4",
    form,
    {
      headers: { ...form.getHeaders() },
      timeout: 60000
    }
  );

  const $ = cheerio.load(html);
  const file = $('input[name="file"]').attr("value");
  if (!file) throw new Error("Gagal mendapatkan token upload dari ezgif");

  return file;
};

const convertOnEzgif = async (file) => {
  const form = new FormData();
  form.append("file", file);
  form.append("convert", "Convert WebP to MP4!");

  const { data: html } = await axios.post(
    `https://ezgif.com/webp-to-mp4/${file}`,
    form,
    {
      headers: { ...form.getHeaders() },
      timeout: 90000
    }
  );

  const $ = cheerio.load(html);
  const src = $("div#output > p.outfile > video > source").attr("src");
  if (!src) throw new Error("Gagal mendapatkan URL hasil konversi dari ezgif");

  return "https:" + src;
};

export default {
  name: "WebP to MP4",
  category: "tools",
  description: "Konversi file WebP (animasi) menjadi MP4 menggunakan ezgif.com",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    url: {
      type: "string",
      required: false,
      description: "URL file WebP (wajib jika tanpa base64)"
    },
    base64: {
      type: "string",
      required: false,
      description: "Data base64 WebP (wajib jika tanpa url)"
    }
  },
  execute: async (req) => {
    const url = req.query.url || req.body?.url;
    const base64 = req.query.base64 || req.body?.base64;

    if (!url && !base64) {
      throw new Error("Parameter 'url' atau 'base64' wajib diisi");
    }

    const startTime = Date.now();
    const buffer = url ? await fetchBuffer(url) : decodeBase64(base64);
    const fileToken = await uploadToEzgif(buffer);
    const mp4Url = await convertOnEzgif(fileToken);

    return {
      original_size: buffer.length,
      result_url: mp4Url,
      process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
    };
  }
};
