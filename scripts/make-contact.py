"""把一批候选图拼成对比图，供挑选定稿。

生成两种图，各回答一个不同的问题：
  全尺寸拼版  这版风格对不对（看质感、构图、有没有白角）
  真实尺寸图  缩到界面上的实际大小还认不认得出（这才是验收标准）

用法：
  python3 scripts/make-contact.py <目录或图片…> --out <输出前缀> [--actual 52x77] [--cols 3]

例：
  python3 scripts/make-contact.py docs/assets/generated/任务牌背/A-扁平烫金 \
      --out docs/assets/generated/任务牌背/_对比图/A --actual 52x77 --actual 104x154

--actual 可重复，按顺序从小到大排。不传则用任务牌的 52x77 和 104x154。
"""

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

# 界面背景色，对比图必须铺这个色——在白底上看深色卡面会严重高估可辨认性
BG = (20, 28, 24)
FG = (200, 200, 200)

FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def collect(inputs):
    files = []
    for raw in inputs:
        p = pathlib.Path(raw)
        if p.is_dir():
            files += sorted(
                q for q in p.iterdir()
                if q.suffix.lower() in {".jpeg", ".jpg", ".png"}
                and not q.name.startswith("_")
            )
        elif p.is_file():
            files.append(p)
        else:
            print("找不到：" + raw, file=sys.stderr)
    return files


def contact_sheet(files, cols, cell_w, out_path):
    """全尺寸拼版：每张缩到统一宽度并排，下方标文件名。"""
    font = load_font(26)
    thumbs = []
    for f in files:
        im = Image.open(f).convert("RGB")
        h = round(im.height * cell_w / im.width)
        thumbs.append((f.stem, im.resize((cell_w, h), Image.LANCZOS)))

    cell_h = max(t.height for _, t in thumbs)
    label_h = 40
    rows = (len(thumbs) + cols - 1) // cols
    pad = 16
    sheet = Image.new(
        "RGB",
        (cols * cell_w + (cols + 1) * pad,
         rows * (cell_h + label_h) + (rows + 1) * pad),
        BG,
    )
    draw = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(thumbs):
        r, c = divmod(i, cols)
        x = pad + c * (cell_w + pad)
        y = pad + r * (cell_h + label_h + pad)
        sheet.paste(im, (x, y))
        draw.text((x, y + cell_h + 8), name, font=font, fill=FG)
    sheet.save(out_path)
    print("已写出 " + str(out_path) + "  " + "x".join(map(str, sheet.size)))


def actual_size_sheet(files, sizes, dprs, out_path):
    """真实尺寸图：按真机实际点亮的物理像素渲染，1:1 贴上，不做任何放大。

    两个必须搞清楚的坑：

    1. wxss 里的 rpx 和文档里的 "52x77px" 都是**逻辑点**，不是物理像素。
       750rpx = 屏宽，所以 104rpx 在 375pt 宽的屏上是 52pt。真机上这 52pt
       会被渲染成 52 x DPR 个物理像素：DPR2 是 104，DPR3 是 156。
       按 52 去缩图等于模拟一台不存在的非 Retina 手机，比真机严苛一倍。

    2. 缩完不要再放大。之前用最近邻放大 2 倍"方便看"，结果是凭空制造出
       真机上不存在的块状模糊，把资产判得比实际差。

    代价是这张图在 Retina 显示器上按 100% 看会比真机显得大约两倍大
    （1 图像素 = 1 点 = 2 物理像素），但**细节含量是准的**，不多不少。
    判断"缩小后还认不认得出"看的就是细节含量。
    """
    font = load_font(22)
    label_h = 34
    pad = 26

    variants = [(w, h, d) for (w, h) in sizes for d in dprs]
    # 列宽要同时容得下最大的一张图和最长的一行标签，否则相邻列的文字会叠在一起
    def text_w(s):
        return draw_probe.textlength(s, font=font)
    probe = Image.new("RGB", (1, 1))
    draw_probe = ImageDraw.Draw(probe)
    labels = [f.stem for f in files] + [
        "{}x{}pt @{}x = {}x{}".format(w, h, d, w * d, h * d) for (w, h, d) in variants]
    col_w = max(max(w * d for (w, _, d) in variants),
                round(max(text_w(s) for s in labels)) + 12)

    width = pad + len(files) * (col_w + pad)
    height = (pad + label_h
              + sum(h * d + 6 + label_h + pad for (_, h, d) in variants) + pad)
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)

    sources = {f: Image.open(f).convert("RGB") for f in files}
    for i, f in enumerate(files):
        x = pad + i * (col_w + pad)
        draw.text((x, pad), f.stem, font=font, fill=FG)
        y = pad + label_h
        for (w, h, d) in variants:
            shown = sources[f].resize((w * d, h * d), Image.LANCZOS)
            sheet.paste(shown, (x + (col_w - w * d) // 2, y))
            y += h * d + 6
            draw.text((x, y), "{}x{}pt @{}x = {}x{}".format(w, h, d, w * d, h * d),
                      font=font, fill=(120, 130, 125))
            y += label_h + pad
    sheet.save(out_path)
    print("已写出 " + str(out_path) + "  " + "x".join(map(str, sheet.size)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", help="图片文件或目录")
    ap.add_argument("--out", required=True, help="输出路径前缀")
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--cell", type=int, default=560, help="全尺寸拼版里每张的宽度")
    ap.add_argument("--actual", action="append", default=[],
                    help="界面上的逻辑尺寸（pt），形如 52x77，可重复")
    ap.add_argument("--dpr", action="append", default=[], type=int,
                    help="设备像素比，可重复；默认 2 和 3（覆盖主流 iPhone）")
    args = ap.parse_args()

    files = collect(args.inputs)
    if not files:
        sys.exit("没有找到任何图片")
    print("共 {} 张：{}".format(len(files), ", ".join(f.stem for f in files)))

    # 默认就是任务牌：wxss 里 .mission-result-card 是 104x154rpx = 52x77pt
    sizes = [tuple(int(n) for n in s.lower().split("x")) for s in args.actual] \
        or [(52, 77)]
    dprs = args.dpr or [2, 3]

    prefix = pathlib.Path(args.out)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    contact_sheet(files, args.cols, args.cell,
                  prefix.with_name(prefix.name + "_全尺寸.png"))
    actual_size_sheet(files, sizes, dprs,
                      prefix.with_name(prefix.name + "_真实尺寸.png"))


if __name__ == "__main__":
    main()
