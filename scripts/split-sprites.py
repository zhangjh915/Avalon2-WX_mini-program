"""把一张拼版图按连通域切成若干独立的透明 PNG。

为什么不按格子等分：模型不会把四枚摆得严丝合缝，格子边界稍有偏差就会切到徽记。
改成找连通域——每一枚徽记是一块和背景不连通的区域，边界由内容自己决定。

前提和 cut-glow.py 的 flood 模式一样：背景是贴着画面边缘的近黑连通区域，
物体不接触画面边缘。徽记之间必须留出足够背景，否则会被判成同一块。

用法：
  python3 scripts/split-sprites.py <图> --out <目录> --names 待打,当前轮,成功,失败
  python3 scripts/split-sprites.py <图> --out <目录> --expect 4        # 只切不命名
"""

import argparse
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

# 低于这个 max 通道值才算候选背景。和 cut-glow.py 的 FLOOD_T 同源。
FLOOD_T = 32
# 面积小于整图这个比例的连通块当噪点丢掉（JPEG 在纯黑区域会有零星亮点）
MIN_AREA_FRAC = 0.002
# 分组用的膨胀半径，按图宽的比例。由分离笔画构成的徽记（放射星芒、断开的圆环）
# 每一笔都是独立连通块，直接按连通域切会切成一地碎片；
# 先把 mask 膨胀这么多让同一枚徽记的笔画连起来，用膨胀后的连通域**分组**，
# 但导出时仍用原始未膨胀的 alpha，所以形状不受影响。
# 取值要大于笔画间距、小于徽记间距——提示词里那句「彼此之间留出宽阔背景」就是为这个。
MERGE_FRAC = 0.02


def masks(path, merge_frac=MERGE_FRAC):
    """-> (rgb, 分组标号图, 组号列表)。分组用膨胀后的连通域，alpha 用原始的。"""
    rgb = np.asarray(Image.open(path).convert("RGB"), np.float32) / 255.0
    t = rgb.max(axis=2) * 255.0
    lab, _ = ndimage.label(t < FLOOD_T)
    edge = np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    outside = np.isin(lab, [v for v in np.unique(edge) if v])
    fg = ~outside

    r = max(1, round(min(rgb.shape[:2]) * merge_frac))
    grown = ndimage.binary_dilation(fg, ndimage.generate_binary_structure(2, 2),
                                    iterations=r) if merge_frac > 0 else fg
    grp, n = ndimage.label(grown)
    grp = grp * fg                      # 分组标号只保留在真实像素上，膨胀出来的边不要
    keep = [i for i in range(1, n + 1)
            if (grp == i).sum() >= MIN_AREA_FRAC * grp.size]
    return rgb, grp, keep


def order_rowmajor(slices):
    """按「先上下、再左右」排序，和提示词里的左上/右上/左下/右下对上。

    不能只按 y 排——同一行两枚的 y 会差几十像素。先按行高聚类，再行内按 x 排。
    """
    ys = [(s[0].start + s[0].stop) / 2 for s in slices]
    hs = [s[0].stop - s[0].start for s in slices]
    tol = max(hs) * 0.5
    rows, used = [], set()
    for i in sorted(range(len(slices)), key=lambda i: ys[i]):
        if i in used:
            continue
        row = [j for j in range(len(slices)) if j not in used and abs(ys[j] - ys[i]) < tol]
        used |= set(row)
        rows.append(sorted(row, key=lambda j: (slices[j][1].start + slices[j][1].stop) / 2))
    return [i for row in rows for i in row]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", required=True)
    ap.add_argument("--names", default="", help="逗号分隔，按 左上,右上,左下,右下 的顺序")
    ap.add_argument("--expect", type=int, default=0, help="期望切出几块，对不上就报错")
    ap.add_argument("--drop-dark", type=float, default=0,
                    help="把徽记**内部**接近纯黑的区域也透掉（阈值 = max 通道值，如 45）。"
                         "被轮廓线圈住的黑色纹章底不属于背景，连通域抠不掉，"
                         "但它是不透明近黑，贴到深色界面上会留一小片更深的斑。0 = 保留")
    ap.add_argument("--merge", type=float, default=MERGE_FRAC,
                    help="分组膨胀半径占图宽的比例。徽记由分离笔画组成时调大，"
                         "两枚徽记挨太近时调小。0 = 不合并")
    args = ap.parse_args()

    src = pathlib.Path(args.image)
    rgb, obj, keep = masks(src, args.merge)
    slices = ndimage.find_objects(obj)
    boxes = [slices[i - 1] for i in keep]
    print("%s 切出 %d 块" % (src.name, len(boxes)))
    if args.expect and len(boxes) != args.expect:
        raise SystemExit(
            "期望 %d 块，实际 %d 块。多了就调大 --merge（同一枚徽记的笔画没连上），"
            "少了就调小（两枚徽记被连成了一块）。当前 --merge %.3f"
            % (args.expect, len(boxes), args.merge))

    names = [s for s in args.names.split(",") if s] if args.names else []
    outdir = pathlib.Path(args.out); outdir.mkdir(parents=True, exist_ok=True)
    for slot, idx in enumerate(order_rowmajor(boxes)):
        sl, comp = boxes[idx], keep[idx]
        # alpha 只取这一块的连通域，避免把邻近徽记的边角带进来。
        # 轻微高斯再重映射，得到一两像素宽的抗锯齿边（只动 alpha，不动颜色）
        m = (obj[sl] == comp).astype(np.float32)
        a = np.clip((ndimage.gaussian_filter(m, 0.8) - 0.35) / 0.3, 0, 1)
        if args.drop_dark > 0:
            # 只按亮度判定，不看连通性——内部黑底和外部黑底是同一个颜色，
            # 区别只在连通性，而这里恰恰是要连内部的一起透掉
            t = rgb[sl].max(axis=2) * 255.0
            a = a * np.clip((t - args.drop_dark * 0.6) / (args.drop_dark * 0.4), 0, 1)
        out = np.concatenate([rgb[sl], a[..., None]], axis=2)
        im = Image.fromarray((out * 255).round().astype(np.uint8), "RGBA")
        name = names[slot] if slot < len(names) else "%s_%d" % (src.stem, slot + 1)
        p = outdir / ("%s.png" % name)
        im.save(p)
        print("  %-10s %dx%d  -> %s" % (name, im.width, im.height, p.name))


if __name__ == "__main__":
    main()
