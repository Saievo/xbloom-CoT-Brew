#!/usr/bin/env bash
# 一键拉起本地服务：咖啡冲泡(8788) + 股票看板(8787) + 门户(localhost:80/3000)
# 用法: ./up.sh [--no-open]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOCK_DIR="${STOCK_WEB_DIR:-/Users/edward/stock/stock_web}"
LOG_DIR="${HOME}/.xbloom"
OPEN_BROWSER=1
[ "${1:-}" = "--no-open" ] && OPEN_BROWSER=0
mkdir -p "$LOG_DIR"

is_up() { curl -fsS -m 2 "$1" >/dev/null 2>&1; }
is_portal() { curl -fsS -m 2 "$1" 2>/dev/null | grep -q "本地工具导航"; }

# 以独立会话后台启动（macOS 没有 setsid 命令，用 python 实现），
# 即使启动它的终端/脚本被关闭或回收，服务也继续存活。
detach() { # detach <workdir> <logfile> <cmd...>
  local dir="$1" log="$2"; shift 2
  (cd "$dir" && env -u PORT -u STOCK_WEB_PORT nohup python3 -c '
import os, sys
try:
    os.setsid()
except OSError:
    pass
os.execvp(sys.argv[1], sys.argv[1:])
' "$@" >"$log" 2>&1 &)
}

wait_until() { # wait_until <url> <port>
  local url="$1" label="$2" i
  for i in $(seq 1 30); do
    is_up "$url" && { echo "  ✓ $label 已就绪"; return 0; }
    sleep 1
  done
  echo "  ✗ $label 启动超时，看日志: $LOG_DIR/web.log"
  return 1
}

echo "== XBLOOM loop 一键启动 =="

# 1. 咖啡冲泡
if is_up "http://127.0.0.1:8788/"; then
  echo "☕ 咖啡冲泡已在运行  http://localhost:8788"
else
  echo "☕ 启动咖啡冲泡 ..."
  detach "$ROOT/web" "$LOG_DIR/web.log" npm start
  wait_until "http://127.0.0.1:8788/" "咖啡冲泡(8788)"
fi

# 2. 股票看板
if [ -d "$STOCK_DIR" ]; then
  if is_up "http://127.0.0.1:8787/"; then
    echo "📈 股票看板已在运行  http://localhost:8787"
  else
    echo "📈 启动股票看板 ..."
    detach "$STOCK_DIR" "$LOG_DIR/stock-web.log" python3 server.py
    wait_until "http://127.0.0.1:8787/" "股票看板(8787)"
  fi
else
  echo "⏭  未找到股票看板目录，跳过: $STOCK_DIR"
fi

# 3. 门户（localhost 两个入口）
PORTAL_PORT=""
is_portal "http://127.0.0.1:80/" && PORTAL_PORT=80
if [ -z "$PORTAL_PORT" ]; then
  is_portal "http://127.0.0.1:3000/" && PORTAL_PORT=3000
fi
if [ -z "$PORTAL_PORT" ]; then
  echo "🌐 启动门户 ..."
  detach "$ROOT/web" "$LOG_DIR/portal.log" node portal.mjs
  for i in $(seq 1 15); do
    is_portal "http://127.0.0.1:80/" && { PORTAL_PORT=80; break; }
    is_portal "http://127.0.0.1:3000/" && { PORTAL_PORT=3000; break; }
    sleep 1
  done
fi
[ -n "$PORTAL_PORT" ] && echo "🌐 门户已就绪        http://localhost:${PORTAL_PORT}"

echo
echo "完成。日志目录: $LOG_DIR"
if [ "$OPEN_BROWSER" = "1" ] && [ -n "$PORTAL_PORT" ]; then
  open "http://localhost:${PORTAL_PORT}"
fi
