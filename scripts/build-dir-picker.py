"""画风方向选片页：3 种画风 × 3 个方向 × 2 角色 × 2 抽卡。

和前几个选片台的差别：这里要**横向比方向**，不是纵向挑张数。
所以布局是「一行 = 一个方向」，行内摩根和亚瑟并排，
三个方向上下堆叠在同一屏内——扫一眼就知道方向之间差异拉开没有。

选择粒度是**方向**（每种画风选一个方向），不是单张图。
"""

import base64
import io
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/assets/generated/画风方向试水"
OUT = SRC / "方向选片台.html"
# 显示宽度（CSS 像素）和嵌入宽度要分开：Retina 屏上 1 CSS 像素 = 2 物理像素，
# 嵌入 300px 却按 300 CSS px 显示，浏览器要拉到 600 物理像素，必糊。
# 嵌入 2 倍，显示 1 倍，正好 1:1。
DISPLAY_W = 300
EMBED_W = DISPLAY_W * 2

sys.path.insert(0, str(ROOT / "scripts"))
import importlib.util as _ilu
_s = _ilu.spec_from_file_location("probe", ROOT / "scripts/gen-style-probe.py")
_m = _ilu.module_from_spec(_s); _s.loader.exec_module(_m)
DIRECTIONS, CHARS = _m.DIRECTIONS, _m.CHARS


def uri(im, q=80):
    b = io.BytesIO(); im.save(b, format="JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def collect():
    groups = {}
    for style, dname, note, _, _ in DIRECTIONS:
        shots = []
        for ck, cn in CHARS.items():
            for d in (1, 2):
                f = SRC / style / dname / f"{ck}_{d}.jpeg"
                if not f.exists():
                    continue
                im = Image.open(f).convert("RGB")
                im = im.resize((EMBED_W, round(im.height * EMBED_W / im.width)), Image.LANCZOS)
                shots.append({"char": cn, "n": d, "img": uri(im)})
        groups.setdefault(style, []).append(
            {"name": dname, "note": note, "shots": shots})
    return groups


CSS = """
:root{--ground:#0f0f11;--surface:#191a1d;--line:#26282c;--line2:#3c3f45;
 --gold:#c9a961;--ink:#eceae6;--mid:#a2a29e;--dim:#75756f;
 --sans:"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;
 --mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
 font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1500px;margin:0 auto;padding:0 24px 120px}
header{padding:54px 0 24px;border-bottom:1px solid var(--line)}
h1{margin:0 0 10px;font-size:31px;font-weight:700;letter-spacing:-.01em}
.lede{margin:0;max-width:66ch;color:var(--mid)}
.lede b{color:var(--ink);font-weight:600}
.bar{position:sticky;top:0;z-index:20;display:flex;gap:16px;align-items:center;
 justify-content:space-between;margin:0 -24px;padding:13px 24px;
 background:color-mix(in srgb,var(--ground) 94%,transparent);
 backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.prog{display:flex;align-items:center;gap:10px;font-family:var(--mono);
 font-size:12px;color:var(--dim)}
.meter{width:150px;height:5px;border-radius:3px;background:var(--line2);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}
.style-head{padding:46px 0 8px}
.style-head h2{margin:0;font-size:24px;font-weight:650;color:var(--gold)}
.style-head p{margin:4px 0 0;font-size:13px;color:var(--dim)}
.dir{border:2px solid var(--line);border-radius:6px;margin-top:16px;padding:16px 18px;
 background:var(--surface);cursor:pointer;transition:border-color .15s}
.dir:hover{border-color:var(--line2)}
.dir[aria-pressed="true"]{border-color:var(--gold);background:color-mix(in srgb,var(--gold) 7%,var(--surface))}
.dir:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.dir-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:4px}
.dir-head h3{margin:0;font-size:18px;font-weight:650}
.tick{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--dim)}
.dir[aria-pressed="true"] .tick{color:var(--gold);font-weight:700}
.note{margin:0 0 14px;font-size:13px;color:var(--mid);max-width:80ch}
.shots{display:flex;gap:12px;flex-wrap:wrap}
figure{margin:0;display:flex;flex-direction:column;gap:5px;width:__W__px}
figure img{display:block;width:100%;height:auto;border-radius:3px}
figcaption{font-family:var(--mono);font-size:11px;color:var(--dim)}
.result{padding:50px 0 0}
.result h2{margin:0 0 6px;font-size:20px;font-weight:650}
.result p{margin:0 0 14px;font-size:13px;color:var(--dim)}
pre{margin:0;padding:18px 20px;border:1px solid var(--line2);border-radius:3px;
 background:var(--surface);font-family:var(--mono);font-size:13px;line-height:1.8;
 white-space:pre-wrap;overflow-x:auto}
.empty{color:var(--dim)}
@media (max-width:900px){.wrap{padding:0 14px 90px}h1{font-size:24px}
 figure{width:calc(50% - 6px)}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
""".replace("__W__", str(DISPLAY_W))

JS = """
const picks = {};
const TOTAL = document.querySelectorAll('.style-head').length;
function render(){
  document.querySelectorAll('.dir').forEach(d=>{
    d.setAttribute('aria-pressed', String(picks[d.dataset.style] === d.dataset.dir));
  });
  const n = Object.keys(picks).length;
  document.getElementById('done').textContent = n;
  document.getElementById('meter').style.width = (n/TOTAL*100)+'%';
  const lines = Object.entries(picks).map(([s,d])=>`${s}：${d}`);
  const out = document.getElementById('out');
  if(lines.length){ out.textContent = lines.join('\\n'); out.classList.remove('empty'); }
  else { out.textContent='还没选。每种画风选一个方向，选完把这段发我。'; out.classList.add('empty'); }
}
document.querySelectorAll('.dir').forEach(d=>{
  d.addEventListener('click', ()=>{
    const s = d.dataset.style;
    if(picks[s] === d.dataset.dir) delete picks[s]; else picks[s] = d.dataset.dir;
    render();
  });
  d.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();d.click();} });
});
render();
"""


def esc(s):
    return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")


def build():
    groups = collect()
    if not groups:
        sys.exit("找不到图，先跑 python3 scripts/gen-style-probe.py")
    secs, n_img = [], 0
    for style, dirs in groups.items():
        rows = []
        for d in dirs:
            figs = []
            for s in d["shots"]:
                n_img += 1
                figs.append(f'<figure><img src="{s["img"]}" alt="{esc(s["char"])}">'
                            f'<figcaption>{esc(s["char"])} · 第{s["n"]}张</figcaption></figure>')
            rows.append(f"""
      <div class="dir" role="button" tabindex="0" aria-pressed="false"
           data-style="{esc(style)}" data-dir="{esc(d['name'])}">
        <div class="dir-head"><h3>{esc(d['name'])}</h3>
          <span class="tick">点击选为该画风的方向</span></div>
        <p class="note">{esc(d['note'])}</p>
        <div class="shots">{''.join(figs)}</div>
      </div>""")
        secs.append(f"""
      <div class="style-head"><h2>{esc(style)}</h2>
        <p>三个方向横向对比，每种画风选一个</p></div>
      {''.join(rows)}""")

    html = f"""<meta charset="utf-8">
<title>画风方向对比</title>
<style>{CSS}</style>
<div class="wrap">
  <header>
    <h1>画风方向对比</h1>
    <p class="lede">上一版四种画风共用同一套人物描述，出来是<b>同一个人换四种渲染</b>——
    那是滤镜不是皮肤。这一版每个方向都<b>重写了人物设计</b>：轮廓、姿态、服装解读、
    年龄倾向、构图全跟着方向走。用<b>摩根勒菲</b>和<b>亚瑟</b>做试金石，各 2 张。
    每种画风<b>点选一个方向</b>，定了我再按这个方向铺开 27 个角色。</p>
  </header>
  <div class="bar">
    <span style="font-family:var(--mono);font-size:12px;color:var(--dim)">每种画风选一个方向</span>
    <div class="prog"><span>已定 <b id="done">0</b> / {len(groups)}</span>
      <span class="meter"><i id="meter"></i></span></div>
  </div>
  {''.join(secs)}
  <section class="result">
    <h2>你的选择</h2>
    <p>三种画风都选完后把这段发我。哪个方向都不满意就直接说，我再出新方向。</p>
    <pre id="out" class="empty">还没选。</pre>
  </section>
</div>
<script>{JS}</script>
"""
    OUT.write_text(html, encoding="utf-8")
    print("已写出 %s  %.1f MB  %d 画风 / %d 图" % (
        OUT.relative_to(ROOT), OUT.stat().st_size/1024/1024, len(groups), n_img))


if __name__ == "__main__":
    build()
