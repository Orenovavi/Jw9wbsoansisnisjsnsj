import axios from "axios";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json"
};

const normalizePhone = (input) => {
  if (!input) return null;
  let phone = String(input).replace(/[^0-9]/g, "");

  if (phone.startsWith("0")) phone = "62" + phone.slice(1);
  if (phone.startsWith("8")) phone = "62" + phone;

  return phone;
};

const fetchJson = async (url, timeout = 15000) => {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout });
    return data;
  } catch {
    return null;
  }
};

const tryRyzenDesu = async (phone) => {
  const data = await fetchJson(
    `https://api.ryzendesu.vip/api/stalker/wa?phone=${phone}`
  );
  if (!data?.success && !data?.data) return null;

  const d = data.data || data;
  return {
    source: "ryzendesu",
    name: d.name || d.pushname || null,
    phone,
    photo: d.photo || d.profile_picture || d.image || null
  };
};

const tryLolhuman = async (phone) => {
  const data = await fetchJson(
    `https://api.lolhuman.xyz/api/stalkwa?apikey=free&query=${phone}`
  );
  if (!data?.result) return null;

  const r = data.result;
  return {
    source: "lolhuman",
    name: r.name || null,
    phone,
    photo: r.photo || r.profile_picture || null
  };
};

const tryZass = async (phone) => {
  const data = await fetchJson(
    `https://api.zass.in/api/stalkwa?phone=${phone}`
  );
  if (!data?.status || !data?.data) return null;

  const d = data.data;
  return {
    source: "zass",
    name: d.name || null,
    phone,
    photo: d.photo || d.pp || null
  };
};

const tryGeneric = async (phone) => {
  const data = await fetchJson(
    `https://api.akuari.my.id/whatsapp/checkwa?nomor=${phone}`
  );
  if (!data?.result) return null;

  return {
    source: "akuari",
    name: data.result.name || null,
    phone,
    photo: data.result.photo || data.result.pp || null
  };
};

const PROVIDERS = [tryRyzenDesu, tryLolhuman, tryZass, tryGeneric];

export default {
  name: "WhatsApp Get Profile Picture",
  category: "tools",
  description: "Ambil foto profil WhatsApp dari nomor telepon (format internasional tanpa +)",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    phone: {
      type: "string",
      required: true,
      description: "Nomor WhatsApp (contoh: 6281234567890)"
    }
  },
  execute: async (req) => {
    const phone = req.query.phone || req.body?.phone;

    if (!phone) {
      throw new Error("Parameter 'phone' wajib diisi");
    }

    const normalized = normalizePhone(phone);

    if (!normalized || normalized.length < 10 || normalized.length > 15) {
      throw new Error("Format nomor tidak valid (contoh: 6281234567890)");
    }

    const startTime = Date.now();

    for (const provider of PROVIDERS) {
      const result = await provider(normalized);
      if (result && result.photo) {
        const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;
        return {
          phone: normalized,
          name: result.name,
          photo_url: result.photo,
          source: result.source,
          process_time: elapsed
        };
      }
    }

    throw new Error("Gagal mengambil foto profil. Nomor mungkin tidak terdaftar, PP di-private, atau semua API sedang down.");
  }
};
