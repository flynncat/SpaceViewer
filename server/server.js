const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

dotenv.config();

const app = express();
app.disable("etag");
const PORT = Number(process.env.PORT || 5173);
const NASA_API_KEY = process.env.NASA_API_KEY || "DEMO_KEY";
const notablePath = path.join(__dirname, "..", "shared", "data", "notable-meteorites.json");
const neoFallbackPath = path.join(__dirname, "..", "shared", "data", "neo-fallback.json");

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  // 开发阶段禁用浏览器缓存，避免看到旧页面。
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

const cache = new Map();
const execFileAsync = promisify(execFile);
let lastSuccessfulNeo = [];

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data, ttlMs) {
  cache.set(key, { data, expireAt: Date.now() + ttlMs });
}

async function fetchJson(url, timeoutMs = 9000) {
  let timer = null;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    timer = null;
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (fetchError) {
    // 某些运行环境下 Node fetch 会受限，回退到 curl 保证可用性。
    const { stdout } = await execFileAsync("curl", ["-sL", "--max-time", "10", url]);
    if (!stdout) {
      throw new Error(`fetch 与 curl 均失败: ${String(fetchError.message || fetchError)}`);
    }
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`远端返回非 JSON 内容: ${stdout.slice(0, 120)}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchJsonWithRetry(url, attempts = 2, timeoutMs = 9000) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("fetchJsonWithRetry 未知错误");
}

function toDateYMD(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function normalizeNeo(item, index) {
  const close = item.close_approach_data?.[0] || {};
  const diameterMin = Number(item.estimated_diameter?.meters?.estimated_diameter_min || 0);
  const diameterMax = Number(item.estimated_diameter?.meters?.estimated_diameter_max || 0);
  const diameterMean = diameterMin && diameterMax ? (diameterMin + diameterMax) / 2 : diameterMax || diameterMin || 10;
  const missKm = Number(close.miss_distance?.kilometers || 0);
  const speedKps = Number(close.relative_velocity?.kilometers_per_second || 0);

  return {
    id: `neo-${item.id}`,
    neoRefId: item.id,
    name: item.name || `未命名对象-${index + 1}`,
    type: "近地小天体",
    location: `绕 ${close.orbiting_body || "Sun"} 轨道`,
    year: (close.close_approach_date || "").slice(0, 4) || "未知",
    diameter: `${diameterMean.toFixed(1)} m（估算）`,
    speed: `${speedKps.toFixed(2)} km/s`,
    nearest: close.close_approach_date_full || close.close_approach_date || "未知",
    risk: item.is_potentially_hazardous_asteroid ? "高关注" : "常规",
    description: `NASA NEO Feed 实时对象，最小地球距离约 ${Math.round(missKm).toLocaleString()} km。`,
    image: "",
    source: item.nasa_jpl_url || "https://cneos.jpl.nasa.gov/",
    metrics: {
      missKm,
      speedKps,
      hazardous: Boolean(item.is_potentially_hazardous_asteroid),
      diameterM: diameterMean,
    },
  };
}

function normalizeBrowseNeo(item, index) {
  const close = item.close_approach_data?.[0] || {};
  const diameterMin = Number(item.estimated_diameter?.meters?.estimated_diameter_min || 0);
  const diameterMax = Number(item.estimated_diameter?.meters?.estimated_diameter_max || 0);
  const diameterMean = diameterMin && diameterMax ? (diameterMin + diameterMax) / 2 : diameterMax || diameterMin || 10;
  const missKm = Number(close.miss_distance?.kilometers || 0);
  const speedKps = Number(close.relative_velocity?.kilometers_per_second || 0);
  const nearest = close.close_approach_date_full || close.close_approach_date || "未知";
  return {
    id: `neo-${item.id || index}`,
    neoRefId: item.id || `browse-${index}`,
    name: item.name_limited || item.name || `近地对象-${index + 1}`,
    type: "近地小天体",
    location: `绕 ${close.orbiting_body || "Earth"} 轨道`,
    year: nearest.slice(0, 4) || "未知",
    diameter: `${diameterMean.toFixed(1)} m（估算）`,
    speed: `${speedKps.toFixed(2)} km/s`,
    nearest,
    risk: item.is_potentially_hazardous_asteroid ? "高关注" : "常规",
    description: `NASA NEO Browse 备用源对象，最近地球距离约 ${Math.round(missKm).toLocaleString()} km。`,
    image: "",
    source: item.nasa_jpl_url || "https://api.nasa.gov/",
    metrics: {
      missKm,
      speedKps,
      hazardous: Boolean(item.is_potentially_hazardous_asteroid),
      diameterM: diameterMean,
    },
  };
}

async function readNeoLocalFallback(limit) {
  const raw = await fs.readFile(neoFallbackPath, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.slice(0, limit);
}

async function readNotableLocal() {
  const key = "notable";
  const cached = getCache(key);
  if (cached) return cached;
  const raw = await fs.readFile(notablePath, "utf-8");
  const parsed = JSON.parse(raw);
  setCache(key, parsed, 10 * 60 * 1000);
  return parsed;
}

function normalizeSearchText(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeQuery(query) {
  return normalizeSearchText(query)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

const SEARCH_ALIAS_GROUPS = [
  ["车里雅宾斯克", ["chelyabinsk", "俄罗斯", "火流星", "爆炸"]],
  ["通古斯", ["tunguska", "俄罗斯", "撞击", "爆炸"]],
  ["霍巴", ["hoba", "纳米比亚", "铁陨石"]],
  ["近地小天体", ["neo", "asteroid", "近地", "轨道"]],
  ["石陨石", ["chondrite", "stony"]],
  ["铁陨石", ["iron", "siderite"]],
  ["石铁陨石", ["stony-iron", "pallasite"]],
];

function expandSearchTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const [anchor, aliases] of SEARCH_ALIAS_GROUPS) {
      const inAnchor = anchor.includes(token) || token.includes(anchor);
      const inAliases = aliases.some((alias) => alias.includes(token) || token.includes(alias));
      if (inAnchor || inAliases) {
        expanded.add(normalizeSearchText(anchor));
        aliases.forEach((alias) => expanded.add(normalizeSearchText(alias)));
      }
    }
  }
  return Array.from(expanded).filter(Boolean);
}

function calcSearchScore(text, tokens, expandedTokens = []) {
  if (!tokens.length) return 1;
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) score += 3;
    if (text.startsWith(token)) score += 2;
  }
  for (const token of expandedTokens) {
    if (tokens.includes(token)) continue;
    if (text.includes(token)) score += 1;
  }
  return score;
}

function toSearchCard(item) {
  const combinedText = normalizeSearchText(`${item.name || ""} ${item.description || ""} ${item.location || ""}`);
  let viewGroup = "观测地点";
  if (item.type === "近地小天体" || combinedText.includes("轨道")) {
    viewGroup = "轨道动力学";
  } else if (
    combinedText.includes("事件") ||
    combinedText.includes("爆炸") ||
    combinedText.includes("撞击") ||
    combinedText.includes("火流星")
  ) {
    viewGroup = "事件复盘";
  }
  return {
    id: item.id,
    name: item.name || "未命名对象",
    type: item.type || item.class || "未知类型",
    location: item.location || item.fall || "未知地点",
    year: item.year || "未知",
    diameter: item.diameter || (item.massG ? `${Math.round(item.massG).toLocaleString()} g` : "-"),
    speed: item.speed || "-",
    nearest: item.nearest || "-",
    risk: item.risk || "常规",
    description: item.description || "暂无详细说明。",
    image: item.image || "",
    source: item.source || "https://api.nasa.gov/",
    metrics: item.metrics || {},
    viewGroup,
  };
}

async function getNeoFromFeed(start, end, limit, options = {}) {
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? 9000;
  const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${start}&end_date=${end}&api_key=${NASA_API_KEY}`;
  const payload = await fetchJsonWithRetry(url, attempts, timeoutMs);
  const all = Object.values(payload.near_earth_objects || {}).flat();
  return all.slice(0, limit).map(normalizeNeo);
}

async function getNeoFromBrowse(limit, options = {}) {
  const attempts = options.attempts ?? 2;
  const timeoutMs = options.timeoutMs ?? 9000;
  const url = `https://api.nasa.gov/neo/rest/v1/neo/browse?api_key=${NASA_API_KEY}&size=${Math.min(limit, 20)}`;
  const payload = await fetchJsonWithRetry(url, attempts, timeoutMs);
  const items = payload.near_earth_objects || [];
  return items.slice(0, limit).map(normalizeBrowseNeo);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "meteorscope-api", now: new Date().toISOString() });
});

app.get("/api/notable", async (_req, res) => {
  try {
    const parsed = await readNotableLocal();
    return res.json({ source: "local", data: parsed });
  } catch (error) {
    return res.status(500).json({ error: "读取著名陨石数据失败", detail: String(error.message || error) });
  }
});

app.get("/api/neo/today", async (req, res) => {
  const forceFallback = String(req.query.forceFallback || "").toLowerCase();
  const start = req.query.start || toDateYMD();
  const end = req.query.end || start;
  const limit = Math.min(Number(req.query.limit || 30), 100);
  const key = `neo:${start}:${end}:${limit}`;
  const diagnostics = { tried: [] };

  const cached = getCache(key);
  if (cached && forceFallback !== "1" && forceFallback !== "true") {
    return res.json({ source: "cache", range: { start, end }, diagnostics, data: cached });
  }

  if (forceFallback !== "1" && forceFallback !== "true") {
    try {
      diagnostics.tried.push("nasa-feed");
      const normalized = await getNeoFromFeed(start, end, limit);
      if (normalized.length > 0) {
        lastSuccessfulNeo = normalized;
        setCache(key, normalized, 60 * 60 * 1000);
        return res.json({
          source: "nasa-feed",
          count: normalized.length,
          apiKeyMode: NASA_API_KEY === "DEMO_KEY" ? "demo" : "custom",
          range: { start, end },
          diagnostics,
          data: normalized,
        });
      }
      diagnostics.tried.push("nasa-feed-empty");
    } catch (error) {
      diagnostics.tried.push(`nasa-feed-failed:${String(error.message || error)}`);
    }

    try {
      diagnostics.tried.push("nasa-browse");
      const browseData = await getNeoFromBrowse(limit);
      if (browseData.length > 0) {
        lastSuccessfulNeo = browseData;
        setCache(key, browseData, 30 * 60 * 1000);
        return res.json({
          source: "nasa-browse",
          count: browseData.length,
          apiKeyMode: NASA_API_KEY === "DEMO_KEY" ? "demo" : "custom",
          range: { start, end },
          diagnostics,
          data: browseData,
        });
      }
      diagnostics.tried.push("nasa-browse-empty");
    } catch (error) {
      diagnostics.tried.push(`nasa-browse-failed:${String(error.message || error)}`);
    }
  } else {
    diagnostics.tried.push("manual-fallback");
  }

  const stale = Array.isArray(lastSuccessfulNeo) && lastSuccessfulNeo.length ? lastSuccessfulNeo : null;
  if (stale) {
    return res.json({
      source: "stale-cache",
      warning: "NASA 数据暂时不可用，已回退到最近一次成功缓存。",
      antiCrawlerHint: true,
      diagnostics,
      data: stale,
    });
  }

  try {
    const parsed = await readNeoLocalFallback(limit);
    return res.json({
      source: "local-fallback",
      warning: "NASA 数据暂时不可用，已回退到本地演示数据。",
      antiCrawlerHint: true,
      diagnostics,
      data: parsed,
    });
  } catch (fallbackError) {
    return res.status(502).json({
      error: "拉取 NASA NEO 数据失败",
      fallbackDetail: String(fallbackError.message || fallbackError),
      diagnostics,
    });
  }
});

app.get("/api/meteorites/catalog", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 500);
    const q = (req.query.q || "").trim();
    const cacheKey = `catalog:${limit}:${q}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json({ source: "cache", count: cached.length, data: cached });

    const whereClause = q ? `&$where=lower(name) like '%${encodeURIComponent(q.toLowerCase())}%'` : "";
    const url = `https://data.nasa.gov/resource/y77d-th95.json?$limit=${limit}&$order=year DESC${whereClause}`;
    const payload = await fetchJson(url);
    const data = payload.map((item, idx) => ({
      id: `catalog-${item.id || idx}`,
      name: item.name || "未命名样本",
      class: item.recclass || "未知",
      massG: Number(item.mass || 0),
      year: (item.year || "").slice(0, 10),
      fall: item.fall || "未知",
      lat: Number(item.reclat || 0),
      lon: Number(item.reclong || 0),
    }));
    setCache(cacheKey, data, 2 * 60 * 60 * 1000);
    return res.json({ source: "nasa-open-data", count: data.length, data });
  } catch (error) {
    return res.status(502).json({ error: "拉取公开陨石目录失败", detail: String(error.message || error) });
  }
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const type = String(req.query.type || "all").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 6), 1), 6);
  const tokens = tokenizeQuery(q);
  const expandedTokens = expandSearchTokens(tokens);
  if (!q) {
    return res.json({ source: "empty-query", count: 0, data: [] });
  }

  try {
    const [notable, neo, catalog] = await Promise.allSettled([
      readNotableLocal(),
      (async () => {
        const today = toDateYMD();
        try {
          const live = await getNeoFromFeed(today, today, 24, { attempts: 1, timeoutMs: 6000 });
          if (live.length) {
            lastSuccessfulNeo = live;
            return live;
          }
        } catch {
          // ignore and fallback
        }
        if (lastSuccessfulNeo.length) return lastSuccessfulNeo;
        return readNeoLocalFallback(24);
      })(),
      (async () => {
        try {
          const url = `https://data.nasa.gov/resource/y77d-th95.json?$limit=40&$where=lower(name)%20like%20'%25${encodeURIComponent(
            q.toLowerCase()
          )}%25'`;
          const payload = await fetchJson(url, 7000);
          return payload.map((item, idx) => ({
            id: `catalog-${item.id || idx}`,
            name: item.name || "未命名样本",
            type: item.recclass || "目录样本",
            location: item.fall || "未知",
            year: (item.year || "").slice(0, 10),
            diameter: item.mass ? `${Math.round(Number(item.mass)).toLocaleString()} g` : "-",
            speed: "-",
            nearest: "-",
            risk: "历史样本",
            description: `公开目录记录，分类 ${item.recclass || "未知"}。`,
            source: "https://data.nasa.gov/resource/y77d-th95/about_data",
            image: "",
          }));
        } catch {
          return [];
        }
      })(),
    ]);

    const merged = [];
    if (notable.status === "fulfilled" && Array.isArray(notable.value)) {
      merged.push(...notable.value.map(toSearchCard));
    }
    if (neo.status === "fulfilled" && Array.isArray(neo.value)) {
      merged.push(...neo.value.map(toSearchCard));
    }
    if (catalog.status === "fulfilled" && Array.isArray(catalog.value)) {
      merged.push(...catalog.value.map(toSearchCard));
    }

    const dedup = new Map();
    merged.forEach((item) => {
      if (!dedup.has(item.id)) dedup.set(item.id, item);
    });
    const ranked = Array.from(dedup.values())
      .filter((item) => (type === "all" ? true : item.type === type))
      .map((item) => {
        const searchText = normalizeSearchText(
          `${item.name} ${item.type} ${item.location} ${item.description} ${item.year} ${item.risk}`
        );
        return { item, score: calcSearchScore(searchText, tokens, expandedTokens) };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "zh-Hans-CN"))
      .slice(0, limit)
      .map((entry) => entry.item);

    return res.json({
      source: "multi-source",
      query: q,
      expandedTokens,
      count: ranked.length,
      data: ranked,
    });
  } catch (error) {
    return res.status(502).json({
      error: "搜索失败",
      detail: String(error.message || error),
      data: [],
    });
  }
});

app.get("/api/combined/home", async (_req, res) => {
  try {
    const notableRaw = await fs.readFile(notablePath, "utf-8");
    const notable = JSON.parse(notableRaw);
    const today = toDateYMD();
    let neo = await getNeoFromFeed(today, today, 20);
    if (!neo.length) {
      neo = await getNeoFromBrowse(20);
    }
    lastSuccessfulNeo = neo;
    return res.json({ date: today, notable, neo });
  } catch (error) {
    try {
      const notableRaw = await fs.readFile(notablePath, "utf-8");
      const notable = JSON.parse(notableRaw);
      if (lastSuccessfulNeo.length) {
        return res.json({
          date: toDateYMD(),
          notable,
          neo: lastSuccessfulNeo,
          source: "stale-cache",
          warning: "NASA 数据暂时不可用，首页使用最近缓存。",
        });
      }
      const fallbackNeo = await readNeoLocalFallback(20);
      return res.json({
        date: toDateYMD(),
        notable,
        neo: fallbackNeo,
        source: "local-fallback",
        warning: "NASA 数据暂时不可用，首页使用本地演示数据。",
      });
    } catch (fallbackError) {
      return res.status(502).json({
        error: "组合数据获取失败",
        detail: String(error.message || error),
        fallbackDetail: String(fallbackError.message || fallbackError),
      });
    }
  }
});

app.get("/api/source/status", async (_req, res) => {
  const status = {
    now: new Date().toISOString(),
    apiKeyMode: NASA_API_KEY === "DEMO_KEY" ? "demo" : "custom",
    sources: {
      nasaFeed: { ok: false, detail: "" },
      nasaBrowse: { ok: false, detail: "" },
      notableLocal: { ok: false, detail: "" },
      neoLocalFallback: { ok: false, detail: "" },
    },
  };
  const today = toDateYMD();

  await Promise.allSettled([
    (async () => {
      try {
        const data = await getNeoFromFeed(today, today, 1, { attempts: 1, timeoutMs: 3500 });
        status.sources.nasaFeed.ok = Array.isArray(data);
        status.sources.nasaFeed.detail = `count=${data.length}`;
      } catch (error) {
        status.sources.nasaFeed.detail = String(error.message || error);
      }
    })(),
    (async () => {
      try {
        const data = await getNeoFromBrowse(1, { attempts: 1, timeoutMs: 3500 });
        status.sources.nasaBrowse.ok = Array.isArray(data);
        status.sources.nasaBrowse.detail = `count=${data.length}`;
      } catch (error) {
        status.sources.nasaBrowse.detail = String(error.message || error);
      }
    })(),
    (async () => {
      try {
        const raw = await fs.readFile(notablePath, "utf-8");
        const data = JSON.parse(raw);
        status.sources.notableLocal.ok = Array.isArray(data) && data.length > 0;
        status.sources.notableLocal.detail = `count=${Array.isArray(data) ? data.length : 0}`;
      } catch (error) {
        status.sources.notableLocal.detail = String(error.message || error);
      }
    })(),
    (async () => {
      try {
        const data = await readNeoLocalFallback(3);
        status.sources.neoLocalFallback.ok = Array.isArray(data) && data.length > 0;
        status.sources.neoLocalFallback.detail = `count=${Array.isArray(data) ? data.length : 0}`;
      } catch (error) {
        status.sources.neoLocalFallback.detail = String(error.message || error);
      }
    })(),
  ]);

  return res.json(status);
});

const clientDir = path.join(__dirname, "..", "client");
const threeDir = path.join(__dirname, "..", "node_modules", "three");
app.use(
  express.static(clientDir, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);
app.use(
  "/vendor/three",
  express.static(threeDir, {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);
app.use((_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.sendFile(path.join(clientDir, "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`MeteorScope 3D running on http://localhost:${PORT}`);
});
