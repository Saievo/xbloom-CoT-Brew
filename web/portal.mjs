// 本地门户：优先绑 80 端口（直接敲 localhost 即可），没权限自动回退 3000。
// 零依赖，纯 Node 内置 http。端口可用环境变量 PORT 覆盖。
// 提供一键启动/停止：页面按钮通过 /api/start/:svc 与 /api/stop/:svc 控制服务
// （启动用 detached 子进程，独立会话，门户退出后服务也继续跑）。
import http from "node:http";
import { spawn, execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFERRED_PORT = Number(process.env.PORT ?? 80);
const FALLBACK_PORT = 3000;
const HOST = process.env.HOST ?? "0.0.0.0";

const WEB_DIR = path.dirname(fileURLToPath(import.meta.url));
const STOCK_DIR = process.env.STOCK_WEB_DIR ?? "/Users/edward/stock/stock_web";
const LOG_DIR = path.join(os.homedir(), ".xbloom");

const STOCK_URL = "http://127.0.0.1:8787";
const COFFEE_URL = "http://127.0.0.1:8788";

const SERVICES = {
  coffee: {
    url: COFFEE_URL + "/",
    log: "web.log",
    cmd: "npm",
    args: ["start"],
    cwd: WEB_DIR,
  },
  stock: {
    url: STOCK_URL + "/",
    log: "stock-web.log",
    cmd: "python3",
    args: ["server.py"],
    cwd: STOCK_DIR,
  },
};

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>本地工具导航</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 28px;
      background: #12151c;
      color: #e8e6e1;
      font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    h1 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: 1px; }
    .sub { color: #8b90a0; font-size: 13px; margin-top: 6px; }
    .cards { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; padding: 0 20px; }
    .card {
      width: 260px;
      padding: 24px 22px 18px;
      border-radius: 16px;
      background: #1b2029;
      border: 1px solid #2a3140;
      display: flex;
      flex-direction: column;
      gap: 12px;
      transition: transform .12s ease, border-color .12s ease;
    }
    .card:hover { transform: translateY(-3px); border-color: #46536b; }
    .card a {
      display: flex;
      flex-direction: column;
      gap: 10px;
      text-decoration: none;
      color: inherit;
    }
    .icon { font-size: 34px; }
    .name { font-size: 17px; font-weight: 600; }
    .desc { color: #9aa1b1; font-size: 13px; line-height: 1.55; }
    .foot { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #8b90a0; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #555d6d; }
    .dot.ok { background: #3ecf6f; box-shadow: 0 0 8px #3ecf6f66; }
    .dot.down { background: #e05b5b; box-shadow: 0 0 8px #e05b5b66; }
    .url { color: #6f7687; font-size: 12px; font-family: ui-monospace, monospace; }
    .card-ctrl { display: flex; align-items: center; gap: 10px; }
    .mini {
      border: 1px solid #3b4356;
      background: #232a37;
      color: #d7dbe4;
      border-radius: 8px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      transition: background .12s ease;
    }
    .mini:hover:not(:disabled) { background: #2c3547; }
    .mini:disabled { opacity: .55; cursor: default; }
    .mini.go { border-color: #2f6b4c; background: #1f3b2e; color: #7ee2ab; }
    .mini.go:hover:not(:disabled) { background: #27503c; }
    .mini.stop { border-color: #6b3b3b; background: #3b1f1f; color: #e28a8a; }
    .mini.stop:hover:not(:disabled) { background: #503030; }
  </style>
</head>
<body>
  <div>
    <h1>本地工具导航</h1>
    <div class="sub">两个入口，状态每 5 秒自动刷新；离线可「启动」，在线可「停止」</div>
  </div>
  <div class="cards">
    <div class="card">
      <a href="${STOCK_URL}/" target="_blank" rel="noopener">
        <div class="icon">📈</div>
        <div class="name">股票看板</div>
        <div class="desc">行情与股票分析看板（Python / FastAPI）</div>
        <div class="foot"><span class="dot" id="dot-stock"></span><span id="txt-stock">检测中…</span></div>
        <div class="url">localhost:8787</div>
      </a>
      <div class="card-ctrl">
        <button id="btn-stock" class="mini go" data-svc="stock" onclick="ctrl('stock', 'start', this)">启动</button>
        <button id="stop-stock" class="mini stop" data-svc="stock" onclick="ctrl('stock', 'stop', this)">停止</button>
        <span class="url" id="hint-stock"></span>
      </div>
    </div>
    <div class="card">
      <a href="${COFFEE_URL}/" target="_blank" rel="noopener">
        <div class="icon">☕</div>
        <div class="name">咖啡冲泡</div>
        <div class="desc">豆库 → 配方 → 冲泡反馈 → 迭代闭环（React / Fastify）</div>
        <div class="foot"><span class="dot" id="dot-coffee"></span><span id="txt-coffee">检测中…</span></div>
        <div class="url">localhost:8788</div>
      </a>
      <div class="card-ctrl">
        <button id="btn-coffee" class="mini go" data-svc="coffee" onclick="ctrl('coffee', 'start', this)">启动</button>
        <button id="stop-coffee" class="mini stop" data-svc="coffee" onclick="ctrl('coffee', 'stop', this)">停止</button>
        <span class="url" id="hint-coffee"></span>
      </div>
    </div>
  </div>
  <script>
    async function tick() {
      try {
        const r = await fetch("/api/health");
        const s = await r.json();
        set("stock", !!s.stock);
        set("coffee", !!s.coffee);
      } catch {
        set("stock", false);
        set("coffee", false);
      }
    }
    function set(k, ok) {
      const dot = document.getElementById("dot-" + k);
      const txt = document.getElementById("txt-" + k);
      const start = document.getElementById("btn-" + k);
      const stop = document.getElementById("stop-" + k);
      const hint = document.getElementById("hint-" + k);
      dot.className = "dot " + (ok ? "ok" : "down");
      txt.textContent = ok ? "在线" : "离线";
      if (ok) {
        start.disabled = true;
        start.textContent = "运行中";
        start.classList.remove("go");
        if (stop.dataset.busy !== "1") { stop.disabled = false; stop.textContent = "停止"; }
        if (hint) hint.textContent = "";
      } else {
        if (start.dataset.busy !== "1") {
          start.disabled = false;
          start.textContent = "启动";
          start.classList.add("go");
        }
        stop.disabled = true;
        stop.textContent = "停止";
        if (hint) hint.textContent = "";
      }
    }
    async function ctrl(svc, action, btn) {
      if (btn.dataset.busy === "1") return;
      btn.dataset.busy = "1";
      btn.disabled = true;
      btn.textContent = action === "start" ? "启动中…" : "停止中…";
      const hint = document.getElementById("hint-" + svc);
      try {
        const r = await fetch("/api/" + action + "/" + svc, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || (action === "start" ? "启动失败" : "停止失败"));
        const target = action === "start" ? "ok" : "down";
        for (let i = 0; i < 30; i++) {
          await new Promise((res) => setTimeout(res, 1000));
          await tick();
          const dot = document.getElementById("dot-" + svc);
          if (dot && dot.className === "dot " + target) break;
        }
        const ok = document.getElementById("dot-" + svc).className === "dot ok";
        if (action === "start" && !ok && hint) hint.textContent = "启动中，请稍候…";
        if (action === "stop" && ok && hint) hint.textContent = "服务仍在运行，请重试";
      } catch (e) {
        if (hint) hint.textContent = e.message;
      } finally {
        delete btn.dataset.busy;
        tick();
      }
    }
    tick();
    setInterval(tick, 5000);
  </script>
</body>
</html>`;

async function probe(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function startService(svc) {
  const s = SERVICES[svc];
  if (!s) return { ok: false, error: "未知服务: " + svc };
  if (!fs.existsSync(s.cwd)) return { ok: false, error: "目录不存在: " + s.cwd };
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFd = fs.openSync(path.join(LOG_DIR, s.log), "a");
  // 清掉 PORT / STOCK_WEB_PORT，避免把门户自身的端口继承给服务
  const env = { ...process.env };
  delete env.PORT;
  delete env.STOCK_WEB_PORT;
  const child = spawn(s.cmd, s.args, { cwd: s.cwd, detached: true, env, stdio: ["ignore", logFd, logFd] });
  child.unref();
  return { ok: true };
}

const SERVICE_PORTS = { coffee: 8788, stock: 8787 };

function stopService(svc) {
  const s = SERVICES[svc];
  if (!s) return Promise.resolve({ ok: false, error: "未知服务: " + svc });
  const port = SERVICE_PORTS[svc];
  return new Promise((resolve) => {
    execFile("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], (err, stdout) => {
      if (err) return resolve({ ok: true, status: "not-running" });
      const pids = stdout.trim().split(/\s+/).filter(Boolean);
      const killed = [];
      for (const pid of pids) {
        let comm = "";
        try {
          comm = execFileSync("ps", ["-p", pid, "-o", "comm="]).toString().trim();
        } catch {
          continue;
        }
        if (!/^(node|Node|Python|python3)$/.test(comm)) continue;
        try {
          process.kill(Number(pid), "SIGTERM");
          killed.push(pid);
        } catch {
          // 已退出或没有权限，忽略
        }
      }
      resolve({ ok: true, status: killed.length ? "stopped" : "not-running", pids: killed });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/api/health") {
    const [stock, coffee] = await Promise.all([probe(STOCK_URL + "/"), probe(COFFEE_URL + "/api/status")]);
    json(res, 200, { stock, coffee });
    return;
  }
  if (url.pathname.startsWith("/api/start/")) {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "需要 POST" });
    const svc = url.pathname.slice("/api/start/".length);
    if (!(svc in SERVICES)) return json(res, 404, { ok: false, error: "未知服务: " + svc });
    if (await probe(SERVICES[svc].url)) return json(res, 200, { ok: true, status: "already" });
    const r = startService(svc);
    if (!r.ok) return json(res, 400, r);
    return json(res, 200, { ok: true, status: "started" });
  }
  if (url.pathname.startsWith("/api/stop/")) {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "需要 POST" });
    const svc = url.pathname.slice("/api/stop/".length);
    if (!(svc in SERVICES)) return json(res, 404, { ok: false, error: "未知服务: " + svc });
    const r = await stopService(svc);
    return json(res, 200, r);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

function start(port) {
  server.listen(port, HOST, () => {
    console.log(`本地门户已启动: http://localhost:${port}`);
    console.log(`  -> 股票看板 http://localhost:8787`);
    console.log(`  -> 咖啡冲泡 http://localhost:8788`);
  });
}

server.on("error", (err) => {
  if (err.code === "EACCES" && PREFERRED_PORT !== FALLBACK_PORT) {
    console.log(`端口 ${PREFERRED_PORT} 需要管理员权限，自动回退到 ${FALLBACK_PORT}。`);
    console.log(`想用 http://localhost 直接访问，请运行一次: sudo ./portal80.sh`);
    start(FALLBACK_PORT);
  } else {
    console.error(err);
    process.exit(1);
  }
});

start(PREFERRED_PORT);
