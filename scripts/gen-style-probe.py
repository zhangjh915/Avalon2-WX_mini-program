"""画风方向试水：每种画风 3 个设计方向 × 2 个角色 × 2 抽卡。

为什么要重做：
  前一轮 4 种画风共用同一套 27 个角色的形象描述，只换了风格段。
  结果是"同一个人换四种渲染"——那是滤镜，不是皮肤。
  皮肤应该连人物设计本身都不一样：轮廓、姿态、服装解读、年龄倾向、构图。

所以这里每个方向都**重写人物描述**，不是只换渲染方式。
摩根勒菲和亚瑟当试金石——这两个已经看过很多版，差异一眼能看出来。

用法：
  source ~/.avalon-llm-key
  CONC=10 python3 scripts/gen-style-probe.py
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
DRAWS = 2
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/画风方向试水"

# 只有这几条是全画风共用的硬约束，其余一切都跟着方向走
COMMON = ("四边完全出血，画面没有任何留白。"
          "严禁出现：文字、水印、白色边框、白色四角、相框、画框、卡片投影。")

# 方向 = 风格 + 人物设计 + 构图 + 边框，整套重写。
# key: (画风, 方向名, 方向说明, 风格段, {角色: 人物描述})
DIRECTIONS = [
    # ───────────── 二次元 ─────────────
    ("二次元", "A幻想华服", "原神/崩铁式的幻想游戏立绘：人物年轻俊美，服装是幻想化的华丽设计而非写实中世纪",
     "日式幻想游戏角色立绘，干净利落的线稿配通透的渐变上色，发丝与布料有细致高光，"
     "少量魔法光效粒子，色彩明快通透。半身像，人物占画面高度三分之二以上，动态姿势有张力。"
     "距画面边缘约百分之三处一道纤细的金色装饰边框，边框有卷草转角。",
     {"morgan":
        "银紫色长发的年轻女术士，暗红与黑金的幻想法袍，肩部有夸张的金属肩饰，"
        "腰间垂着链饰与流苏，衣摆有发光的暗红纹路。指尖托着一团跳动的暗红魔法火焰，"
        "火焰化作细碎光粒向上飘散。姿态张扬自信，一手叉腰，眼神凌厉带笑。背景是暗酒红的虚化魔法光晕。",
      "arthur":
        "金发的年轻国王，蓝金相间的幻想铠甲，胸甲有发光的金色纹路，"
        "深蓝披风内衬绣着流动的金色符文，头戴造型锐利的金冠。手握一柄装饰华丽的长剑斜举，"
        "姿态挺拔有英气。背景是深靛蓝的虚化光晕。"}),

    ("二次元", "B日式厚涂", "FGO 式的日式厚涂：保留二次元面部结构但服装写实、光影厚重，人物年龄更成熟",
     "日式厚涂角色立绘，笔触细腻，面部是二次元结构但五官立体，"
     "服装为写实的中世纪材质，光影厚重有体积感，色调偏沉。"
     "半身像，人物占画面高度三分之二以上，构图庄重，正面或四分之三侧面。"
     "距画面边缘约百分之三处一道暗金细边框。",
     {"morgan":
        "三十余岁的黑发女术士，深红丝绒法袍配黑色皮革束腰，肩线利落，"
        "掌心托着一团真实的暗红火焰，火光从下方映亮面部。神情沉稳，气度是掌权者。"
        "背景是暗酒红的暗色环境虚化。",
      "arthur":
        "四十余岁的国王，锁子甲外罩深蓝罩袍，肩披厚重披风，简朴金冠。"
        "一手按在剑柄上，目光坚定带疲惫。背景是深靛蓝的暗色环境虚化。"}),

    ("二次元", "C平涂海报", "极简线条 + 大面积平涂，接近现代插画海报，几乎无渐变",
     "现代插画海报风格，粗细一致的干净线条，大面积纯色平涂，几乎没有渐变和阴影，"
     "配色明快对比强烈，形体高度概括。半身像，人物占画面高度三分之二以上，"
     "姿态简洁有辨识度，剪影清晰。距画面边缘约百分之三处一道纯色细边框。",
     {"morgan":
        "黑发女术士的高度概括形象，朱红与墨黑两大色块构成法袍，"
        "掌心一团纯橙红色块表示火焰，五官用极少的线条勾出，眼神锐利。"
        "背景是一整块暗酒红平涂色。",
      "arthur":
        "国王的高度概括形象，靛蓝披风与金色冠冕两大色块，"
        "锁子甲用规律的短线概括，五官用极少线条勾出。背景是一整块深靛蓝平涂色。"}),

    # ───────────── 3D真人 ─────────────
    ("3D真人", "A电影剧照", "史诗剧集的角色海报：戏剧性侧逆光、浅景深、真实年龄感与皮肤瑕疵",
     "电影级人像摄影质感的三维渲染，戏剧性侧逆光勾出轮廓光，浅景深，"
     "皮肤有真实的纹理、细纹与瑕疵，布料有真实的织物结构与磨损。"
     "半身像，人物占画面高度三分之二以上，构图像史诗剧集的角色海报。"
     "距画面边缘约百分之三处一道暗金细边框。",
     {"morgan":
        "四十岁上下的女性，黑发挽起有几缕散落，深红羊毛长袍配旧皮革护肩，"
        "掌心一团真实的暗红火焰，火光是画面唯一的暖光源，从下方照亮她的面部与颈侧。"
        "眼角有细纹，神情是久居高位的沉着。背景是暗酒红的深色虚化。",
      "arthur":
        "五十岁上下的国王，风霜的面容，花白胡须，锁子甲外罩磨损的深蓝罩袍，"
        "简朴的金冠有使用痕迹。侧逆光勾出肩线，眼神疲惫但坚定。背景是深靛蓝的深色虚化。"}),

    ("3D真人", "B游戏CG", "3A 游戏过场动画质感：材质细节丰富、金属物理正确、面容略理想化",
     "3A 游戏过场动画级别的三维渲染，材质细节丰富，金属有正确的粗糙度与反射，"
     "布料有物理模拟的褶皱，全局光照柔和，面容略作理想化处理但仍写实。"
     "半身像，人物占画面高度三分之二以上。距画面边缘约百分之三处一道暗金细边框。",
     {"morgan":
        "三十余岁的女术士，乌黑长发，暗红丝绒与黑色皮革的层叠法袍，金属饰件反射环境光，"
        "掌心悬浮一团暗红火焰，有真实的次表面散射与体积光。神情从容锐利。"
        "背景是暗酒红的深色虚化。",
      "arthur":
        "四十余岁的国王，精工锁子甲与深蓝天鹅绒披风，金冠金属质感真实，"
        "手按剑柄，剑柄护手铸成圆桌纹章。背景是深靛蓝的深色虚化。"}),

    ("3D真人", "C彩绘胸像", "博物馆里的中世纪彩绘木雕胸像：上色的木头与镀金，正面对称，庄重静止",
     "中世纪彩绘木雕胸像的三维渲染，材质是上色的椴木与局部镀金，"
     "表面有年代久远的细微开裂与颜料剥落，雕刻手法概括而庄重。"
     "正面对称的胸像构图，人物占画面高度三分之二以上，姿态静止端正，博物馆布光。"
     "距画面边缘约百分之三处一道暗金细边框。",
     {"morgan":
        "彩绘木雕的女术士胸像，朱红与墨黑的袍服彩绘，局部镀金已有磨损，"
        "双手在胸前捧着一团雕成火焰形状的镀金物件。面容雕刻概括，眼神以黑色颜料点出。"
        "背景是暗酒红的素色墙面。",
      "arthur":
        "彩绘木雕的国王胸像，靛蓝袍服彩绘配镀金冠冕，胡须以刻痕表现，"
        "双手交叠在胸前扶着一柄短剑。面容庄严对称。背景是深靛蓝的素色墙面。"}),

    # ───────────── 手抄本 ─────────────
    ("手抄本", "A纹章符号", "极简：人物高度符号化接近纹章图形，粗黑轮廓 + 四色平涂，完全无阴影",
     "中世纪纹章图形风格，人物高度符号化，粗重的黑色轮廓线，"
     "只用朱红、靛蓝、金、象牙白四种纯色平涂，完全没有阴影、渐变或立体感，"
     "形体极度概括接近符号。正面站立，构图完全对称，人物占画面高度三分之二以上。"
     "距画面边缘约百分之三处一道粗黑线边框。",
     {"morgan":
        "符号化的女性正面立像，朱红长袍为一整块平涂色，黑色长发为一整块色块，"
        "双手在胸前捧着一朵金色的火焰纹样。五官只用几笔黑线概括。背景是象牙白。",
      "arthur":
        "符号化的国王正面立像，靛蓝长袍为一整块平涂色，头戴金色冠冕，"
        "双手握着一柄竖直的金色长剑置于身前。五官只用几笔黑线概括。背景是象牙白。"}),

    ("手抄本", "B泥金细密画", "繁复金箔装饰边框占画面三分之一，人物在中央被藤蔓与花体环绕",
     "中世纪泥金手抄本细密画风格，繁复的金箔装饰边框占据画面四周约三分之一，"
     "边框内满是藤蔓卷草、花体纹样与小幅装饰，金箔有真实的贴金质感。"
     "人物在画面中央的方形开光内，尺寸不大但描绘精细，笔法细密，"
     "以深色墨线勾勒轮廓，色块平涂，没有立体光影。",
     {"morgan":
        "开光内是一位穿朱红与深蓝袍服的女性，手托一朵金色火焰，姿态端正。"
        "四周边框的藤蔓间点缀着暗红的果实与荆棘。",
      "arthur":
        "开光内是一位戴冠的国王，靛蓝袍服绣金，手持权杖与剑，姿态端正。"
        "四周边框的藤蔓间点缀着金色的百合花纹。"}),

    ("手抄本", "C木刻线刻", "黑白木刻版画：排线塑造体积，只用一种套色点缀",
     "中世纪木刻版画风格，黑白为主，以粗细不一的排线与交叉线塑造体积与阴影，"
     "线条有木刻特有的顿挫与毛边，只用一种套色作点缀。"
     "半身像，人物占画面高度三分之二以上，构图端正。"
     "距画面边缘约百分之三处一道粗黑线边框。",
     {"morgan":
        "木刻版画的女术士半身像，黑白排线塑造法袍的褶皱与面部结构，"
        "掌心一团火焰用暗红色套色印刷，是画面唯一的彩色。背景以密集排线压暗。",
      "arthur":
        "木刻版画的国王半身像，黑白排线塑造锁子甲与披风的质感，"
        "冠冕用靛蓝色套色印刷，是画面唯一的彩色。背景以密集排线压暗。"}),

    # 泥金细密画的人物放大变体。
    # 原 B 方向写死了「边框占画面四周约三分之一，人物尺寸不大」——
    # 人小是我提示词主动要求的，不是模型跑偏。这两版把边框收窄、人物放大。
    ("手抄本", "B2泥金-人物放大", "泥金细密画，边框收窄到六分之一，人物占画面高度一半以上",
     "中世纪泥金手抄本细密画风格，金箔装饰边框收窄为画面四周约六分之一的一圈，"
     "边框内是藤蔓卷草与花体纹样，金箔有真实的贴金质感。"
     "人物在画面中央，占画面高度二分之一以上，以深色墨线勾勒轮廓，"
     "色块平涂，没有立体光影也没有透视。",
     {"morgan":
        "一位穿朱红与深蓝袍服的女性，头戴简化的金冠，手托一朵金色火焰，姿态端正。"
        "四周边框的藤蔓间点缀着暗红的果实与荆棘。",
      "arthur":
        "一位戴冠的国王，靛蓝袍服绣金，手持权杖与剑，姿态端正。"
        "四周边框的藤蔓间点缀着金色的百合花纹。"}),

    ("手抄本", "B3泥金-人物主导", "泥金细密画，只剩一道窄装饰带，人物是半身像占三分之二",
     "中世纪泥金手抄本细密画风格，四周只保留一道窄窄的金箔装饰带，"
     "人物占据画面主体。半身像，人物占画面高度三分之二以上，"
     "以深色墨线勾勒轮廓，色块平涂，局部金箔点缀，没有立体光影也没有透视，"
     "面部以细密的墨线描绘五官。",
     {"morgan":
        "朱红与深蓝袍服的女性半身像，头戴简化金冠，一手托着一朵金色火焰，"
        "神情端正沉静。背景是暗酒红的平涂色块，其上有稍浅的卷草纹。",
      "arthur":
        "戴金冠的国王半身像，靛蓝袍服绣金，一手扶着竖立的剑，神情庄重。"
        "背景是深靛蓝的平涂色块，其上有稍浅的卷草纹。"}),
]

CHARS = {"morgan": "摩根勒菲", "arthur": "亚瑟"}
lock = threading.Lock()


def prompt_of(style_block, char_desc):
    return style_block + char_desc + COMMON


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


PROG = None


def job(didx, ckey, draw, key):
    style, dname, _, block, chars = DIRECTIONS[didx]
    data = request(prompt_of(block, chars[ckey]), key)
    tag = "%s·%s·%s 第%d张" % (style, dname, CHARS[ckey], draw)
    if "error" in data:
        with lock:
            print("X %s -- %s" % (tag, str(data["error"].get("message", ""))[:140]))
        if PROG: PROG.tick(tag + " 失败", ok=False)
        return 0
    out = BASE / style / dname
    out.mkdir(parents=True, exist_ok=True)
    save_verified(data["data"][0]["url"], out / ("%s_%d.jpeg" % (ckey, draw)))
    tok = (data.get("usage") or {}).get("total_tokens", 0) or 0
    with lock:
        print("OK %s (%d tokens)" % (tag, tok))
    if PROG: PROG.tick(tag)
    return tok


def main():
    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY")
    tasks = [(i, c, d) for i in range(len(DIRECTIONS))
             for c in CHARS for d in range(1, DRAWS + 1)]
    if "--missing" in sys.argv:
        tasks = [t for t in tasks
                 if not (BASE / DIRECTIONS[t[0]][0] / DIRECTIONS[t[0]][1] /
                         ("%s_%d.jpeg" % (t[1], t[2]))).exists()]
    print("方向试水：%d 个方向 × %d 角色 × %d 抽卡 = %d 次请求 | 并发 %d" %
          (len(DIRECTIONS), len(CHARS), DRAWS, len(tasks), CONC))

    for i, (style, dname, note, block, chars) in enumerate(DIRECTIONS):
        d = BASE / style / dname
        d.mkdir(parents=True, exist_ok=True)
        (d / "_配置.md").write_text(
            "# %s · %s\n\n%s\n\n## 风格段\n\n```text\n%s\n```\n\n"
            "## 人物描述\n\n%s\n" % (
                style, dname, note, block,
                "\n\n".join("**%s**\n\n```text\n%s\n```" % (CHARS[k], v)
                            for k, v in chars.items())),
            encoding="utf-8")

    global PROG
    PROG = Progress("画风方向试水", len(tasks))
    with ThreadPoolExecutor(max_workers=CONC) as pool:
        total = sum(pool.map(lambda t: job(t[0], t[1], t[2], key), tasks))
    PROG.done()
    print("\n合计约 %d tokens，产物在 %s" % (total, BASE.relative_to(ROOT)))


if __name__ == "__main__":
    main()
