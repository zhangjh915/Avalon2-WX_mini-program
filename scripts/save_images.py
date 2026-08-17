"""解析 seedream 接口返回并把图片下载存盘。

从 stdin 读接口返回的 JSON，参数经环境变量传入：
  OUT    输出目录
  LABEL  文件名前缀
  TAG    模型简称（4 / 5 / 5pro）
  SLOT   抽卡序号；为 "-" 时按返回顺序编号（组图模式）

单独成文件而不是内联在 shell 里，是因为提示词和 JSON 里都有引号，
内联会陷入多层转义。
"""

import json
import os
import pathlib
import sys
import urllib.request

raw = sys.stdin.read()

try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("  返回的不是合法 JSON：" + raw[:400])
    sys.exit(1)

if "error" in data:
    print("  接口报错：" + json.dumps(data["error"], ensure_ascii=False))
    sys.exit(1)

out = pathlib.Path(os.environ["OUT"])
label = os.environ["LABEL"]
tag = os.environ["TAG"]
slot = os.environ.get("SLOT", "-")

items = data.get("data", [])
if not items:
    print("  返回里没有图片：" + json.dumps(data, ensure_ascii=False)[:400])
    sys.exit(1)

for index, item in enumerate(items):
    suffix = slot if slot != "-" else str(index)
    name = label + "_" + tag + "_" + suffix + ".jpeg"
    target = out / name
    urllib.request.urlretrieve(item["url"], target)
    size = item.get("size", "?")
    kb = target.stat().st_size // 1024
    print("  已保存 " + name + "  " + size + "  " + str(kb) + "KB")

usage = data.get("usage", {})
print("  用量：{} 张 / {} tokens".format(
    usage.get("generated_images", "?"), usage.get("total_tokens", "?")))
