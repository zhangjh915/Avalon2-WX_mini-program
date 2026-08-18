"""生图脚本共用的进度显示。

为什么要有这个：生图一次几十上百张、跑几十分钟，中途看不到任何东西，
分不清是"还在等接口返回"还是"卡死了"。进度写到一个固定文件里，
随时 cat 就能看到，不用翻后台日志。

用法：
    from genlib import Progress
    p = Progress("画风方向试水", total=36)
    ...每完成一个：
    p.tick("手抄本·C木刻线刻·亚瑟 第2张")
    ...结束：
    p.done()
"""

import pathlib
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILE = ROOT / "docs/assets/generated/_进度.txt"
BAR_W = 28

# doubao-seedream-5-0-pro 按分辨率计价：
#   ≤ 261 万像素（1.5K 及以下）  0.30 元/张
#   > 261 万像素（1.5K 以上）    0.60 元/张
# 本项目卡牌是 1728x2304 = 398 万像素，属于后者。
PRICE_HI, PRICE_LO, PIXEL_GATE = 0.60, 0.30, 2_610_000


def price_of(size):
    """size 形如 '1728x2304'，返回单张价格（元）。"""
    w, h = (int(v) for v in size.lower().split("x"))
    return PRICE_HI if w * h > PIXEL_GATE else PRICE_LO


class Progress:
    def __init__(self, name, total, size="1728x2304"):
        self.name, self.total = name, total
        self.unit = price_of(size)
        self.n, self.fail = 0, 0
        self.start = time.time()
        self.last = ""
        self.lock = threading.Lock()
        self._write("排队中")

    def tick(self, label="", ok=True):
        with self.lock:
            self.n += 1
            if not ok:
                self.fail += 1
            self.last = label
            self._write("跑着")

    def done(self):
        with self.lock:
            self._write("完成")

    def _write(self, state):
        pct = self.n / self.total if self.total else 0
        filled = round(pct * BAR_W)
        bar = "#" * filled + "." * (BAR_W - filled)
        el = time.time() - self.start
        # 用已完成的平均耗时外推剩余时间，比固定估计准
        eta = (el / self.n * (self.total - self.n)) if self.n else 0
        spent = self.n * self.unit
        budget = self.total * self.unit
        lines = [
            "%s" % self.name,
            "[%s]  %d/%d  %d%%" % (bar, self.n, self.total, round(pct * 100)),
            "状态：%s   已用 %s   预计还需 %s" % (
                state, _dur(el), _dur(eta) if state == "跑着" else "-"),
            "花费：%.2f / %.2f 元   （%.2f 元 每张）" % (spent, budget, self.unit),
        ]
        if self.fail:
            lines.append("失败 %d 张" % self.fail)
        if self.last:
            lines.append("最近：%s" % self.last)
        lines.append("更新于 %s" % time.strftime("%H:%M:%S"))
        FILE.parent.mkdir(parents=True, exist_ok=True)
        FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _dur(sec):
    sec = int(sec)
    return "%d分%02d秒" % (sec // 60, sec % 60) if sec >= 60 else "%d秒" % sec


def save_verified(url, target):
    """下载并校验完整性。进程被中断时会留下半张图，
    混在产物里后面每一步都会踩到，不如下载完当场验、坏了就删。"""
    import urllib.request
    from PIL import Image
    urllib.request.urlretrieve(url, target)
    try:
        Image.open(target).convert("RGB").load()
    except Exception:
        target.unlink(missing_ok=True)
        raise OSError("下载的图片不完整，已删除：%s" % target.name)
    return target
