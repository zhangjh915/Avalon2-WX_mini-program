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

// homeBg 特意不在这张清单里：它已进包、走 /assets/ 绝对路径，
// 不经云存储也就没有签名/下载失败这回事，不需要 binderror 兜底。
// 远程图链路：预加载池已退役（localCopy 落地缓存取代了它——池子里的 cloud://
// 在非创建者窗口只会刷一串加载失败）。取而代之的守卫：
// 1) 每张远程 image 必须挂 binderror 兜底——落地的 tmp 文件在多账号调试的
//    虚拟窗口渲染层读不了（500），报错时现签 https 顶上，否则那个窗口整图全裂。
const playSrc3 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.ok(!/preload-pool|preloadList/.test(playSrc3 + playWxml), "预加载池已退役，不该再出现")
;[["play", playWxml], ["room", fs.readFileSync(path.join(root, "room", "room.wxml"), "utf8")],
  ["index", fs.readFileSync(path.join(root, "index", "index.wxml"), "utf8")]].forEach(([name, wxml]) => {
  const remoteImages = wxml.match(/<image [^>]*src="\{\{(ui\.floor|longTable\.src|myRoleArt|identityBackArt)[^>]*>/g) || []
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
// 首夜屏：真人主持念稿，app 只提供一个「天亮」按钮。
// 逐句推进的仪式脚本已整套下线——玩家认人时全程闭眼，屏上文字没人看，
// 还逼房主一边主持一边读屏。锁住：不许把脚本推进重新长回来。
const nightBlock = (playWxml.match(/<view wx:if="\{\{phase === 'night'\}\}"[\s\S]*?\n    <\/view>/) || [""])[0]
assert.ok(nightBlock, "找不到首夜屏区块")
;["nightStep", "currentNightLine", "nightProgressPercent", "nextNightStep", "prevNightStep"].forEach(gone => {
  assert.ok(nightBlock.indexOf(gone) < 0, `首夜屏不该再有仪式脚本推进: ${gone}`)
})
const nightButtons = nightBlock.match(/<button[^>]*bindtap="([^"]+)"/g) || []
assert.strictEqual(nightButtons.length, 1, `首夜屏房主只该有一个按钮，实际 ${nightButtons.length} 个`)
assert.match(nightButtons[0], /bindtap="enterMission"/, "那一个按钮必须是「天亮」")
const playSrcNight = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
;["applyNightStep", "startNightDirectives", "nightCeremony", "nightDirective"].forEach(gone => {
  assert.ok(playSrcNight.indexOf(gone) < 0, `play.js 残留已下线的夜间仪式代码: ${gone}`)
})

// 座位尺寸必须跟着台面实测值算，不能写死。
// 两块台面差很多：选人面板是 flex:1 撑满屏高（10 人局实测 584pt），
// 终局猎杀那块只有 452pt。写死一个尺寸必然一边浪费一边压脸。
const playSrcSeat = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.match(playSrcSeat, /refreshSeatSize\(\)\s*\{/, "缺少座位尺寸自适应")
const seatFn = playSrcSeat.slice(playSrcSeat.indexOf("refreshSeatSize() {"))
const seatBody = seatFn.slice(0, seatFn.indexOf("\n  },"))
assert.match(seatBody, /pitch - 16/, "座位尺寸要减掉名字条的高度，否则名字压在下一个人脸上")
assert.match(seatBody, /Math\.max\(32/, "座位尺寸要有下限，太小认不出人")
assert.match(seatBody, /Math\.min\(47/, "座位尺寸要有上限，头像资产按 42pt 画的")
// 调用点必须在挑档**之前**：挑档有「桌子没变就 return」的早退，
// 排在它后面的话切台面时算不到，圆桌局更是压根走不到那儿。
const refresh = playSrcSeat.slice(playSrcSeat.indexOf("\n  refreshLongTable() {"))
const seatCall = refresh.indexOf("this.refreshSeatSize()")
const tierPick = refresh.indexOf("assets.pickLongTable(")
assert.ok(seatCall > 0 && seatCall < tierPick, "refreshSeatSize 必须排在长桌挑档之前")
// 两块台面的座位都要吃这个尺寸
const seatTokens = playWxml.match(/<view[^>]*class="seat-token game-seat-token[^>]*>/g) || []
assert.strictEqual(seatTokens.length, 2, `应有两处座位，实际 ${seatTokens.length}`)
seatTokens.forEach(tag => assert.match(tag, /width: \{\{seatSize\}\}px/, "座位没吃自适应尺寸"))

// 深色主题：全 app 的底面必须是深的。
// 289 处色值是一次性翻过来的，以后随手补一条 background: #fff 就破功了，
// 而这种问题在开发者工具里未必一眼看得出（浅底浅字反而"看着还行"）。
// 只查底面和边框；文字/金饰在深底上本来就该是浅的，不查。
{
  const lum = hex => {
    const v = hex.length === 4
      ? [hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3]]
      : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
    const [r, g, b] = v.map(x => parseInt(x, 16))
    return { L: (r * 299 + g * 587 + b * 114) / 1000, C: Math.max(r, g, b) - Math.min(r, g, b) }
  }
  const SURFACE = ["background", "background-color", "border", "border-color", "border-top",
    "border-bottom", "border-left", "border-right", "border-top-color", "border-bottom-color"]
  const sheets = ["app.wxss", "pages/index/index.wxss", "pages/room/room.wxss",
    "pages/play/play.wxss", "pages/result/result.wxss"]
  const offenders = []
  sheets.forEach(rel => {
    const css = fs.readFileSync(path.join(__dirname, "..", "miniprogram", rel), "utf8")
    const decls = css.match(/[a-z-]+\s*:\s*[^;{}]+/g) || []
    decls.forEach(decl => {
      const prop = decl.slice(0, decl.indexOf(":")).trim()
      if (SURFACE.indexOf(prop) < 0) return
      const hexes = decl.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g) || []
      hexes.forEach(hex => {
        const { L, C } = lum(hex.toLowerCase())
        // L 是 0~255 的亮度。150 这个阈值卡在「深色阶最亮的一档」和「羊皮纸」之间：
        //   深色面 #202623=37、#323b36=56、强调棕 #795436=92  —— 都放行
        //   羊皮纸 #e5ded2=223、#fffaf1=250              —— 要拦住
        // 高色度的是金/绿/红强调色，深底上本来就该亮，另外放行。
        // 60 这个色度界：羊皮纸系全在 20 以下，而最淡的强调色（护身符火花
        // #70b099）色度 64——卡 70 会把它误当浅底面。
        if (L > 150 && C < 60) offenders.push(`${rel}: ${decl.trim().slice(0, 60)}`)
      })
    })
  })
  assert.strictEqual(offenders.length, 0, `深色主题里混进了浅底面:\n  ${offenders.join("\n  ")}`)
}
// 导航栏要贴合首页底图顶部，不能是原来那个棕色
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "miniprogram", "app.json"), "utf8"))
assert.strictEqual(appJson.window.navigationBarBackgroundColor.toLowerCase(), "#0b110f",
  "导航栏底色应贴合首页底图顶部 6% 的中位色")
assert.strictEqual(appJson.window.navigationBarTextStyle, "white", "深色导航栏上要用白字")

// 按钮文字必须垂直居中。
// 小程序的 <button> 自带行高，一旦用 min-height 把盒子撑高又不同步设行高，
// 文字就贴在顶上——「让测试骑士行动」那颗是这么被发现的，同类共 7 处。
// 现在由 app.wxss 一条通用规则兜底；这里锁住两件事：规则还在，
// 以及**每个自己设了高度的按钮类**都被那条规则覆盖到。
{
  const appCss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "app.wxss"), "utf8")
  const centerRule = /([^{}]*?)\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*\}/g
  let covered = null
  let m
  while ((m = centerRule.exec(appCss))) {
    if (m[1].indexOf("button") >= 0) { covered = m[1].split(",").map(x => x.trim()); break }
  }
  assert.ok(covered, "app.wxss 缺少按钮垂直居中的通用规则")

  const sheets = ["app.wxss", "pages/index/index.wxss", "pages/room/room.wxss", "pages/play/play.wxss"]
  const uncovered = []
  sheets.forEach(rel => {
    const css = fs.readFileSync(path.join(__dirname, "..", "miniprogram", rel), "utf8")
    const rules = css.match(/[^{}]+\{[^}]*\}/g) || []
    rules.forEach(rule => {
      const sel = rule.slice(0, rule.indexOf("{")).trim()
      const body = rule.slice(rule.indexOf("{"))
      if (!/-action\b|\.btn\b|loyalty-button|dial-key/.test(sel)) return
      if (/\[disabled\]|:active|::after/.test(sel)) return
      if (!/(?:^|;|\{)\s*(?:min-)?height:\s*\d+rpx/.test(body)) return
      if (/line-height:/.test(body)) return
      if (/display:\s*flex/.test(body) && /align-items:\s*center/.test(body)) return
      // 落到通用规则上才算安全
      const cls = (sel.match(/\.[a-z-]+/g) || []).map(x => x.trim())
      const hit = cls.some(c => covered.indexOf(c) >= 0)
      if (!hit) uncovered.push(`${rel}: ${sel.slice(0, 50)}`)
    })
  })
  assert.deepStrictEqual(uncovered, [],
    `这些按钮设了高度但没被居中规则覆盖，文字会贴顶:\n  ${uncovered.join("\n  ")}`)
}

