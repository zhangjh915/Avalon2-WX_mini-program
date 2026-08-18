"""按皮肤批量生成角色卡与卡背。提示词全部来自 docs/assets/prompts/，不在本文件里。

用法：
  source ~/.avalon-llm-key
  CONC=10 python3 scripts/gen-skin.py 幻想华服 木刻线刻          # 角色卡 + 卡背
  CONC=10 python3 scripts/gen-skin.py 幻想华服 --only-backs      # 只跑卡背
  CONC=10 python3 scripts/gen-skin.py 幻想华服 --draws 2         # 改抽卡次数
  python3 scripts/gen-skin.py --dry 幻想华服                     # 只打印计划和预算
"""

import json
import os
import pathlib
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from genlib import Progress, price_of, save_verified
from prompts import ROSTER, list_skins, load_skin

CONC = int(os.environ.get("CONC", "6"))
ENDPOINT = "https://openproxy-cn.zuoyebang.cc/openproxy/rp/v1/images/generations"
MODEL = "doubao-seedream-5-0-pro-260628"
SIZE = "1728x2304"
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/皮肤"

lock = threading.Lock()
PROG = None


def request(prompt, key):
    body = {"model": MODEL, "prompt": prompt, "size": SIZE, "stream": False,
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


def job(task, key):
    skin, kind, item, draw = task
    sk = load_skin(skin)
    if kind == "role":
        prompt = sk.role_prompt(item)
        label = ROSTER[item]["name"]
        out = BASE / skin / "角色" / ("%s_%d.jpeg" % (item, draw))
    elif kind == "var":
        k, i = item.split("#"); i = int(i)
        prompt = sk.variant_prompt(k, i)
        label = "%s·%s" % (ROSTER[k]["name"], sk.variant_name(k, i))
        out = BASE / skin / "角色" / ("%s-v%d_%d.jpeg" % (k, i + 1, draw))
    else:
        prompt = sk.back_prompt(item)
        label = "卡背·" + item
        out = BASE / skin / "卡背" / ("%s_%d.jpeg" % (item, draw))
    tag = "%s·%s 第%d张" % (skin, label, draw)

    data = request(prompt, key)
    if "error" in data:
        with lock:
            print("X %s -- %s" % (tag, str(data["error"].get("message", ""))[:130]))
        if PROG:
            PROG.tick(tag + " 失败", ok=False)
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        save_verified(data["data"][0]["url"], out)
    except OSError as e:
        with lock:
            print("X %s -- %s" % (tag, e))
        if PROG:
            PROG.tick(tag + " 下载损坏", ok=False)
        return 0
    tok = (data.get("usage") or {}).get("total_tokens", 0) or 0
    with lock:
        print("OK %s" % tag)
    if PROG:
        PROG.tick(tag)
    return tok


def main():
    args = sys.argv[1:]
    dry = "--dry" in args
    only_backs = "--only-backs" in args
    only_roles = "--only-roles" in args
    draws = 3
    if "--draws" in args:
        draws = int(args[args.index("--draws") + 1])
        args.remove("--draws"); args.remove(str(draws))
    skins = [a for a in args if a in list_skins()]
    if not skins:
        sys.exit("用法：gen-skin.py <皮肤名…>\n可选：" + "、".join(list_skins()))

    tasks = []
    for s in skins:
        sk = load_skin(s)
        miss, extra = sk.check()
        if miss:
            sys.exit("%s 缺这些角色的形象描述：%s" % (s, "、".join(miss)))
        if not only_backs:
            # 有变体的角色不出"通用版"，直接出各变体；没变体的照常
            tasks += [(s, "role", k, d) for k in ROSTER
                      if k not in sk.variants for d in range(1, draws + 1)]
            tasks += [(s, "var", "%s#%d" % (k, i), d)
                      for k, vs in sk.variants.items()
                      for i in range(len(vs)) for d in range(1, draws + 1)]
        if not only_roles:
            tasks += [(s, "back", m, d) for m in sk.motifs for d in range(1, draws + 1)]
    # 已经跑过的跳过，方便中断后续跑
    todo = []
    for t in tasks:
        if t[1] == "var":
            k, i = t[2].split("#")
            f = BASE / t[0] / "角色" / ("%s-v%d_%d.jpeg" % (k, int(i) + 1, t[3]))
        else:
            sub = "角色" if t[1] == "role" else "卡背"
            f = BASE / t[0] / sub / ("%s_%d.jpeg" % (t[2], t[3]))
        if not f.exists():
            todo.append(t)

    unit = price_of(SIZE)
    print("皮肤：%s ｜ 抽卡 %d 次" % ("、".join(skins), draws))
    print("计划 %d 张（已有 %d 张跳过）｜ 单价 %.2f 元 ｜ 预算 %.2f 元 ｜ 并发 %d" % (
        len(todo), len(tasks) - len(todo), unit, len(todo) * unit, CONC))
    if dry:
        return

    key = os.environ.get("LLM_API_KEY")
    if not key:
        sys.exit("缺少 LLM_API_KEY，先执行： source ~/.avalon-llm-key")

    for s in skins:
        sk = load_skin(s)
        d = BASE / s
        d.mkdir(parents=True, exist_ok=True)
        (d / "_配置.md").write_text(
            "# 皮肤 · %s\n\n%s\n\n| 项 | 值 |\n|---|---|\n"
            "| 模型 | `%s` |\n| 尺寸 | `%s` |\n| 抽卡 | %d 次 |\n"
            "| 提示词来源 | `%s` |\n\n"
            "提示词全文见上面那个 TOML，本文件不重复抄，避免两处不同步。\n" % (
                s, sk.note, MODEL, SIZE, draws,
                sk.path.relative_to(ROOT)),
            encoding="utf-8")

    global PROG
    PROG = Progress("皮肤：" + "、".join(skins), len(todo), SIZE)
    with ThreadPoolExecutor(max_workers=CONC) as pool:
        total = sum(pool.map(lambda t: job(t, key), todo))
    PROG.done()
    print("\n合计 %d tokens ｜ 实际花费约 %.2f 元" % (total, len(todo) * unit))


if __name__ == "__main__":
    main()
