import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://id.wikipedia.org";

const HEADERS = {
  "User-Agent": "WikiScraper/1.0 (contact@example.com)",
  "Accept-Language": "id-ID",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

const IGNORE_SECTIONS = [
  "Daftar isi",
  "Referensi",
  "Pranala luar",
  "Lihat pula",
  "Catatan kaki",
  "Sumber",
  "Bacaan lanjut"
];

const req = async (url, params = {}) => {
  try {
    const { data } = await axios.get(url, {
      params,
      headers: HEADERS,
      timeout: 15000
    });
    return data;
  } catch (e) {
    return null;
  }
};

const cleanText = ($, element) => {
  if (!element || $(element).length === 0) return null;
  try {
    const el = $(element).clone();
    el.find(
      "sup, style, script, .mw-editsection, .reference, .noprint, .error, .hatnote, .Template-Fact"
    ).remove();
    el.find("br").replaceWith(", ");
    el.find("li").prepend("• ").append("\n");

    let text = el.text();
    text = text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, " ")
      .replace(/ ,/g, ",")
      .replace(/^,|,$/g, "")
      .trim();

    return text || null;
  } catch (e) {
    return null;
  }
};

const extractImages = ($) => {
  try {
    const images = [];
    $(".infobox img, .thumbimage, .gallery img, .mw-parser-output > div > a > img").each(
      (i, el) => {
        let src = $(el).attr("src");
        const alt = $(el).attr("alt") || "";

        if (src) {
          if (src.includes("/thumb/")) {
            src = src.replace("/thumb/", "/").split("/").slice(0, -1).join("/");
          }
          if (src.startsWith("//")) src = "https:" + src;

          if (
            !src.endsWith(".svg") &&
            !src.includes("Flag_of") &&
            !src.includes("Ambox")
          ) {
            images.push({ url: src, caption: alt });
          }
        }
      }
    );

    return [...new Map(images.map((item) => [item.url, item])).values()];
  } catch (e) {
    return [];
  }
};

const parseComponents = ($) => {
  const infobox = {};
  const taxonomy = {};
  let isTaxonomyMode = false;

  try {
    $(".infobox tr").each((i, row) => {
      const $row = $(row);

      if ($row.find("th[colspan]").length > 0) {
        const header = cleanText($, $row.find("th"));
        if (header) {
          isTaxonomyMode =
            header.toLowerCase().includes("klasifikasi") ||
            header.toLowerCase().includes("scientific");
        }
        return;
      }

      let key = null;
      let value = null;

      if ($row.find("th").length > 0 && $row.find("td").length > 0) {
        key = cleanText($, $row.find("th").first());
        value = cleanText($, $row.find("td").first());
      } else if ($row.find("td").length > 1) {
        key = cleanText($, $row.find("td").eq(0));
        value = cleanText($, $row.find("td").eq(1));
      }

      if (key && value && key.length > 1 && value.length > 0) {
        key = key.replace(/:$/, "").trim();
        if (isTaxonomyMode) {
          taxonomy[key] = value;
        } else if (key.toLowerCase() !== value.toLowerCase()) {
          infobox[key] = value;
        }
      }
    });
  } catch (e) {}

  return {
    infobox: Object.keys(infobox).length ? infobox : null,
    taxonomy: Object.keys(taxonomy).length ? taxonomy : null
  };
};

const parseSections = ($) => {
  const sections = [];

  try {
    const $containers = $("section[data-mw-section-id]");

    if ($containers.length > 0) {
      $containers.each((i, el) => {
        const $sec = $(el);
        const heading = $sec.find("h2, h3, .mw-heading").first().text().trim();

        if (!heading || IGNORE_SECTIONS.some((x) => heading.includes(x))) return;

        const paragraphs = [];
        $sec.find("p, ul, ol").each((j, node) => {
          if ($(node).parents(".infobox, .navbox, .hatnote, table").length === 0) {
            const txt = cleanText($, node);
            if (txt && txt.length > 5) paragraphs.push(txt);
          }
        });

        if (paragraphs.length > 0) {
          sections.push({ heading, content: paragraphs.join("\n\n") });
        }
      });
    }

    if (sections.length === 0) {
      $(".mw-parser-output > h2, .mw-parser-output > h3").each((i, el) => {
        const heading = $(el).text().trim();
        if (!heading || IGNORE_SECTIONS.some((x) => heading.includes(x))) return;

        const paragraphs = [];
        let $next = $(el).next();

        while ($next.length && !$next.is("h2, h3, .mw-heading")) {
          if ($next.is("p, ul, ol") && !$next.hasClass("mw-empty-elt")) {
            const txt = cleanText($, $next);
            if (txt && txt.length > 5) paragraphs.push(txt);
          }
          $next = $next.next();
        }

        if (paragraphs.length > 0) {
          sections.push({ heading, content: paragraphs.join("\n\n") });
        }
      });
    }
  } catch (e) {}

  return sections;
};

const getRelated = async (title, limit = 5) => {
  try {
    const data = await req(`${BASE_URL}/w/api.php`, {
      action: "query",
      format: "json",
      generator: "search",
      gsrsearch: `morelike:${title}`,
      gsrlimit: limit,
      prop: "pageimages|description",
      piprop: "thumbnail",
      pithumbsize: 200
    });

    return Object.values(data?.query?.pages || {}).map((p) => ({
      title: p.title,
      description: p.description || null,
      thumbnail: p.thumbnail?.source || null,
      url: `https://id.wikipedia.org/wiki/${encodeURIComponent(p.title)}`
    }));
  } catch (e) {
    return [];
  }
};

const getPage = async (title) => {
  const result = {
    title,
    url: `https://id.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    intro: null,
    infobox: null,
    taxonomy: null,
    sections: [],
    images: [],
    stats: { references: 0 }
  };

  try {
    const html = await req(`${BASE_URL}/wiki/${encodeURIComponent(title)}`);
    if (!html || typeof html !== "string") return result;

    const $ = cheerio.load(html);
    const components = parseComponents($);
    const sections = parseSections($);
    const images = extractImages($);

    let intro = null;
    $(".mw-parser-output > p").each((i, el) => {
      const t = cleanText($, el);
      if (t && t.length > 50 && !intro) intro = t;
    });

    return {
      ...result,
      title: $("h1#firstHeading").text().trim() || title,
      intro,
      infobox: components.infobox,
      taxonomy: components.taxonomy,
      sections,
      images,
      stats: { references: $(".reference").length }
    };
  } catch (e) {
    return { ...result, error: e.message };
  }
};

const searchWiki = async (query, limit) => {
  const results = [];

  const data = await req(`${BASE_URL}/w/api.php`, {
    action: "query",
    format: "json",
    generator: "prefixsearch",
    gpssearch: query,
    gpslimit: limit,
    prop: "pageimages|description|info",
    piprop: "thumbnail",
    pithumbsize: 200,
    inprop: "url"
  });

  const pages = Object.values(data?.query?.pages || {});

  for (const item of pages) {
    results.push({
      page_id: item.pageid,
      title: item.title,
      description: item.description || null,
      thumbnail: item.thumbnail?.source || null,
      url: item.fullurl
    });
  }

  return results;
};

export default {
  name: "Wikipedia Indonesia",
  category: "search",
  description:
    "Cari artikel Wikipedia Indonesia atau ambil detail halaman (intro, infobox, taxonomy, section, gambar, related)",
  method: ["GET", "POST"],
  cache: 600,
  params: {
    query: {
      type: "string",
      required: false,
      description: "Kata kunci pencarian (wajib jika tanpa 'title')"
    },
    title: {
      type: "string",
      required: false,
      description: "Judul artikel untuk mode detail langsung"
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil pencarian (default: 5)"
    },
    detail: {
      type: "boolean",
      required: false,
      description: "Ambil detail lengkap untuk setiap hasil search"
    },
    related: {
      type: "boolean",
      required: false,
      description: "Ambil artikel terkait"
    }
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const title = req.query.title || req.body?.title;
    const limit = parseInt(req.query.limit || req.body?.limit || 5);
    const detail = String(req.query.detail || req.body?.detail) === "true";
    const related = String(req.query.related || req.body?.related) === "true";

    if (!query && !title) {
      throw new Error("Parameter 'query' atau 'title' wajib diisi");
    }

    const startTime = Date.now();

    if (title && !query) {
      const page = await getPage(title);

      if (related) {
        page.related_articles = await getRelated(title, 5);
      }

      return {
        mode: "page",
        ...page,
        process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
      };
    }

    const results = await searchWiki(query, limit);

    for (const item of results) {
      if (detail) {
        const fullData = await getPage(item.title);
        Object.assign(item, fullData);
      }

      if (related) {
        item.related_articles = await getRelated(item.title, 3);
      }
    }

    return {
      mode: "search",
      query,
      total: results.length,
      results,
      process_time: `${((Date.now() - startTime) / 1000).toFixed(2)}s`
    };
  }
};
