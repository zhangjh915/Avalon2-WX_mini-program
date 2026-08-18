"""把所有已定稿的资产拼成一张总览图，按真机显示尺寸缩放。

尺寸的取舍：
  任务牌在界面上只有 52x77pt，@3x 是 156x231 物理像素——小到可辨认性本身就是问题，
  所以按**真机 @3x 原尺寸**放，一比一，不缩放。
  身份牌是 330x440pt，@3x 990x1320，按原尺寸拼进来会让整张图大到没法看，
  而且身份牌够大、可辨认性不是问题，要看的是"整套像不像一套"，
  所以缩到 @1x（330x440），并在标题上写清倍率。

用法：
  python3 scripts/build-overview.py
"""
import pathlib
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
GEN = ROOT / "docs/assets/generated"
OUT = GEN / "_总览.jpg"

sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util as _ilu
_s = _ilu.spec_from_file_location("mk", ROOT / "scripts/make-contact.py")
mk = _ilu.module_from_spec(_s); _s.loader.exec_module(mk)

BG = (16, 16, 18)
FG = (235, 232, 226)
DIM = (140, 140, 134)
GOLD = (201, 169, 97)
PAD = 18
GAP = 12


def load(paths, w, h):
    out = []
    for p in paths:
        im = Image.open(p).convert("RGB").resize((w, h), Image.LANCZOS)
        out.append((p.stem, im))
    return out


def section(draw, y, title, note, width):
    draw.text((PAD, y), title, font=mk.load_font(34), fill=GOLD)
    draw.text((PAD, y + 44), note, font=mk.load_font(20), fill=DIM)
    draw.line((PAD, y + 76, width - PAD, y + 76), fill=(50, 50, 54))
    return y + 92


def grid(sheet, draw, items, x0, y0, cw, ch, cols, label=True):
    lab = 26 if label else 0
    for i, (name, im) in enumerate(items):
        r, c = divmod(i, cols)
        x = x0 + c * (cw + GAP)
        y = y0 + r * (ch + lab + GAP)
        sheet.paste(im, (x, y))
        if label:
            draw.text((x, y + ch + 4), name[:18], font=mk.load_font(17), fill=DIM)
    rows = (len(items) + cols - 1) // cols
    return y0 + rows * (ch + lab + GAP)


def main():
    # ── 收集 ──
    missions = []
    for skin in sorted((GEN / "任务牌-定稿").iterdir()):
        if skin.is_dir():
            for role in ("mission-back", "mission-success", "mission-fail"):
                f = skin / f"{role}.jpeg"
                if f.exists():
                    missions.append(f)

    skins = [("手绘", GEN / "角色插画/手绘-定稿"),
             ("幻想华服", GEN / "皮肤/幻想华服/_定稿"),
             ("木刻线刻", GEN / "皮肤/木刻线刻/_定稿")]
    skins = [(n, d) for n, d in skins if d.exists()]

    MW, MH = 156, 231          # 任务牌 @3x，真机原尺寸
    IW, IH = 330, 440          # 身份牌 @1x（真机 @3x 的三分之一）
    COLS_M, COLS_I = 12, 8
    width = PAD * 2 + COLS_I * IW + (COLS_I - 1) * GAP

    # ── 先算高度 ──
    h = PAD + 60
    h += 92 + ((len(missions) + COLS_M - 1) // COLS_M) * (MH + 26 + GAP) + 30
    for _, d in skins:
        n = len(list(d.glob("*.jpeg")))
        h += 92 + ((n + COLS_I - 1) // COLS_I) * (IH + 26 + GAP) + 30

    sheet = Image.new("RGB", (width, h), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((PAD, PAD), "《圆桌秘闻》已定稿资产总览", font=mk.load_font(40), fill=FG)

    y = PAD + 62
    y = section(draw, y, "任务牌 · 4 套皮肤 × 牌背/成功/失败",
                "真机 @3x 原尺寸 156×231，一比一没有缩放 —— 界面上就这么大", width)
    y = grid(sheet, draw, load(missions, MW, MH), PAD, y, MW, MH, COLS_M) + 30

    for name, d in skins:
        files = sorted(d.glob("*.jpeg"), key=lambda f: (not f.stem.startswith("identity"), f.stem))
        y = section(draw, y, f"身份牌 · {name}（{len(files)} 张）",
                    "缩到真机 @3x 的三分之一 —— 实际显示比这大 3 倍，"
                    "身份牌够大所以看的是整套统不统一", width)
        y = grid(sheet, draw, load(files, IW, IH), PAD, y, IW, IH, COLS_I) + 30

    sheet = sheet.crop((0, 0, width, min(y + PAD, h)))
    sheet.save(OUT, quality=88, optimize=True)
    mb = OUT.stat().st_size / 1024 / 1024
    print(f"已写出 {OUT.relative_to(ROOT)}  {sheet.size[0]}×{sheet.size[1]}  {mb:.1f} MB")
    return OUT


if __name__ == "__main__":
    main()
