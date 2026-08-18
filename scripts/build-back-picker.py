"""生成身份牌卡背选片页：4 种画风 × 3 种纹样 × 3 次抽卡。

和角色选片台的差别：这里是**按画风分组**，每组内 3 种纹样各 3 张。
挑选目标是每种画风选出一张卡背。

用法：
  python3 scripts/build-back-picker.py
"""

import base64
import io
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/assets/generated/身份牌卡背"
OUT = ROOT / "docs/assets/generated/身份牌卡背/卡背选片台.html"
DISPLAY_W, EMBED_W = 300, 600   # Retina：嵌入 2 倍，显示 1 倍

import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("backs", ROOT / "scripts/gen-identity-backs.py")
_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
STYLES, MOTIFS, DRAWS = _mod.STYLES, _mod.MOTIFS, _mod.DRAWS


def uri(im, q=80):
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


WANT = None


def collect():
    groups = []
    for style in (WANT or STYLES):
        rows = []
        for mname, _ in MOTIFS:
            shots = []
            for d in range(1, DRAWS + 1):
                f = SRC / style / f"{mname}_{d}.jpeg"
                if not f.exists():
                    continue
                im = Image.open(f).convert("RGB")
                im = im.resize((EMBED_W, round(im.height * EMBED_W / im.width)),
                               Image.LANCZOS)
                shots.append({"n": d, "img": uri(im), "file": f.name})
            if shots:
                rows.append({"key": f"{style}-{mname}", "motif": mname, "shots": shots})
        if rows:
            groups.append({"style": style, "rows": rows})
    return groups


CSS = """
:root{
  --ground:#14100c; --surface:#1e1813; --line:#2f2620; --line-strong:#4a3d33;
  --gold:#c8aa62; --ink:#efe7d9; --ink-mid:#ab9f8e; --ink-dim:#7d7264;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1360px;margin:0 auto;padding:0 24px 120px}
header{padding:56px 0 26px;border-bottom:1px solid var(--line)}
h1{margin:0 0 10px;font-size:32px;font-weight:700;letter-spacing:-.01em}
.lede{margin:0;max-width:64ch;color:var(--ink-mid)}
.lede b{color:var(--ink);font-weight:600}
.bar{position:sticky;top:0;z-index:20;display:flex;gap:16px;align-items:center;
  justify-content:space-between;margin:0 -24px;padding:13px 24px;
  background:color-mix(in srgb,var(--ground) 93%,transparent);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.progress{display:flex;align-items:center;gap:10px;font-family:var(--mono);
  font-size:12px;color:var(--ink-dim)}
.meter{width:160px;height:5px;border-radius:3px;background:var(--line-strong);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}
.style-head{display:flex;align-items:baseline;gap:12px;padding:46px 0 6px;
  border-bottom:1px solid var(--line)}
.style-head h2{margin:0;font-size:23px;font-weight:650;color:var(--gold)}
.style-head .n{font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
.motif{padding:22px 0;border-top:1px solid var(--line)}
.motif:first-of-type{border-top:0}
.motif.done{background:linear-gradient(90deg,color-mix(in srgb,var(--gold) 8%,transparent),transparent 52%)}
.motif h3{margin:0 0 12px;font-size:17px;font-weight:600}
.shots{display:flex;gap:14px;flex-wrap:wrap}
.shot{display:flex;flex-direction:column;border:2px solid transparent;border-radius:4px;
  background:none;padding:0;cursor:pointer;font:inherit;color:inherit;overflow:hidden;width:__W__px}
.shot img{display:block;width:100%;height:auto}
.shot .cap{display:flex;justify-content:space-between;align-items:center;padding:7px 9px;
  font-family:var(--mono);font-size:12px;color:var(--ink-dim);background:var(--surface)}
.shot:hover{border-color:var(--line-strong)}
.shot:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.shot[aria-pressed="true"]{border-color:var(--gold)}
.shot[aria-pressed="true"] .cap{background:var(--gold);color:#17130d;font-weight:700}
.zoom{opacity:.55}.zoom:hover{opacity:1}
.result{padding:48px 0 0}
.result h2{margin:0 0 6px;font-size:20px;font-weight:650}
.result p{margin:0 0 14px;color:var(--ink-dim);font-size:13px}
pre{margin:0;padding:18px 20px;overflow-x:auto;border:1px solid var(--line-strong);
  border-radius:3px;background:var(--surface);font-family:var(--mono);font-size:13px;
  line-height:1.8;white-space:pre-wrap}
.empty{color:var(--ink-dim)}
dialog{border:0;padding:0;max-width:min(94vw,720px);background:transparent}
dialog::backdrop{background:rgba(8,6,4,.92)}
dialog img{display:block;width:100%;height:auto;border:1px solid var(--line-strong)}
dialog .cap{display:flex;justify-content:space-between;padding:10px 2px 0;
  font-family:var(--mono);font-size:12px;color:var(--ink-mid)}
dialog button{border:1px solid var(--line-strong);background:transparent;color:var(--ink-mid);
  font-family:var(--sans);font-size:12px;padding:3px 10px;border-radius:2px;cursor:pointer}
@media (max-width:820px){.wrap{padding:0 14px 90px}h1{font-size:25px}.shots{gap:8px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
""".replace("__W__", str(DISPLAY_W))

JS = """
const picks = {};
const TOTAL = document.querySelectorAll('.style-head').length;

function render() {
  document.querySelectorAll('.motif').forEach(row => {
    const v = picks[row.dataset.style];
    const mine = v && v.key === row.dataset.key;
    row.classList.toggle('done', !!mine);
    row.querySelectorAll('.shot').forEach(s =>
      s.setAttribute('aria-pressed', String(!!mine && String(v.n) === s.dataset.n)));
  });
  const done = Object.keys(picks).length;
  document.getElementById('done').textContent = done;
  document.getElementById('meter').style.width = (done / TOTAL * 100) + '%';

  const lines = Object.entries(picks).map(([style, v]) =>
    `${style}：${v.motif} 第 ${v.n} 张`);
  const out = document.getElementById('out');
  if (lines.length) { out.textContent = lines.join('\\n'); out.classList.remove('empty'); }
  else {
    out.textContent = '还没选。每种画风选一张卡背，选完把这段发我。';
    out.classList.add('empty');
  }
}

document.querySelectorAll('.shot').forEach(s => {
  s.addEventListener('click', e => {
    if (e.target.closest('.zoom')) return;
    const row = s.closest('.motif');
    const style = row.dataset.style, n = Number(s.dataset.n);
    const cur = picks[style];
    // 每种画风只能选一张，换纹样会顶掉之前的
    if (cur && cur.key === row.dataset.key && cur.n === n) delete picks[style];
    else picks[style] = {key: row.dataset.key, motif: row.dataset.motif, n};
    render();
  });
});

const dlg = document.getElementById('zoom');
document.querySelectorAll('.zoom').forEach(z => {
  z.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('zoom-img').src = z.closest('.shot').querySelector('img').src;
    document.getElementById('zoom-cap').textContent = z.dataset.cap;
    dlg.showModal();
  });
});
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
document.getElementById('zoom-close').addEventListener('click', () => dlg.close());
render();
"""


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def build():
    groups = collect()
    if not groups:
        sys.exit("找不到卡背，先跑 python3 scripts/gen-identity-backs.py")

    secs, n_img = [], 0
    for g in groups:
        rows = []
        for r in g["rows"]:
            shots = []
            for s in r["shots"]:
                n_img += 1
                cap = f"{g['style']}/{r['motif']}_{s['n']}.jpeg"
                shots.append(f"""
          <button class="shot" data-n="{s['n']}" aria-pressed="false"
                  aria-label="选择 {esc(r['motif'])} 第 {s['n']} 张">
            <img src="{s['img']}" alt="{esc(g['style'])} {esc(r['motif'])} 第 {s['n']} 张">
            <span class="cap"><span>第 {s['n']} 张</span>
              <span class="zoom" role="button" tabindex="0" data-cap="{esc(cap)}">放大</span></span>
          </button>""")
            rows.append(f"""
        <div class="motif" data-style="{esc(g['style'])}" data-key="{esc(r['key'])}"
             data-motif="{esc(r['motif'])}">
          <h3>{esc(r['motif'])}</h3>
          <div class="shots">{''.join(shots)}</div>
        </div>""")
        secs.append(f"""
      <div class="style-head"><h2>{esc(g['style'])}</h2>
        <span class="n">{len(g['rows'])} 种纹样</span></div>
      {''.join(rows)}""")

    html = f"""<meta charset="utf-8">
<title>卡背选片台</title>
<style>{CSS}</style>
<div class="wrap">
  <header>
    <h1>卡背选片台</h1>
    <p class="lede">身份牌卡背，<b>{len(groups)} 种画风 × {len(MOTIFS)} 种纹样 × {DRAWS} 次抽卡</b>。
    每种画风<b>选一张</b>——跨纹样也是单选，点另一个纹样会顶掉之前的。
    底色统一用深棕，区别于任务牌背的板岩蓝灰；纹样也避开了任务牌用过的圣杯和圆桌纹章。
    卡背是未揭示状态，所以不用正义靛蓝或邪恶酒红，不能暗示阵营。</p>
  </header>

  <div class="bar">
    <span style="font-family:var(--mono);font-size:12px;color:var(--ink-dim)">
      每种画风选一张</span>
    <div class="progress">
      <span>已定 <b id="done">0</b> / {len(groups)}</span>
      <span class="meter"><i id="meter"></i></span>
    </div>
  </div>

  {''.join(secs)}

  <section class="result">
    <h2>你的选择</h2>
    <p>四种画风都选完后把这段发我。</p>
    <pre id="out" class="empty">还没选。</pre>
  </section>
</div>

<dialog id="zoom">
  <img id="zoom-img" alt="放大查看">
  <div class="cap"><span id="zoom-cap"></span><button id="zoom-close">关闭</button></div>
</dialog>
<script>{JS}</script>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print("已写出 %s  %.1f MB  %d 种画风 / %d 张图" % (
        OUT.relative_to(ROOT), OUT.stat().st_size / 1024 / 1024, len(groups), n_img))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a in STYLES]
    if args:
        globals()['WANT'] = args
        globals()['OUT'] = SRC / ('卡背选片台-%s.html' % ''.join(args))
    build()
