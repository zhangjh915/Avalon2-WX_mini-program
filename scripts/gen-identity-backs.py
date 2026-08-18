"""生成身份牌卡背：每种画风 3 种纹样 × 3 次抽卡。

卡背跟画风走——二次元的角色卡配二次元的卡背，手抄本配手抄本，
不能拿一张手绘卡背套所有画风。

配色决策：底色用**深棕**，不是任务牌背那个板岩蓝灰。
  身份牌背和任务牌背在同一局里都会出现，必须一眼分得开；
  换色 + 换纹样（任务牌用圣杯/圆桌纹章，身份牌用王冠双剑/石中剑/盾徽）
  两条都拉开，才不会认错。
另外卡背是**未揭示状态**，绝不能暗示阵营，所以不能用正义的靛蓝或邪恶的酒红。

尺寸同身份牌：界面 660x880rpx = 330x440pt，生成 1728x2304（3:4）。

用法：
  source ~/.avalon-llm-key
  CONC=10 python3 scripts/gen-identity-backs.py            # 全部画风
  CONC=10 python3 scripts/gen-identity-backs.py 二次元      # 指定画风
"""

import json
import os
import pathlib
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from genlib import Progress, save_verified

CONC = int(os.environ.get("CONC", "6"))
ENDPOINT = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"
MODEL = "doubao-seedream-5-0-pro-260628"
SIZE = "1728x2304"
DRAWS = 3
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/身份牌卡背"

# 卡背的共同骨架。和角色卡不同：没有人物，要求完全对称、能当牌背用。
# ⚠️ 不要写「背面设计图」。第一版写的是「身份卡牌的背面设计图」，
# 36 张里 28 张长出了白边——「背面」会让模型去渲染**一张实体卡的背面**，
# 于是画出卡纸的白边。任务牌第二轮 36 张零白角，用的是「正面平视的卡面设计图」，
# 模型把它理解成平面图案而不是实物照片。
# 另外补一句「边框之外仍是深棕底色」，堵住金边框外圈留白那种画法。
FRAME = (
    "中世纪桌游卡牌的正面平视卡面设计图，构图完全左右对称。"
    "深棕色底铺满整个画面，四边完全出血，画面没有任何留白。"
    "主体位于画面正中，高度占画面高度三分之二以上，上下留白均等。"
    "距画面边缘约百分之五处有一道清晰可见的暗金细线边框，"
    "边框之外到画面边缘之间仍然是深棕底色。"
)

TAIL = (
    "暗金、深棕、烛火色调，克制的史诗感，色调低饱和。"
    "画面四个角必须是与中央同色的深棕色。"
    "严禁出现：白色边框、白色四角、圆角外框、相框、画框、桌面、蜡烛、手、"
    "人物、任何环境或背景物体、卡片投影、文字、水印。"
)

# 画风段。和 gen-roles.py 的画风一一对应，但换成描述"纹样"而不是"人物"。
STYLES = {
    "手绘": "手绘厚涂风格，可见笔触与颜料质感，纹样有立体浮雕感与明暗层次，"
            "不是照片，不是3D渲染，不是二次元。",
    "二次元": "日式二次元动画风格，干净利落的线稿配平涂上色，"
              "高光与阴影有明确分界，纹样简洁有装饰性。",
    "3D真人": "写实三维渲染，接近电影级 CG，金属与皮革材质真实可信，"
              "全局光照柔和，纹样是真实压印在皮革上的立体浮雕。",
    "手抄本": "中世纪泥金手抄本插图风格，平面装饰画，没有透视也没有立体光影，"
              "纹样以清晰的深色墨线勾勒，色块平涂，局部金箔点缀。",
}

# 纹样。避开任务牌已占用的圣杯和圆桌纹章，否则两种牌背会混。
MOTIFS = [
    ("王冠双剑",
     "画面正中一顶金色王冠，王冠下方交叉着两把长剑，剑尖朝下，构图完全对称。"),
    ("石中剑",
     "画面正中一把插在方形石座中的长剑，剑柄朝上、剑身没入石中，"
     "石面有细密的凿痕，构图完全对称。"),
    ("盾徽",
     "画面正中一面厚重的盾牌，盾面有对称的卷草纹与一道竖直分割线，"
     "盾牌边缘包着金属条，构图完全对称。"),
]

lock = threading.Lock()


def prompt_of(style, motif_desc):
    return FRAME + STYLES[style] + motif_desc + TAIL


def request(prompt, key):
    body = {"model": MODEL, "prompt": prompt, "size": SIZE, "stream": False,
            "response_format": "url", "watermark": False}
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": {"message": "HTTP %d" % e.code}}
    except Exception as e:
        return {"error": {"message": str(e)}}


def job(style, midx, draw, key):
    mname, mdesc = MOTIFS[midx]
    data = request(prompt_of(style, mdesc), key)
    tag = "%s·%s 第%d张" % (style, mname, draw)
    if "error" in data:
        with lock:
            print("✗ %s — %s" % (tag, str(data["error"].get("message", ""))[:140]))
        return 0
    out = BASE / style
    out.mkdir(parents=True, exist_ok=True)
    fname = "%s_%d.jpeg" % (mname, draw)
    save_verified(data["data"][0]["url"], out / fname)
    tok = (data.get("usage") or {}).get("total_tokens", 0) or 0
    with lock:
        print("✓ %s → %s/%s  (%d tokens)" % (tag, style, fname, tok))
    return tok


def main():
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    want = [a for a in sys.argv[1:] if a in STYLES] or list(STYLES)
    tasks = [(s, i, d) for s in want for i in range(len(MOTIFS))
             for d in range(1, DRAWS + 1)]
    print("卡背：%s ｜ %d 纹样 × %d 抽卡 = %d 次请求 ｜ 并发 %d" %
          ("、".join(want), len(MOTIFS), DRAWS, len(tasks), CONC))

    for s in want:
        d = BASE / s
        d.mkdir(parents=True, exist_ok=True)
        (d / "_配置.md").write_text(
            "# 身份牌卡背 · %s\n\n| 项 | 值 |\n|---|---|\n"
            "| 画风 | %s |\n| 模型 | `%s` |\n| 尺寸 | `%s` |\n"
            "| 纹样 | %s |\n| 抽卡 | 每纹样 %d 张 |\n\n"
            "底色用深棕，区别于任务牌背的板岩蓝灰；纹样也避开任务牌的圣杯和圆桌纹章。\n"
            "卡背是未揭示状态，绝不能暗示阵营，所以不用正义靛蓝或邪恶酒红。\n\n"
            "## 提示词（以第一个纹样为例）\n\n```text\n%s\n```\n" % (
                s, s, MODEL, SIZE, "、".join(n for n, _ in MOTIFS), DRAWS,
                prompt_of(s, MOTIFS[0][1])),
            encoding="utf-8")

    with ThreadPoolExecutor(max_workers=CONC) as pool:
        total = sum(pool.map(lambda t: job(t[0], t[1], t[2], key), tasks))
    print("\n合计约 %d tokens，产物在 %s" % (total, BASE.relative_to(ROOT)))


if __name__ == "__main__":
    main()
