#!/usr/bin/env bash
# 一键停止本地服务：咖啡(8788) + 股票看板(8787) + 门户(80/3000)
set -uo pipefail

stop_port() {
  local port="$1" pids pid comm
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $pids; do
    comm="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
    case "$comm" in
      node|Node|Python|python3)
        kill "$pid" 2>/dev/null || true
        echo "已停止 :$port (pid $pid)"
        ;;
    esac
  done
}

stop_port 8788   # 咖啡冲泡
stop_port 8787   # 股票看板
stop_port 80     # 门户（管理员端口）
stop_port 3000   # 门户（回退端口）
echo "完成。"
