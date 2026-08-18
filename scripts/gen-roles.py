"""生成 27 个角色的身份牌正面插画。

身份牌正面 = 每个角色一张完整插画，**卡面上不叠任何文字**（角色名和能力
渲染在卡片下方的界面里）。所以这不是"留白底图"，是一张完整的人物卡。

尺寸：界面 660x880rpx = 330x440pt，@3x 990x1320，生成用 1728x2304（3:4）。

模型用 5pro：质感最好；角色插画是**逐张单图**，用不上组图，
反而躲开了「组图返回顺序不保证」那个坑（27 个角色靠内容认人比靠底色难得多）。

一致性靠**参考图**：先跑风格试水挑一张当锚，其余全部拿它当 `image` 参考。

用法：
  source ~/.avalon-llm-key
  python3 scripts/gen-roles.py --test              # 风格试水：3 个角色各 3 张
  python3 scripts/gen-roles.py --ref <锚图> [key…] # 带参考图批量出，不传 key 则全部
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

# 并发路数。单次 5pro 请求约 97 秒，并发直接决定总时长：
#   3 路 → 32 秒/张（81 张跑了 40 分钟）
#   10 路 → 约 10 秒/张
# 用 CONC 环境变量调，遇到限流就调低。
CONC = int(os.environ.get("CONC", "6"))

ENDPOINT = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"
MODEL = "doubao-seedream-5-0-pro-260628"
SIZE = "1728x2304"
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/角色插画"

# ─────────────────────────────────────────────────────────────
# 画风。每种画风是一整套：风格段 + 阵营背景 + 尾巴。
#
# 三者必须成套定义，不能只换风格段——例如手抄本是平面装饰画，
# 「暗色环境虚化」这种带景深的背景描述和它直接冲突；
# 二次元的尾巴也不能留着「不要二次元大眼」这种自相矛盾的禁令。
#
# 风格段里**不放**「不要猥琐」之类的气质约束——那是角色属性，不是全局规则。
# 疯子、骗徒、爪牙本来就该猥琐，摩根勒菲该是气度沉稳的女王。
# 早期版本把气质写进公共段，等于把 27 个角色抹平成一种，还删掉了该有的邪气。
# 气质一律写进各角色描述，而且**只用正面描述**——「不要X」既不可靠也容易
# 把模型推到反方向（摩根加了「英姿飒爽/英气逼人」反而往男相走了）。
# ─────────────────────────────────────────────────────────────

_COMMON_FRAME = (
    "半身像，人物占画面高度三分之二以上，位于画面中上部，正面或四分之三侧面，"
    "面部轮廓清晰、眼神有戏、气质到位。"
    "服装为中世纪题材：羊毛、皮革、锁子甲、亚麻、丝绒。"
    "距画面边缘约百分之三处一道暗金细边框，四边完全出血。"
)

# 背景按阵营统一：27 张摆在一起时，人物各有各的服饰色，如果背景也各走各的
# 就会散成一堆孤立插画。选色避开了任务牌已占用的绿（成功）和亮红（失败）。
_BG_DEPTH = {
    "good": "背景统一为深靛蓝色调的暗色环境虚化（接近 #1a2b38），"
            "冷调、沉静、压暗，不抢人物。",
    "evil": "背景统一为暗酒红色调的暗色环境虚化（接近 #2e1518），"
            "暖调、压抑、压暗，不抢人物。",
}
# 手抄本是平面装饰画，不能有景深虚化
_BG_FLAT = {
    "good": "背景为深靛蓝色（接近 #1a2b38）的平涂色块，其上有同色系稍浅的"
            "藤蔓卷草装饰纹样，完全平面，没有景深也没有虚化。",
    "evil": "背景为暗酒红色（接近 #2e1518）的平涂色块，其上有同色系稍浅的"
            "藤蔓卷草装饰纹样，完全平面，没有景深也没有虚化。",
}

_TAIL_BASE = ("克制的史诗感，色调低饱和。不要现代服装，不要夸张的网游盔甲。"
              "严禁出现：文字、水印、白色边框、白色四角、相框、画框、卡片投影。")

STYLES = {
    "手绘": {
        "block": ("中世纪桌游角色卡插画，手绘厚涂风格，可见笔触与颜料质感，"
                  "不是照片，不是3D渲染，不是二次元。" + _COMMON_FRAME),
        "bg": _BG_DEPTH,
        "tail": "不要二次元大眼。" + _TAIL_BASE,
    },
    "二次元": {
        "block": ("中世纪桌游角色卡插画，日式二次元动画风格，干净利落的线稿配赛璐璐平涂，"
                  "高光与阴影有明确分界，不是厚涂也不是写实照片。" + _COMMON_FRAME),
        "bg": _BG_DEPTH,
        # 这里绝不能写「不要二次元大眼」，会和风格本身打架
        "tail": "五官精致但不夸张变形，头身比接近写实。" + _TAIL_BASE,
    },
    "3D真人": {
        "block": ("中世纪桌游角色卡插画，写实三维渲染，接近电影级 CG，"
                  "皮肤纹理与布料材质真实可信，全局光照柔和，轻微景深。" + _COMMON_FRAME),
        "bg": _BG_DEPTH,
        "tail": ("皮肤有真实的毛孔与瑕疵，不要塑料感，不要过度光滑，"
                 "不要二次元大眼。" + _TAIL_BASE),
    },
    "手抄本": {
        "block": ("中世纪泥金手抄本插图风格，平面装饰画，没有透视也没有立体光影，"
                  "人物以清晰的深色墨线勾勒轮廓，色块平涂，局部金箔点缀，"
                  "构图端正对称，像中世纪彩绘经书里的人物像。" + _COMMON_FRAME),
        "bg": _BG_FLAT,
        "tail": ("完全平面，不要立体渲染，不要景深，不要照片质感，不要二次元大眼。"
                 + _TAIL_BASE),
    },
}

# 兼容旧调用：默认画风
STYLE = "手绘"
STYLE_HAND = STYLES["手绘"]["block"]
FACTION_BG = STYLES["手绘"]["bg"]
TAIL = STYLES["手绘"]["tail"]

# key: (中文名, 阵营, 形象描述)
ROLES = {
    # ── 正义方 13 ──
    "arthur": ("亚瑟", "good",
        "沉稳的中年国王，简朴的金冠，肩披深蓝披风，目光坚定而带着疲惫，"
        "久经决断的面容，姿态挺拔但不张扬。一手按在剑柄上，剑柄护手铸成圆桌纹章。人物服饰以蓝与暗金为主。"),
    "percival": ("帕西瓦里", "good",
        "年轻骑士，双手握着未出鞘的长剑，神情警惕而诚恳，眉头微蹙，"
        "像在分辨眼前谁真谁假。人物服饰以蓝银为主。"),
    "priest": ("教士", "good",
        "年长的神职者，一手托着烛台，素色法袍，神情审慎克制，"
        "眼中有洞悉一切的沉静。人物服饰以米白与金为主。"),
    "loyal": ("亚瑟的忠臣", "good",
        "普通的中年骑士，朴素锁子甲，胸前有圆桌纹章，神情坦荡踏实，"
        "没有野心也没有城府。人物服饰以灰蓝与暗金为主。"),
    "duke": ("公爵", "good",
        "中年贵族，剪裁考究的深绿丝绒外袍，一手虚扶腰间佩剑，"
        "从容有分寸，习惯了被听取意见。人物服饰以深绿与金为主。"),
    "archduke": ("大公", "good",
        "年长贵族，厚重毛领大氅，鬓角灰白，威严但不凌人，"
        "眼神看得很远。人物服饰以深紫与金为主。"),
    "squire": ("侍从", "good",
        "成年的扈从，尚未受封为骑士，怀里抱着主人的头盔，衣着朴素但整洁，"
        "神情恭谨，眼里有跃跃欲试的光。人物服饰以褐与暗金为主。"),
    "apprentice": ("学徒", "good",
        "年轻学徒，抱着一卷羊皮书，袖口沾着墨渍，眼神好奇而专注。"
        "人物服饰以米色与青为主。"),
    "troublemaker": ("捣乱者", "good",
        "神情狡黠的年轻人，衣着略凌乱，一边嘴角上扬，手里把玩着一枚硬币，"
        "看热闹但不坏。人物服饰以土黄与暗红为主。"),
    "galahad": ("加拉哈德", "good",
        "年轻的纯洁骑士，白色罩袍上有金十字，神情澄澈坚定，双手捧着一只朴素的圣杯、杯中透出极淡的柔光，"
        "面部几乎不带阴影。人物服饰以白与金为主。"),
    "reluctant": ("不情愿的领袖", "good",
        "中年男子，被硬塞了一件明显过大的指挥官披风，神情无奈，"
        "但还是站得笔直。人物服饰以灰褐与暗金为主。"),
    "guard": ("守卫", "good",
        "魁梧卫兵，厚重铠甲与长戟，面容刚毅，目光警觉地扫视侧方。"
        "人物服饰以铁灰与暗金为主。"),
    "lancelotGood": ("正义的兰斯洛特", "good",
        "英挺骑士，银白铠甲泛着圣洁微光，手按剑柄，神情磊落坦荡，"
        "四分之三侧面。人物服饰以银白与蓝为主。"),

    # ── 邪恶方 14 ──
    "morgan": ("摩根勒菲", "evil",
        "成熟的黑发女术士，气度沉稳的女王，兼具女巫的神秘。"
        "深红与墨黑长袍，肩线利落如战袍，衣饰上有低调的秘法符号，"
        "姿态挺拔从容，下巴微抬，眼神锐利带一丝了然的笑意。一只手掌心向上托着一团悬浮的暗红色火焰，火光从下方映亮她的下颌与眼神，她看着火焰的神情是掌控而非迷恋。"
        "她是掌权者，不是阴谋者。"
        "人物服饰以暗红与暗金为主。"),
    "minion": ("莫德雷德的爪牙", "evil",
        "兜帽下只露出半张脸的随从，暗紫斗篷，神情顺从阴沉，唯唯诺诺，"
        "视线躲闪不看正前方，带几分猥琐。人物服饰以暗紫与黑为主。"),
    "shapeshifter": ("幻形妖", "evil",
        "轮廓略不稳定的人形，面容像随时会变成别人，身体边缘泛起细微扭曲。"
        "妖异，是一种让人不安的美。手中一面古旧铜镜，镜面里映出的脸和本人并不一样。人物服饰以青灰与暗紫为主。"),
    "crownPrince": ("王储", "evil",
        "年轻俊美的王子，华服镶金，身姿挺拔贵气逼人，神情倨傲，"
        "嘴角有礼貌的弧度，眼底藏着算计。五官俊朗，仪表堂堂。手中把玩着一顶尚未戴上的王冠，指尖摩挲冠沿。人物服饰以暗金与酒红为主。"),
    "hunter": ("盲眼杀手", "evil",
        "蒙着眼布的刺客，深灰兜帽压低，下半张脸冷硬，面朝正前方，"
        "虽看不见却姿态精准笃定。冷峻，有威慑力。"
        "手中匕首反射一线冷光。人物服饰以冷灰与暗蓝为主。"),
    "barbarian": ("野蛮人", "evil",
        "魁梧的异族战士，皮毛与骨饰，脸上有战纹，神情桀骜，肌肉线条硬朗。"
        "野性，充满力量感。人物服饰以赭石与暗红为主。"),
    "traitor": ("叛徒", "evil",
        "穿着正义方制服的中年男子，却把脸侧向阴影，神情复杂带着愧色。"
        "面容端正，只是眼神躲闪——他曾经也是骑士。手里攥着一封拆开的密信，信纸边缘已被捏皱。人物服饰以灰绿与暗红为主。"),
    "revealer": ("揭露者", "evil",
        "手提一盏罩着薄纱的提灯，灯光从下方斜照上来，把脸照得一半明一半暗。"
        "神情坦然近乎从容，像早就知道自己迟早会被看见，"
        "并且已经想好了那之后该怎么办。人物服饰以暗红与冷白为主。"),
    "lunatic": ("疯子", "evil",
        # 原描述用「眼神涣散」「神态癫狂失态」被内容审核拦了三次：
        # The request failed because the input text may contain sensitive information
        # 改成只写**行为**不写精神状态，同样能出那股不管不顾的劲。
        "举止夸张放肆的男子，衣衫松垮凌乱，双臂张开，仰头大笑，"
        "目光飘向别处不与人对视，浑身是不管不顾的劲。人物服饰以灰黄与暗红为主。"),
    "deceiver": ("骗徒", "evil",
        "衣着考究的廷臣，面容和善可信，笑意得体，让人第一眼就想相信他。"
        "半边脸在暖光里、半边沉入阴影，眼神平静得看不出底细。"
        "他的本事是被人信任，不是逗人发笑。人物服饰以深青与暗金为主。"),
    "boaster": ("吹嘘者", "evil",
        "挺胸抬头的骑士，铠甲擦得锃亮却毫无战损痕迹。"
        "表情浮夸自信、虚张声势，略带滑稽。人物服饰以亮铜与暗红为主。"),
    "saboteur": ("破坏者", "evil",
        "卸去半副铠甲的老兵，肩头还留着领袖绶带压出的旧痕，"
        "正低头擦拭一把不再出鞘的剑，神情平静得看不出情绪。"
        "人物服饰以铁锈与暗红为主。"),
    "outsider": ("边缘人", "evil",
        "站在人群边缘的人，斗篷拉得很紧，神情疏离警觉，"
        "像随时准备离开。人物服饰以灰褐与暗红为主。"),
    "lancelotEvil": ("邪恶的兰斯洛特", "evil",
        "与正义的兰斯洛特同一张脸、同一姿态、同一构图、同样英挺，"
        "但铠甲泛暗红微光，神情阴郁。四分之三侧面。人物服饰以暗红与黑为主。"),
}

# 两阵营各 2 个，验证统一背景色和道具互动：
#   亚瑟——上一轮跑过，可直接对照背景色变化；新增按剑（护手是圆桌纹章）
#   教士——正义方另一种气质（年长、克制），带烛台
#   摩根——托火焰，重点验证
#   王储——邪恶方「要好看」的代表，把玩尚未戴上的王冠
# ─────────────────────────────────────────────────────────────
# 同一角色的多个变体。
#
# 起因：gameCore.js 的 roleLimits 里有 6 个角色能在一局里出现多次——
#   loyal / minion 是 multiple（不限），实际上限由 factionTotals 卡住：
#     10 人局 {good:6, evil:4}，morgan 是 required，
#     所以最多 6 个忠臣、3 个爪牙；
#   duke / archduke / priest / apprentice 是 maxCopies: 2。
# 一局里出现两张一模一样的身份牌，终局公开身份时会很出戏。
#
# 关键点：**同一条提示词的多次抽卡只是同一个人的不同角度，不是不同的人**，
# 拿来当第二变体是糊弄。每个变体必须有自己的形象描述。
#
# 共同标识要保留（比如忠臣胸前的圆桌纹章），否则四个变体会散成四个无关角色。
# ─────────────────────────────────────────────────────────────
VARIANTS = {
    # 原描述写了「没有野心也没有城府」——那句本身就是在要求一张没表情的脸，
    # 用户反馈"都有点呆"根因在此。四个变体各给一种性格。
    "loyal": [
        ("老兵", "年长的忠臣骑士，鬓角灰白，颧骨上一道旧疤，锁子甲边缘被磨得发亮，"
                "胸前有圆桌纹章。神情沉静，像见过太多场远征。"
                "人物服饰以灰蓝与暗金为主。"),
        ("壮汉", "壮实的忠臣骑士，络腮胡，肩背宽厚，双手交叠按在剑柄上，"
                "胸前有圆桌纹章。咧嘴的笑意直率，是那种会第一个冲上去的人。"
                "人物服饰以灰蓝与暗金为主。"),
        ("女骑士", "短发利落的女性忠臣骑士，甲胄合身，胸前有圆桌纹章，"
                "目光平视前方，下颌线坚毅，神情冷静自持。"
                "人物服饰以灰蓝与暗金为主。"),
        ("青年", "瘦高的年轻忠臣骑士，面容清秀但眼神执拗，甲胄略大不合身，"
                "胸前有圆桌纹章，站得笔直，透着一股不肯服输的劲。"
                "人物服饰以灰蓝与暗金为主。"),
    ],
    "minion": [
        ("瘦削", "兜帽阴影下的瘦削男子，颧骨凸出，暗紫斗篷裹得很紧，"
                "神情顺从阴沉，视线躲闪不看正前方，带几分猥琐。"
                "人物服饰以暗紫与黑为主。"),
        ("打手", "脖颈粗短的壮硕打手，暗紫斗篷罩不住肩膀，面无表情，"
                "眼神空洞地执行命令，不思考也不迟疑。人物服饰以暗紫与黑为主。"),
        ("侍从", "阴柔的年轻侍从，暗紫衣袍整洁，嘴角挂着恰到好处的假笑，"
                "眼神却是冰冷的。人物服饰以暗紫与黑为主。"),
    ],
    # 下面四个 maxCopies 是 2，各补一条与已选版本明显不同的描述
    "duke": [
        ("第二位", "年轻的公爵，深绿丝绒外袍剪裁利落，一手随意搭在椅背上，"
                "眉眼间有掩不住的锋芒，是刚接过封地不久的那种自信。"
                "人物服饰以深绿与金为主。"),
    ],
    "archduke": [
        ("第二位", "身形瘦削的年长大公，毛领大氅显得有些空荡，手指枯瘦戴着家族印戒，"
                "眼窝深陷但目光清明，是靠脑子而非武力坐到这个位置的。"
                "人物服饰以深紫与金为主。"),
    ],
    "priest": [
        ("第二位", "中年女性神职者，素色法袍外披一条金线绣带，一手按在胸前的圣徽上，"
                "神情温和但不容置疑，另一手托着烛台。人物服饰以米白与金为主。"),
    ],
    "apprentice": [
        ("第二位", "戴着圆框水晶眼镜的年轻学徒，一头蓬乱卷发，怀里塞着好几卷羊皮书，"
                "指尖染着墨，神情兴奋得有点忘形。人物服饰以米色与青为主。"),
    ],
}

TEST = ["arthur", "priest", "morgan", "crownPrince"]
lock = threading.Lock()


def prompt_of(key, style=None):
    st = STYLES[style or STYLE]
    _, faction, desc = ROLES[key]
    return st["block"] + st["bg"][faction] + desc + st["tail"]


def ref_uri(path):
    import base64, io
    from PIL import Image
    im = Image.open(path).convert("RGB")
    im = im.resize((768, round(im.height * 768 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def request(prompt, key_api, uri=None):
    body = {"model": MODEL, "prompt": prompt, "size": SIZE, "stream": False,
            "response_format": "url", "watermark": False}
    if uri:
        body["image"] = uri          # 只有 image 这个名字有效，别的会被静默忽略
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key_api}, method="POST")
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


def job(key, draw, key_api, out_dir, uri=None, variant=None, style=None):
    name = ROLES[key][0]
    if variant is None:
        prompt, label, stem = prompt_of(key, style), name, key
    else:
        vname, vdesc = VARIANTS[key][variant]
        _, faction, _ = ROLES[key]
        st = STYLES[style or STYLE]
        prompt = st["block"] + st["bg"][faction] + vdesc + st["tail"]
        label, stem = f"{name}·{vname}", f"{key}-v{variant + 1}"
    data = request(prompt, key_api, uri)
    tag = f"{label} 第{draw}张" if draw else label
    if "error" in data:
        with lock:
            print("✗ %s — %s" % (tag, str(data["error"].get("message", ""))[:150]))
        return 0
    items = data.get("data", [])
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{stem}_{draw}.jpeg" if draw else f"{stem}.jpeg"
    save_verified(items[0]["url"], out_dir / fname)
    tok = (data.get("usage") or {}).get("total_tokens", 0) or 0
    with lock:
        print("✓ %s → %s  (%d tokens)" % (tag, fname, tok))
    return tok


def main():
    key_api = os.environ.get("LLM_API_KEY")
    if not key_api:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    args = sys.argv[1:]
    style = None
    if "--style" in args:
        style = args[args.index("--style") + 1]
        if style not in STYLES:
            sys.exit("未知画风 %s，可选：%s" % (style, "、".join(STYLES)))
        args = [a for a in args if a != "--style" and a != style]
    if "--variants" in args:
        out = BASE / "变体与重跑"
        want = [a for a in args if a in VARIANTS] or list(VARIANTS)
        tasks = [(k, i, d) for k in want for i in range(len(VARIANTS[k]))
                 for d in (1, 2)]
        uri = None
        print("变体：%s，每变体 2 抽卡 = %d 次请求" % (
            "、".join("%s(%d个)" % (ROLES[k][0], len(VARIANTS[k])) for k in want),
            len(tasks)))
    elif "--rerun" in args:
        # 重跑某些角色（描述已改过），仍是 3 抽卡
        out = BASE / "变体与重跑"
        want = [a for a in args if a in ROLES]
        if not want:
            sys.exit("--rerun 要跟上角色 key，例如： --rerun squire")
        tasks = [(k, None, d) for k in want for d in (1, 2, 3)]
        uri = None
        print("重跑：%s，各 3 抽卡 = %d 次请求" %
              ("、".join(ROLES[k][0] for k in want), len(tasks)))
    elif "--all" in args:
        st = style or STYLE
        out = BASE / ("全角色-3抽卡" if st == "手绘" else "%s-3抽卡" % st)
        tasks = [(k, None, d) for k in ROLES for d in (1, 2, 3)]
        uri = None
        print("批量【%s】：%d 个角色 × 3 抽卡 = %d 次请求" %
              (st, len(ROLES), len(tasks)))
    elif "--test" in args:
        out = BASE / "_试水2-阵营背景与道具"
        tasks = [(k, None, d) for k in TEST for d in (1, 2, 3)]
        uri = None
        print("风格试水（手绘）：%s，各 3 张，共 %d 次请求" %
              ("、".join(ROLES[k][0] for k in TEST), len(tasks)))
    else:
        if "--ref" not in args:
            sys.exit("批量出图必须带 --ref <锚图路径>，否则 27 张风格会各走各的")
        i = args.index("--ref")
        ref = pathlib.Path(args[i + 1])
        keys = [a for a in args[i + 2:] if a in ROLES] or list(ROLES)
        out = BASE / "定稿候选"
        tasks = [(k, None, 0) for k in keys]
        uri = ref_uri(ref)
        print("批量出图：%d 个角色，参考图 %s" % (len(keys), ref.name))

    out.mkdir(parents=True, exist_ok=True)
    (out / "_配置.md").write_text(
        "# 角色插画生成配置\n\n| 项 | 值 |\n|---|---|\n"
        "| 画风 | %s |\n| 模型 | `%s` |\n| 尺寸 | `%s` |\n| 模式 | 单图%s |\n\n"
        "## 风格段\n\n```text\n%s\n```\n\n## 尾巴\n\n```text\n%s\n```\n\n"
        "## 各角色形象描述\n\n| key | 角色 | 阵营 | 描述 |\n|---|---|---|---|\n%s\n" % (
            style or STYLE, MODEL, SIZE,
            "（带参考图）" if uri else "（无参考图）",
            STYLES[style or STYLE]["block"], STYLES[style or STYLE]["tail"],
            "\n".join("| `%s` | %s | %s | %s |" % (k, v[0], v[1], v[2])
                      for k, v in ROLES.items())),
        encoding="utf-8")

    with ThreadPoolExecutor(max_workers=CONC) as pool:
        total = sum(pool.map(
            lambda t: job(t[0], t[2], key_api, out, uri, t[1], style), tasks))
    print("\n合计约 %d tokens，产物在 %s" % (total, out.relative_to(ROOT)))


if __name__ == "__main__":
    main()
