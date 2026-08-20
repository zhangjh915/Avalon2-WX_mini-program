#!/usr/bin/env python3
# 从 tables_v2 那批切片里挑长桌的比例档位。
#
# 第一版是手算的，漏了一整段需求：只按 compact-stage（比 1.19）算，
# 没算选人页 .selector-page .compact-stage —— 那个是 flex:1 撑满屏高的，
# 比例只有 0.55，长宽比需求一路顶到 3.5。而 5-10 人的**默认**座位布局
# （balancedLayout 全排左右两侧）恰好落在这一段，等于最常见的局全都在外插。
#
# 这一版把需求空间完整枚举出来，再做覆盖最优的 DP，别再手算了。
import glob, itertools, json, math, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs/assets/generated/界面/徽记-切片/v2_norm")

# 拼版 2 整批弃用。同一条提示词跑了三张，1 和 3 是「整圈连续凯尔特绳结包边」，
# 2 却自己换了做法：四个光面铜包角 + 绳结只走在边上，桌面还多了板缝。
# 单看不难看，混进去就是用户上次说的「有圆角的也有尖角的」。
# 教训：同一提示词的多张之间，模型可能在**结构**上分叉，不只是配色浮动——
# 选片前必须整批并排看一眼，光看比例数字看不出来。
SKIP_SHEETS = {"2"}

# tableGeometry()：width/height 是舞台的百分比，seats 5 及以上都被 min() 夹住
W_PCT = {0: 32, 1: 35, 2: 44, 3: 53, 4: 62, 5: 68}
H_PCT = {0: 28, 1: 33, 2: 42, 3: 51, 4: 60, 5: 62}

# 舞台长宽比。两类：
#   play 页 .compact-stage —— 宽 100%、高 590rpx，两个都是 rpx，比例基本固定
#   选人页 / 房间页 —— flex:1 吃掉剩余屏高，比例随机型在 0.55(高屏) ~ 0.72(SE) 之间
STAGE_RATIOS = [1.19, 1.32] + [0.554 + i * (0.722 - 0.554) / 8 for i in range(9)]

# 分辨率按最大机型算（440pt 宽 @3x）：选人页舞台约 412x744pt，play 页约 412x346pt
STAGE_PT = {"tall": (412, 744), "wide": (412, 346)}
DPR = 3


def combos():
    """(需求长宽比, 落地时长边需要多少物理像素)"""
    out = []
    for h in range(6):
        for v in range(6):
            if h == 0 and v == 0:
                continue
            wp, hp = W_PCT[h], H_PCT[v]
            for sr in STAGE_RATIOS:
                r = sr * wp / hp
                a = max(r, 1 / r)
                sw, sh = STAGE_PT["wide"] if sr > 1 else STAGE_PT["tall"]
                px = max(sw * wp / 100, sh * hp / 100) * DPR
                out.append((a, px))
    return out


def default_combos():
    """balancedLayout：5-10 人默认全排左右两侧，这是绝大多数局真正会走到的档。"""
    out = []
    for n in range(5, 11):
        v = min(5, max((n + 1) // 2, n // 2))
        wp, hp = W_PCT[0], H_PCT[v]
        for sr in STAGE_RATIOS:
            r = sr * wp / hp
            sw, sh = STAGE_PT["wide"] if sr > 1 else STAGE_PT["tall"]
            out.append((max(r, 1 / r), max(sw * wp / 100, sh * hp / 100) * DPR, n))
    return out


def load_candidates():
    rows = []
    for f in sorted(glob.glob(os.path.join(SRC, "*.png"))):
        if os.path.basename(f).split("_")[0] in SKIP_SHEETS:
            continue
        w, h = Image.open(f).size
        rows.append({"file": f, "w": w, "h": h,
                     "aspect": round(max(w / h, h / w), 4), "long": max(w, h)})
    rows.sort(key=lambda r: r["aspect"])
    return rows


def gap(t1, t2):
    """相邻两档之间最差的拉伸：需求落在几何中点时。"""
    return math.sqrt(t2 / t1) - 1


def best_subset(cands, k, a_lo, a_hi, cbs):
    """选 k 档。主目标最小化最大拉伸，并列时再最小化最大放大倍数——
    比例相近的候选常常尺寸差一截（1.28 那档 578x452 vs 508x395），
    早先的 DP 在并列时随手挑一个，白白丢了分辨率。池子只有十几张，直接穷举。"""
    best = None
    for combo in itertools.combinations(range(len(cands)), k):
        tiers = [cands[i] for i in combo]
        s, _, up, _ = evaluate(tiers, cbs)
        key = (round(s, 4), round(up, 3))
        if best is None or key < best[0]:
            best = (key, tiers)
    return best[0][0], best[1]


def evaluate(tiers, cbs):
    worst_s, worst_a, worst_up = 0.0, 0.0, 0.0
    ups = {t["aspect"]: 0.0 for t in tiers}
    for a, px in cbs:
        t = min(tiers, key=lambda t: abs(math.log(a / t["aspect"])))
        s = abs(a / t["aspect"] - 1) if a > t["aspect"] else abs(t["aspect"] / a - 1)
        if s > worst_s:
            worst_s, worst_a = s, a
        u = px / t["long"]
        ups[t["aspect"]] = max(ups[t["aspect"]], u)
        worst_up = max(worst_up, u)
    return worst_s, worst_a, worst_up, ups


def main():
    cands = load_candidates()
    cbs = combos()
    a_lo, a_hi = min(c[0] for c in cbs), max(c[0] for c in cbs)
    print("候选 %d 张，比例 %.2f ~ %.2f" % (len(cands), cands[0]["aspect"], cands[-1]["aspect"]))
    print("需求长宽比区间 %.2f ~ %.2f\n" % (a_lo, a_hi))

    cur = json.load(open(os.path.join(ROOT, "miniprogram/assets/ui/table-long/_meta.json")))
    cur_tiers = [{"aspect": t["aspect"], "long": max(t["w"], t["h"]),
                  "w": t["w"], "h": t["h"], "file": ""} for t in cur]
    s, a, up, _ = evaluate(cur_tiers, cbs)
    print("现在这 7 档：最大拉伸 %.1f%%（出现在需求比 %.2f），最大放大 %.2fx" % (s * 100, a, up))

    print("\n档数  最大拉伸  最大放大  档位")
    rows = {}
    for k in range(7, 13):
        _, tiers = best_subset(cands, k, a_lo, a_hi, cbs)
        s, a, up, ups = evaluate(tiers, cbs)
        rows[k] = (tiers, s, up)
        print("  %2d   %5.1f%%   %5.2fx   %s" % (
            k, s * 100, up, " ".join("%.2f" % t["aspect"] for t in tiers)))

    dfs = [(a, px) for a, px, _ in default_combos()]
    print("\n（只看 5-10 人默认座位布局）")
    s, a, up, _ = evaluate(cur_tiers, dfs)
    print("  现在 7 档：最大拉伸 %.1f%%，最大放大 %.2fx" % (s * 100, up))
    for k in (8, 10):
        _, tiers = best_subset(cands, k, a_lo, a_hi, cbs)
        s, a, up, _ = evaluate(tiers, dfs)
        print("  重挑 %d 档：最大拉伸 %.1f%%，最大放大 %.2fx" % (k, s * 100, up))

    k = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if k:
        tiers, s, up = rows[k]
        print("\n=== 选定 %d 档 ===" % k)
        _, _, _, ups = evaluate(tiers, cbs)
        for i, t in enumerate(tiers, 1):
            print("  %d.png  %.4f  %dx%d  最大放大 %.2fx  <- %s"
                  % (i, t["aspect"], t["w"], t["h"], ups[t["aspect"]],
                     os.path.basename(t["file"])))
        out = [{"i": i, "aspect": t["aspect"], "w": t["w"], "h": t["h"]}
               for i, t in enumerate(tiers, 1)]
        print(json.dumps(out, ensure_ascii=False))
        with open(os.path.join(ROOT, "scripts/.table-tiers.json"), "w") as fh:
            json.dump([{"i": i, "aspect": t["aspect"], "w": t["w"], "h": t["h"],
                        "file": t["file"]} for i, t in enumerate(tiers, 1)], fh,
                      ensure_ascii=False, indent=1)


main()
