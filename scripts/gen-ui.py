"""生成界面图标与场景资产。提示词来自 docs/assets/prompts/界面/，不在本文件里。

和 gen-skin.py 的区别：皮肤是「一套风格 × 27 个角色」的笛卡尔积，
界面资产是一堆各自尺寸、各自用途的独立条目，所以每条自带 size。

用法：
  source ~/.avalon-llm-key
  python3 scripts/gen-ui.py --dry 图标                 # 看计划和预算，不花钱
  python3 scripts/gen-ui.py 图标                       # 跑整组
  python3 scripts/gen-ui.py 图标 --only fireball       # 只跑其中一条
  python3 scripts/gen-ui.py 图标 --draws 3             # 改抽卡次数（默认 3）
  python3 scripts/gen-ui.py 图标 --show                # 只打印提示词全文，不发请求
"""

import json
import os
import pathlib
import sys
import threading
import tomllib
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from genlib import Progress, price_of, save_verified

CONC = int(os.environ.get("CONC", "3"))
ENDPOINT = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"
MODEL = "doubao-seedream-5-0-pro-260628"
ROOT = pathlib.Path(__file__).resolve().parent.parent
PROMPT_DIR = ROOT / "docs/assets/prompts/界面"
BASE = ROOT / "docs/assets/generated/界面"

lock = threading.Lock()
PROG = None


def load_group(name):
    """一组界面资产 -> [(key, label, size, prompt), …]"""
    path = PROMPT_DIR / ("%s.toml" % name)
    with open(path, "rb") as f:
        data = tomllib.load(f)
    style, tail = data["style"].strip(), data["tail"].strip()
    # 顶层唯一的表就是条目表（icons / scenes），名字随文件走，不写死
    table = next(v for k, v in data.items() if isinstance(v, dict))
    items = []
    for key, it in table.items():
        items.append((key, it["label"], it["size"],
                      style + it["desc"].strip() + tail))
    return items, path


def request(prompt, size, key):
    body = {"model": MODEL, "prompt": prompt, "size": size, "stream": False,
            "response_format": "url", "watermark": False}
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body, ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + key}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:
            return {"error": {"message": "HTTP %d" % e.code}}
    except Exception as e:
        return {"error": {"message": str(e)}}


def job(task, group, key):
    item_key, label, size, prompt, draw = task
    out = BASE / group / ("%s_%d.jpeg" % (item_key, draw))
    tag = "%s 第%d张" % (label, draw)

    data = request(prompt, size, key)
    if "error" in data:
        with lock:
            print("X %s -- %s" % (tag, str(data["error"].get("message", ""))[:130]))
        if PROG:
            PROG.tick(tag + " 失败", ok=False)
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        save_verified(data["data"][0]["url"], out)
    except OSError as e:
        with lock:
            print("X %s -- %s" % (tag, e))
        if PROG:
            PROG.tick(tag + " 下载损坏", ok=False)
        return
    with lock:
        print("OK %s" % tag)
    if PROG:
        PROG.tick(tag)


def main():
    args = sys.argv[1:]
    dry, show = "--dry" in args, "--show" in args
    draws = 3
    if "--draws" in args:
        i = args.index("--draws")
        draws = int(args[i + 1]); del args[i:i + 2]
    only = None
    if "--only" in args:
        i = args.index("--only")
        only = args[i + 1]; del args[i:i + 2]
    groups = [a for a in args if not a.startswith("--")]
    if not groups:
        avail = sorted(p.stem for p in PROMPT_DIR.glob("*.toml"))
        sys.exit("用法：gen-ui.py <组名…>\n可选：" + "、".join(avail))

    tasks, budget = [], 0.0
    for g in groups:
        items, path = load_group(g)
        if only:
            items = [it for it in items if it[0] == only]
            if not items:
                sys.exit("%s 里没有 %s 这一条" % (g, only))
        for key, label, size, prompt in items:
            if show:
                print("=== %s ｜ %s ｜ %s\n%s\n" % (label, key, size, prompt))
                continue
            for d in range(1, draws + 1):
                f = BASE / g / ("%s_%d.jpeg" % (key, d))
                if f.exists():          # 跳过已有的，中断后重跑同一条命令即可续上
                    continue
                tasks.append((g, (key, label, size, prompt, d)))
                budget += price_of(size)
    if show:
        return

    print("计划 %d 张 ｜ 预算 %.2f 元 ｜ 并发 %d" % (len(tasks), budget, CONC))
    if dry or not tasks:
        return

    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    global PROG
    # 各条尺寸可能不同，进度条的单价按第一条算，总预算上面已经精确打印过
    PROG = Progress("界面：" + "、".join(groups), len(tasks), tasks[0][1][2])
    with ThreadPoolExecutor(max_workers=CONC) as pool:
        list(pool.map(lambda t: job(t[1], t[0], key), tasks))
    PROG.done()
    print("\n实际花费约 %.2f 元" % budget)


if __name__ == "__main__":
    main()
