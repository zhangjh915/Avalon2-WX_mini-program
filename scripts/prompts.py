"""读取 docs/assets/prompts/ 下的提示词文件。

提示词是**内容**不是代码，所以全部放在 TOML 里，不硬编码在 .py 中：
改文案不用碰代码，也方便直接 review 和 diff。

目录结构：
  docs/assets/prompts/
    角色名册.toml        27 个角色的 key / 中文名 / 阵营（唯一事实来源）
                         结构键用英文（TOML 裸键必须 ASCII），内容中文
    皮肤/<名字>.toml     一套皮肤：风格段 + 阵营背景 + 尾巴 + 27 个角色形象 + 卡背

用法：
    from prompts import load_skin, ROSTER
    sk = load_skin("幻想华服")
    sk.role_prompt("morgan")     # 角色卡完整提示词
    sk.back_prompt("王冠双剑")   # 卡背完整提示词
"""

import pathlib
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = ROOT / "docs/assets/prompts"
SKIN_DIR = DIR / "皮肤"


def _load(path):
    with open(path, "rb") as f:
        return tomllib.load(f)


# TOML 裸键必须是 ASCII，所以结构键用英文、内容用中文
ROSTER = _load(DIR / "角色名册.toml")["roles"]   # key -> {name, faction}


class Skin:
    def __init__(self, data, path):
        self.path = path
        self.name = data["name"]
        self.note = data.get("note", "")
        self.style = data["style"].strip()
        self.tail = data["tail"].strip()
        self.bg = {k: v.strip() for k, v in data["background"].items()}
        self.roles = {k: v.strip() for k, v in data["characters"].items()}
        # 变体：一局里能出现多次的角色需要几张不同长相（见 gameCore.js 的 roleLimits）
        # {角色key: [(变体名, 描述), …]}
        self.variants = {k: [(n, d.strip()) for n, d in v.items()]
                         for k, v in data.get("variants", {}).items()}
        back = data.get("back", {})
        self.back_style = back.get("style", "").strip()
        self.back_frame = back.get("frame", "").strip()
        self.back_tail = back.get("tail", "").strip()
        self.motifs = {k: v.strip() for k, v in back.get("motifs", {}).items()}

    def role_prompt(self, key):
        faction = ROSTER[key]["faction"]
        return self.style + self.bg[faction] + self.roles[key] + self.tail

    def variant_prompt(self, key, idx):
        faction = ROSTER[key]["faction"]
        return self.style + self.bg[faction] + self.variants[key][idx][1] + self.tail

    def variant_name(self, key, idx):
        return self.variants[key][idx][0]

    def back_prompt(self, motif):
        return self.back_frame + self.back_style + self.motifs[motif] + self.back_tail

    def check(self):
        """名册里的角色是不是都写了形象描述——漏一个就会在批量跑到一半才炸。"""
        # 有变体的角色不出通用版，所以覆盖率要把 variants 算进去
        covered = set(self.roles) | set(self.variants)
        missing = [k for k in ROSTER if k not in covered]
        extra = [k for k in covered if k not in ROSTER]
        return missing, extra


def load_skin(name):
    return Skin(_load(SKIN_DIR / f"{name}.toml"), SKIN_DIR / f"{name}.toml")


def list_skins():
    return sorted(p.stem for p in SKIN_DIR.glob("*.toml"))
