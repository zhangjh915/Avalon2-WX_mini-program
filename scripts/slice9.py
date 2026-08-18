"""把一张带完整边框的整图切成九宫格，并渲染出任意长宽比下的合成效果。

为什么需要：.long-table 的长宽比由玩家的座位布局决定，归并 90° 旋转后有 30 种，
真实像素比从 1.19 排到 2.89（见 docs/assets/prompts/界面/场景.toml 的 note）。
整张图直接拉伸会把桌沿和铆钉抻变形，九宫格则让每一块只在单一方向上变化。

  四角  固定像素，永不缩放
  上下边 只沿水平方向平铺
  左右边 只沿垂直方向平铺
  中心  cover 裁切

**边条必须镜像拼贴**：生成图的边缘不可能天然无缝，直接 repeat 会露出接缝。
取一段边条、水平镜像后接上，得到的两倍宽图块按构造必然无缝——
左半的右端和右半的左端是同一列像素，右半的右端又和下一次重复的左端相同。

用法：
  python3 scripts/slice9.py <图> --out <目录> --inset 90 [--preview 2.89 --preview 1.19]
"""

import argparse
import pathlib

from PIL import Image
import numpy as np

# 切角尺寸的下限：.long-table 的 border-radius 是 32rpx = 16pt = 48px @3x，
# 切角必须完整包住圆角，否则圆角会被边条的平铺切断
MIN_INSET = 60


def alpha_bbox(im):
    a = im.getchannel("A").point(lambda v: 255 if v > 8 else 0)
    return a.getbbox()


def slice9(im, inset):
    """-> dict，九块。im 必须已经裁到物体的最小外接框。"""
    w, h = im.size
    if inset * 2 >= min(w, h):
        raise ValueError("inset %d 太大，图只有 %dx%d" % (inset, w, h))
    L, T, R, B = inset, inset, w - inset, h - inset
    return {
        "corner_tl": im.crop((0, 0, L, T)),
        "corner_tr": im.crop((R, 0, w, T)),
        "corner_bl": im.crop((0, B, L, h)),
        "corner_br": im.crop((R, B, w, h)),
        "edge_top": im.crop((L, 0, R, T)),
        "edge_bottom": im.crop((L, B, R, h)),
        "edge_left": im.crop((0, T, L, B)),
        "edge_right": im.crop((R, T, w, B)),
        "center": im.crop((L, T, R, B)),
    }


def mirror_tile(strip, axis):
    """把边条镜像拼成两倍，得到按构造无缝的平铺单元。axis: 'x' 或 'y'。"""
    flip = strip.transpose(Image.FLIP_LEFT_RIGHT if axis == "x"
                           else Image.FLIP_TOP_BOTTOM)
    if axis == "x":
        out = Image.new("RGBA", (strip.width * 2, strip.height))
        out.paste(strip, (0, 0)); out.paste(flip, (strip.width, 0))
    else:
        out = Image.new("RGBA", (strip.width, strip.height * 2))
        out.paste(strip, (0, 0)); out.paste(flip, (0, strip.height))
    return out


def tile_to(strip, w, h, axis):
    """把（已镜像的）边条平铺满 w x h，只沿 axis 方向重复，另一轴保持原始像素。"""
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if axis == "x":
        for x in range(0, w, strip.width):
            out.alpha_composite(strip.crop((0, 0, min(strip.width, w - x), h)), (x, 0))
    else:
        for y in range(0, h, strip.height):
            out.alpha_composite(strip.crop((0, 0, w, min(strip.height, h - y))), (0, y))
    return out


def fade_inward(im, f, side):
    """把边条**朝内的那一侧** f 像素做成 alpha 渐隐。

    不做这一步，边条的内边界和中心是一刀切，而源图自身有轻微的光照梯度，
    两边木纹亮度对不上就会露出一道台阶。渐隐后中心的木纹从边条底下渐渐透出来，
    台阶被抹平。只动 alpha，不动颜色。
    """
    if f <= 0:
        return im
    a = np.asarray(im.getchannel("A"), np.float32) / 255.0
    w, h = im.size
    ramp = np.clip(np.arange(f, dtype=np.float32) / f, 0, 1)
    if side == "top":            # 内侧是下边
        a[h - f:, :] *= ramp[::-1, None]
    elif side == "bottom":       # 内侧是上边
        a[:f, :] *= ramp[:, None]
    elif side == "left":         # 内侧是右边
        a[:, w - f:] *= ramp[::-1][None, :]
    else:                        # right，内侧是左边
        a[:, :f] *= ramp[None, :]
    out = im.copy()
    out.putalpha(Image.fromarray((a * 255).round().astype(np.uint8), "L"))
    return out


def cover(im, w, h):
    """保持比例缩放到刚好盖满 w x h，居中裁切。只丢边，不变形。"""
    k = max(w / im.width, h / im.height)
    r = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))),
                  Image.LANCZOS)
    return r.crop(((r.width - w) // 2, (r.height - h) // 2,
                   (r.width - w) // 2 + w, (r.height - h) // 2 + h))


def compose(parts, inset_src, inset_out, w, h, feather=0):
    """按目标尺寸合成，模拟落地时多重 background 的效果。

    切片尺寸（源图像素）和渲染尺寸（落地物理像素）是两回事：源图上切 220px 的角，
    渲染到 630px 宽的桌子上时这个角只占几十像素。inset_out 就是 CSS 里
    background-size 给角指定的那个值，固定不变——这正是九宫格的意义：
    桌子再大再小，包边的粗细都一样。
    """
    if w < inset_out * 2 or h < inset_out * 2:
        raise ValueError("目标 %dx%d 装不下两个 %dpx 的角" % (w, h, inset_out))
    k = inset_out / inset_src
    sc = lambda im: im.resize((max(1, round(im.width * k)),
                               max(1, round(im.height * k))), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # 中心向四周多铺 feather 像素，垫在边条底下，供渐隐时透出来
    e = min(feather, inset_out)
    cw, ch = w - inset_out * 2, h - inset_out * 2
    out.alpha_composite(cover(parts["center"], cw + e * 2, ch + e * 2),
                        (inset_out - e, inset_out - e))
    for name, side, pos, size, axis in [
            ("edge_top", "top", (inset_out, 0), (cw, inset_out), "x"),
            ("edge_bottom", "bottom", (inset_out, h - inset_out), (cw, inset_out), "x"),
            ("edge_left", "left", (0, inset_out), (inset_out, ch), "y"),
            ("edge_right", "right", (w - inset_out, inset_out), (inset_out, ch), "y")]:
        strip = tile_to(sc(mirror_tile(parts[name], axis)), size[0], size[1], axis)
        out.alpha_composite(fade_inward(strip, e, side), pos)
    for key, pos in [("corner_tl", (0, 0)), ("corner_tr", (w - inset_out, 0)),
                     ("corner_bl", (0, h - inset_out)),
                     ("corner_br", (w - inset_out, h - inset_out))]:
        out.alpha_composite(sc(parts[key]), pos)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--inset", type=int, default=90)
    ap.add_argument("--preview", action="append", default=[], type=float,
                    help="要预览的长宽比，可重复；默认覆盖 1.19 / 1.9 / 2.89")
    ap.add_argument("--preview-h", type=int, default=300, help="预览图的高（物理像素）")
    ap.add_argument("--render-inset", type=int, default=54,
                    help="落地时切角渲染成多少物理像素（= CSS 给角的 background-size）")
    ap.add_argument("--feather", type=int, default=18,
                    help="边条内侧的渐隐宽度（物理像素），抹平边条与中心的木纹台阶")
    args = ap.parse_args()

    if args.inset < MIN_INSET:
        raise SystemExit("inset 至少要 %d，否则包不住 48px 的圆角" % MIN_INSET)

    src = Image.open(args.image).convert("RGBA")
    if src.getchannel("A").getextrema()[0] == 255:
        raise SystemExit("这张图没有透明通道，先用 scripts/cut-glow.py 抠出来")
    box = alpha_bbox(src)
    src = src.crop(box)
    print("裁到外接框 %dx%d" % src.size)

    outdir = pathlib.Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    parts = slice9(src, args.inset)
    for name, im in parts.items():
        if name.startswith("edge_"):
            im = mirror_tile(im, "x" if name in ("edge_top", "edge_bottom") else "y")
        im.save(outdir / ("%s.png" % name))
        print("  %-12s %dx%d" % (name, *im.size))

    ratios = args.preview or [1.19, 1.9, 2.89]
    H = args.preview_h
    tiles = [(r, compose(parts, args.inset, args.render_inset, round(H * r), H,
                         args.feather)) for r in ratios]
    pad = 20
    sheet = Image.new("RGB",
                      (pad + max(t.width for _, t in tiles) + pad,
                       pad + sum(t.height + pad for _, t in tiles)),
                      (216, 212, 202))          # .compact-table-stage 的底色
    y = pad
    for r, t in tiles:
        sheet.paste(Image.alpha_composite(
            Image.new("RGBA", t.size, (216, 212, 202, 255)), t).convert("RGB"), (pad, y))
        y += t.height + pad
    p = outdir / "_九宫格预览.png"
    sheet.save(p)
    print("预览（比例 %s ｜ 切角渲染 %dpx）写到 %s  %dx%d" % (
        "、".join("%.2f" % r for r in ratios), args.render_inset, p, *sheet.size))


if __name__ == "__main__":
    main()
