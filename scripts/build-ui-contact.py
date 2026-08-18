"""界面资产选片拼图：每类一张，左右并排看候选。

产出到 docs/assets/generated/界面/_选片/，四张：
  图标.png    火球/皇冠/护身符/纹章，每个候选带一条真实尺寸条
  圆桌.png    6 个候选，各自合成到真实牌桌上
  长桌.png    6 个候选，切九宫格后按 68x28（最扁那档）合成
  底纹.png    地面 3 + 首页 3

真实尺寸一律 1:1 渲染，不做任何放大（手册 5.2）。展示用的大图可以缩，
但缩放比例会标在旁边，避免把「缩过的图」误当成验收依据。
"""
import importlib.util
import math
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
G = ROOT / "docs/assets/generated/界面"
ICO, SCE, RAW = G / "图标-抠图", G / "场景-抠图", G / "场景"
OUT = G / "_选片"

spec = importlib.util.spec_from_file_location("s9", ROOT / "scripts/slice9.py")
s9 = importlib.util.module_from_spec(spec); spec.loader.exec_module(s9)

D = 3
R = lambda rpx: round(rpx / 2 * D)
STAGE = (R(702), R(590))
PAGE_BG, STAGE_BG, AV_BG, AV_BD = (18, 24, 22), (216, 212, 202), (64, 80, 73), (143, 153, 147)
SHEET_BG, INK, DIM = (26, 28, 27), (222, 220, 214), (135, 142, 138)

FONTS = ["/System/Library/Fonts/Hiragino Sans GB.ttc",
         "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]


def font(sz):
    for p in FONTS:
        if pathlib.Path(p).exists():
            try:
                return ImageFont.truetype(p, sz)
            except OSError:
                pass
    return ImageFont.load_default()


F, FS = font(26), font(19)


def fit(im, s):
    k = s / max(im.width, im.height)
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)


def cover(im, w, h):
    k = max(w / im.width, h / im.height)
    r = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    return r.crop(((r.width - w) // 2, (r.height - h) // 2,
                   (r.width - w) // 2 + w, (r.height - h) // 2 + h))


def on(im, bg, w, h):
    t = Image.new("RGBA", (w, h), bg + (255,))
    t.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2))
    return t.convert("RGB")


def grid(cells, cols, cell_w, cell_h, title, sub=""):
    """cells: [(标题, PIL图), …]，图已经是最终像素，居中摆进格子。"""
    pad, head, lab = 26, 62 if sub else 44, 30
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (pad + cols * (cell_w + pad),
                              head + rows * (cell_h + lab + pad) + pad), SHEET_BG)
    d = ImageDraw.Draw(sheet)
    d.text((pad, 14), title, font=F, fill=INK)
    if sub:
        d.text((pad, 46), sub, font=FS, fill=DIM)
    for i, (name, im) in enumerate(cells):
        r, c = divmod(i, cols)
        x = pad + c * (cell_w + pad)
        y = head + r * (cell_h + lab + pad)
        sheet.paste(im, (x + (cell_w - im.width) // 2, y + (cell_h - im.height) // 2))
        d.text((x, y + cell_h + 6), name, font=FS, fill=INK)
    return sheet


# ---------- 图标 ----------
def icon_cell(key, sizes, big=190):
    """上面是放大看造型，下面一条是真实尺寸 1:1。"""
    im = Image.open(ICO / (key + ".png")).convert("RGBA")
    top = on(fit(im, big), PAGE_BG, big + 16, big + 16)
    strip_w = sum(s + 18 for s in sizes) + 18
    strip_h = max(sizes) + 30
    strip = Image.new("RGB", (strip_w, strip_h), PAGE_BG)
    sd = ImageDraw.Draw(strip)
    x = 18
    for s in sizes:
        strip.paste(on(fit(im, s), PAGE_BG, s, s), (x, 8))
        sd.text((x, s + 12), "%dpx" % s, font=font(15), fill=DIM)
        x += s + 18
    cell = Image.new("RGB", (max(top.width, strip.width), top.height + 8 + strip.height), SHEET_BG)
    cell.paste(top, ((cell.width - top.width) // 2, 0))
    cell.paste(strip, ((cell.width - strip.width) // 2, top.height + 8))
    return cell


def sheet_icons():
    groups = [("魔法指示物·火球", "fireball", [42, 51, 210]),
              ("队长·皇冠", "crown", [51, 72, 210]),
              ("查验权·护身符", "amulet", [51, 72, 210]),
              ("桌心·圣杯纹章", "table_emblem", [174])]
    cells = []
    for label, key, sizes in groups:
        for n in (1, 2, 3):
            cells.append(("%s  第%d张" % (label, n), icon_cell("%s_%d" % (key, n), sizes)))
    w = max(c.width for _, c in cells); h = max(c.height for _, c in cells)
    return grid(cells, 3, w, h,
                "界面图标 · 每类三选一",
                "上排放大看造型；下面一条是真机物理像素 1:1，验收看这条。底色是页面底 #121816")


# ---------- 桌子 ----------
CR = Image.open(ICO / "crown_2.png").convert("RGBA")
AM = Image.open(ICO / "amulet_3.png").convert("RGBA")
FI = Image.open(ICO / "fireball_2.png").convert("RGBA")
TOK, AV, BADGE = R(72), R(64), R(34)
P_TL, P_TR, P_BR = (R(-2), R(-9)), (TOK - BADGE - R(-2), R(-9)), (TOK - BADGE - R(-2), TOK - BADGE - R(-2))


# 角标是故意挂在头像框外面的（wxss 里 .seat-badge 和 .game-seat-token 都是
# overflow: visible），左上角标的偏移是负数、右下角标会超出右下边。
# 画布必须比 token 大一圈，否则角标会被画布切掉——皇冠没顶、护身符没底。
SEAT_PAD = BADGE


def seat(marks):
    side = TOK + SEAT_PAD * 2
    c = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    o = SEAT_PAD + (TOK - AV) // 2
    d.ellipse([o, o, o + AV, o + AV], fill=AV_BG, outline=AV_BD, width=R(3))
    for im, pos in marks:
        b = fit(im, BADGE)
        c.alpha_composite(b, (SEAT_PAD + pos[0] + (BADGE - b.width) // 2,
                              SEAT_PAD + pos[1] + (BADGE - b.height) // 2))
    return c


def stage_base(floor_key):
    return cover(Image.open(RAW / (floor_key + ".jpeg")).convert("RGBA"), *STAGE)


def emblem(st, key):
    e = fit(Image.open(ICO / (key + ".png")).convert("RGBA"), R(116))
    st.alpha_composite(e, (STAGE[0] // 2 - e.width // 2, STAGE[1] // 2 - e.height // 2))


def stage_round(key, floor_key="floor_2", emb="table_emblem_1"):
    st = stage_base(floor_key)
    t = fit(Image.open(SCE / (key + ".png")).convert("RGBA"), R(330))
    cx, cy = STAGE[0] // 2, STAGE[1] // 2
    st.alpha_composite(t, (cx - t.width // 2, cy - t.height // 2))
    emblem(st, emb)
    for i, m in enumerate([[(CR, P_TL)], [(AM, P_BR)], [(FI, P_TR)], [], [(AM, P_BR)], []]):
        a = -math.pi / 2 + i * math.pi / 3
        rad = R(330) // 2 + R(56)
        st.alpha_composite(seat(m), (cx + round(rad * math.cos(a)) - TOK // 2 - SEAT_PAD,
                                     cy + round(rad * math.sin(a) * .86) - TOK // 2 - SEAT_PAD))
    return st.convert("RGB")


def stage_long(key, wpct=68, hpct=28, floor_key="floor_2", emb="table_emblem_1"):
    st = stage_base(floor_key)
    src = Image.open(SCE / (key + ".png")).convert("RGBA")
    box = src.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    parts = s9.slice9(src.crop(box), 220)
    tw, th = round(STAGE[0] * wpct / 100), round(STAGE[1] * hpct / 100)
    t = s9.compose(parts, 220, R(36), tw, th, R(12))
    cx, cy = STAGE[0] // 2, STAGE[1] // 2
    st.alpha_composite(t, (cx - tw // 2, cy - th // 2))
    emblem(st, emb)
    for i in range(5):
        x = cx - tw // 2 + round(tw * (i + .5) / 5)
        st.alpha_composite(seat([(CR, P_TL)] if i == 0 else [(AM, P_BR)] if i == 2 else []),
                           (x - TOK // 2 - SEAT_PAD, cy - th // 2 - TOK - R(6) - SEAT_PAD))
        st.alpha_composite(seat([(FI, P_TR)] if i == 3 else []),
                           (x - TOK // 2 - SEAT_PAD, cy + th // 2 + R(6) - SEAT_PAD))
    return st.convert("RGB")


def sheet_tables(kind):
    keys = [("克制版 第%d张" % n, "table_%s_plain_%d" % (kind, n)) for n in (1, 2, 3)] + \
           [("华丽版 第%d张" % n, "table_%s_ornate_%d" % (kind, n)) for n in (1, 2, 3)]
    mk = stage_round if kind == "round" else stage_long
    cells = [(lab, fit(mk(k), 640)) for lab, k in keys]
    w = max(c.width for _, c in cells); h = max(c.height for _, c in cells)
    sub = ("圆桌固定 330×330rpx，整张出图" if kind == "round"
           else "切九宫格后按 68×28（最扁那档）合成，同一套切片覆盖全部 30 种比例")
    return grid(cells, 3, w, h, "%s · 六选一" % ("圆桌" if kind == "round" else "长桌"),
                sub + "。地面用 floor_2、纹章用 table_emblem_1，缩至 %d px 展示" % 640)


# ---------- 底纹 ----------
def sheet_bg():
    cells = []
    for n in (1, 2, 3):
        f = RAW / ("floor_%d.jpeg" % n)
        if f.exists():
            cells.append(("地面 floor_%d" % n, cover(Image.open(f).convert("RGB"), 460, 386)))
    for n in (1, 2, 3):
        f = RAW / ("home_bg_%d.jpeg" % n)
        if f.exists():
            cells.append(("首页 home_bg_%d" % n, cover(Image.open(f).convert("RGB"), 460, 386)))
    return grid(cells, 3, 460, 386, "地面与首页底纹 · 各三选一",
                "按容器比例 cover 裁切。地面垫在牌桌下，首页是浅色主题、和其余深色资产不同套")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, sheet in [("图标", sheet_icons()), ("圆桌", sheet_tables("round")),
                        ("长桌", sheet_tables("long")), ("底纹", sheet_bg())]:
        p = OUT / ("%s.png" % name)
        sheet.save(p)
        print("%-6s %s  %dx%d" % (name, p.relative_to(ROOT), *sheet.size))


if __name__ == "__main__":
    main()
