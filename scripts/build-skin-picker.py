"""皮肤选片页：一套皮肤一个页面，27 角色三选一 + 卡背三选一。

嵌入宽度 = 显示宽度 × 2：Retina 屏上 1 CSS 像素 = 2 物理像素，
嵌多大就按一半显示，才不会被浏览器拉糊。
"""
import base64, io, json, pathlib, sys
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = ROOT / "docs/assets/generated/皮肤"
# Artifact 上限 16MB。线稿类图（木刻）压缩率差，同样参数能到 19MB，
# 所以嵌入宽度和质量都留了余量，超了会被拒绝发布。
DISPLAY_W, EMBED_W = 260, 520
QUALITY = 68
MAX_MB = 13          # Artifact 上限 16MB，留 3MB 余量
QUALITY_FLOOR = 40
sys.path.insert(0, str(ROOT / "scripts"))
from prompts import ROSTER, load_skin

SETTLED_DIR = ROOT / "docs/assets/prompts/_选择"


def settled(skin):
    """上一轮已定的项，页面上标成「已定」不再要求操作。
    不这样的话用户面对几十项分不清哪些是新的。"""
    f = SETTLED_DIR / f"{skin}.json"
    if not f.exists():
        return {}
    return {k: v for k, v in json.loads(f.read_text()).items()
            if not k.startswith("_")}


def uri(im, q=None):
    q = QUALITY if q is None else q
    b = io.BytesIO(); im.save(b, format="JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()


def shots(d, stem):
    out = []
    for f in sorted(d.glob(stem + "_*.jpeg")):
        n = int(f.stem.rsplit("_", 1)[1])
        im = Image.open(f).convert("RGB")
        im = im.resize((EMBED_W, round(im.height * EMBED_W / im.width)), Image.LANCZOS)
        out.append({"n": n, "img": uri(im)})
    return out


def esc(s):
    return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")


CSS = """
:root{--ground:#0f0f11;--surface:#191a1d;--line:#26282c;--line2:#3c3f45;
 --gold:#c9a961;--good:#6f93b8;--evil:#b5666b;--ink:#eceae6;--mid:#a2a29e;--dim:#75756f;
 --sans:"PingFang SC","Hiragino Sans GB",system-ui,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:15px;
 line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1320px;margin:0 auto;padding:0 24px 120px}
header{padding:52px 0 22px;border-bottom:1px solid var(--line)}
h1{margin:0 0 8px;font-size:31px;font-weight:700}
.lede{margin:0;max-width:66ch;color:var(--mid)}.lede b{color:var(--ink);font-weight:600}
.bar{position:sticky;top:0;z-index:20;display:flex;gap:16px;align-items:center;justify-content:space-between;
 margin:0 -24px;padding:12px 24px;background:color-mix(in srgb,var(--ground) 94%,transparent);
 backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.prog{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:12px;color:var(--dim)}
.meter{width:170px;height:5px;border-radius:3px;background:var(--line2);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}
h2.sec{margin:44px 0 0;font-size:22px;font-weight:650;color:var(--gold)}
.item{padding:22px 0;border-top:1px solid var(--line)}
.item.done{background:linear-gradient(90deg,color-mix(in srgb,var(--gold) 7%,transparent),transparent 52%)}
.item.reject{background:linear-gradient(90deg,color-mix(in srgb,var(--evil) 8%,transparent),transparent 52%)}
.ih{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:3px}
.ih h3{margin:0;font-size:18px;font-weight:650}
.ih code{font-family:var(--mono);font-size:12px;color:var(--dim)}
.badge{font-size:11px;padding:2px 8px;border-radius:2px;border:1px solid}
.badge.good{border-color:var(--good);color:var(--good)}.badge.evil{border-color:var(--evil);color:var(--evil)}
.desc{margin:0 0 12px;max-width:80ch;font-size:13px;color:var(--dim)}
.item.settled{opacity:.4}
.item.settled:hover{opacity:1}
.badge.settled-badge{border-color:var(--dim);color:var(--dim)}
body.hide-settled .item.settled{display:none}
.shots{display:flex;gap:12px;flex-wrap:wrap}
.shot{display:flex;flex-direction:column;border:2px solid transparent;border-radius:4px;background:none;
 padding:0;cursor:pointer;font:inherit;color:inherit;overflow:hidden;width:__W__px}
.shot img{display:block;width:100%;height:auto}
.shot .cap{padding:6px 8px;font-family:var(--mono);font-size:12px;color:var(--dim);background:var(--surface)}
.shot:hover{border-color:var(--line2)}
.shot:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.shot[aria-pressed="true"]{border-color:var(--gold)}
.shot[aria-pressed="true"] .cap{background:var(--gold);color:#17130d;font-weight:700}
.rej-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:11px}
.rej-row button{padding:6px 12px;border:1px solid var(--line2);border-radius:3px;background:transparent;
 color:var(--dim);font-family:var(--sans);font-size:13px;cursor:pointer}
.rej-row button[aria-pressed="true"]{border-color:var(--evil);color:var(--evil);font-weight:600}
.rej-row input{flex:1;min-width:240px;padding:6px 10px;border:1px solid var(--line2);border-radius:3px;
 background:var(--surface);color:var(--ink);font-family:var(--sans);font-size:13px}
.rej-row input:disabled{opacity:.35}
.result{padding:48px 0 0}.result h2{margin:0 0 6px;font-size:20px;font-weight:650}
.result p{margin:0 0 12px;font-size:13px;color:var(--dim)}
pre{margin:0;padding:18px 20px;border:1px solid var(--line2);border-radius:3px;background:var(--surface);
 font-family:var(--mono);font-size:13px;line-height:1.8;white-space:pre-wrap;overflow-x:auto}
.empty{color:var(--dim)}
@media (max-width:820px){.wrap{padding:0 14px 90px}h1{font-size:24px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
""".replace("__W__", str(DISPLAY_W))

JS = """
const picks={}; // 进度只算需要你操作的项，上轮已定的不计入
const TOTAL=document.querySelectorAll('.item:not(.settled)').length;
document.getElementById('total').textContent=TOTAL;
const tg=document.getElementById('toggle');
tg.addEventListener('click',()=>{
  document.body.classList.toggle('hide-settled');
  tg.textContent=document.body.classList.contains('hide-settled')?'显示全部':'只看待选';
});
function render(){
  document.querySelectorAll('.item').forEach(r=>{
    const p=picks[r.dataset.key];
    r.classList.toggle('done', !!p && p.c!=='no');
    r.classList.toggle('reject', !!p && p.c==='no');
    r.querySelectorAll('.shot').forEach(s=>s.setAttribute('aria-pressed',
      String(!!p && String(p.c)===s.dataset.n)));
    const rj=r.querySelector('.rej'); if(rj) rj.setAttribute('aria-pressed', String(!!p&&p.c==='no'));
    const nt=r.querySelector('.note'); if(nt) nt.disabled=!(p&&p.c==='no');
  });
  const n=Object.keys(picks).filter(k=>
  !document.querySelector(`.item[data-key="${CSS.escape(k)}"]`)
    ?.classList.contains('settled')).length;
  document.getElementById('done').textContent=n;
  document.getElementById('meter').style.width=(n/TOTAL*100)+'%';
  const lines=[];
  document.querySelectorAll('.item').forEach(r=>{
    const p=picks[r.dataset.key]; if(!p) return;
    lines.push(p.c==='no' ? `${r.dataset.label}（${r.dataset.key}）：都不满意`+(p.note?` —— ${p.note}`:'')
                          : `${r.dataset.label}（${r.dataset.key}）：第 ${p.c} 张`);
  });
  const o=document.getElementById('out');
  if(lines.length){o.textContent=lines.join('\\n');o.classList.remove('empty');}
  else{o.textContent='还没选。每项点一张选中，或点「都不满意」并写下哪里不对。';o.classList.add('empty');}
}
document.querySelectorAll('.item').forEach(r=>{
  const k=r.dataset.key;
  r.querySelectorAll('.shot').forEach(s=>s.addEventListener('click',()=>{
    const n=Number(s.dataset.n);
    if(picks[k]&&picks[k].c===n) delete picks[k]; else picks[k]={c:n,note:''};
    render();
  }));
  const rj=r.querySelector('.rej');
  if(rj) rj.addEventListener('click',()=>{
    if(picks[k]&&picks[k].c==='no') delete picks[k];
    else picks[k]={c:'no',note:r.querySelector('.note').value.trim()};
    render(); if(picks[k]) r.querySelector('.note').focus();
  });
  const nt=r.querySelector('.note');
  if(nt) nt.addEventListener('input',e=>{
    if(picks[k]&&picks[k].c==='no'){picks[k].note=e.target.value.trim();render();}
  });
});
render();
"""


def build(skin):
    global QUALITY
    sk = load_skin(skin)
    rd, bd = BASE / skin / "角色", BASE / skin / "卡背"
    items, n_img = [], 0

    done = settled(skin)

    def block(key, label, badge, desc, sh):
        nonlocal n_img
        n_img += len(sh)
        figs = "".join(
            f'<button class="shot" data-n="{s["n"]}" aria-pressed="false">'
            f'<img src="{s["img"]}" alt="{esc(label)} 第{s["n"]}张">'
            f'<span class="cap">第 {s["n"]} 张</span></button>' for s in sh)
        pick = done.get(key)
        cls = "item settled" if pick else "item"
        mark = (f'<span class="badge settled-badge">上轮已定 · 第 {pick} 张</span>'
                if pick else "")
        return f"""
      <div class="{cls}" data-key="{esc(key)}" data-label="{esc(label)}"
           data-settled="{pick or ''}">
        <div class="ih"><h3>{esc(label)}</h3><code>{esc(key)}</code>{badge}{mark}</div>
        <p class="desc">{esc(desc)}</p>
        <div class="shots">{figs}</div>
        <div class="rej-row"><button class="rej" aria-pressed="false">都不满意</button>
          <input class="note" type="text" disabled placeholder="哪里不对？"></div>
      </div>"""

    for fac, fname in (("good", "正义方"), ("evil", "邪恶方")):
        keys = [k for k, v in ROSTER.items() if v["faction"] == fac]
        items.append(f'<h2 class="sec">{fname}<span style="font-family:var(--mono);'
                     f'font-size:12px;color:var(--dim);font-weight:400"> {len(keys)} 个</span></h2>')
        b = f'<span class="badge {fac}">{"正义" if fac=="good" else "邪恶"}</span>'
        for k in keys:
            if k in sk.variants:
                for i, (vname, vdesc) in enumerate(sk.variants[k]):
                    sh = shots(rd, f"{k}-v{i+1}")
                    if sh:
                        items.append(block(f"{k}-v{i+1}",
                                           f'{ROSTER[k]["name"]}·{vname}', b, vdesc, sh))
            else:
                sh = shots(rd, k)
                if sh:
                    items.append(block(k, ROSTER[k]["name"], b, sk.roles[k], sh))

    items.append('<h2 class="sec">卡背<span style="font-family:var(--mono);font-size:12px;'
                 'color:var(--dim);font-weight:400"> 3 种纹样，选一种</span></h2>')
    for m in sk.motifs:
        sh = shots(bd, m)
        if sh:
            items.append(block("back-" + m, "卡背 · " + m, "", sk.motifs[m], sh))

    html = f"""<meta charset="utf-8">
<title>{esc(skin)}皮肤</title>
<style>{CSS}</style>
<div class="wrap">
  <header><h1>{esc(skin)}</h1>
  <p class="lede">{esc(sk.note)}<br>27 个角色各抽 3 张、卡背 3 种纹样各 3 张。
  每项<b>点一张选中</b>，或点<b>「都不满意」</b>写清哪里不对。选完把底部文字发我。</p></header>
  <div class="bar">
    <button id="toggle" style="padding:6px 12px;border:1px solid var(--line2);border-radius:3px;
      background:transparent;color:var(--ink);font-family:var(--sans);font-size:13px;cursor:pointer">
      只看待选</button>
    <div class="prog"><span>已定 <b id="done">0</b> / <span id="total">0</span></span>
      <span class="meter"><i id="meter"></i></span></div></div>
  {''.join(items)}
  <section class="result"><h2>你的选择</h2>
    <p>每个形象选一张，卡背三种纹样里选一种。选完发我。</p>
    <pre id="out" class="empty">还没选。</pre></section>
</div>
<script>{JS}</script>
"""
    out = BASE / skin / f"选片台-{skin}.html"
    out.write_text(html, encoding="utf-8")
    print("已写出 %s  %.1f MB  %d 张图" % (
        out.relative_to(ROOT), out.stat().st_size/1024/1024, n_img))
    return out


if __name__ == "__main__":
    for s in sys.argv[1:] or ["幻想华服", "木刻线刻"]:
        # 线稿类图压缩率差得多，同样参数木刻能比厚涂大 70%。
        # 超了就降质重建，别赌 Artifact 的 16MB 上限。
        while True:
            out = build(s)
            mb = out.stat().st_size / 1024 / 1024
            if mb <= MAX_MB or QUALITY <= QUALITY_FLOOR:
                break
            QUALITY -= 8
            print("  %.1f MB 超过 %d MB，降到 quality=%d 重建" % (mb, MAX_MB, QUALITY))
