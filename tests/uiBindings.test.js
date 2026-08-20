const assert = require("assert")
const fs = require("fs")
const path = require("path")

const pages = ["index", "room", "play", "result"]
const root = path.join(__dirname, "..", "miniprogram", "pages")

pages.forEach(name => {
  const pageRoot = path.join(root, name, name)
  const wxml = fs.readFileSync(`${pageRoot}.wxml`, "utf8")
  let definition = null
  global.Page = value => { definition = value }
  delete require.cache[require.resolve(`${pageRoot}.js`)]
  require(`${pageRoot}.js`)
  assert.ok(definition, `${name} page did not register`)
  const handlers = Array.from(wxml.matchAll(/(?:bind|catch)(?:tap|input|change|longpress)="([A-Za-z0-9_]+)"/g), match => match[1])
  handlers.forEach(handler => assert.strictEqual(typeof definition[handler], "function", `${name}.${handler} is missing`))
  assert.ok(!/>\s*×\s*</.test(wxml), `${name} uses a text close glyph`)
  assert.ok(!/class="[^"]*sheet-close/.test(wxml), `${name} uses the retired sheet-close button`)
})

const indexWxml = fs.readFileSync(path.join(root, "index", "index.wxml"), "utf8")
const indexWxss = fs.readFileSync(path.join(root, "index", "index.wxss"), "utf8")
const roomWxml = fs.readFileSync(path.join(root, "room", "room.wxml"), "utf8")
const roomWxss = fs.readFileSync(path.join(root, "room", "room.wxss"), "utf8")
const playWxml = fs.readFileSync(path.join(root, "play", "play.wxml"), "utf8")
const playWxss = fs.readFileSync(path.join(root, "play", "play.wxss"), "utf8")
assert.strictEqual((indexWxml.match(/class="modal-close"/g) || []).length, 5, "all index sheets need the shared close control")
// 圆桌纪录、我的密录、以及选人全屏页都要有统一的关闭控件
assert.strictEqual((playWxml.match(/class="modal-close"/g) || []).length, 3, "play full-screen pages need the shared close control")
assert.match(playWxml, /bindtap="openDossier"/, "对局中需要能随时打开我的密录")
assert.match(playWxml, /myInspections/, "我的密录需要展示自己的查验记录")
// 自己的出牌并进圆桌纪录里对应轮次，不再单独占一块（原来分散在密录里太割裂）
assert.match(playWxml, /history-mine/, "圆桌纪录里要标出自己那一轮打的牌")
assert.ok(!/创建圆桌|设置本局的圆桌/.test(indexWxml), "creation copy must support long and round tables")
assert.match(indexWxml, />创建房间</, "creation action should use neutral room wording")
assert.match(indexWxss, /\.create-sheet\s*\{[^}]*height:\s*100%/, "creation setup must occupy the full screen")
assert.ok(!/圆桌候场|角色候选池/.test(roomWxml), "lobby copy must not assume a round table or inline the role pool")
assert.match(roomWxml, /class="role-config-button"/, "lobby needs a compact role configuration entry")
assert.match(roomWxml, /class="role-viewer"/, "lobby needs the shared fixed role viewer")
assert.match(roomWxml, /class="role-candidate-list"[^>]*scroll-y/, "role skills should appear together in a faction list")
assert.ok(!/bindtap="selectRoleDetail"/.test(roomWxml), "role details should not require selecting each role")
assert.match(roomWxml, /class="role-candidate-count"> x/, "duplicate roles should show their count beside the name")
assert.match(roomWxss, /\.page\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s, "lobby must be a fixed viewport")
assert.strictEqual((playWxml.match(/round-seat-stage/g) || []).length, 2, "both in-game round selectors need square stages")
assert.match(playWxss, /round-seat-stage\s*\{[^}]*width:\s*650rpx;[^}]*height:\s*650rpx/s, "main in-game round selector must be square")

// 状态印不再用汉字。原来 10 处共用一张底纹只靠一个字区分，
// 「该我动」和「我交完了」在视觉上几乎没差别，玩家得读字才知道要不要动。
// 现在圆圈里是自己的角色立绘，状态由边框的动静表达。
assert.ok(!/class="submitted-seal[^"]*"[^>]*>\s*[\u4e00-\u9fa5]/.test(playWxml), "状态印里不该再出现汉字")
assert.ok(/seal-waiting/.test(playWxml) && /seal-sealed/.test(playWxml), "等待态与已封存态必须能区分")
// 状态印里不能出现任何身份图——立绘会泄底，卡背等于把牌又摆了一遍。
// 放的是自己的座位头像（名字首字），有个人标识而不带任何身份信息。
assert.ok(!/class="submitted-seal[^"]*"[^>]*>\s*<image[^>]*(myRoleArt|identityBackArt)/.test(playWxml),
  "状态印里不能放角色立绘或卡背")
assert.match(playWxml, /class="submitted-seal[^"]*"[^>]*>\s*<image class="seal-base"[^>]*\/>\s*<view class="seal-initial">/,
  "状态印应当是「印章底纹垫底 + 座位头像」")

// 翻开身份牌之前，密录和「本局思路」里直接写着自己的角色，点开就等于提前看牌
assert.match(playWxml, /bindtap="openDossier"/, "对局中要能打开密录")
;[/wx:if="\{\{privateView\.roleName && identityUnlocked\}\}"[^>]*dossier-button/,
  /<button wx:if="\{\{identityUnlocked\}\}"[^>]*>查看本局思路<\/button>/].forEach(re => {
  assert.match(playWxml, re, "身份揭示前必须藏起密录/攻略入口")
})
const playJsSrc = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.match(playJsSrc, /openDossier\(\) \{[^}]*identityUnlocked/s, "openDossier 要有兜底防护")

// 长桌整图的两条硬约束
;[["play", playWxml], ["room", roomWxml]].forEach(([name, wxml]) => {
  if (!/class="long-table"/.test(wxml)) return
  // ±8% 的拉伸靠 scaleToFill 吸收。aspectFit 会留边、aspectFill 会裁掉桌沿。
  assert.match(wxml, /class="long-table"[^>]*mode="scaleToFill"/, `${name} 长桌必须用 scaleToFill`)
  // 纹章绝不能放进 .long-table 里：竖桌靠 rotate(90deg) 实现，
  // transform 对整个子树生效，会把圣杯一起转过去。真实踩过。
  assert.ok(!/<image class="long-table"[^>]*>[\s\S]*?table-emblem[\s\S]*?<\/image>/.test(wxml),
    `${name} 纹章不能嵌在长桌图里`)
  const slot = wxml.slice(wxml.indexOf('class="table-slot"'))
  const slotEnd = slot.indexOf("</view>")
  assert.ok(!/table-emblem/.test(slot.slice(0, slotEnd)), `${name} 纹章不能放进 table-slot（会跟着旋转）`)
})

// 走 CSS background 的图必须先换成 https 临时链接，而临时链接会过期成 403
// （实测生成后十几分钟就失效，反复修了三轮都是在错的方向上使劲）。
// 现在一律改用 <image src="cloud://">，由微信自己解析，不再经手临时链接。
;["index", "room", "play", "result"].forEach(name => {
  const wxml = fs.readFileSync(path.join(root, name, `${name}.wxml`), "utf8")
  assert.ok(!/style="\{\{[a-zA-Z]*Bg[\s}]/.test(wxml), `${name}.wxml 不能再把图放进 CSS background`)
})
// 同 assets.test.js：只看实际代码，顶部的警示注释里本来就写着这个词
const assetsSrc2 = fs.readFileSync(path.join(root, "..", "utils", "assets.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
assert.ok(!/getTempFileURL/.test(assetsSrc2), "不该再需要临时链接")

delete global.Page
console.log("UI binding tests passed")
