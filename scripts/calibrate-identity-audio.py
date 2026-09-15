#!/usr/bin/env python3
"""按开场播报音频里台词的实际位置，算出云函数 IDENTITY_SCHEDULE 的三个常数。

用法：
  python3 scripts/calibrate-identity-audio.py tmp/audio-candidates/royal-t1-v1-m1.json          # 只看数
  python3 scripts/calibrate-identity-audio.py tmp/audio-candidates/royal-t1-v1-m1.json --add    # 加进音频库
  python3 scripts/calibrate-identity-audio.py tmp/audio-candidates/timed-v2.json --write         # 改默认时间轴

--add 做三件事：把 <id>.mp3 复制到 miniprogram/assets/audio/identity/（不入包不入库，只是上传中转），
把 {id, claimMs, shuffleMs, readMs} 写进 gameCore.js 的 IDENTITY_BRIEFINGS（同 id 覆盖），
然后提示接下来要跑的上传命令和部署。id 就是 json 的文件名。

读 gen-tts.py 产出的 .json（含字幕逐句时间戳），找到五句台词：
  锁定句「阵营已锁定」的开始 → lockAt      → claimMs   = lock
  翻牌句「请翻开身份牌」的开始 → revealAt   → shuffleMs = reveal - lock
  收起句「请收起身份牌」的开始 → closeAt    → readMs    = close - reveal
并核对「还有十秒」是否落在 closeAt 前 10 秒左右。--write 会把常数写进 gameCore.js。
"""
import json, re, sys, pathlib

# 每个锚点接受几种说法（台词改过版本），按顺序匹配
LINES = {
    "claim": ["第一位领袖", "首任队长"],
    "lock": ["展示已锁定", "阵营已定", "阵营已锁定"],
    "reveal": ["翻开身份牌", "翻开你的身份牌"],
    "tenLeft": ["还有十秒"],
    "close": ["收起身份牌"],
}

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
    sentences = ((meta.get("subtitle") or {}).get("sentences")) or []
    if not sentences:
        sys.exit("这个 json 没有字幕时间戳：生成时 audio_config.enable_subtitle 要为 true")
    found = {}
    for key, markers in LINES.items():
        hit = next((s for s in sentences if any(marker in (s.get("text") or "") for marker in markers)), None)
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
    if "--add" in sys.argv:
        src = pathlib.Path(sys.argv[1])
        audio_id = src.stem
        mp3 = src.with_suffix(".mp3")
        if not mp3.exists(): sys.exit(f"找不到 {mp3}")
        dest = pathlib.Path("miniprogram/assets/audio/identity") / f"{audio_id}.mp3"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(mp3.read_bytes())
        core = pathlib.Path("cloudfunctions/avalonGame/gameCore.js")
        text = core.read_text()
        entry = f'  {{ id: "{audio_id}", claimMs: {schedule["claimMs"]}, shuffleMs: {schedule["shuffleMs"]}, readMs: {schedule["readMs"]} }},'
        text = re.sub(rf'\n  \{{ id: "{re.escape(audio_id)}",[^\n]*\n', "\n", text)   # 同 id 先删
        marker = "const IDENTITY_BRIEFINGS = [\n"
        if marker not in text: sys.exit("gameCore.js 里没找到 IDENTITY_BRIEFINGS")
        text = text.replace(marker, marker + entry + "\n", 1)
        core.write_text(text)
        print(f"已加入音频库：{audio_id}；文件已复制到 {dest}")
        print(f"接着：node scripts/upload-cloud-assets.js assets/audio/identity/{audio_id}.mp3 ，然后部署云函数")
    if "--write" in sys.argv:
        core = pathlib.Path("cloudfunctions/avalonGame/gameCore.js")
        src = core.read_text()
        new = re.sub(r"const IDENTITY_SCHEDULE = \{[^}]*\}", f"const IDENTITY_SCHEDULE = {{ claimMs: {schedule['claimMs']}, shuffleMs: {schedule['shuffleMs']}, readMs: {schedule['readMs']} }}", src, count=1)
        if new == src: sys.exit("gameCore.js 里没找到 IDENTITY_SCHEDULE")
        core.write_text(new)
        print("已写入 gameCore.js")

if __name__ == "__main__":
    main()
