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
  // 图一律走 <image src="cloud://">：CSS background 只认 https，就得先换临时链接，
  // 而临时链接实测只活约 10 分钟，403 反复出现三轮就是它带来的。
  assert.ok(!/style="\{\{[a-zA-Z]*Bg[\s}]/.test(wxml), `${name}.wxml 不能再把图放进 CSS background`)
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



// 选人面板有两条打开路径：openTable（点按钮）和 applyState 自动打开
// （队长进入组队阶段）。长桌要靠实测 stage 尺寸才能挑档，测量必须两条路径都覆盖——
// 只挂在 openTable 上时，真实对局里队长那一轮的长桌整个不渲染（e2e 截图逮到过）。
const playSrc2 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.match(playSrc2, /tableVisible:\s*phaseChanged \?/, "applyState 仍会自动打开选人面板")
assert.match(playSrc2, /refreshLongTable\(\) \{[\s\S]{0,400}?measureStage\(\)/,
  "refreshLongTable 在没有 stage 尺寸时必须主动补测，否则自动打开的面板挑不出档")

// 远程图链路：预加载池已退役（localCopy 落地缓存取代了它——池子里的 cloud://
// 在非创建者窗口只会刷一串加载失败）。取而代之的守卫：
// 1) 每张远程 image 必须挂 binderror 兜底——落地的 tmp 文件在多账号调试的
//    虚拟窗口渲染层读不了（500），报错时现签 https 顶上，否则那个窗口整图全裂。
const playSrc3 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.ok(!/preload-pool|preloadList/.test(playSrc3 + playWxml), "预加载池已退役，不该再出现")
;[["play", playWxml], ["room", fs.readFileSync(path.join(root, "room", "room.wxml"), "utf8")],
  ["index", fs.readFileSync(path.join(root, "index", "index.wxml"), "utf8")]].forEach(([name, wxml]) => {
  const remoteImages = wxml.match(/<image [^>]*src="\{\{(ui\.floor|ui\.homeBg|longTable\.src|myRoleArt|identityBackArt)[^>]*>/g) || []
  remoteImages.forEach(tag => {
    assert.ok(/binderror="onRemoteImageError"/.test(tag), `${name} 的远程图缺 binderror 兜底: ${tag.slice(0, 70)}`)
    assert.ok(/data-raw=/.test(tag), `${name} 的远程图缺 data-raw（兜底重签要用原始 fileID）: ${tag.slice(0, 70)}`)
  })
})
// 2) 长桌落地：room 页也必须走 localCopy（此前只接了 play，虚拟窗口候场桌子全裂）
const roomSrc3 = fs.readFileSync(path.join(root, "room", "room.js"), "utf8")
const rlRoom = roomSrc3.slice(roomSrc3.indexOf("\n  refreshLongTable() {"))
assert.ok(/localCopy/.test(rlRoom.slice(0, rlRoom.indexOf("\n  },"))), "room 页长桌也要落地")


// 全场只能有一枚金冠，且它戴在「即将掌权的人」头上：
//   还没选接任者时是现任队长；一旦选定，金冠归接任者、现任转灰（他马上卸任了）。
const goldCond = /wx:if="\{\{([^"]*?)\}\}" class="seat-badge leader-badge"/.exec(playWxml)
const retiredCond = /wx:if="\{\{([^"]*?)\}\}" class="seat-badge retired-badge"/.exec(playWxml)
assert.ok(goldCond && retiredCond, "找不到金冠/灰冠条件")
assert.ok(/nextLeaderId/.test(goldCond[1]) && /!nextLeaderId/.test(goldCond[1]),
  "选定接任者后，金冠该归接任者而不是现任")
assert.ok(/nextLeaderId/.test(retiredCond[1]), "灰冠要排除接任者，否则金灰两枚重叠")

// 道具的飞行终点必须是它自己那枚徽标的位置，否则会「飞到中间淡出 + 角上突然冒出来」
const playSrc4 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.match(playSrc4, /BADGE_OFFSET/, "要按徽标位置定飞行终点")
;["leader", "amuletOwner", "magic"].forEach(mode => {
  assert.ok(new RegExp(`BADGE_OFFSET[\\s\\S]{0,200}${mode}`).test(playSrc4), `缺少 ${mode} 的徽标偏移`)
})

// 云端图必须落到本地再渲染：cloud:// 每次渲染都要重新解析、HTTP 缓存命中不了，
// 于是每次开选人面板桌子和地毯都重新下一遍
assert.match(playSrc4, /localCopy/, "长桌与地毯要落本地复用")
const assetsSrc5 = fs.readFileSync(path.join(root, "..", "utils", "assets.js"), "utf8")
assert.match(assetsSrc5, /downloadFile/, "localCopy 要真的把文件下下来")

// 道具在飞的时候，目标身上那枚徽标必须先藏起来。
// 徽标是点击瞬间就随数据出现的，如果不藏，就会和还在飞的道具同时存在——
// 看着就是「两个火球」，也就是反复被指出的「两阶段」。
;["leader-badge", "amulet-badge", "magic-badge"].forEach(cls => {
  const cond = new RegExp(`wx:if="\\{\\{([^"]*?)\\}\\}" class="seat-badge ${cls}"`).exec(playWxml)
  assert.ok(cond, `找不到 ${cls} 的条件`)
  assert.ok(/deliverFlying/.test(cond[1]) && /deliverTargetId/.test(cond[1]),
    `${cls} 要在道具飞行期间隐藏，否则和飞行中的道具重复出现`)
})

// 圣杯纹章要跟着桌子缩放：固定 116rpx 时，窄桌上它几乎和桌面一样宽，看着溢出到桌外
assert.match(playWxml, /class="table-emblem" style="\{\{[^"]*emblemStyle/, "长桌的圣杯要随桌缩放")
const assetsSrc6 = fs.readFileSync(path.join(root, "..", "utils", "assets.js"), "utf8")
assert.match(assetsSrc6, /emblemStyle/, "pickLongTable 要给出圣杯尺寸")

// 阅读时间结束要自动收起密录，否则它是全屏浮层会把「我已记住」整个挡住
const playSrc5 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.match(playSrc5, /identityMode === "remember"[\s\S]{0,200}dossierVisible: false/,
  "阅读结束要自动收起密录")

delete global.Page
console.log("UI binding tests passed")
