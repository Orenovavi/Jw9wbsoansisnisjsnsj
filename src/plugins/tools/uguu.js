import axios from "axios";
import FormData from "form-data";
import { fileTypeFromBuffer } from "file-type";

const fetchBuffer = async (url) => {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
  return Buffer.from(res.data);
};

const decodeBase64 = (input) => {
  const clean = input.replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(clean, "base64");
};

const uploadToUguu = async (buffer) => {
  const form = new FormData();
  const type = await fileTypeFromBuffer(buffer);
  const ext = type?.ext || "bin";

  form.append("files[]", buffer, { filename: `data.${ext}` });

  const { data } = await axios.post("https://uguu.se/upload.php", form, {
    headers: { ...form.getHeaders() },
    timeout: 60000
  });

  if (!data?.files?.[0]) throw new Error("Upload ke Uguu gagal");
  return data.files[0];
};

export default {
  name: "Uguu Uploader",
  category: "tools",
  description: "Upload file ke uguu.se, hasilkan URL sementara (expired 3 jam)",
  method: ["GET", "POST"],
  cache: 0,
  params: {
    url: {
      type: "string",
      required: false,
      description: "URL file yang akan di-upload (wajib jika tanpa base64)"
    },
    base64: {
      type: "string",
      required: false,
      description: "Data base64 file (wajib jika tanpa url)"
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
    const resultUrl = await uploadToUguu(buffer);

    return {
      url: resultUrl,
      size: buffer.length,
      note: "Link uguu.se expired dalam 3 jam",
      process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
    };
  }
};
