const { spawn } = require("child_process");
const net = require("net");

const BASE_URL = "http://localhost:5173";
const START_TIMEOUT_MS = 25000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await sleep(450);
  }
  return false;
}

async function fetchJson(pathname, label, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${pathname}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`${label} 请求失败: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runDeepChecks() {
  const findings = [];

  const health = await fetchJson("/api/health", "health");
  assert(health.ok === true, "health ok 字段不是 true");
  findings.push("health 接口正常");

  const notable = await fetchJson("/api/notable", "notable");
  assert(Array.isArray(notable.data) && notable.data.length > 0, "notable 数据为空");
  findings.push("notable 数据正常");

  const neoToday = await fetchJson("/api/neo/today?limit=10", "neo today", 45000);
  assert(Array.isArray(neoToday.data), "neo today data 不是数组");
  assert(neoToday.data.length > 0, "neo today data 为空（冗余链路未生效）");
  findings.push(`neo today 结构正常（source=${neoToday.source || "unknown"}）`);

  const neoFallback = await fetchJson("/api/neo/today?forceFallback=1&limit=10", "neo forced fallback", 20000);
  assert(Array.isArray(neoFallback.data) && neoFallback.data.length > 0, "fallback 数据为空");
  assert(
    neoFallback.source === "local-fallback" || neoFallback.source === "stale-cache",
    `fallback source 异常: ${neoFallback.source}`
  );
  findings.push("强制兜底链路正常");

  const neoPast = await fetchJson("/api/neo/today?start=2026-03-14&end=2026-03-14&limit=5", "neo past", 45000);
  assert(Array.isArray(neoPast.data), "neo past data 不是数组");
  assert(neoPast.data.length > 0, "neo past data 为空（应由备用源或本地兜底填充）");
  findings.push(`时间轴日期查询结构正常（source=${neoPast.source || "unknown"}）`);

  const sourceStatus = await fetchJson("/api/source/status", "source status", 30000);
  assert(sourceStatus.sources?.notableLocal?.ok, "notable 本地源不可用");
  assert(sourceStatus.sources?.neoLocalFallback?.ok, "neo 本地兜底源不可用");
  const remoteOk = Boolean(sourceStatus.sources?.nasaFeed?.ok) || Boolean(sourceStatus.sources?.nasaBrowse?.ok);
  findings.push(`数据源状态检查完成（远程源可用=${remoteOk ? "是" : "否"}）`);

  const search = await fetchJson("/api/search?q=%E8%BD%A6%E9%87%8C%E9%9B%85%E5%AE%BE%E6%96%AF%E5%85%8B&limit=6", "search", 30000);
  assert(Array.isArray(search.data), "search data 不是数组");
  assert(search.data.length <= 6, "search 返回条目超过 6");
  findings.push("搜索接口可用且结果条数受限");

  const homeRes = await fetch(`${BASE_URL}/`);
  assert(homeRes.ok, `首页请求失败: ${homeRes.status}`);
  const homeHtml = await homeRes.text();
  const mustHtml = [
    "时间轴（日偏移）",
    "三目标对比看板",
    "收藏与订阅",
    "搜索结果以卡片显示，最多展示 6 条。",
  ];
  mustHtml.forEach((token) => assert(homeHtml.includes(token), `首页缺少模块文案: ${token}`));
  findings.push("首页模块文案齐全");

  const appRes = await fetch(`${BASE_URL}/app.js`);
  assert(appRes.ok, `app.js 请求失败: ${appRes.status}`);
  const appJs = await appRes.text();
  assert(appJs.includes("runSearch"), "缺少搜索主流程 runSearch");
  assert(appJs.includes("/api/search"), "前端未接入 /api/search");
  assert(appJs.includes("innerPlanets"), "缺少简化太阳系 innerPlanets 保底逻辑");
  assert(appJs.includes("demo-object-1"), "缺少无数据演示天体注入逻辑");
  assert(appJs.includes("Promise.allSettled"), "缺少并行请求容错逻辑 Promise.allSettled");
  findings.push("前端搜索流程与无数据保底逻辑存在");

  return findings;
}

async function main() {
  let serverProcess = null;
  const alreadyRunning = await isPortOpen(5173);

  if (!alreadyRunning) {
    serverProcess = spawn("node", ["server/server.js"], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    const ok = await waitForHealth(START_TIMEOUT_MS);
    if (!ok) {
      if (serverProcess) serverProcess.kill("SIGTERM");
      throw new Error("服务启动超时，无法连接 /api/health");
    }
  }

  try {
    const findings = await runDeepChecks();
    console.log("\n[SELF-CHECK DEEP PASS]");
    findings.forEach((line, idx) => console.log(`${idx + 1}. ${line}`));
  } finally {
    if (serverProcess) serverProcess.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("\n[SELF-CHECK DEEP FAIL]");
  console.error(err.message || err);
  process.exit(1);
});
