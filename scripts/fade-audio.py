#!/usr/bin/env python3
"""给生成的音频补一个平滑的结尾（和一个极短的开头淡入），避免戛然而止。

用法：python3 scripts/fade-audio.py <输入.mp3> [输出.mp3] [--tail 8]
不给输出路径就原地覆盖。生成模型经常把结尾切得很硬，尤其是撞到两分钟上限的时候；
与其反复重生成，不如在这里统一做 8 秒的指数淡出，听感和「音乐慢慢消失」一致。
依赖 soundfile（pip 已装，libsndfile 1.2 能读写 mp3）。
"""
import sys, shutil, tempfile, pathlib
import numpy as np, soundfile as sf

def fade(src, dst, tail=8.0, head=0.3):
    data, sr = sf.read(src, always_2d=True)
    n_tail = min(len(data), int(sr * tail))
    if n_tail > 0:
        curve = np.exp(np.linspace(0, -6, n_tail)) * (1 - np.linspace(0, 1, n_tail)) + 0   # 指数为主，末端归零
        curve = np.exp(np.linspace(0, -5, n_tail)); curve = (curve - curve[-1]) / (curve[0] - curve[-1])
        data[-n_tail:] *= curve[:, None]
    n_head = min(len(data), int(sr * head))
    if n_head > 0:
        data[:n_head] *= np.linspace(0, 1, n_head)[:, None]
    tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False).name
    sf.write(tmp, data, sr, format="MP3")
    shutil.move(tmp, dst)

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tail = float(sys.argv[sys.argv.index("--tail") + 1]) if "--tail" in sys.argv else 8.0
    if not args: sys.exit(__doc__)
    src = args[0]; dst = args[1] if len(args) > 1 else src
    fade(src, dst, tail=tail)
    print(f"{dst}: 已做 {tail:.0f} 秒淡出")
