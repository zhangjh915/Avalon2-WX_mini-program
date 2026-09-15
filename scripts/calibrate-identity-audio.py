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

# 台词每版都不一样，锚点按「句子的功能」找，不按固定字面：
#   claim   含「第一位领袖」的第一句
#   lock    claim 之后紧跟的那句短话（不超过 6 个字，如「锁定。」「好。」「嗯。」）；找不到就按 reveal 前 3 秒算
#   reveal  claim 之后第一句带「牌」且不带「收」的话
#   tenLeft 「还有十秒」
#   close   带「收」又带「牌」的第一句
def locate(sentences):
    found = {}
    idx = {}
    for i, s in enumerate(sentences):
        text = (s.get("text") or "").strip()
        if "claim" not in found and "第一位领袖" in text:
            found["claim"] = s; idx["claim"] = i; continue
        if "claim" in found and "reveal" not in found and "牌" in text and "收" not in text:
            found["reveal"] = s; idx["reveal"] = i; continue
        if "tenLeft" not in found and "还有十秒" in text:
            found["tenLeft"] = s; idx["tenLeft"] = i; continue
        if "close" not in found and "收" in text and "牌" in text:
            found["close"] = s; idx["close"] = i; continue
    if "claim" in found and "reveal" in found:
        for s in sentences[idx["claim"] + 1: idx["reveal"]]:
            text = (s.get("text") or "").strip()
            if 0 < len(text.rstrip("。！？…")) <= 6:
                found["lock"] = s; break
    return found

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    meta = json.load(open(sys.argv[1], encoding="utf-8"))
    sentences = ((meta.get("subtitle") or {}).get("sentences")) or []
    if not sentences:
        sys.exit("这个 json 没有字幕时间戳：生成时 audio_config.enable_subtitle 要为 true")
    hits = locate(sentences)
    found = {k: (v["start_time"] / 1000.0, v["end_time"] / 1000.0) for k, v in hits.items()}
    missing = [k for k in ("claim", "reveal", "tenLeft", "close") if k not in found]
    if missing:
        sys.exit(f"台词没找齐，缺 {missing}；字幕里有：{[s.get('text') for s in sentences]}")
    if "lock" not in found:
        found["lock"] = (found["reveal"][0] - 3.0, found["reveal"][0] - 3.0)
        print("（没找到锁定短句，按翻牌前 3 秒算）")
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
