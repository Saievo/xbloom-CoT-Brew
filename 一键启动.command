#!/usr/bin/env bash
# 双击运行：一键拉起本地服务并打开浏览器
cd "$(dirname "$0")"
./up.sh
echo
echo "按回车关闭此窗口（服务会在后台继续运行）..."
read -r _
