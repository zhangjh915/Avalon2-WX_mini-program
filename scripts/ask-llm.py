#!/usr/bin/env python3
"""用公司代理调任意聊天模型写东西（写台词、写文案用）。

用法：python3 scripts/ask-llm.py <model> <提示词文件> [输出文件]
model 例：claude-opus-4-6 / claude-sonnet-4-6 / claude-opus-5
key 只从 ~/.avalon-llm-key 或环境变量 LLM_API_KEY 读，绝不进仓库。
Claude 系列要走不带 -cn 的域名（openproxy.zuoyebang.cc），-cn 域名会报 host error。
"""
import os, re, sys, requests

def api_key():
    key = os.environ.get("LLM_API_KEY", "")
    if not key:
        path = os.path.expanduser("~/.avalon-llm-key")
        if os.path.exists(path):
            m = re.search(r'LLM_API_KEY="([^"]+)"', open(path).read())
            key = m.group(1) if m else ""
    if not key: sys.exit("缺少 LLM_API_KEY")
    return key

def ask(model, prompt):
    r = requests.post("https://openproxy.zuoyebang.cc/openproxy/rp/v1/chat/completions",
                      headers={"Authorization": "Bearer " + api_key(), "Content-Type": "application/json"},
                      json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 1.0, "max_tokens": 3000},
                      timeout=300)
    if r.status_code != 200: sys.exit(f"HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(__doc__)
    text = ask(sys.argv[1], open(sys.argv[2], encoding="utf-8").read())
    if len(sys.argv) > 3:
        open(sys.argv[3], "w", encoding="utf-8").write(text)
    print(text)
