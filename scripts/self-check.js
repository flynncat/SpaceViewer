const { spawn } = require("child_process");
const net = require("net");

const BASE_URL = "http://localhost:5173";
const START_TIMEOUT_MS = 20000;

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
    await sleep(400);
  }
  return false;
}

async function checkJson(pathname, validator, label) {
  const res = await fetch(`${BASE_URL}${pathname}`);
  if (!res.ok) throw new Error(`${label} 请求失败: ${res.status}`);
  const json = await res.json();
  const result = validator(json);
  if (result !== true) {
    throw new Error(`${label} 校验失败: ${result}`);
  }
  return json;
}

async function runChecks() {
  const findings = [];

  await checkJson(
    "/api/health",
    (json) => (json.ok === true ? true : "ok 字段不是 true"),
    "health"
  );
  findings.push("health 接口正常");

  await checkJson(
    "/api/notable",
    (json) => (Array.isArray(json.data) && json.data.length > 0 ? true : "notable data 为空"),
    "notable"
  );
  findings.push("notable 接口正常");

  await checkJson(
    "/api/neo/today?limit=10",
    (json) => (Array.isArray(json.data) ? true : "neo data 不是数组"),
    "neo"
  );
  findings.push("neo 接口结构正常");

  await checkJson(
    "/api/search?q=%E4%BF%84%E7%BD%97%E6%96%AF&limit=6",
    (json) => (Array.isArray(json.data) ? true : "search data 不是数组"),
    "search"
  );
  findings.push("search 接口结构正常");

  const homeRes = await fetch(`${BASE_URL}/`);
  if (!homeRes.ok) throw new Error(`首页请求失败: ${homeRes.status}`);
  const html = await homeRes.text();
  const mustHave = ["模拟时间", "三目标对比看板", "收藏与订阅", "搜索结果以卡片显示，最多展示 6 条。"];
  for (const token of mustHave) {
    if (!html.includes(token)) {
      throw new Error(`首页缺少关键文案: ${token}`);
    }
  }
  findings.push("首页关键模块文案存在");

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
    const findings = await runChecks();
    console.log("\n[SELF-CHECK PASS]");
    findings.forEach((line, index) => {
      console.log(`${index + 1}. ${line}`);
    });
  } finally {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error("\n[SELF-CHECK FAIL]");
  console.error(err.message || err);
  process.exit(1);
});
