"""把「近黑底上的发光物体」抠成带透明通道的 PNG，并出一张真实尺寸校验图。

为什么能这么抠：接口只出 JPEG 没有 alpha，但发光物体拍在近黑底上，
这张图本身就等价于一张**预乘 alpha**的图——亮度到哪里，不透明度就到哪里。
所以 alpha = 亮度，柔和的外发光边缘会被完整保留，
不像色度键（chroma key）那样要么留一圈绿边、要么把光晕啃掉。

一个必须绕开的坑（手册 5.4）：从预乘转直通 alpha 要做 RGB / alpha 这个除法，
而 alpha 趋近 0 时除法会爆，正是「逐通道乘性校正毁掉两套扁平皮肤」那个坑的同款。
这里把除数钳在 FLOOR 以上——代价是最淡的那圈外发光会略微偏暗，
而落地背景本来就是近黑（#121816 / #202b27），这点偏差看不出来。

用法：
  python3 scripts/cut-glow.py <图片…> --out <输出目录>
  python3 scripts/cut-glow.py <图片…> --out <目录> --check 14x14 --check 17x17 --check 70x70
"""

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont
import numpy as np

# alpha 低于这个值就不再做反预乘除法，避免除数趋零把噪点放大成彩斑
FLOOR = 0.25
# hard 模式的边界带：max 通道低于 LO 判为背景，高于 HI 判为不透明物体，
# 中间线性过渡。实测三张火球的背景 99 分位都 ≤14、物体都 ≥90，
# 落在 20-90 之间的只有 0.25%-0.66%，就是那一两像素宽的抗锯齿边。
HARD_LO, HARD_HI = 18, 70

# 落地时图标真正会贴在上面的两种底色
BGS = [("页面底 #121816", (18, 24, 22)), ("头像底 #202b27", (32, 43, 39))]

FONTS = ["/System/Library/Fonts/PingFang.ttc",
         "/System/Library/Fonts/Hiragino Sans GB.ttc"]


def load_font(size):
    for p in FONTS:
        if pathlib.Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def cut(path, mode="hard"):
    """近黑底上的物体 -> RGBA 图，已按内容裁到最小外接框。

    hard（默认，适合平涂图标）
        alpha 只在 HARD_LO..HARD_HI 这条窄带上过渡，物体内部一律全不透明。
        暗色部位（比如火球最外圈的暗红）会被当成**不透明的暗色**而不是半透明，
        所以贴到任何底色上都成立。

    lum（适合真正的发光体，比如光晕、烛焰）
        alpha = 亮度，把整张图当预乘 alpha 用。柔和的外发光会被完整保留，
        但**暗色部位会被判成半透明**——只在深色底上成立，贴到浅底会发虚。
    """
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    if mode == "hard":
        t = rgb.max(axis=2) * 255.0
        alpha = np.clip((t - HARD_LO) / (HARD_HI - HARD_LO), 0, 1)
    else:
        # 亮度用感知权重，不是三通道平均：火焰的红比蓝亮得多，平均会低估边缘。
        # 再取三通道最大值兜底，否则红边会被削掉。
        lum = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
        alpha = np.clip(np.maximum(lum, rgb.max(axis=2) * 0.85), 0, 1)

    # 反预乘：边界带上的像素颜色是和黑底混过的，不还原会留一圈暗边。
    # 除数钳在 FLOOR 以上——alpha 趋零时的除法正是手册 5.4 那个「系数爆成
    # 天文数字、把 JPEG 噪点放大成彩斑」的坑，钳住就不会爆。
    straight = np.clip(rgb / np.maximum(alpha, FLOOR)[..., None], 0, 1)

    out = np.concatenate([straight, alpha[..., None]], axis=2)
    im = Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop(box) if box else im


def check_sheet(cuts, sizes, dprs, out_path):
    """真实尺寸校验图：按 逻辑点 × DPR 渲染，贴到真实底色上，渲染完不做任何放大。"""
    font, small = load_font(20), load_font(17)
    pad, head, gap = 24, 30, 8

    variants = [(w, h, d, name, bg)
                for (w, h) in sizes for d in dprs for (name, bg) in BGS]
    # 列宽要同时容得下最大的一张图和最长的一行标签，否则相邻列的文字会叠在一起
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    labels = [n for n, _ in cuts] + [
        "%dpt @%dx = %dpx ｜ %s" % (w, d, w * d, bn)
        for (w, _, d, bn, _) in variants]
    col_w = max(max(w * d for (w, _, d, _, _) in variants),
                round(max(probe.textlength(t, font=font) for t in labels)) + 12)

    width = pad + len(cuts) * (col_w + pad)
    height = pad + head + sum(h * d + gap + head for (_, h, d, _, _) in variants) + pad
    sheet = Image.new("RGB", (width, height), (10, 12, 11))
    draw = ImageDraw.Draw(sheet)

    for i, (name, im) in enumerate(cuts):
        x = pad + i * (col_w + pad)
        draw.text((x, pad), name, font=font, fill=(210, 210, 210))
        y = pad + head
        for (w, h, d, bgname, bg) in variants:
            tw, th = w * d, h * d
            # 等比缩放塞进 tw x th 的框，不拉伸——火焰是竖长条，
            # 按正方形硬缩会压扁，那是脚本造出来的失真，不是资产的问题
            k = min(tw / im.width, th / im.height)
            fw, fh = max(1, round(im.width * k)), max(1, round(im.height * k))
            tile = Image.new("RGBA", (tw, th), bg + (255,))
            tile.alpha_composite(im.resize((fw, fh), Image.LANCZOS),
                                 ((tw - fw) // 2, (th - fh) // 2))
            sheet.paste(tile.convert("RGB"), (x + (col_w - tw) // 2, y))
            y += th + 4
            draw.text((x, y), "%dpt @%dx = %dpx ｜ %s" % (w, d, tw, bgname),
                      font=small, fill=(115, 125, 120))
            y += head + gap - 4
    sheet.save(out_path)
    print("已写出 %s  %dx%d" % (out_path, *sheet.size))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--check", action="append", default=[],
                    help="界面上的逻辑尺寸（pt），形如 17x17，可重复")
    ap.add_argument("--dpr", action="append", default=[], type=int)
    ap.add_argument("--mode", choices=["hard", "lum"], default="hard",
                    help="hard=平涂图标（默认，任何底色都成立）｜lum=发光体（只在深色底成立）")
    args = ap.parse_args()

    files = []
    for raw in args.inputs:
        p = pathlib.Path(raw)
        files += sorted(q for q in p.iterdir()
                        if q.suffix.lower() in {".jpeg", ".jpg", ".png"}
                        and not q.name.startswith("_")) if p.is_dir() else [p]
    if not files:
        sys.exit("没有找到任何图片")

    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    cuts = []
    for f in files:
        im = cut(f, args.mode)
        target = outdir / (f.stem + ".png")
        im.save(target)
        print("抠好 %s  %dx%d" % (target.name, *im.size))
        cuts.append((f.stem, im))

    sizes = [tuple(int(n) for n in s.lower().split("x")) for s in args.check] \
        or [(17, 17), (70, 70)]
    check_sheet(cuts, sizes, args.dpr or [2, 3], outdir / "_真实尺寸校验.png")


if __name__ == "__main__":
    main()
