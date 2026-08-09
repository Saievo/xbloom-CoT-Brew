#!/bin/bash
# 以管理员身份把本地门户绑到 80 端口，之后浏览器直接访问 http://localhost 即可。
# 首次运行会提示输入 Mac 密码（仅本次）。
set -e
cd "$(dirname "$0")"
sudo env PORT=80 node portal.mjs
