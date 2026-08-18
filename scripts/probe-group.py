"""对照实验：文生组图 vs 单图生组图，哪个组内一致性更好。

背景：上一轮探测发现 `5` 的单图生组图出的两张风格明显不统一
（一张烫金线描圣杯、一张写实银剑）。假设是**参考图本身破坏了一致性**——
参考图是一张圣杯牌背，第 1 张（成功牌=圣杯）被死死锚住，
第 2 张（断剑）没有对应参考就自己飞了。

文生组图两张都没锚点，可能反而更自洽。本脚本用**同一条完整提示词**
跑两种模式做对照，唯一变量是有没有参考图。

上一轮的提示词为了简洁省掉了边框和四角纹样的要求，导致产物全没边框，
不能用来判断质感。这次提示词是完整的。

用法：
  source ~/.avalon-llm-key
  python3 scripts/probe-group.py
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
V5 = "doubao-seedream-5-0-260128"

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/assets/generated/_探测/组图对照"
REF_B = ROOT / "docs/assets/generated/任务牌背/B-实物皮革/cardback-B_5pro_1.jpeg"

# 完整提示词：风格约束、边框、四角纹样、必禁清单一个不少。
# 两个模式共用这一条，唯一变量是有没有传参考图。
COMMON = (
    "两张共同的风格：正面平视的卡面设计图，深色皮革压纹底色铺满整个画面，四边完全出血。"
    "主体为实心的哑光做旧金，表面有精细浮雕花纹，轮廓厚重清晰，"
    "不要镜面抛光，不要强烈高光。主体高度占画面高度三分之二以上，上下留白均等。"
    "距画面边缘约百分之五处有一道清晰可见的细线双色边框，边框亮度明显高于背景。"
    "藤蔓叶片浮雕只压在边框内侧一圈与四角，向中心延伸不超过四分之一，"
    "中央整块保持干净的皮革不放纹样；浮雕颜色压暗，接近底色，只作为肌理存在。"
    "整体明暗层次：背景暗、边框中等、主体亮。"
)

TAIL = (
    "暗金、深木、烛火色调，克制的史诗感。画面四个角必须是与中央同色的深底色。"
    "严禁出现：白色边框、白色四角、圆角外框、相框、画框、桌面、蜡烛、手、"
    "任何环境或背景物体、卡片投影、文字、水印。不要二次元，不要网游特效"
)

PROMPT_2 = (
    "生成一组共 2 张中世纪桌游任务卡牌的卡面设计图，两张属于同一套牌，"
    "底色体系、边框宽度、材质与光照完全一致。" + COMMON +
    "第 1 张是任务成功牌：深翠绿皮革底色，画面正中一只圣杯，"
    "周围一圈柔和的金色圣光向四周均匀淡出，边框为翠绿与金双线，庄重。"
    "第 2 张是任务失败牌：暗红近黑皮革底色，画面正中一把长剑断成两截，"
    "上下两段明显分离，中间有清晰缺口，断口参差并有暗红裂纹向外扩散，"
    "边框为暗红与黑金双线，压迫感。" + TAIL
)

# 3 张版：连牌背一起出，看整套自洽度的上限（牌背已定稿，这张只作参考不采用）
PROMPT_3 = (
    "生成一组共 3 张中世纪桌游任务卡牌的卡面设计图，三张属于同一套牌，"
    "底色体系、边框宽度、材质与光照完全一致。" + COMMON +
    "第 1 张是牌背：深墨绿皮革底色，画面正中一只圣杯，边框为暗金细线。"
    "第 2 张是任务成功牌：深翠绿皮革底色，画面正中一只圣杯，"
    "周围一圈柔和的金色圣光向四周均匀淡出，边框为翠绿与金双线，庄重。"
    "第 3 张是任务失败牌：暗红近黑皮革底色，画面正中一把长剑断成两截，"
    "上下两段明显分离，中间有清晰缺口，断口参差并有暗红裂纹向外扩散，"
    "边框为暗红与黑金双线，压迫感。" + TAIL
)

CASES = [
    ("文生组图2",   PROMPT_2, 2, False),
    ("单图生组图2", PROMPT_2, 2, True),
    ("文生组图3",   PROMPT_3, 3, False),
]


def data_uri(path):
    im = Image.open(path).convert("RGB")
    im = im.resize((768, round(im.height * 768 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def run(name, prompt, max_images, use_ref, uri, key):
    body = {
        "model": V5,
        "prompt": prompt,
        "size": "1728x2304",
        "stream": False,
        "response_format": "url",
        "watermark": False,
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": {"max_images": max_images},
    }
    if use_ref:
        body["image"] = uri

    print("\n── {} ── 参考图：{}".format(name, "有" if use_ref else "无"))
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode())
        except Exception:
            data = {"error": {"message": "HTTP {}".format(e.code)}}
    except Exception as e:
        data = {"error": {"message": str(e)}}

    if "error" in data:
        print("   ✗ " + str(data["error"].get("message", data["error"]))[:200])
        return 0

    items = data.get("data", [])
    OUT.mkdir(parents=True, exist_ok=True)
    for i, it in enumerate(items):
        urllib.request.urlretrieve(it["url"], OUT / "{}_{}.jpeg".format(name, i))
    usage = data.get("usage", {})
    print("   ✓ 出图 {} 张，用量 {} tokens".format(
        len(items), usage.get("total_tokens", "?")))
    return usage.get("total_tokens", 0) or 0


def main():
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    uri = data_uri(REF_B)
    total = sum(run(n, p, m, r, uri, key) for n, p, m, r in CASES)
    print("\n合计约 {} tokens，产物在 {}".format(total, OUT.relative_to(ROOT)))


if __name__ == "__main__":
    main()
