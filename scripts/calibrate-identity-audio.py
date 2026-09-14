#!/usr/bin/env python3
"""按开场播报音频里台词的实际位置，算出云函数 IDENTITY_SCHEDULE 的三个常数。

用法：
  python3 scripts/calibrate-identity-audio.py tmp/audio-candidates/timed-v2.json [--write]

读 gen-tts.py 产出的 .json（含字幕逐句时间戳），找到五句台词：
  锁定句「阵营已锁定」的开始 → lockAt      → claimMs   = lock
  翻牌句「请翻开身份牌」的开始 → revealAt   → shuffleMs = reveal - lock
  收起句「请收起身份牌」的开始 → closeAt    → readMs    = close - reveal
并核对「还有十秒」是否落在 closeAt 前 10 秒左右。--write 会把常数写进 gameCore.js。
"""
import json, re, sys, pathlib

LINES = {
    "claim": "首任队长",
    "lock": "阵营已锁定",
    "reveal": "请翻开身份牌",
    "tenLeft": "还有十秒",
    "close": "请收起身份牌",
}

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
    sentences = ((meta.get("subtitle") or {}).get("sentences")) or []
    if not sentences:
        sys.exit("这个 json 没有字幕时间戳：生成时 audio_config.enable_subtitle 要为 true")
    found = {}
    for key, marker in LINES.items():
        hit = next((s for s in sentences if marker in (s.get("text") or "")), None)
        if hit: found[key] = (hit["start_time"] / 1000.0, hit["end_time"] / 1000.0)
    missing = [k for k in LINES if k not in found]
    if missing:
        sys.exit(f"台词没找齐，缺 {missing}；字幕里有：{[s.get('text') for s in sentences]}")
    lock, reveal, close, ten = found["lock"][0], found["reveal"][0], found["close"][0], found["tenLeft"][0]
    schedule = {"claimMs": int(round(lock * 10)) * 100, "shuffleMs": int(round((reveal - lock) * 10)) * 100, "readMs": int(round((close - reveal) * 10)) * 100}
    print(f"音频 {meta.get('duration')}s")
    for key, (a, b) in found.items():
        print(f"  {key:8s} {a:6.2f} → {b:6.2f}")
    print(f"IDENTITY_SCHEDULE = {json.dumps(schedule)}")
    gap = close - ten
    print(f"「还有十秒」离收起 {gap:.1f}s" + ("" if 8 <= gap <= 12 else "  ← 偏差超过 2 秒，考虑重生成或改台词"))
    if "--write" in sys.argv:
        core = pathlib.Path("cloudfunctions/avalonGame/gameCore.js")
        src = core.read_text()
        new = re.sub(r"const IDENTITY_SCHEDULE = \{[^}]*\}", f"const IDENTITY_SCHEDULE = {{ claimMs: {schedule['claimMs']}, shuffleMs: {schedule['shuffleMs']}, readMs: {schedule['readMs']} }}", src, count=1)
        if new == src: sys.exit("gameCore.js 里没找到 IDENTITY_SCHEDULE")
        core.write_text(new)
        print("已写入 gameCore.js")

if __name__ == "__main__":
    main()
