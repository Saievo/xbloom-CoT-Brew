// 本地门户：优先绑 80 端口（直接敲 localhost 即可），没权限自动回退 3000。
// 零依赖，纯 Node 内置 http。端口可用环境变量 PORT 覆盖。
import http from "node:http";

const PREFERRED_PORT = Number(process.env.PORT ?? 80);
const FALLBACK_PORT = 3000;
const HOST = process.env.HOST ?? "0.0.0.0";

const STOCK_URL = "http://127.0.0.1:8787";
const COFFEE_URL = "http://127.0.0.1:8788";

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
    a.card {
      text-decoration: none;
      color: inherit;
      width: 260px;
      padding: 26px 22px;
      border-radius: 16px;
      background: #1b2029;
      border: 1px solid #2a3140;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: transform .12s ease, border-color .12s ease;
    }
    a.card:hover { transform: translateY(-3px); border-color: #46536b; }
    .icon { font-size: 34px; }
    .name { font-size: 17px; font-weight: 600; }
    .desc { color: #9aa1b1; font-size: 13px; line-height: 1.55; }
    .foot { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #8b90a0; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #555d6d; }
    .dot.ok { background: #3ecf6f; box-shadow: 0 0 8px #3ecf6f66; }
    .dot.down { background: #e05b5b; box-shadow: 0 0 8px #e05b5b66; }
    .url { color: #6f7687; font-size: 12px; font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <div style="text-align:center">
    <h1>本地工具导航</h1>
    <div class="sub">两个入口，状态灯每 5 秒自动刷新</div>
  </div>
  <div class="cards">
    <a class="card" href="${STOCK_URL}/" target="_blank" rel="noopener">
      <div class="icon">📈</div>
      <div class="name">股票看板</div>
      <div class="desc">行情与股票分析看板（Python / FastAPI）</div>
      <div class="foot"><span class="dot" id="dot-stock"></span><span id="txt-stock">检测中…</span></div>
      <div class="url">localhost:8787</div>
    </a>
    <a class="card" href="${COFFEE_URL}/" target="_blank" rel="noopener">
      <div class="icon">☕</div>
      <div class="name">咖啡冲泡</div>
      <div class="desc">豆库 → 配方 → 冲泡反馈 → 迭代闭环（React / Fastify）</div>
      <div class="foot"><span class="dot" id="dot-coffee"></span><span id="txt-coffee">检测中…</span></div>
      <div class="url">localhost:8788</div>
    </a>
  </div>
  <script>
    async function tick() {
      try {
        const r = await fetch("/api/health");
        const s = await r.json();
        set("stock", s.stock);
        set("coffee", s.coffee);
      } catch {
        set("stock", false);
        set("coffee", false);
      }
    }
    function set(k, ok) {
      const dot = document.getElementById("dot-" + k);
      const txt = document.getElementById("txt-" + k);
      if (ok) { dot.className = "dot ok"; txt.textContent = "在线"; }
      else { dot.className = "dot down"; txt.textContent = "离线"; }
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/api/health") {
    const [stock, coffee] = await Promise.all([probe(STOCK_URL + "/"), probe(COFFEE_URL + "/api/status")]);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ stock, coffee }));
    return;
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
