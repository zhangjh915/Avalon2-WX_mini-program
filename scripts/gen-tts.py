#!/usr/bin/env python3
"""生成一段固定的「认身份」播报音频（豆包 seed-audio-1.0，经公司代理）。

用法：
  python3 scripts/gen-tts.py scripts/tts-prompts/identity-v2.txt tmp/audio-candidates/v2.mp3

API key 只从 ~/.avalon-llm-key（export LLM_API_KEY="..."）或环境变量 LLM_API_KEY 读，
绝不写进仓库、也不打在命令行里。接口是同步的：一次调用直接返回音频（base64 或临时 url），
生成 70 秒左右的音频大约要等一到三分钟。
"""
import base64, json, os, re, sys, time
import requests

BASE = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/doubao/api/v3/tts"

def api_key():
    key = os.environ.get("LLM_API_KEY", "")
    if not key:
        path = os.path.expanduser("~/.avalon-llm-key")
        if os.path.exists(path):
            m = re.search(r'LLM_API_KEY="([^"]+)"', open(path).read())
            key = m.group(1) if m else ""
    if not key:
        sys.exit("缺少 LLM_API_KEY：请在 ~/.avalon-llm-key 写 export LLM_API_KEY=\"...\"")
    return key

def generate(prompt, out_path):
    body = {
        "model": "seed-audio-1.0",
        "text_prompt": prompt,
        "audio_config": {"format": "mp3", "sample_rate": 48000, "pitch_rate": 0, "speech_rate": 0, "loudness_rate": 0},
        "watermark": {}
    }
    headers = {"Content-Type": "application/json", "Authorization": "Bearer " + api_key()}
    started = time.time()
    resp = requests.post(BASE + "/create", headers=headers, json=body, timeout=600)
    elapsed = time.time() - started
    if resp.status_code != 200:
        sys.exit(f"生成失败 HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    blob = next((v for v in data.values() if isinstance(v, str) and len(v) > 2000 and re.fullmatch(r"[A-Za-z0-9+/=\n]+", v)), None)
    if blob:
        audio = base64.b64decode(blob)
    elif data.get("url"):
        audio = requests.get(data["url"], timeout=120).content
    else:
        sys.exit("响应里既没有音频数据也没有 url：" + json.dumps({k: (v if not isinstance(v, str) or len(v) < 200 else "<blob>") for k, v in data.items()}, ensure_ascii=False))
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(audio)
    meta = {"duration": data.get("duration"), "original_duration": data.get("original_duration"), "elapsed": round(elapsed, 1), "bytes": len(audio), "prompt": prompt}
    with open(re.sub(r"\.mp3$", "", out_path) + ".json", "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"{out_path}: {meta['duration']}s 音频，{len(audio)//1024} KB，耗时 {elapsed:.0f}s")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    generate(open(sys.argv[1], encoding="utf-8").read().strip(), sys.argv[2])
