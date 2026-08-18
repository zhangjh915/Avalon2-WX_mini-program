"""生成角色插画选片页：27 个角色，每个三选一，或者都不满意 + 写备注。

和任务牌选片台的差别：
  任务牌是从 12 组里挑 2 组当皮肤，重点是 @3x 真机像素能不能认出来；
  角色插画是 27 个角色**各自**三选一，卡在界面上有 330x440pt 那么大，
  可辨认性不是问题，要看的是**长相对不对、气质对不对**。
  所以这里不做真机像素视图，改成能点开看大图。

备注很重要：用户说"都不满意"时得能讲清楚哪里不对，否则重跑还是瞎撞。

用法：
  python3 scripts/build-role-picker.py
"""

import base64
import io
import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs/assets/generated/角色插画/全角色-3抽卡"
OUT = ROOT / "docs/assets/generated/角色插画/角色选片台.html"
SHOW_W = 420

import importlib.util as _ilu

# 角色名单和形象描述只在 gen-roles.py 里维护一份，这里直接加载，避免两处不同步
_spec = _ilu.spec_from_file_location("roles", ROOT / "scripts/gen-roles.py")
_roles_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_roles_mod)
ROLES = _roles_mod.ROLES


def uri(im, q=78):
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=q, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


SRC_OVERRIDE = None


def collect():
    """只收三张齐的角色。缺图的角色放进来会让人误以为只有两个候选，
    还没跑完的时候构建部分页面是有用的，但得说清楚缺了谁。"""
    out, pending = [], []
    for key, (name, faction, desc) in ROLES.items():
        src = SRC_OVERRIDE or SRC
        files = [src / f"{key}_{d}.jpeg" for d in (1, 2, 3)]
        if not all(f.exists() for f in files):
            pending.append(name)
            continue
        draws = []
        for d, f in zip((1, 2, 3), files):
            im = Image.open(f).convert("RGB")
            im = im.resize((SHOW_W, round(im.height * SHOW_W / im.width)), Image.LANCZOS)
            draws.append({"n": d, "img": uri(im), "file": f.name})
        out.append({"key": key, "name": name, "faction": faction,
                    "desc": desc, "draws": draws})
    return out, pending



# ── 变体与重跑批次 ──────────────────────────────────────────
# 文件名两种形态：
#   {key}_{draw}.jpeg        重跑（描述改过，3 抽卡）
#   {key}-v{n}_{draw}.jpeg   变体（同一角色的第 n 个变体，2 抽卡）
EXTRA_SRC = ROOT / "docs/assets/generated/角色插画/变体与重跑"
VARIANTS = _roles_mod.VARIANTS


def collect_extra():
    rows = []
    for key, (name, faction, desc) in ROLES.items():
        # 重跑
        files = sorted(EXTRA_SRC.glob(f"{key}_*.jpeg"))
        if files:
            draws = []
            for f in files:
                n = int(f.stem.rsplit("_", 1)[1])
                im = Image.open(f).convert("RGB")
                im = im.resize((SHOW_W, round(im.height * SHOW_W / im.width)), Image.LANCZOS)
                draws.append({"n": n, "img": uri(im), "file": f.name})
            rows.append({"key": key, "name": name, "faction": faction,
                         "desc": desc, "draws": draws, "kind": "重跑"})
        # 变体
        for i, (vname, vdesc) in enumerate(VARIANTS.get(key, []), start=1):
            files = sorted(EXTRA_SRC.glob(f"{key}-v{i}_*.jpeg"))
            if not files:
                continue
            draws = []
            for f in files:
                n = int(f.stem.rsplit("_", 1)[1])
                im = Image.open(f).convert("RGB")
                im = im.resize((SHOW_W, round(im.height * SHOW_W / im.width)), Image.LANCZOS)
                draws.append({"n": n, "img": uri(im), "file": f.name})
            rows.append({"key": f"{key}-v{i}", "name": f"{name}·{vname}",
                         "faction": faction, "desc": vdesc,
                         "draws": draws, "kind": "变体"})
    return rows, []

CSS = """
:root{
  --ground:#12100e; --surface:#1b1815; --line:#2c2724; --line-strong:#443c36;
  --gold:#c8aa62; --good:#6f93b8; --evil:#b5666b;
  --ink:#ece6da; --ink-mid:#a89f92; --ink-dim:#7a7268;
  --sans:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1400px;margin:0 auto;padding:0 24px 120px}

header{padding:56px 0 26px;border-bottom:1px solid var(--line)}
h1{margin:0 0 10px;font-size:32px;font-weight:700;letter-spacing:-.01em;text-wrap:balance}
.lede{margin:0;max-width:62ch;color:var(--ink-mid)}
.lede b{color:var(--ink);font-weight:600}
.pending{margin:0 0 12px;padding:10px 14px;border-left:3px solid var(--gold);
  background:var(--surface);color:var(--ink-mid);font-size:13px;max-width:70ch}

.bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:16px;
  align-items:center;justify-content:space-between;margin:0 -24px;padding:13px 24px;
  background:color-mix(in srgb,var(--ground) 93%,transparent);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.seg{display:flex;border:1px solid var(--line-strong);border-radius:3px;overflow:hidden}
.seg button{padding:7px 15px;border:0;background:transparent;color:var(--ink-dim);
  font-family:var(--sans);font-size:13px;cursor:pointer}
.seg button+button{border-left:1px solid var(--line-strong)}
.seg button[aria-pressed="true"]{background:var(--gold);color:#17140f;font-weight:600}
.seg button:focus-visible{outline:2px solid var(--gold);outline-offset:-2px}
.progress{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
.meter{width:150px;height:5px;border-radius:3px;background:var(--line-strong);overflow:hidden}
.meter i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}

.faction-head{display:flex;align-items:baseline;gap:12px;padding:44px 0 4px}
.faction-head h2{margin:0;font-size:22px;font-weight:650}
.faction-head .n{font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
.good h2{color:var(--good)} .evil h2{color:var(--evil)}

.role{padding:26px 0;border-top:1px solid var(--line)}
.role.done{background:linear-gradient(90deg,color-mix(in srgb,var(--gold) 7%,transparent),transparent 55%)}
.role.reject{background:linear-gradient(90deg,color-mix(in srgb,var(--evil) 8%,transparent),transparent 55%)}
.role-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:4px}
.role-head h3{margin:0;font-size:19px;font-weight:650}
.role-head code{font-family:var(--mono);font-size:12px;color:var(--ink-dim)}
.badge{font-size:11px;padding:2px 8px;border-radius:2px;border:1px solid}
.badge.good{border-color:var(--good);color:var(--good)}
.badge.evil{border-color:var(--evil);color:var(--evil)}
.desc{margin:0 0 14px;max-width:78ch;font-size:13px;color:var(--ink-dim)}

.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:900px}
.shot{display:flex;flex-direction:column;gap:0;border:2px solid transparent;
  border-radius:4px;background:none;padding:0;cursor:pointer;font:inherit;color:inherit;
  overflow:hidden}
.shot img{display:block;width:100%;height:auto}
.shot .cap{display:flex;justify-content:space-between;align-items:center;
  padding:7px 9px;font-family:var(--mono);font-size:12px;color:var(--ink-dim);
  background:var(--surface)}
.shot:hover{border-color:var(--line-strong)}
.shot:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.shot[aria-pressed="true"]{border-color:var(--gold)}
.shot[aria-pressed="true"] .cap{background:var(--gold);color:#17140f;font-weight:700}
.shot .zoom{opacity:.55}
.shot .zoom:hover{opacity:1}

.reject-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px;max-width:900px}
.reject-row button{padding:6px 12px;border:1px solid var(--line-strong);border-radius:3px;
  background:transparent;color:var(--ink-dim);font-family:var(--sans);font-size:13px;cursor:pointer}
.reject-row button[aria-pressed="true"]{border-color:var(--evil);color:var(--evil);font-weight:600}
.reject-row input{flex:1;min-width:240px;padding:6px 10px;border:1px solid var(--line-strong);
  border-radius:3px;background:var(--surface);color:var(--ink);font-family:var(--sans);font-size:13px}
.reject-row input:focus-visible{outline:2px solid var(--gold);outline-offset:-1px}
.reject-row input:disabled{opacity:.35}

body[data-view="grid"] .shots{max-width:560px;gap:10px}
body[data-view="grid"] .desc{display:none}
body[data-view="grid"] .role{padding:16px 0}

.result{padding:48px 0 0}
.result h2{margin:0 0 6px;font-size:20px;font-weight:650}
.result p{margin:0 0 14px;color:var(--ink-dim);font-size:13px}
pre{margin:0;padding:18px 20px;overflow-x:auto;border:1px solid var(--line-strong);
  border-radius:3px;background:var(--surface);font-family:var(--mono);font-size:13px;
  line-height:1.8;color:var(--ink);white-space:pre-wrap}
.empty{color:var(--ink-dim)}

dialog{border:0;padding:0;max-width:min(94vw,760px);max-height:94vh;background:transparent}
dialog::backdrop{background:rgba(8,7,6,.92)}
dialog img{display:block;width:100%;height:auto;border:1px solid var(--line-strong)}
dialog .cap{display:flex;justify-content:space-between;gap:16px;padding:10px 2px 0;
  font-family:var(--mono);font-size:12px;color:var(--ink-mid)}
dialog button{border:1px solid var(--line-strong);background:transparent;color:var(--ink-mid);
  font-family:var(--sans);font-size:12px;padding:3px 10px;border-radius:2px;cursor:pointer}

@media (max-width:860px){
  .wrap{padding:0 14px 90px}
  h1{font-size:25px}
  .shots{gap:8px}
  body[data-view="grid"] .shots{max-width:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
"""

JS = """
const body = document.body;
const picks = {};      // key -> {choice: 1|2|3|'no', note: string}
const TOTAL = document.querySelectorAll('.role').length;

document.querySelectorAll('.seg button').forEach(b => {
  b.addEventListener('click', () => {
    body.dataset.view = b.dataset.view;
    document.querySelectorAll('.seg button').forEach(x =>
      x.setAttribute('aria-pressed', String(x === b)));
  });
});

function render() {
  let done = 0;
  document.querySelectorAll('.role').forEach(row => {
    const k = row.dataset.key, p = picks[k];
    row.classList.toggle('done', !!p && p.choice !== 'no');
    row.classList.toggle('reject', !!p && p.choice === 'no');
    row.querySelectorAll('.shot').forEach(s =>
      s.setAttribute('aria-pressed', String(!!p && String(p.choice) === s.dataset.n)));
    const rej = row.querySelector('.rej');
    rej.setAttribute('aria-pressed', String(!!p && p.choice === 'no'));
    const note = row.querySelector('.note');
    note.disabled = !(p && p.choice === 'no');
    if (p) done++;
  });
  document.getElementById('done').textContent = done;
  document.getElementById('meter').style.width = (done / TOTAL * 100) + '%';

  const lines = [];
  document.querySelectorAll('.role').forEach(row => {
    const k = row.dataset.key, p = picks[k];
    if (!p) return;
    const label = row.dataset.label;
    if (p.choice === 'no') {
      lines.push(`${label}（${k}）：都不满意` + (p.note ? ` —— ${p.note}` : ''));
    } else {
      lines.push(`${label}（${k}）：第 ${p.choice} 张`);
    }
  });
  const out = document.getElementById('out');
  if (lines.length) {
    out.textContent = lines.join('\\n');
    out.classList.remove('empty');
  } else {
    out.textContent = '还没选。每个角色点一张图选中，或者点「都不满意」并写下哪里不对。';
    out.classList.add('empty');
  }
}

document.querySelectorAll('.role').forEach(row => {
  const k = row.dataset.key;
  row.querySelectorAll('.shot').forEach(s => {
    s.addEventListener('click', e => {
      if (e.target.closest('.zoom')) return;      // 放大按钮不算选中
      const n = Number(s.dataset.n);
      if (picks[k] && picks[k].choice === n) delete picks[k];
      else picks[k] = {choice: n, note: ''};
      render();
    });
  });
  row.querySelector('.rej').addEventListener('click', () => {
    if (picks[k] && picks[k].choice === 'no') delete picks[k];
    else picks[k] = {choice: 'no', note: row.querySelector('.note').value.trim()};
    render();
    if (picks[k]) row.querySelector('.note').focus();
  });
  row.querySelector('.note').addEventListener('input', e => {
    if (picks[k] && picks[k].choice === 'no') { picks[k].note = e.target.value.trim(); render(); }
  });
});

const dlg = document.getElementById('zoom');
document.querySelectorAll('.zoom').forEach(z => {
  z.addEventListener('click', e => {
    e.stopPropagation();
    const s = z.closest('.shot');
    document.getElementById('zoom-img').src = s.querySelector('img').src;
    document.getElementById('zoom-cap').textContent = z.dataset.cap;
    dlg.showModal();
  });
});
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
document.getElementById('zoom-close').addEventListener('click', () => dlg.close());

body.dataset.view = 'full';
render();
"""


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


def build(out_path=None, title="角色选片台", lede=None):
    data, pending = collect()
    if not data:
        sys.exit("找不到图，先跑 python3 scripts/gen-roles.py --all")

    sections = []
    for faction, label in (("good", "正义方"), ("evil", "邪恶方")):
        rows = [r for r in data if r["faction"] == faction]
        sections.append(f'<div class="faction-head {faction}">'
                        f'<h2>{label}</h2><span class="n">{len(rows)} 个角色</span></div>')
        for r in rows:
            shots = []
            for d in r["draws"]:
                cap = f"{r['name']} · {d['file']}"
                shots.append(f"""
          <button class="shot" data-n="{d['n']}" aria-pressed="false"
                  aria-label="选择 {esc(r['name'])} 第 {d['n']} 张">
            <img src="{d['img']}" alt="{esc(r['name'])} 第 {d['n']} 张">
            <span class="cap"><span>第 {d['n']} 张</span>
              <span class="zoom" role="button" tabindex="0" data-cap="{esc(cap)}">放大</span></span>
          </button>""")
            sections.append(f"""
        <section class="role" data-key="{r['key']}" data-label="{esc(r['name'])}">
          <div class="role-head">
            <h3>{esc(r['name'])}</h3>
            <code>{r['key']}</code>
            <span class="badge {r['faction']}">{'正义' if r['faction'] == 'good' else '邪恶'}</span>{f"<span class='badge'>{r['kind']}</span>" if r.get("kind") else ""}
          </div>
          <p class="desc">{esc(r['desc'])}</p>
          <div class="shots">{''.join(shots)}</div>
          <div class="reject-row">
            <button class="rej" aria-pressed="false">都不满意</button>
            <input class="note" type="text" disabled
                   placeholder="哪里不对？例如：太年轻 / 道具错了 / 气质不符 / 服装太现代">
          </div>
        </section>""")

    n_img = sum(len(r["draws"]) for r in data)
    pending_html = (
        f'<p class="pending">⏳ 还有 {len(pending)} 个角色在生成中，暂未列出：'
        f'{esc("、".join(pending))}。跑完会更新这个页面，同一个链接刷新即可。</p>'
        if pending else "")
    html = f"""<meta charset="utf-8">
<title>{title}</title>
<style>{CSS}</style>
<div class="wrap">
  <header>
    <h1>{title}</h1>
    {pending_html}
    <p class="lede">{lede or f"{len(data)} 个角色，每个抽了 3 张。"}每一项<b>点一张选中</b>，
    或者点<b>「都不满意」</b>并写清楚哪里不对——写了我才知道该往哪个方向重跑，
    只说不满意等于让我再瞎撞一次。选完把底部那段文字发我。</p>
  </header>

  <div class="bar">
    <div class="seg" role="group" aria-label="视图">
      <button data-view="full" aria-pressed="true">大图</button>
      <button data-view="grid" aria-pressed="false">紧凑</button>
    </div>
    <div class="progress">
      <span>已定 <b id="done">0</b> / {len(data)}</span>
      <span class="meter"><i id="meter"></i></span>
    </div>
  </div>

  {''.join(sections)}

  <section class="result">
    <h2>你的选择</h2>
    <p>全部选完后把这段发我即可。没选的角色不会出现在里面。</p>
    <pre id="out" class="empty">还没选。</pre>
  </section>
</div>

<dialog id="zoom">
  <img id="zoom-img" alt="放大查看">
  <div class="cap"><span id="zoom-cap"></span><button id="zoom-close">关闭</button></div>
</dialog>
<script>{JS}</script>
"""
    out_path = out_path or OUT
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print("已写出 %s  %.1f MB  %d 个角色 / %d 张图%s" % (
        out_path.relative_to(ROOT), out_path.stat().st_size / 1024 / 1024, len(data), n_img,
        ("，%d 个待生成" % len(pending)) if pending else ""))


if __name__ == "__main__":
    if "--style" in sys.argv:
        st = sys.argv[sys.argv.index("--style") + 1]
        globals()["SRC_OVERRIDE"] = ROOT / f"docs/assets/generated/角色插画/{st}-3抽卡"
        build(ROOT / f"docs/assets/generated/角色插画/选片台-{st}.html",
              title=f"{st}角色卡",
              lede=f"{st}画风，27 个角色各抽了 3 张。")
    elif "--extra" in sys.argv:
        globals()["collect"] = collect_extra
        build(ROOT / "docs/assets/generated/角色插画/变体选片台.html",
              title="变体与重跑",
              lede="这批是两类：<b>重跑</b>——形象和游戏机制对不上，描述改过重出的 4 个角色，"
                   "各 3 张；<b>变体</b>——一局里能出现多次的角色需要不同长相，"
                   "每个变体各 2 张。")
    else:
        build(OUT)
