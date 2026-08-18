"""矩阵探测：5 / 5pro 各自支持文档里的哪些生成模式。

seedream 4.0 官方文档描述了六种模式（文生图 / 单图生图 / 多图生图，
以及各自的组图版本），但我们定稿用的是 5pro，能力和 4.0 文档不一定一致。
手册里「5pro 不支持 sequential_image_generation」这条是早期结论，需要复核。

被拒的请求报 InvalidParameter，不出图也不计费，所以矩阵探测的成本
只等于成功那几次。

用法：
  source ~/.avalon-llm-key
  python3 scripts/probe-modes.py
"""

import base64
import io
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

from PIL import Image

ENDPOINT = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"
PRO = "doubao-seedream-5-0-pro-260628"
V5 = "doubao-seedream-5-0-260128"

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/assets/generated/_探测/模式矩阵"
REF_A = ROOT / "docs/assets/generated/任务牌背/A-扁平烫金/cardback-A_5pro_1.jpeg"
REF_B = ROOT / "docs/assets/generated/任务牌背/B-实物皮革/cardback-B_5pro_1.jpeg"

# 提示词固定，好让不同模式之间可比：要一组「成功牌 + 失败牌」
PROMPT = (
    "生成一组共 2 张中世纪桌游任务卡牌的卡面设计图，两张属于同一套牌，"
    "底色体系、边框宽度、材质与光照完全一致。"
    "第 1 张是任务成功牌：深翠绿底色，画面正中一只散发柔和金色圣光的圣杯。"
    "第 2 张是任务失败牌：暗红近黑底色，画面正中一把从中折断的长剑，断口有暗红裂纹。"
    "两张的主体高度都占画面高度三分之二以上，上下留白均等，四边完全出血。"
    "严禁出现：白色边框、白色四角、圆角外框、相框、画框、桌面、蜡烛、手、"
    "任何环境或背景物体、卡片投影、文字、水印。不要二次元，不要网游特效"
)

# name, model, seq（None 表示整个字段省略）, max_images, 参考图张数
CASES = [
    ("5pro_文生组图",     PRO, "auto",     2, 0),
    ("5pro_单图生组图",   PRO, "auto",     2, 1),
    ("5pro_单图生图",     PRO, "disabled", None, 1),
    ("5pro_多图生图",     PRO, None,       None, 2),
    ("5_单图生组图",      V5,  "auto",     2, 1),
    ("5_多图生组图",      V5,  "auto",     2, 2),
]


def data_uri(path):
    im = Image.open(path).convert("RGB")
    im = im.resize((768, round(im.height * 768 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def build(model, seq, max_images, refs, uris, stream=False):
    body = {
        "model": model,
        "prompt": PROMPT,
        "size": "1728x2304",
        "stream": stream,
        "response_format": "url",
        "watermark": False,
    }
    if seq is not None:
        body["sequential_image_generation"] = seq
        if max_images:
            body["sequential_image_generation_options"] = {"max_images": max_images}
    if refs == 1:
        body["image"] = uris[0]
    elif refs >= 2:
        body["image"] = uris[:refs]
    return body


def post(body, key, stream=False):
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            raw = r.read().decode()
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": {"message": "HTTP {}".format(e.code)}}
    except Exception as e:
        return {"error": {"message": str(e)}}

    if not stream:
        return json.loads(raw)

    # SSE：逐行收 data:，把 partial_succeeded 的 url 攒起来
    urls, usage = [], {}
    for line in raw.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            ev = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if ev.get("url"):
            urls.append({"url": ev["url"], "size": ev.get("size", "?")})
        if ev.get("usage"):
            usage = ev["usage"]
    return {"data": urls, "usage": usage, "_stream_events": raw.count("event:")}


def run(name, body, key, stream=False):
    print("\n── {} ──".format(name))
    keys = [k for k in body if k not in
            ("model", "prompt", "size", "response_format", "watermark")]
    print("   传参：" + ", ".join(
        "{}={}".format(k, "<base64>" if k == "image" else
                       ("[{}张]".format(len(body[k])) if isinstance(body[k], list) else body[k]))
        for k in keys))

    data = post(body, key, stream)
    if "error" in data:
        print("   ✗ " + str(data["error"].get("message", data["error"]))[:220])
        return {"name": name, "ok": False,
                "err": str(data["error"].get("message", ""))[:220]}

    items = data.get("data", [])
    if not items:
        print("   ? 无报错但没图：" + json.dumps(data, ensure_ascii=False)[:200])
        return {"name": name, "ok": False, "err": "no images"}

    OUT.mkdir(parents=True, exist_ok=True)
    saved = []
    for i, it in enumerate(items):
        target = OUT / "{}_{}.jpeg".format(name, i)
        urllib.request.urlretrieve(it["url"], target)
        saved.append(target.name)
    usage = data.get("usage", {})
    print("   ✓ 出图 {} 张：{}".format(len(items), ", ".join(saved)))
    print("     用量 {} tokens".format(usage.get("total_tokens", "?")))
    return {"name": name, "ok": True, "n": len(items),
            "tokens": usage.get("total_tokens", 0)}


def main():
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    print("参考图：{} / {}".format(REF_A.name, REF_B.name))
    uris = [data_uri(REF_A), data_uri(REF_B)]

    results = []
    for name, model, seq, mx, refs in CASES:
        results.append(run(name, build(model, seq, mx, refs, uris), key))

    # 组图若有任一成功，再单独验流式——流式和非流式是同一次生成，
    # 先确认组图本身可用再花这笔钱
    group_ok = next((r for r in results if r["ok"] and "组图" in r["name"]), None)
    if group_ok:
        name, model, seq, mx, refs = next(c for c in CASES if c[0] == group_ok["name"])
        results.append(run("流式_" + name, build(model, seq, mx, refs, uris, stream=True),
                           key, stream=True))

    print("\n" + "=" * 60)
    print("{:<22} {:<6} {}".format("模式", "结果", "说明"))
    total = 0
    for r in results:
        if r["ok"]:
            total += r.get("tokens") or 0
            print("{:<22} {:<6} 出图 {} 张".format(r["name"], "✓", r["n"]))
        else:
            print("{:<22} {:<6} {}".format(r["name"], "✗", r["err"][:60]))
    print("\n本轮成功请求合计约 {} tokens".format(total))
    print("产物在 " + str(OUT.relative_to(ROOT)))


if __name__ == "__main__":
    main()
