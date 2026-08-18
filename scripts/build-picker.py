"""生成任务牌选片页（自包含 HTML，图片内嵌为 data URI）。

Artifact 有严格 CSP，外链图片一律被拦，所以必须内嵌。
每张图内嵌两份：
  展示版  520 宽，用来看质感和构图
  验收版  156x231，@3x 真机物理像素，Lanczos 缩放，页面上不做任何放大

页面底色用的是 play 页真实的 #121816——在浅色底上看深色卡面会严重高估
可辨认性，这是手册里的硬规则，所以选片页不做浅色主题。

用法：
  python3 scripts/build-picker.py            # 第一轮：4 个符号方案
  python3 scripts/build-picker.py --round2   # 第二轮：符号 × 风格 两两组合
"""

import base64
import io
import json
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/任务牌套"
OUT = ROOT / "docs/assets/generated/任务牌套/选片台.html"

SHOW_W = 520          # 展示版宽度
REAL = (156, 231)     # 52x77pt @3x

PLANS = [
    {
        "dir": "方案1-剑的正逆", "no": "1", "name": "剑的正逆",
        "style": "实物皮革", "logic": "同一符号两状态 · 方向翻转 + 缺口",
        "symbols": "圣杯 / 剑尖朝上的完好长剑 / 剑尖朝下断成两截",
        "verdict": "warn",
        "note": "失败牌出成了棕底而不是红底，和牌背撞色——正是「牌背绿 + 成功绿」"
                "那个错误的翻版。断剑和剑尖倒插两条都生效了。",
    },
    {
        "dir": "方案2-圣杯的盈亏", "no": "2", "name": "圣杯的盈亏",
        "style": "实物皮革", "logic": "同一符号两状态 · 盛满 / 倾倒碎裂",
        "symbols": "圆桌纹章 / 盛满圣光的圣杯 / 倾倒碎裂的圣杯",
        "verdict": "good",
        "note": "三色系彻底分开：棕牌背、绿成功、红失败。圆桌纹章和圣杯"
                "形状完全不同，牌背绝不会被认成正面。饱和度 57–71%，"
                "是四个方案里最贴色板的。",
    },
    {
        "dir": "方案3-环的完缺", "no": "3", "name": "环的完缺",
        "style": "扁平烫金", "logic": "同一符号两状态 · 环的缺口",
        "symbols": "线描圣杯 / 完整月桂环 / 断裂月桂环",
        "verdict": "bad",
        "note": "设计不成立：月桂环本来就是两条不闭合的枝叶，"
                "「完整 vs 断裂」六张全都看不出差别。底色饱和度 92–100%，"
                "鲜绿鲜红严重跳出色板。牌背是纯黑加极细线描，杯子还长了握把。",
    },
    {
        "dir": "方案4-盾与断剑", "no": "4", "name": "盾与断剑",
        "style": "扁平烫金", "logic": "两个不同符号 · 盾形 vs 竖线",
        "symbols": "卷草纹章 / 十字盾牌 / 断成两截的长剑",
        "verdict": "warn",
        "note": "辨识度四个方案里最高，盾和剑在指甲盖大小下也绝不会混。"
                "但底色饱和度 92–100%（成功牌是接近纯绿的 #004e2f），"
                "整体偏现代扁平图标，古籍质感基本没了。",
    },
]

PLANS2 = [
    {
        "dir": "剑A-扁平烫金", "no": "剑A", "name": "剑的正逆 · 扁平烫金",
        "style": "扁平烫金", "logic": "同一符号两状态 · 方向翻转 + 缺口",
        "symbols": "圣杯 / 剑尖朝上完好剑 / 剑尖朝下断成两截",
        "verdict": "", "note": "",
    },
    {
        "dir": "剑B-实物皮革", "no": "剑B", "name": "剑的正逆 · 实物皮革",
        "style": "实物皮革", "logic": "同一符号两状态 · 方向翻转 + 缺口",
        "symbols": "圣杯 / 剑尖朝上完好剑 / 剑尖朝下断成两截",
        "verdict": "", "note": "",
    },
    {
        "dir": "杯A-扁平烫金", "no": "杯A", "name": "圣杯的盈亏 · 扁平烫金",
        "style": "扁平烫金", "logic": "同一符号两状态 · 盛满 / 倾倒碎裂",
        "symbols": "圆桌纹章 / 盛满圣杯 / 倾倒碎裂圣杯",
        "verdict": "", "note": "",
    },
    {
        "dir": "杯B-实物皮革", "no": "杯B", "name": "圣杯的盈亏 · 实物皮革",
        "style": "实物皮革", "logic": "同一符号两状态 · 盛满 / 倾倒碎裂",
        "symbols": "圆桌纹章 / 盛满圣杯 / 倾倒碎裂圣杯",
        "verdict": "", "note": "",
    },
]

ROLES = [("1牌背", "牌背", "back"), ("2成功", "成功", "good"), ("3失败", "失败", "evil")]

VERDICT = {"good": "推荐", "warn": "有保留", "bad": "不建议", "": ""}

# 第二轮的配色目标，页面上要能对着数看偏了多少
TARGETS = {"牌背": "#1e2a33", "成功": "#1b4936", "失败": "#241012"}


def uri(im, quality):
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def measure(im):
    """底色、饱和度、@3x 对比差——挑图要看的三个数。"""
    W, H = im.size
    px = list(im.crop((int(W * .40), int(H * .09), int(W * .60), int(H * .16))).getdata())
    r, g, b = [round(sum(c[i] for c in px) / len(px)) for i in range(3)]
    sat = round((max(r, g, b) - min(r, g, b)) / max(max(r, g, b), 1) * 100)

    small = im.convert("L").resize(REAL, Image.LANCZOS)
    gw, gh = small.size
    ctr = sorted(small.crop((int(gw * .30), int(gh * .28),
                             int(gw * .70), int(gh * .73))).getdata())
    peak = ctr[int(len(ctr) * .95)]
    edge = [small.getpixel((x, y)) for x in range(gw) for y in range(gh)
            if x < gw * .12 or x > gw * .88 or y < gh * .10 or y > gh * .90]
    return {"hex": "#%02x%02x%02x" % (r, g, b), "sat": sat,
            "contrast": round(peak - sum(edge) / len(edge))}


def collect(plans, base):
    data = []
    for plan in plans:
        pdir = base / plan["dir"]
        draws = []
        for d in (1, 2, 3):
            cards = []
            for suffix, label, kind in ROLES:
                f = pdir / f"r{d}-{suffix}.jpeg"
                if not f.exists():
                    continue
                im = Image.open(f).convert("RGB")
                show = im.resize((SHOW_W, round(im.height * SHOW_W / im.width)),
                                 Image.LANCZOS)
                cards.append({
                    "label": label, "kind": kind, "file": f.name,
                    "show": uri(show, 80), "real": uri(im.resize(REAL, Image.LANCZOS), 92),
                    **measure(im),
                })
            if cards:
                draws.append({"n": d, "cards": cards})
        data.append({**plan, "draws": draws})
    return data


CSS = """
:root{
  /* 底色取 play 页真实的 #121816：在浅色底上看深色卡面会高估可辨认性 */
  --ground:#121816; --surface:#1a2320; --raised:#212b27;
  --line:#2f3a35; --line-strong:#44534d;
  --gold:#c8aa62; --gold-dim:#8d7742;
  --good:#5aaa8c; --evil:#c1656b;
  --ink:#e9e5d9; --ink-mid:#a7b0aa; --ink-dim:#78827c;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --dpr:1;   /* JS 覆盖成真实 devicePixelRatio */
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:var(--sans); font-size:15px; line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1180px; margin:0 auto; padding:0 24px 96px}

/* ── 页头 ── */
header{padding:56px 0 28px; border-bottom:1px solid var(--line)}
h1{
  margin:0 0 10px; font-size:32px; font-weight:700; letter-spacing:-.01em;
  text-wrap:balance;
}
.lede{margin:0; max-width:60ch; color:var(--ink-mid)}
.lede b{color:var(--ink); font-weight:600}

/* ── 控制条 ── */
.bar{
  position:sticky; top:0; z-index:20; display:flex; flex-wrap:wrap; gap:16px;
  align-items:center; justify-content:space-between;
  margin:0 -24px; padding:14px 24px;
  background:color-mix(in srgb, var(--ground) 92%, transparent);
  backdrop-filter:blur(12px); border-bottom:1px solid var(--line);
}
.seg{display:flex; border:1px solid var(--line-strong); border-radius:3px; overflow:hidden}
.seg button{
  padding:8px 16px; border:0; background:transparent; color:var(--ink-dim);
  font-family:var(--sans); font-size:13px; cursor:pointer;
}
.seg button+button{border-left:1px solid var(--line-strong)}
.seg button[aria-pressed="true"]{background:var(--gold); color:#171410; font-weight:600}
.seg button:focus-visible{outline:2px solid var(--gold); outline-offset:-2px}
.tally{display:flex; gap:18px; font-family:var(--mono); font-size:12px; color:var(--ink-dim)}
.tally b{font-weight:400}
.tally .a{color:var(--gold)} .tally .b{color:var(--good)}

/* ── 方案 ── */
.plan{padding:44px 0; border-bottom:1px solid var(--line)}
.plan-head{display:flex; gap:18px; align-items:baseline; margin-bottom:6px}
.plan-no{
  font-family:var(--mono); font-size:12px; color:var(--gold-dim);
  border:1px solid var(--gold-dim); border-radius:2px; padding:2px 7px;
}
.plan-head h2{margin:0; font-size:23px; font-weight:650; letter-spacing:-.005em}
.chips{display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 10px}
.chip{
  font-size:12px; padding:3px 10px; border-radius:2px;
  border:1px solid var(--line-strong); color:var(--ink-mid);
}
.chip.v-good{border-color:var(--good); color:var(--good)}
.chip.v-warn{border-color:var(--gold); color:var(--gold)}
.chip.v-bad{border-color:var(--evil); color:var(--evil)}
.note{margin:0 0 4px; max-width:70ch; font-size:14px; color:var(--ink-mid)}

/* ── 抽卡行 ── */
.draw{
  display:grid; grid-template-columns:120px 1fr; gap:26px;
  padding:24px 0; border-top:1px solid var(--line);
}
.draw:first-of-type{margin-top:20px}
.draw.picked-a{background:linear-gradient(90deg, color-mix(in srgb, var(--gold) 9%, transparent), transparent 62%)}
.draw.picked-b{background:linear-gradient(90deg, color-mix(in srgb, var(--good) 9%, transparent), transparent 62%)}
.draw.dropped{opacity:.34}
.draw-meta{padding-left:2px}
.draw-n{font-family:var(--mono); font-size:12px; color:var(--ink-dim); margin-bottom:12px}
.picks{display:flex; flex-direction:column; gap:6px}
.picks button{
  padding:6px 10px; border:1px solid var(--line-strong); border-radius:3px;
  background:transparent; color:var(--ink-dim);
  font-family:var(--sans); font-size:12px; text-align:left; cursor:pointer;
}
.picks button:hover{border-color:var(--ink-dim); color:var(--ink-mid)}
.picks button:focus-visible{outline:2px solid var(--gold); outline-offset:1px}
.picks button[aria-pressed="true"]{font-weight:600}
.picks .pa[aria-pressed="true"]{border-color:var(--gold); background:var(--gold); color:#171410}
.picks .pb[aria-pressed="true"]{border-color:var(--good); background:var(--good); color:#0f1a15}
.picks .pd[aria-pressed="true"]{border-color:var(--evil); color:var(--evil)}

.strip{display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start}
figure{margin:0; display:flex; flex-direction:column; gap:8px}
.frame{
  display:block; padding:0; border:1px solid var(--line); border-radius:2px;
  background:var(--ground); cursor:zoom-in; line-height:0;
}
.frame:focus-visible{outline:2px solid var(--gold); outline-offset:2px}
.frame img{display:block; width:100%; height:auto}
figcaption{display:flex; gap:8px; align-items:baseline; font-size:12px}
.role{font-weight:600}
.role.back{color:var(--ink-mid)} .role.good{color:var(--good)} .role.evil{color:var(--evil)}
.stats{font-family:var(--mono); font-size:11px; color:var(--ink-dim)}

/* 全尺寸是默认态——不能依赖 body 上的属性，因为 body 由宿主生成，
   属性要等 JS 跑完才有，写成默认态可以避免首帧闪一下 */
figure{width:calc((100% - 32px)/3); min-width:150px}
/* 真实尺寸视图：图片是 156x231 的 Lanczos 产物，要让这 156 个像素
   1:1 落在**物理**像素上。写 width:156px 是 156 个 CSS 像素，在 2x 屏上
   会被拉成 312 个物理像素——既放大一倍又插值变糊。所以除以 --dpr。
   --dpr 由 JS 写入，跟随缩放和换屏更新。 */
body[data-view="real"] .strip{gap:26px; padding:14px 0 6px}
body[data-view="real"] figure{width:calc(156px / var(--dpr)); min-width:0}
body[data-view="real"] .frame{width:calc(156px / var(--dpr) + 2px); cursor:default}
body[data-view="real"] .frame img{
  width:calc(156px / var(--dpr));
  height:calc(231px / var(--dpr));
}
body[data-view="real"] .stats{display:none}
body[data-view="real"] figcaption{font-size:11px}
.realhint{display:none; margin:8px 0 0; max-width:70ch; font-size:13px; color:var(--ink-dim)}
body[data-view="real"] .realhint{display:block}

/* ── 结论 ── */
.result{padding:44px 0 0}
.result h2{margin:0 0 14px; font-size:20px; font-weight:650}
pre{
  margin:0; padding:18px 20px; overflow-x:auto;
  border:1px solid var(--line-strong); border-radius:3px; background:var(--surface);
  font-family:var(--mono); font-size:13px; line-height:1.75; color:var(--ink);
  white-space:pre-wrap;
}
.empty{color:var(--ink-dim)}

/* ── 放大 ── */
dialog{
  border:0; padding:0; max-width:min(94vw,880px); max-height:94vh;
  background:transparent;
}
dialog::backdrop{background:rgba(8,11,10,.9)}
dialog img{display:block; width:100%; height:auto; border:1px solid var(--line-strong)}
dialog .cap{
  display:flex; justify-content:space-between; gap:16px;
  padding:10px 2px 0; font-family:var(--mono); font-size:12px; color:var(--ink-mid);
}
dialog button{
  border:1px solid var(--line-strong); background:transparent; color:var(--ink-mid);
  font-family:var(--sans); font-size:12px; padding:3px 10px; border-radius:2px; cursor:pointer;
}

@media (max-width:720px){
  .wrap{padding:0 16px 72px}
  h1{font-size:25px}
  .draw{grid-template-columns:1fr; gap:14px}
  .picks{flex-direction:row; flex-wrap:wrap}
  body[data-view="show"] figure{width:calc((100% - 16px)/2)}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important; animation:none!important}}
"""

JS = """
const body = document.body;
const picks = {};   // key -> 'a' | 'b' | 'drop'

// 156x231 的图要 1:1 落在物理像素上，所以 CSS 宽度得除以 devicePixelRatio。
// 浏览器缩放和拖到另一块屏都会改 dpr，所以要跟着更新。
function syncDpr() {
  const d = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty('--dpr', String(d));
  document.querySelectorAll('.dpr-val').forEach(el => el.textContent = d.toString());
}
syncDpr();
window.matchMedia('(resolution: 1dppx)').addEventListener('change', syncDpr);
window.addEventListener('resize', syncDpr);

// 两份图都内嵌了：展示版 520 宽在 src 上，验收版 156x231 在 data-real 上。
// 切到验收视图时换 src，而不是用 CSS 把 520 的图压到 156——
// 那样是浏览器缩放，和手册要求的 Lanczos 产物不是一回事。
function applyView(v) {
  body.dataset.view = v;
  document.querySelectorAll('.frame img').forEach(img => {
    if (!img.dataset.show) img.dataset.show = img.getAttribute('src');
    img.setAttribute('src', v === 'real' ? img.dataset.real : img.dataset.show);
  });
}

document.querySelectorAll('.seg button').forEach(b => {
  b.addEventListener('click', () => {
    applyView(b.dataset.view);
    document.querySelectorAll('.seg button').forEach(x =>
      x.setAttribute('aria-pressed', String(x === b)));
  });
});

function render() {
  document.querySelectorAll('.draw').forEach(row => {
    const v = picks[row.dataset.key];
    row.classList.toggle('picked-a', v === 'a');
    row.classList.toggle('picked-b', v === 'b');
    row.classList.toggle('dropped', v === 'drop');
    row.querySelectorAll('.picks button').forEach(btn =>
      btn.setAttribute('aria-pressed', String(picks[row.dataset.key] === btn.dataset.v)));
  });

  const of = v => Object.keys(picks).filter(k => picks[k] === v);
  const a = of('a'), b = of('b'), dropped = of('drop');
  document.getElementById('t-a').textContent = a[0] || '未选';
  document.getElementById('t-b').textContent = b[0] || '未选';
  document.getElementById('t-d').textContent = dropped.length;

  const lines = [];
  if (a.length) lines.push('皮肤 A ← ' + a[0]);
  if (b.length) lines.push('皮肤 B ← ' + b[0]);
  if (dropped.length) lines.push('淘汰 ← ' + dropped.join('、'));
  const out = document.getElementById('out');
  if (lines.length) {
    out.textContent = lines.join('\\n');
    out.classList.remove('empty');
  } else {
    out.textContent = '还没选。给某一行点「设为皮肤 A」或「设为皮肤 B」，选完把这段文字发我。';
    out.classList.add('empty');
  }
}

document.querySelectorAll('.picks button').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.closest('.draw').dataset.key, v = btn.dataset.v;
    if (picks[key] === v) { delete picks[key]; }
    else {
      // 皮肤 A 和 B 各自只能有一行
      if (v === 'a' || v === 'b') {
        Object.keys(picks).forEach(k => { if (picks[k] === v) delete picks[k]; });
      }
      picks[key] = v;
    }
    render();
  });
});

const dlg = document.getElementById('zoom');
document.querySelectorAll('.frame').forEach(f => {
  f.addEventListener('click', () => {
    if (body.dataset.view === 'real') return;
    const img = f.querySelector('img');
    document.getElementById('zoom-img').src = img.dataset.show || img.getAttribute('src');
    document.getElementById('zoom-cap').textContent = f.dataset.cap;
    dlg.showModal();
  });
});
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
document.getElementById('zoom-close').addEventListener('click', () => dlg.close());

applyView('show');
render();
"""


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def build(plans, base, out, lede_extra=""):
    data = collect(plans, base)
    n = sum(len(p["draws"]) * len(p["draws"][0]["cards"]) for p in data if p["draws"])

    rows = []
    for p in data:
        draws_html = []
        for d in p["draws"]:
            key = f"{p['no']}·抽卡{d['n']}"
            figs = []
            for c in d["cards"]:
                tgt = TARGETS.get(c["label"], "")
                tgt_txt = f" · 目标 {tgt}" if tgt else ""
                cap = (f"{p['dir']}/{c['file']} · 底色 {c['hex']}{tgt_txt}"
                       f" · 饱和 {c['sat']}% · @3x 对比差 {c['contrast']}")
                figs.append(f"""
            <figure>
              <button class="frame" data-cap="{esc(cap)}" aria-label="放大 {esc(c['label'])}">
                <img class="js-show" src="{c['show']}" data-real="{c['real']}" alt="{esc(p['name'])} 抽卡{d['n']} {esc(c['label'])}">
              </button>
              <figcaption>
                <span class="role {c['kind']}">{esc(c['label'])}</span>
                <span class="stats">{c['hex']} · 饱和{c['sat']}% · 对比{c['contrast']}</span>
              </figcaption>
            </figure>""")
            draws_html.append(f"""
        <div class="draw" data-key="{esc(key)}">
          <div class="draw-meta">
            <div class="draw-n">抽卡 {d['n']}</div>
            <div class="picks">
              <button class="pa" data-v="a" aria-pressed="false">设为皮肤 A</button>
              <button class="pb" data-v="b" aria-pressed="false">设为皮肤 B</button>
              <button class="pd" data-v="drop" aria-pressed="false">淘汰</button>
            </div>
          </div>
          <div class="strip">{''.join(figs)}</div>
        </div>""")

        verdict = (f'<span class="chip v-{p["verdict"]}">{VERDICT[p["verdict"]]}</span>'
                   if p["verdict"] else "")
        note = f'<p class="note">{esc(p["note"])}</p>' if p["note"] else ""
        rows.append(f"""
      <section class="plan">
        <div class="plan-head">
          <span class="plan-no">{esc(p['no'])}</span>
          <h2>{esc(p['name'])}</h2>
        </div>
        <div class="chips">
          <span class="chip">{esc(p['style'])}</span>
          <span class="chip">{esc(p['logic'])}</span>
          <span class="chip">{esc(p['symbols'])}</span>
          {verdict}
        </div>
        {note}
        {''.join(draws_html)}
      </section>""")

    # meta charset 放最前面兜底：整页几乎全是中文，宿主万一没声明编码就是满屏乱码。
    # 宿主已经声明的话第一个声明生效，多这一行也无害。
    html = f"""<meta charset="utf-8">
<title>任务牌选片台</title>
<style>{CSS}</style>
<div class="wrap">
  <header>
    <h1>任务牌选片台</h1>
    <p class="lede">每组是<b>牌背 / 成功 / 失败</b>三张一套，同一次请求生成，
    所以组内材质和边框是对齐的。挑两组分别当<b>皮肤 A</b> 和 <b>皮肤 B</b>，剩下的可以标淘汰。
    页面底色就是对局页真实的 <span class="stats">#121816</span>——
    在浅色底上看深色卡面会明显高估可辨认性。{lede_extra}</p>
  </header>

  <div class="bar">
    <div class="seg" role="group" aria-label="视图">
      <button data-view="show" aria-pressed="true">全尺寸</button>
      <button data-view="real" aria-pressed="false">@3x 真实像素</button>
    </div>
    <div class="tally">
      <span>皮肤 A <b class="a" id="t-a">未选</b></span>
      <span>皮肤 B <b class="b" id="t-b">未选</b></span>
      <span>已淘汰 <b id="t-d">0</b></span>
    </div>
  </div>

  <p class="realhint">每张图是 <b>156×231 物理像素</b>（52×77 逻辑点 @3x），
  并且按你这块屏的 devicePixelRatio（<b class="dpr-val">1</b>）换算了 CSS 宽度，
  所以这 156 个像素<b>正好 1:1 落在物理像素上，没有插值也没有放大</b>。<br>
  屏幕 ppi 比手机低，所以它在物理尺寸上还是会比真机显得大一些——
  这是低 ppi 屏的固有限制，没法同时做到像素 1:1 和尺寸 1:1。
  想模拟真机观感，把脸往后挪到平时看手机的两倍距离再看。</p>

  {''.join(rows)}

  <section class="result">
    <h2>你的选择</h2>
    <pre id="out" class="empty">还没选。</pre>
  </section>
</div>

<dialog id="zoom">
  <img id="zoom-img" alt="放大查看">
  <div class="cap"><span id="zoom-cap"></span><button id="zoom-close">关闭</button></div>
</dialog>
<script>{JS}</script>
"""
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    mb = out.stat().st_size / 1024 / 1024
    print(f"已写出 {out.relative_to(ROOT)}  {mb:.1f} MB  内嵌 {n} 张 × 2 份")


if __name__ == "__main__":
    import sys
    if "--round2" in sys.argv:
        build(PLANS2,
              ROOT / "docs/assets/generated/任务牌套v2",
              ROOT / "docs/assets/generated/任务牌套v2/选片台.html",
              lede_extra="每张的底色都标了实测值和目标值，"
                         "牌背目标 #1e2a33（板岩蓝灰）、成功 #1b4936、失败 #241012。")
    else:
        build(PLANS, BASE, OUT)
