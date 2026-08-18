"""生成任务牌整套（牌背 + 成功 + 失败）的候选方案。

为什么用文生组图而不是图生组图：原先的两张定稿牌背是深墨绿的，
而成功牌要绿、失败牌要红，牌背跟成功牌撞色。所以整套重新设计，
牌背改用中性色（深棕 / 炭黑）。既然不再需要锚定旧牌背，就不用参考图，
文生组图的组内一致性正是这里要的东西。

模型只能用 5——5pro 不支持 sequential_image_generation。

4 个方案 × 3 次抽卡 = 12 次请求，每次出 3 张，共 36 张。

用法：
  source ~/.avalon-llm-key
  python3 scripts/gen-mission-cards.py [方案号…]   # 不传则跑全部
"""

import json
import os
import pathlib
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

# 并发路数。单次 5pro 请求约 97 秒，并发直接决定总时长：
#   3 路 → 32 秒/张（81 张跑了 40 分钟）
#   10 路 → 约 10 秒/张
# 用 CONC 环境变量调，遇到限流就调低。
CONC = int(os.environ.get("CONC", "6"))

ENDPOINT = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"
MODEL = "doubao-seedream-5-0-260128"          # 5：唯一支持组图的
SIZE = "1728x2304"
DRAWS = 3                                      # 每个方案抽卡次数
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/任务牌套"

HEAD = ("生成一组共 3 张中世纪桌游任务卡牌的卡面设计图，三张属于同一套牌，"
        "底色体系、边框宽度、材质与光照完全一致。")

# 实物皮革：主体是实心浮雕金。上一轮文生组图的主体变成了扁平浅金色块，
# 所以这里明确写"有明暗层次""不要扁平的单色块"。
LEATHER = (
    "三张共同的风格：正面平视的卡面设计图，皮革压纹底色铺满整个画面，四边完全出血。"
    "主体为实心的哑光做旧金，表面有精细浮雕花纹，有明确的明暗层次，轮廓厚重清晰；"
    "不要镜面抛光，不要强烈高光，不要扁平的单色块。"
    "主体高度占画面高度三分之二以上，上下留白均等。"
    "距画面边缘约百分之五处有一道清晰可见的细线双色边框，边框亮度明显高于背景。"
    "藤蔓叶片浮雕只压在边框内侧一圈与四角，向中心延伸不超过四分之一，"
    "中央整块保持干净的皮革不放纹样；浮雕颜色压暗，接近底色，饱和度很低，只作为肌理存在。"
    "整体明暗层次：背景暗、边框中等、主体亮。"
)

# 扁平烫金：线描最怕缩小后糊掉，所以明确要求线条粗
GILT = (
    "三张共同的风格：古籍烫金风格的平面装帧设计图，纯色低饱和底色铺满整个画面，四边完全出血。"
    "主体以明亮的烫金线条描绘，线条厚重清晰，带对称卷草雕纹，线条要粗到缩小后仍清晰可辨。"
    "主体高度占画面高度三分之二以上，上下留白均等。"
    "四角对称的烫金卷草藤蔓纹样，向中心延伸约四分之一，中央区域保持干净不放纹样。"
    "距画面边缘约百分之五处有一道清晰可见的烫金细线内框，内框四角有小卷草收尾。"
    "整体为平面印刷质感，不要立体金属反光，不要高光，不要投影。"
)

# 无参考图时叶片会跑成高饱和鲜绿/鲜红，直接跳出色板，所以尾巴里点名压住
TAIL = (
    "暗金、深木、烛火色调，克制的史诗感，所有颜色低饱和，不要鲜艳的绿色或红色。"
    "画面四个角必须是与中央同色的深底色。"
    "严禁出现：白色边框、白色四角、圆角外框、相框、画框、桌面、蜡烛、手、"
    "任何环境或背景物体、卡片投影、文字、水印。不要二次元，不要网游特效"
)

PLANS = [
    {
        "id": 1, "name": "方案1-剑的正逆", "style": LEATHER, "style_name": "实物皮革",
        "logic": "同一符号的两个状态：靠方向翻转 + 缺口辨认，最耐缩",
        "cards": (
            "第 1 张是牌背：深棕色皮革底色，画面正中一只金色圣杯，边框为暗金细线。"
            "第 2 张是任务成功牌：深翠绿底色，画面正中一把剑尖朝上的完好长剑，"
            "剑身笔直完整，边框为翠绿与金双线，庄重。"
            "第 3 张是任务失败牌：暗红近黑底色，画面正中一把剑尖朝下倒插的长剑，"
            "剑身从中断成两截，上下两段之间有明显空隙能看到背景透出，"
            "断口参差并有暗红裂纹，边框为暗红与黑金双线，压迫感。"
        ),
    },
    {
        "id": 2, "name": "方案2-圣杯的盈亏", "style": LEATHER, "style_name": "实物皮革",
        "logic": "同一符号的两个状态：靠盛满/倾倒碎裂辨认",
        "cards": (
            "第 1 张是牌背：深棕色皮革底色，画面正中一枚金色圆桌纹章，"
            "一张正俯视的圆桌与桌沿环绕的长剑，构图完全对称，边框为暗金细线。"
            "第 2 张是任务成功牌：深翠绿底色，画面正中一只盛满的圣杯，"
            "杯口有柔和的金色圣光向上溢出，杯身端正，边框为翠绿与金双线，庄重。"
            "第 3 张是任务失败牌：暗红近黑底色，画面正中一只倾倒并碎裂的圣杯，"
            "杯体倒向一侧、杯壁有明显裂口与缺失的碎片，边框为暗红与黑金双线，压迫感。"
        ),
    },
    {
        "id": 3, "name": "方案3-环的完缺", "style": GILT, "style_name": "扁平烫金",
        "logic": "同一符号的两个状态：圆环的缺口在小尺寸下最显眼",
        "cards": (
            "第 1 张是牌背：炭黑色底色，画面正中一只烫金线描的圣杯，边框为烫金细线。"
            "第 2 张是任务成功牌：深翠绿底色，画面正中一个完整闭合的烫金月桂环，"
            "环形饱满对称，环内留空，边框为翠绿与金双线，庄重。"
            "第 3 张是任务失败牌：暗红近黑底色，画面正中一个断裂的月桂环，"
            "环上有一处明显的缺口断开，断口两端参差分离，边框为暗红与黑金双线，压迫感。"
        ),
    },
    {
        "id": 4, "name": "方案4-盾与断剑", "style": GILT, "style_name": "扁平烫金",
        "logic": "两个不同符号：靠形状差异辨认（盾形 vs 竖线）",
        "cards": (
            "第 1 张是牌背：深棕色底色，画面正中一枚烫金线描的对称卷草纹章，"
            "圆形轮廓，边框为烫金细线。"
            "第 2 张是任务成功牌：深翠绿底色，画面正中一面完好的盾牌，"
            "盾面正中有一道简洁的十字纹，轮廓厚重，边框为翠绿与金双线，庄重。"
            "第 3 张是任务失败牌：暗红近黑底色，画面正中一把从中断成两截的长剑，"
            "上下两段之间有明显空隙能看到背景透出，断口参差并有暗红裂纹，"
            "边框为暗红与黑金双线，压迫感。"
        ),
    },
]

# ─────────────────────────────────────────────────────────────
# 第二轮：符号系统 × 风格 的两两组合
#
# 第一轮结论：剑的正逆 和 圣杯的盈亏 两套符号最好，留作两套皮肤。
# 但两者当时都是实物皮革，皮肤之间只换符号不换风格，区分度不够——
# 所以这轮把两套符号各出扁平烫金和实物皮革两版。
#
# 配色改动：牌背从深棕改成板岩蓝灰。深棕和失败牌的暗红褐撞色，
# 重犯了「牌背绿 + 成功绿」那个错误。成功绿保持第一轮的样子不动。
# ─────────────────────────────────────────────────────────────

# 底色写具体色值。第一轮只写「低饱和」，实物皮革守住了 57–71%，
# 扁平烫金跑到 92–100%——皮革纹理本身会压饱和度，纯色底不会，
# 所以形容词对纯色底没有约束力，必须给数值。
COLORS2 = (
    "三张的底色必须明确分成三个互不混淆的色系："
    "牌背是板岩蓝灰色（约 #1e2a33），冷调中性，既不偏绿也不偏红；"
    "成功牌是深翠绿色（约 #1b4936）；"
    "失败牌是极暗的红褐色、接近黑（约 #241012）。"
    "三张的主体明度要分开：成功牌的金最明亮，牌背的金中等，"
    "失败牌的金最暗、发灰做旧、几乎失去光泽。"
    "所有底色饱和度都要低，不要鲜艳的绿色或红色，不要纯蓝。"
)

LEATHER2 = (
    "三张共同的风格：正面平视的卡面设计图，皮革压纹底色铺满整个画面，四边完全出血。"
    "主体为实心的哑光做旧金，表面有精细浮雕花纹，有明确的明暗层次，轮廓厚重清晰；"
    "不要镜面抛光，不要强烈高光，不要扁平的单色块。"
    "主体高度占画面高度三分之二以上，上下留白均等。"
    "距画面边缘约百分之五处有一道清晰可见的细线双色边框，边框亮度明显高于背景。"
    "藤蔓叶片浮雕只压在边框内侧一圈与四角，向中心延伸不超过四分之一，"
    "中央整块保持干净的皮革不放纹样；浮雕颜色压暗，接近底色，只作为肌理存在。"
)

# 「线条 + 实心块面」这条是第一轮的教训：cardback-A_2 的空心细线描
# 是全场最不耐缩的一张（@3x 对比差只有 78），因为主体内部就是背景色，
# 缩小后细线糊掉、内部又没有色块支撑。
GILT2 = (
    "三张共同的风格：古籍烫金风格的平面装帧设计图，纯色实底铺满整个画面，四边完全出血，"
    "底色是均匀的实色，不要照片纹理也不要渐变。"
    "主体以明亮的烫金线条与实心烫金块面结合描绘，线条厚重、块面饱满，"
    "线条要粗到缩小成指甲盖大小时仍清晰可辨；不要极细的空心线描。"
    "主体高度占画面高度三分之二以上，上下留白均等。"
    "四角对称的烫金卷草藤蔓纹样，向中心延伸约四分之一，中央区域保持干净不放纹样。"
    "距画面边缘约百分之五处有一道清晰可见的烫金细线内框，内框四角有小卷草收尾。"
    "整体为平面印刷质感，不要立体金属反光，不要投影。"
)

SYM_SWORD = (
    "第 1 张是牌背：画面正中一只圣杯。"
    "第 2 张是任务成功牌：画面正中一把剑尖朝上的完好长剑，剑身笔直完整。"
    "第 3 张是任务失败牌：画面正中一把剑尖朝下倒插的长剑，剑身从中断成两截，"
    "上下两段之间有明显空隙能看到背景透出，断口参差。"
)

SYM_GRAIL = (
    "第 1 张是牌背：画面正中一枚圆桌纹章，一张正俯视的圆桌与桌沿环绕的长剑，构图完全对称。"
    "第 2 张是任务成功牌：画面正中一只盛满的圣杯，杯口有柔和的金色圣光向上溢出，杯身端正。"
    "第 3 张是任务失败牌：画面正中一只倾倒并碎裂的圣杯，杯体倒向一侧、"
    "杯壁有明显裂口与缺失的碎片。"
)

TAIL2 = (
    "暗金、深木、烛火色调，克制的史诗感。画面四个角必须是与该张中央同色的深底色。"
    "严禁出现：白色边框、白色四角、圆角外框、相框、画框、桌面、蜡烛、手、"
    "任何环境或背景物体、卡片投影、文字、水印。不要二次元，不要网游特效"
)

PLANS2 = [
    {"id": 1, "name": "剑A-扁平烫金", "style": GILT2, "sym": SYM_SWORD,
     "style_name": "扁平烫金", "logic": "圣杯 / 剑尖朝上完好剑 / 剑尖朝下断成两截"},
    {"id": 2, "name": "剑B-实物皮革", "style": LEATHER2, "sym": SYM_SWORD,
     "style_name": "实物皮革", "logic": "圣杯 / 剑尖朝上完好剑 / 剑尖朝下断成两截"},
    {"id": 3, "name": "杯A-扁平烫金", "style": GILT2, "sym": SYM_GRAIL,
     "style_name": "扁平烫金", "logic": "圆桌纹章 / 盛满圣杯 / 倾倒碎裂圣杯"},
    {"id": 4, "name": "杯B-实物皮革", "style": LEATHER2, "sym": SYM_GRAIL,
     "style_name": "实物皮革", "logic": "圆桌纹章 / 盛满圣杯 / 倾倒碎裂圣杯"},
]

CARD_ROLE = ["牌背", "成功", "失败"]
lock = threading.Lock()


def prompt_of(plan):
    if "sym" in plan:      # 第二轮：风格 + 配色 + 符号 分三段拼
        return HEAD + plan["style"] + COLORS2 + plan["sym"] + TAIL2
    return HEAD + plan["style"] + plan["cards"] + TAIL


def request(plan, draw, key):
    body = {
        "model": MODEL,
        "prompt": prompt_of(plan),
        "size": SIZE,
        "stream": False,
        "response_format": "url",
        "watermark": False,
        "sequential_image_generation": "auto",
        "sequential_image_generation_options": {"max_images": 3},
    }
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": {"message": "HTTP {}".format(e.code)}}
    except Exception as e:
        return {"error": {"message": str(e)}}


def job(plan, draw, key):
    tag = "{}·抽卡{}".format(plan["name"], draw)
    data = request(plan, draw, key)

    if "error" in data:
        with lock:
            print("✗ {} — {}".format(tag, str(data["error"].get("message", ""))[:150]))
        return 0

    items = data.get("data", [])
    out = BASE / plan["name"]
    out.mkdir(parents=True, exist_ok=True)
    names = []
    for i, it in enumerate(items):
        role = CARD_ROLE[i] if i < len(CARD_ROLE) else str(i)
        target = out / "r{}-{}{}.jpeg".format(draw, i + 1, role)
        urllib.request.urlretrieve(it["url"], target)
        names.append(target.name)
    tokens = (data.get("usage") or {}).get("total_tokens", 0) or 0
    with lock:
        print("✓ {} — {} 张：{}  ({} tokens)".format(
            tag, len(items), ", ".join(names), tokens))
    return tokens


def write_config(plan):
    out = BASE / plan["name"]
    out.mkdir(parents=True, exist_ok=True)
    (out / "_配置.md").write_text(
        "# {} 生成配置\n\n"
        "| 项 | 值 |\n|---|---|\n"
        "| 模型 | `{}` |\n| 尺寸 | `{}` |\n"
        "| 模式 | 文生组图 `sequential_image_generation: auto`，`max_images: 3` |\n"
        "| 参考图 | （无） |\n"
        "| 抽卡 | {} 次，每次 3 张 |\n"
        "| 风格 | {} |\n"
        "| 辨认逻辑 | {} |\n"
        "| 产物 | `r{{抽卡号}}-{{1牌背|2成功|3失败}}.jpeg` |\n\n"
        "提示词全文：\n\n```text\n{}\n```\n".format(
            plan["name"], MODEL, SIZE, DRAWS,
            plan["style_name"], plan["logic"], prompt_of(plan)),
        encoding="utf-8")


def main():
    global BASE
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    args = sys.argv[1:]
    rnd = 2 if "--round2" in args else 1
    if rnd == 2:
        args = [a for a in args if a != "--round2"]
        pool, BASE = PLANS2, ROOT / "docs/assets/generated/任务牌套v2"
    else:
        pool = PLANS

    wanted = {int(a) for a in args} or {p["id"] for p in pool}
    plans = [p for p in pool if p["id"] in wanted]

    print("方案 {} ｜ 各抽卡 {} 次 ｜ 每次 3 张 ｜ 共 {} 次请求 / {} 张\n".format(
        [p["id"] for p in plans], DRAWS, len(plans) * DRAWS, len(plans) * DRAWS * 3))
    for p in plans:
        write_config(p)

    tasks = [(p, d) for p in plans for d in range(1, DRAWS + 1)]
    # 并发 3 路：更高没测过限流，12 次请求 3 路已经够快
    with ThreadPoolExecutor(max_workers=CONC) as pool:
        totals = list(pool.map(lambda t: job(t[0], t[1], key), tasks))

    print("\n合计约 {} tokens，产物在 {}".format(
        sum(totals), BASE.relative_to(ROOT)))


if __name__ == "__main__":
    main()
