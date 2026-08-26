#!/bin/bash
# 运行全部单元/集成测试。
#
# 这台开发机没有安装系统 Node，但微信开发者工具自带一个可用的 node（v16），
# 因此优先使用系统 node，找不到时回退到开发者工具内置的那个。
# 需要 miniprogram-automator 的 tests/cloud.live.e2e.js 不在这里跑，
# 它依赖开发者工具的自动化端口，见 README 或项目进度文档。

set -u

DEVTOOLS_NODE="/Applications/wechatwebdevtools.app/Contents/Frameworks/nwjs Framework.framework/Helpers/wechatwebdevtools Helper (Renderer).app/Contents/MacOS/node"

if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x "$DEVTOOLS_NODE" ]; then
  NODE="$DEVTOOLS_NODE"
else
  echo "找不到可用的 node：既没有系统 Node，也没有微信开发者工具内置的 node。" >&2
  exit 1
fi

cd "$(dirname "$0")/.." || exit 1

TESTS=(
  gameCore
  tableLayout
  balance
  indexConfig
  roomLobby
  cloudFunction.integration
  uiBindings
  uiAnimations
  stateSync
  waitingHint
  env
  roleArt
  assets
  identityTiming
  applyState
  roomStoreRetry
)

failed=0
for name in "${TESTS[@]}"; do
  printf "%-32s" "$name"
  if output=$("$NODE" "tests/$name.test.js" 2>&1); then
    echo "PASS"
  else
    echo "FAIL"
    echo "$output" | sed 's/^/    /'
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -eq 0 ]; then
  echo "全部 ${#TESTS[@]} 个测试通过"
else
  echo "$failed / ${#TESTS[@]} 个测试失败"
  exit 1
fi
