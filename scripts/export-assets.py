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


# ---- 界面资产（图标 / 场景）----
# 尺寸 = 该资产在界面上的最大用途 × DPR3，留一点余量。改尺寸前先回 wxss 查，别拍脑袋。
#
# 格式怎么选：**只有轮廓不规则的才用 PNG**。
#   圆桌实测填充率 78.0%（完美圆内切正方形是 78.5%）——它就是个干净的圆，
#   用 JPEG + CSS border-radius:50% 裁，512px 从 472KB 降到 51KB，省 9 倍。
#   长桌的边条和中心全不透明像素占 97-100%，同样走 JPEG；只有四个圆角需要 alpha。
ICONS = {   # 轮廓不规则，必须 PNG 带 alpha
    "crown.png":            (96,  ".handoff-preview-symbol 48rpx = 24pt"),
    "amulet.png":           (224, ".amulet-emblem 140rpx = 70pt"),
    "magic-fire.png":       (224, "座位角标只要 17pt，留给分配时的摆动动画"),
    "table-emblem.png":     (192, ".table-emblem 116rpx = 58pt"),
    "crest-good.png":       (240, ".verdict-mark 144rpx = 72pt，同时用于 .mission-orb"),
    "crest-evil.png":       (240, "同上"),
    "home-emblem.png":      (160, ".home-emblem 94rpx = 47pt"),
    "seal-base.png":        (208, ".submitted-seal / .sigil-placeholder 112-126rpx"),
    "mission-pending.png":  (128, ".mission-orb 68rpx = 34pt"),
    "mission-current.png":  (128, "同上"),
}
SCENES = {  # 矩形或可用 CSS 裁形，走 JPEG
    "table-round.jpg": ((512, 512),   84, ".round-table 330rpx=165pt，CSS border-radius:50% 裁圆"),
    # 地毯四个配色，玩家可选。全部同规格，只有颜色不同。
    "floor-green.jpg":  ((1080, 1080), 78, "墨绿绒毯，.compact-table-stage 约 351x295pt，cover 铺"),
    "floor-indigo.jpg": ((1080, 1080), 78, "深靛蓝绒毯"),
    "floor-wine.jpg":   ((1080, 1080), 78, "深酒红绒毯"),
    "floor-umber.jpg":  ((1080, 1080), 78, "暗金褐绒毯"),
    "home-bg.jpg":     ((750, 1624),  76, "首页整屏。低对比木纹，@2x 足够，@3x 白白多一倍体积"),
}
# 切角渲染边长。必须 >= 桌子圆角的弧半径，否则角块自己会把弧切掉。
# 实测这张长桌的弧半径是 76px（切片 inset=260 时），所以 84 够用；
# 早先用 72 就不够，角上会缺一圈月牙。改桌子图后要重新量，别照抄。
SLICE_OUT = 84


def export_png(src, out, side):
    out.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGBA")
    k = side / max(im.size)
    im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))),
              Image.LANCZOS).save(out, optimize=True)
    return out.stat().st_size


def export_ui():
    src = GEN / "界面/_定稿"
    rows, total = [], 0
    for name, (side, why) in ICONS.items():
        f = src / name
        if not f.exists():
            print("  ! 缺 " + name); continue
        n = export_png(f, DST / "ui" / name, side); total += n
        rows.append(("ui/" + name, "%dpx" % side, n, why))
    for name, (size, q, why) in SCENES.items():
        f = src / (name[:-4] + (".png" if name.startswith("table-round") else ".jpeg"))
        n = export(f, DST / "ui" / name, size, q=q); total += n
        rows.append(("ui/" + name, "x".join(map(str, size)), n, why))
    for f in sorted((src / "table-long-9slice").glob("*.png")):
        if f.stem.startswith("_"):
            continue                      # _九宫格预览 是验收图，不是资产
        im = Image.open(f).convert("RGBA")
        if f.stem.startswith("corner"):
            n = export_png(f, DST / "ui/table-long" / f.name, SLICE_OUT)
            rows.append(("ui/table-long/" + f.name, "%dpx" % SLICE_OUT, n, "圆角，需要 alpha"))
        else:
            # 边条只把「厚度」那一轴缩到 SLICE_OUT，长度按比例——它要沿另一轴平铺
            horiz = f.stem in ("edge_top", "edge_bottom")
            k = SLICE_OUT / 260   # 切片 inset 是 260，所有块用同一个缩放比
            if f.stem == "center":
                # 中心和边条同比例平铺，所以按同一个 k 缩，不能给固定尺寸——
                # 尺寸一变比例就和边条对不上，交界处又会出现长方形轮廓
                k = SLICE_OUT / 260
                sz = (max(1, round(im.width * k)), max(1, round(im.height * k)))
            else:
                sz = (max(1, round(im.width * k)), max(1, round(im.height * k)))
            n = export(f, DST / "ui/table-long" / (f.stem + ".jpg"), sz, q=82)
            rows.append(("ui/table-long/%s.jpg" % f.stem, "x".join(map(str, sz)), n,
                         "全不透明，JPEG 即可"))
        total += n
    w = max(len(r[0]) for r in rows)
    for path, size, n, why in rows:
        print("  %-*s %-11s %7.1f KB   %s" % (w, path, size, n / 1024, why))
    print("\n界面资产合计 %.2f MB" % (total / 1024 / 1024))
    return total
