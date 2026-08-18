"""把定稿资产压缩导出到 miniprogram/assets/（入库，代码会话直接用）。

为什么要单独一步：generated/ 是 gitignore 的，而且是 1728x2304 的原图约 1MB 一张，
小程序主包上限 2MB，直接放进去必爆。

导出规则：按各资产在界面上的 @3x 物理像素缩放，Lanczos，再压 JPEG。
  任务牌 52x77pt   → 156x231
  身份牌 330x440pt → 990x1320
"""
import pathlib
import shutil
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = ROOT / "docs/assets/generated"
DST = ROOT / "miniprogram/assets"

MISSION = (156, 231)     # 104x154rpx = 52x77pt @3x
IDENTITY = (990, 1320)   # 660x880rpx = 330x440pt @3x


def export(src, out, size, q=82):
    out.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGB").resize(size, Image.LANCZOS)
    im.save(out, quality=q, optimize=True, progressive=True)
    return out.stat().st_size



# 一局能出现多次的角色，各皮肤生成阶段的文件名不统一（手绘用 loyal-1/duke，
# 另两套用 loyal-v1/duke-v1）。导出时统一归一化成 <key>-v<N>.jpg，
# 代码侧只认这一种，且必须和 gameCore.js 的 roleArtVariants 对齐。
ROLE_VARIANTS = {"loyal": 4, "minion": 3, "duke": 2, "archduke": 2, "priest": 2, "apprentice": 2}


def normalized_role_names(files):
    """把一批源文件映射成归一化后的目标文件名；超出变体上限的返回 None（不导出）。"""
    import re as _re
    from collections import defaultdict
    groups = defaultdict(list)
    for f in files:
        m = _re.match(r"^(.*?)-v?(\d+)$", f.stem)
        if m and m.group(1) in ROLE_VARIANTS:
            groups[m.group(1)].append((int(m.group(2)), f))
        else:
            groups[f.stem].append((0, f))
    mapping = {}
    for key, items in groups.items():
        if key not in ROLE_VARIANTS:
            mapping[items[0][1]] = f"{key}.jpg"
            continue
        for idx, (_, f) in enumerate(sorted(items), start=1):
            mapping[f] = f"{key}-v{idx}.jpg" if idx <= ROLE_VARIANTS[key] else None
    return mapping


def main():
    if DST.exists():
        shutil.rmtree(DST)
    total = {}

    # ── 任务牌 ──
    for skin in sorted((GEN / "任务牌-定稿").glob("skin-*")):
        for role, name in (("mission-back", "back"), ("mission-success", "success"),
                           ("mission-fail", "fail")):
            f = skin / f"{role}.jpeg"
            if f.exists():
                n = export(f, DST / "cards/mission" / skin.name / f"{name}.jpg", MISSION)
                total["任务牌"] = total.get("任务牌", 0) + n

    # ── 身份牌：卡背 + 角色 ──
    SKINS = {"手绘": GEN / "角色插画/手绘-定稿",
             "幻想华服": GEN / "皮肤/幻想华服/_定稿",
             "木刻线刻": GEN / "皮肤/木刻线刻/_定稿"}
    SLUG = {"手绘": "painted", "幻想华服": "fantasy", "木刻线刻": "woodcut"}
    for name, d in SKINS.items():
        if not d.exists():
            continue
        slug = SLUG[name]
        sources = sorted(d.glob("*.jpeg"))
        role_names = normalized_role_names([f for f in sources if not f.stem.startswith("identity-back")])
        for f in sources:
            if f.stem.startswith("identity-back"):
                out = DST / "cards/identity" / slug / "back.jpg"
                # 幻想华服选了两张卡背，取第一张，另一张留作备选
                if out.exists():
                    out = DST / "cards/identity" / slug / f"back-alt.jpg"
            else:
                target = role_names.get(f)
                if not target:
                    continue          # 超出变体上限，代码取不到，不浪费体积
                out = DST / "roles" / slug / target
            n = export(f, out, IDENTITY)
            total[f"身份牌·{name}"] = total.get(f"身份牌·{name}", 0) + n

    print(f"{'分类':<16}{'张数':>6}{'体积':>12}")
    grand = 0
    for k, v in total.items():
        cnt = len(list((DST / "cards/mission").rglob("*.jpg"))) if k == "任务牌" else \
              len(list((DST / "roles" / SLUG[k.split('·')[1]]).glob("*.jpg"))) + \
              len(list((DST / "cards/identity" / SLUG[k.split('·')[1]]).glob("*.jpg")))
        print(f"{k:<16}{cnt:>6}{v/1024/1024:>10.2f} MB")
        grand += v
    print(f"{'合计':<16}{'':>6}{grand/1024/1024:>10.2f} MB")
    print(f"\n小程序主包上限 2MB —— {'超了 %.1f 倍' % (grand/1024/1024/2) if grand > 2*1024*1024 else '没超'}")


if __name__ == "__main__":
    main()
