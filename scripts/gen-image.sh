#!/bin/bash
# 调用 seedream 生成图片并下载到 docs/assets/generated/。
#
# API key 只从环境变量读，绝不写进文件——本仓库会推到公开的 GitHub。
#   export LLM_API_KEY="你的key"
#
# 用法：
#   ./scripts/gen-image.sh <model> <label> <size> <count> "<prompt>"
#
# 例：
#   ./scripts/gen-image.sh doubao-seedream-5-0-260128 cardback 1728x2304 1 "中世纪任务卡牌背面……"
#
# REF=<参考图路径> 走图生图，让新图对齐已定稿资产的质感与构图：
#   REF=.../cardback-B_5pro_1.jpeg DIR=任务牌正面 ./scripts/gen-image.sh …
# 参数名只能是 image，其余名字接口会静默忽略（不报错但当纯文生图跑掉）。
#
# count 的含义分两种：
#   默认（抽卡）  发 count 次独立的单图请求，得到同一提示词的 count 个不同方案，
#                 用来横向挑选。这是选风格阶段想要的。
#   GROUP=1（成套）走组图（sequential_image_generation=auto），一次生成一组内容关联、
#                 风格统一的图，prompt 里要把每一张依次描述清楚。
#                 用于牌背/成功/失败这种必须成套一致的资产。
#
# 注意：返回的图片 URL 24 小时后失效，本脚本会立即下载存盘。

set -u

if [ $# -lt 5 ]; then
  echo "用法: $0 <model> <label> <size> <count> \"<prompt>\"" >&2
  exit 1
fi

if [ -z "${LLM_API_KEY:-}" ]; then
  echo "缺少 LLM_API_KEY 环境变量。请先执行： export LLM_API_KEY=\"你的key\"" >&2
  exit 1
fi

MODEL="$1"; LABEL="$2"; SIZE="$3"; COUNT="$4"; PROMPT="$5"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# DIR 可选，用来把产物归到子目录，避免所有资产堆在一个文件夹里：
#   DIR=任务牌背/A-扁平烫金 ./scripts/gen-image.sh …
OUT="$ROOT/docs/assets/generated/${DIR:-}"
mkdir -p "$OUT"

ENDPOINT="https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"

# 用 python 组装 JSON，避免提示词里的引号和换行破坏 payload
GROUP="${GROUP:-0}"
# 文件名里带上模型简称，便于并排对比同一提示词在不同模型下的结果
case "$MODEL" in
  *pro*)         TAG="5pro" ;;
  *seedream-5*)  TAG="5" ;;
  *)             TAG="4" ;;
esac

if [ "$GROUP" = "1" ]; then
  MODE="组图 $COUNT 张"
else
  MODE="独立抽卡 $COUNT 次"
fi
if [ -n "${REF:-}" ]; then
  [ -f "$REF" ] || { echo "参考图不存在：$REF" >&2; exit 1; }
  MODE="$MODE ｜ 参考图 $(basename "$REF")"
fi
echo "模型 $MODEL ｜ 尺寸 $SIZE ｜ 标签 $LABEL ｜ $MODE"

# 配置追加进产物目录的 _配置.md。不记的话过两天就只剩一堆 jpeg，
# 想知道某张是什么模型、什么提示词、有没有参考图，只能翻聊天记录。
{
  echo ""
  echo "## $LABEL"
  echo ""
  echo "| 项 | 值 |"
  echo "|---|---|"
  echo "| 时间 | $(date '+%Y-%m-%d %H:%M') |"
  echo "| 模型 | \`$MODEL\` |"
  echo "| 尺寸 | \`$SIZE\` |"
  echo "| 模式 | $MODE |"
  echo "| 参考图 | ${REF:-（无）} |"
  echo "| 产物 | \`${LABEL}_${TAG}_*.jpeg\` |"
  echo ""
  echo "提示词："
  echo ""
  echo '```text'
  echo "$PROMPT"
  echo '```'
} >> "$OUT/_配置.md"

request_once() {
  local want="$1" slot="$2"
  local payload
  payload=$(MODEL="$MODEL" SIZE="$SIZE" WANT="$want" GROUP="$GROUP" PROMPT="$PROMPT" REF="${REF:-}" python3 -c '
import base64, io, json, os
body = {
    "model": os.environ["MODEL"],
    "prompt": os.environ["PROMPT"],
    "size": os.environ["SIZE"],
    "stream": False,
    "response_format": "url",
    "watermark": False,
}
if os.environ["GROUP"] == "1":
    body["sequential_image_generation"] = "auto"
    body["sequential_image_generation_options"] = {"max_images": int(os.environ["WANT"])}
# 非组图时整个字段省略：doubao-seedream-5-0-pro 不支持这个参数，
# 连传 "disabled" 都会报 InvalidParameter；省略则各模型都能接受。

ref = os.environ["REF"]
if ref:
    # 参数名只能是 image。image_url / reference_image / init_image / images
    # 都会被接口静默忽略——不报错，但当纯文生图跑掉，白花一次 token。
    from PIL import Image
    im = Image.open(ref).convert("RGB")
    # 压到 768 宽：原图 1728 宽转出来约 1.1MB，请求体太大
    im = im.resize((768, round(im.height * 768 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=88)
    body["image"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
print(json.dumps(body, ensure_ascii=False))
')
  local response
  response=$(curl -sS -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $LLM_API_KEY" \
    -d "$payload")

  # 原始返回同时落盘，万一下载失败还能从 URL 手动抢救（URL 24 小时内有效）
  printf '%s' "$response" > "$OUT/.last-response.json"
  printf '%s' "$response" | OUT="$OUT" LABEL="$LABEL" TAG="$TAG" SLOT="$slot" \
    python3 "$ROOT/scripts/save_images.py"
}

if [ "$GROUP" = "1" ]; then
  request_once "$COUNT" "-"
else
  # 抽卡：发 COUNT 次独立请求，得到同一提示词的不同方案
  for slot in $(seq 1 "$COUNT"); do
    echo "  第 $slot / $COUNT 次"
    request_once 1 "$slot"
  done
fi
