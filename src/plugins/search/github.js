import { safeFetch } from "../../function.js";

const GITHUB_API = "https://api.github.com/search/repositories";

const HEADERS = {
  "User-Agent": "Justputu-API",
  "Accept": "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

const searchRepos = async (query, options = {}) => {
  const {
    sort = "stars",
    order = "desc",
    perPage = 10,
    page = 1
  } = options;

  const params = new URLSearchParams({
    q: query,
    sort,
    order,
    per_page: String(perPage),
    page: String(page)
  });

  const url = `${GITHUB_API}?${params.toString()}`;
  const response = await safeFetch(url, { headers: HEADERS }, 15000);

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("Rate limit GitHub tercapai, coba lagi nanti atau gunakan token");
    }
    throw new Error(`GitHub API error: ${response.status}`);
  }

  return response.json();
};

const formatResults = (data) => {
  if (!data.items || data.items.length === 0) {
    return [];
  }

  return data.items.map((repo) => ({
    name: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    language: repo.language,
    updated_at: repo.updated_at
  }));
};

export default {
  name: "GitHub Search",
  category: "search",
  description: "Cari repositori di GitHub berdasarkan keyword",
  method: ["GET", "POST"],
  cache: 300,
  params: {
    query: {
      type: "string",
      required: true,
      description: "Kata kunci pencarian repositori"
    },
    sort: {
      type: "string",
      required: false,
      description: "Urutkan berdasarkan: stars, forks, updated (default: stars)"
    },
    order: {
      type: "string",
      required: false,
      description: "Urutan: desc atau asc (default: desc)"
    },
    limit: {
      type: "number",
      required: false,
      description: "Jumlah hasil maksimal (default: 10, max: 100)"
    }
  },
  execute: async (req) => {
    const query = req.query.query || req.body?.query;
    const sort = req.query.sort || req.body?.sort || "stars";
    const order = req.query.order || req.body?.order || "desc";
    const limit = Math.min(parseInt(req.query.limit || req.body?.limit || 10), 100);

    if (!query) {
      throw new Error("Parameter 'query' wajib diisi");
    }

    const startTime = Date.now();
    const data = await searchRepos(query, { sort, order, perPage: limit });
    const results = formatResults(data);
    const elapsed = `${((Date.now() - startTime) / 1000).toFixed(2)}s`;

    return {
      query,
      total_count: data.total_count || 0,
      returned: results.length,
      results,
      process_time: elapsed
    };
  }
};
