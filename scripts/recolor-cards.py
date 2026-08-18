"""【已废弃，别用】把定稿卡牌的底色校到目标值。

⚠️ 这个做法在近饱和底色上会毁图，实测已确认，脚本保留只作为记录。

失败原因：逐通道乘性校正的系数是 目标/实测。扁平烫金的底色是 #00652b、#025129
这种**红通道接近 0** 的近饱和色，系数就成了 0x1b/0，是个天文数字，
底色里任何一点 JPEG 噪点的红分量都被放大成橙色斑块。
实物皮革那两套没坏，因为三个通道都不接近 0——而它们本来就不需要校色。

更坑的是数值检查完全没抓到：当时只测了「主体金的 97 分位亮度」和「@3x 对比差」，
两个指标都只看主体和边缘，**底色里长出来的彩色噪点不在测量范围内**，
于是报出「最差 主体金 -1、对比差 -14」这种看着很安全的结论。
证据见 `docs/assets/generated/任务牌-定稿/_校色前后对比.png`。

教训有两条：
  1. 色彩变换不要用逐通道乘性，通道接近 0 时会爆。要压饱和度就在 HSV 里
     只缩 S、不动 H 和 V，这样不可能出现通道爆炸。
  2. **改完图必须看图。** 只测主体的指标测不出背景的损坏。

以下是原始实现，保留备查。

──────────────────────────────────────────────────────────

把定稿卡牌的底色校到目标值，同时保住主体的金不被改暗。

为什么要后期校色而不是重抽：
  底色偏亮和饱和度过高是**全局色彩问题**，重抽会连构图一起重掷，
  可能丢掉已经选中的那一版。校色是确定性的，改完能量出来对不对。

为什么能改：
  实测「板岩蓝灰」被模型理解成偏亮的钢蓝（目标 #1e2a33，实际最远跑到 #607381），
  扁平烫金的底色饱和度写了具体色值也压不到（88–100%）。
  这两件事都只跟底色有关，跟主体无关。

怎么改：
  按亮度做遮罩——暗部是底色，亮部是主体的金。
  只对暗部做**乘性**校正（factor = 目标/实测，逐通道），亮部原样不动。
  乘性而不是加性，是为了保住底色纹理的明暗比例，不把暗处压死成纯黑。

用法：
  python3 scripts/recolor-cards.py            # 预演，只打表不写文件
  python3 scripts/recolor-cards.py --apply    # 真正写出 *_校色.jpeg
"""

import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/任务牌-定稿"

TARGET = {
    "mission-back":    (0x1e, 0x2a, 0x33),   # 板岩蓝灰
    "mission-success": (0x1b, 0x49, 0x36),   # 深翠绿
    "mission-fail":    (0x24, 0x10, 0x12),   # 极暗红褐
}


def base_color(im):
    """取画面中上部一小块当底色采样：那里一定是背景，不会撞上主体。"""
    W, H = im.size
    px = list(im.crop((int(W * .40), int(H * .09), int(W * .60), int(H * .16))).getdata())
    return tuple(sum(c[i] for c in px) / len(px) for i in range(3))


def stats(im):
    r, g, b = base_color(im)
    mx, mn = max(r, g, b), min(r, g, b)
    return ("#%02x%02x%02x" % (round(r), round(g), round(b)),
            round((mx - mn) / max(mx, 1) * 100))


def recolor(im, target):
    src = base_color(im)
    # 逐通道乘性系数：底色乘上它正好落到目标
    factor = [target[i] / max(src[i], 1e-6) for i in range(3)]

    gray = im.convert("L")
    lum = list(gray.getdata())
    lum_sorted = sorted(lum)
    gold = lum_sorted[int(len(lum_sorted) * .97)]        # 主体的金有多亮
    bg = sum(src) / 3                                     # 底色多亮
    span = max(gold - bg, 1.0)

    px = list(im.convert("RGB").getdata())
    out = []
    for (r, g, b), L in zip(px, lum):
        # 遮罩：底色亮度处为 1，主体亮度处为 0，中间平滑过渡
        t = (gold - L) / span
        m = 0.0 if t <= 0 else (1.0 if t >= 1 else t)
        m = m * m * (3 - 2 * m)                           # smoothstep，避免出现硬边
        out.append((
            min(255, round(r * (1 + m * (factor[0] - 1)))),
            min(255, round(g * (1 + m * (factor[1] - 1)))),
            min(255, round(b * (1 + m * (factor[2] - 1)))),
        ))
    new = Image.new("RGB", im.size)
    new.putdata(out)
    return new


def main():
    apply = "--apply" in sys.argv
    if apply and "--i-know-it-breaks" not in sys.argv:
        sys.exit("这个脚本已废弃：逐通道乘性校正会在近饱和底色上产生橙色噪点，"
                 "实测毁掉了两套扁平皮肤。见文件头说明。")
    print("模式：" + ("写出文件" if apply else "预演（不写文件，加 --apply 才写）"))
    print(f"\n{'皮肤/卡面':<26}{'校色前':>10}{'饱和':>6}{'校色后':>10}{'饱和':>6}{'目标':>10}")

    for skin in sorted(p for p in BASE.iterdir() if p.is_dir()):
        for role, tgt in TARGET.items():
            f = skin / f"{role}.jpeg"
            if not f.exists():
                continue
            im = Image.open(f).convert("RGB")
            before = stats(im)
            fixed = recolor(im, tgt)
            after = stats(fixed)
            if apply:
                fixed.save(skin / f"{role}_校色.jpeg", quality=94)
            print(f"{skin.name + '/' + role:<26}{before[0]:>10}{before[1]:>5}%"
                  f"{after[0]:>10}{after[1]:>5}%{'#%02x%02x%02x' % tgt:>10}")

    if apply:
        print(f"\n已写出 *_校色.jpeg，原图保留未动")


if __name__ == "__main__":
    main()
