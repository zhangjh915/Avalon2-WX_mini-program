"""把木刻卡的套色统一改成阵营色。

为什么这次后期改色是安全的（上次校色毁图的教训还在）：
  上次用的是**逐通道乘性**，系数 = 目标/实测，扁平底色的红通道接近 0，
  系数爆成天文数字，噪点被放大成橙色斑块。
  这次是**只改色相、不动明度和饱和度**——HSV 里只写 H，S/V 原样保留，
  数学上不可能放大任何东西。而且木刻图本来就是「黑白 + 单一套色」，
  有彩度的像素只有套色那一处，改起来目标明确。

  但仍然：改完必须看图。指标能证伪不能证真。
"""
import colorsys
import pathlib
import sys

from PIL import Image

# 阵营色的色相（HSV 的 H，0–1）
HUE = {"good": 220 / 360.0,   # 靛蓝
       "evil": 355 / 360.0}   # 暗红
SAT_MIN = 0.18                # 低于这个饱和度算黑白排线，不动


def recolor(src, dst, faction):
    im = Image.open(src).convert("RGB")
    h_target = HUE[faction]
    px = list(im.getdata())
    out, touched = [], 0
    for r, g, b in px:
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if s < SAT_MIN:
            out.append((r, g, b))          # 黑白部分原样不动
            continue
        touched += 1
        nr, ng, nb = colorsys.hsv_to_rgb(h_target, s, v)   # 只换色相
        out.append((round(nr * 255), round(ng * 255), round(nb * 255)))
    new = Image.new("RGB", im.size)
    new.putdata(out)
    new.save(dst, quality=95)
    return touched / len(px)


if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from prompts import ROSTER
    src_dir = pathlib.Path(sys.argv[1])
    dst_dir = pathlib.Path(sys.argv[2])
    dst_dir.mkdir(parents=True, exist_ok=True)
    for f in sorted(src_dir.glob("*.jpeg")):
        key = f.stem.split("_")[0]
        if key not in ROSTER:
            continue
        ratio = recolor(f, dst_dir / f.name, ROSTER[key]["faction"])
        print("%-22s %s  改动像素 %.1f%%" % (f.name, ROSTER[key]["faction"], ratio * 100))
