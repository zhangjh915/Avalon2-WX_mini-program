"""探测生图接口是否支持「传参考图」（图生图 / 风格参考）。

为什么要探这个：成功/失败牌要和牌背成套，27 个角色插画彼此要一致。
组图（sequential_image_generation）在 5pro 上不可用，只能靠提示词对齐，不够可靠。
如果接口收参考图，一致性问题就有了确定性的解法。

各家接口对这个参数的命名不统一，所以逐个试。被拒的请求报 InvalidParameter，
不产生图也不计费；只有被接受的那个会真的出图。

用法：
  source ~/.avalon-llm-key
  python3 scripts/probe-img2img.py <参考图路径>
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
MODEL = "doubao-seedream-5-0-pro-260628"

# 各家常见的参数名，逐个试
CANDIDATES = ["image", "image_url", "reference_image", "init_image", "images"]

PROMPT = ("参考图中卡牌的风格、底色、边框与材质，把中央主体换成一把从中折断的长剑，"
          "底色转为暗红近黑。其余构图与质感保持一致。"
          "严禁出现：白色边框、白色四角、文字、水印")


def data_uri(path):
    """参考图压到 768 宽再转 base64——原图 1728 宽转出来约 1.1MB，请求体太大。"""
    im = Image.open(path).convert("RGB")
    h = round(im.height * 768 / im.width)
    im = im.resize((768, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=88)
    b64 = base64.b64encode(buf.getvalue()).decode()
    print("  参考图 {}x{} → base64 {} KB".format(768, h, len(b64) // 1024))
    return "data:image/jpeg;base64," + b64


def post(body, key):
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": {"message": "HTTP {}".format(e.code)}}
    except Exception as e:
        return {"error": {"message": str(e)}}


def main():
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")
    if len(sys.argv) < 2:
        sys.exit("用法: python3 scripts/probe-img2img.py <参考图路径>")

    ref = pathlib.Path(sys.argv[1])
    if not ref.exists():
        sys.exit("找不到参考图：" + str(ref))

    print("参考图：" + ref.name)
    uri = data_uri(ref)

    out = pathlib.Path("docs/assets/generated/_探测")
    out.mkdir(parents=True, exist_ok=True)

    accepted = []
    for name in CANDIDATES:
        body = {
            "model": MODEL,
            "prompt": PROMPT,
            "size": "1728x2304",
            "stream": False,
            "response_format": "url",
            "watermark": False,
        }
        # images 复数形态一般收数组
        body[name] = [uri] if name == "images" else uri

        print("\n试 `{}` …".format(name))
        data = post(body, key)

        if "error" in data:
            msg = data["error"].get("message", "")
            print("  ✗ 被拒：" + msg[:200])
            continue

        items = data.get("data", [])
        if not items:
            print("  ? 无报错但没返回图：" + json.dumps(data, ensure_ascii=False)[:200])
            continue

        target = out / ("img2img_" + name + ".jpeg")
        urllib.request.urlretrieve(items[0]["url"], target)
        kb = target.stat().st_size // 1024
        usage = data.get("usage", {})
        print("  ✓ 接受！已保存 {}  {} KB  用量 {} tokens".format(
            target.name, kb, usage.get("total_tokens", "?")))
        accepted.append(name)

    print("\n" + "=" * 50)
    if accepted:
        print("接口支持参考图，可用参数名：" + ", ".join(accepted))
        print("产物在 docs/assets/generated/_探测/，需人工确认是否真的参考了风格")
    else:
        print("接口不支持参考图。成套一致只能靠提示词对齐（见手册 2.3）")


if __name__ == "__main__":
    main()
