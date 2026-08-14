#!/bin/bash
# 用微信开发者工具的自动化端口跑一局完整对局并截图。
#
# 会自动确保自动化端口已开启（开发者工具重启后端口会关闭）。
# 注意：本脚本会在当前云环境写入一间真实的测试房间。

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
DEVTOOLS_NODE="/Applications/wechatwebdevtools.app/Contents/Frameworks/nwjs Framework.framework/Helpers/wechatwebdevtools Helper (Renderer).app/Contents/MacOS/node"
PORT="${AUTOMATION_PORT:-9420}"

if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x "$DEVTOOLS_NODE" ]; then
  NODE="$DEVTOOLS_NODE"
else
  echo "找不到可用的 node。" >&2
  exit 1
fi

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "自动化端口 $PORT 未开启，正在启动……"
  if [ ! -x "$CLI" ]; then
    echo "找不到微信开发者工具 CLI：$CLI" >&2
    exit 1
  fi
  "$CLI" auto --project "$PROJECT_DIR" --auto-port "$PORT" || exit 1
fi

cd "$PROJECT_DIR" || exit 1
exec "$NODE" tests/fullGame.e2e.js
