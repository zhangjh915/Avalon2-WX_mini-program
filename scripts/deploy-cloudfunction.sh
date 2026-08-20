#!/bin/bash
# 部署 avalonGame 云函数。
#
# **必须带 -r**（--remote-npm-install，让云端按 package.json 装依赖）。
# 不带的话 CLI 会上传本地 cloudfunctions/avalonGame/node_modules，而本地
# 从来没装过依赖，于是部署包里只有 4 个源文件、没有 wx-server-sdk——
# 部署会显示成功，但**所有云函数调用立刻全挂**，报
# `Cannot find module 'wx-server-sdk'`，整个小程序不可用。真实踩过一次。
#
# 另：函数刚部署完会短暂处于 Updating，此时再部署会被拒，脚本里先探状态。
set -u
CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
ENV_ID="cloudbase-d6gh6eo4ce2c13e2b"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"

for i in $(seq 1 15); do
  if "$CLI" cloud functions info --project "$PROJECT" --e "$ENV_ID" --n avalonGame 2>&1 | grep -q "'Active'"; then
    echo "函数就绪，开始部署"
    "$CLI" cloud functions deploy --env "$ENV_ID" --names avalonGame --project "$PROJECT" -r || exit 1
    echo
    echo "部署完成。注意：超时与内存改不了——微信 cli 不读 config.json 的 timeout，"
    echo "要在【云开发控制台 → 云函数 → avalonGame → 函数配置】里手动改。"
    exit 0
  fi
  echo "第 $i 次探测：函数更新中，等待…"
done
echo "函数长时间处于 Updating，稍后再试" >&2
exit 1
