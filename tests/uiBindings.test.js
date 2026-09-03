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
  /<view wx:if="\{\{identityUnlocked\}\}"[^>]*>查看本局思路<\/view>/].forEach(re => {
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



// 选人面板只能由人点开（openTable），applyState **不许**替队长自动弹出：
// 队长刚拿到皇冠时全桌正在讨论谁上车，他的手机不该被钉在满屏座位图上。
// 阶段一换只做一件事——把开着的面板收掉。
const playSrc2 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.match(playSrc2, /tableVisible:\s*phaseChanged \? false :/, "applyState 不得在换阶段时自动打开选人面板")
assert.ok(!/tableVisible:\s*phaseChanged \? \(room\.phase === "mission"/.test(playSrc2), "选人面板又被自动弹开了")
// 长桌要靠实测 stage 尺寸才能挑档；面板开着却量到 0 时必须补测，否则桌子整个不渲染
assert.match(playSrc2, /refreshLongTable\(\) \{[\s\S]{0,400}?measureStage\(\)/,
  "refreshLongTable 在没有 stage 尺寸时必须主动补测，否则面板挑不出档")

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

// 阅读时间结束**不能**把密录强行收起。
// 原先是收的（怕全屏浮层挡住「我已记住」），但阅读窗口只有 40 秒，
// 读完「本局思路」基本必定超时——一超时浮层被关、身份牌同时收起，
// 玩家再也回不到身份大图（实战中被抓到）。
// 现在改成把收尾操作搬进浮层里，所以这里锁两件事：
//   1. 不许再出现「到点就 dossierVisible: false」
//   2. 浮层里必须有出路（「我已记住」），否则换成另一种困住
const playSrc5 = fs.readFileSync(path.join(root, "play", "play.js"), "utf8")
assert.ok(!/identityMode === "remember"[\s\S]{0,200}dossierVisible: false/.test(playSrc5),
  "阅读结束不该强行收起密录——会把人踢到再也翻不开身份牌的界面")
const dossier = playWxml.slice(playWxml.indexOf('wx:if="{{dossierVisible}}"'))
const dossierBlock = dossier.slice(0, dossier.indexOf("</scroll-view>"))
assert.match(dossierBlock, /bindtap="rememberIdentity"/,
  "阅读时间可能在密录开着时走完，浮层里必须能就地确认，否则玩家被困住")
assert.match(dossierBlock, /identityMode === 'remember'/,
  "浮层里的收尾操作应当只在阅读时间结束后出现")

delete global.Page
// 「天黑请闭眼」整段下线：夜里要传的信息全在身份牌的秘密信息里，
// 那一屏只剩房主连点两下。全员记住身份后，房主的按钮直接开远征。
assert.ok(playWxml.indexOf("phase === 'night'") < 0, "夜晚屏又长回来了")
assert.ok(playWxml.indexOf("enterNight") < 0 && playSrc2.indexOf("enterNight") < 0, "客户端不该再发 enterNight")
const rememberBlock = (playWxml.match(/identityMode === 'remember'[\s\S]*?identity-progress[\s\S]*?<\/view>\s*<\/view>/) || [""])[0]
assert.match(rememberBlock, /bindtap="enterMission">开始远征</, "全员记住后房主应当一键「开始远征」")

// 出征名单要常驻在投票屏和结算屏上（全员可见）：队伍是队长在自己手机上定的，
// 别人只在横幅里看到 2.6 秒，之后只能去战绩里翻。
;["vote", "missionResult"].forEach(phase => {
  const block = (playWxml.match(new RegExp(`<view wx:if="\\{\\{phase === '${phase}'\\}\\}"[\\s\\S]*?\\n    <\\/view>`)) || [""])[0]
  assert.ok(block, `找不到 ${phase} 屏区块`)
  assert.match(block, /wx:for="\{\{teamPlayers\}\}"/, `${phase} 屏必须列出出征成员`)
  assert.match(block, /magicTargetId/, `${phase} 屏的名单要标出火球在谁身上`)
})
// 结算屏对老队长先是结算屏：讨论完了再点「交接皇冠」进选人，不许一上来就是选人界面
const resultBlock = (playWxml.match(/<view wx:if="\{\{phase === 'missionResult'\}\}"[\s\S]*?\n    <\/view>/) || [""])[0]
assert.match(resultBlock, /'交接皇冠'/, "结算屏的入口按钮应当是「交接皇冠」")
assert.ok(!/等待当前队长/.test(resultBlock), "结算屏不该催队长")

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

// ---- 样式表解析（四条 CSS 守卫共用）----
// 一次读、一次切，且**先剥注释**：规则切分的正则会把规则前面的注释算进
// 选择器里，而注释里常常写着 88rpx、<button> 这类词，直接让守卫误报
//（真踩过：一条解释"别写死行高"的注释自己被判成写死了行高）。
const STYLE_SHEETS = ["app.wxss", "pages/index/index.wxss", "pages/room/room.wxss",
  "pages/play/play.wxss", "pages/result/result.wxss"]
const STYLE_RULES = STYLE_SHEETS.map(rel => {
  const css = fs.readFileSync(path.join(__dirname, "..", "miniprogram", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
  const rules = (css.match(/[^{}]+\{[^}]*\}/g) || []).map(rule => {
    const at = rule.indexOf("{")
    return { sel: rule.slice(0, at).trim(), body: rule.slice(at) }
  })
  return { rel, rules }
})
// 颜色亮度 L(0~255) 与色度 C：色度用来分辨「中性羊皮纸」和「金/绿/红强调色」
const lum = hex => {
  const v = hex.length === 4
    ? [hex[1] + hex[1], hex[2] + hex[2], hex[3] + hex[3]]
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
  const [r, g, b] = v.map(x => parseInt(x, 16))
  return { L: (r * 299 + g * 587 + b * 114) / 1000, C: Math.max(r, g, b) - Math.min(r, g, b) }
}
// 「这条规则画的是笔画，不是底面」——关闭的 ×、拖动条这类，
// 整个视觉就是那个 background。豁免与「必须够亮」是同一枚硬币的两面，
// 所以判定只写一次，两个方向共用。
const isGlyph = sel => /glyph|handle|-dot\b/.test(sel)
// 「什么算按钮」只定义一次。此前居中守卫和行高守卫各写了一份，
// 且已经分叉（一份有 dial-key、一份有 -button\b），于是各自漏掉对方覆盖的。
const BUTTONISH = /-action\b|\.btn\b|-button\b|dial-key/

// 深色主题：全 app 的底面必须是深的。
// 289 处色值是一次性翻过来的，以后随手补一条 background: #fff 就破功了，
// 而这种问题在开发者工具里未必一眼看得出（浅底浅字反而"看着还行"）。
//
// 同一次遍历里做两件互为反面的事：
//   底面 —— 不许浅（会在深色页面上戳出一块白）
//   笔画 —— 必须够亮（关闭的 × 压暗了等于按钮消失。实战出过一次：
//           浮层变成一个出不来的陷阱，玩家原话「没有任何按钮可以关闭」）
{
  const SURFACE = ["background", "background-color", "border", "border-color", "border-top",
    "border-bottom", "border-left", "border-right", "border-top-color", "border-bottom-color"]
  const offenders = []
  const faint = []
  STYLE_RULES.forEach(({ rel, rules }) => {
    rules.forEach(({ sel, body }) => {
      if (isGlyph(sel)) {
        // 笔画那一面：**关闭类控件**必须看得见——看不见就等于被困在浮层里。
        // 按功能匹配（选择器里带 close）而不是按类名硬编码，
        // 这样 sheet-close-glyph 之类的新写法也自动进检查。
        // 不按「所有 glyph」一刀切：.role-card-glyph 是实心小卡片图标、
        // .sheet-handle 是刻意低调的拖动条，它们暗是对的。
        if (!/close/.test(sel)) return
        const bg = /background(?:-color)?:\s*(#[0-9a-fA-F]{6})/.exec(body)
        if (bg && lum(bg[1]).L < 120) {
          faint.push(`${rel}: ${sel.slice(0, 46)} -> ${bg[1]} 亮度 ${Math.round(lum(bg[1]).L)}`)
        }
        return
      }
      const decls = body.match(/[a-z-]+\s*:\s*[^;{}]+/g) || []
      decls.forEach(decl => {
        const prop = decl.slice(0, decl.indexOf(":")).trim()
        if (SURFACE.indexOf(prop) < 0) return
        const hexes = decl.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g) || []
        hexes.forEach(hex => {
          const { L, C } = lum(hex.toLowerCase())
          // L 是 0~255 的亮度。150 卡在「深色阶最亮的一档」和「羊皮纸」之间：
          //   深色面 #202623=37、#323b36=56、强调棕 #795436=92  —— 放行
          //   羊皮纸 #e5ded2=223、#fffaf1=250                —— 拦住
          // 色度 60：羊皮纸系全在 20 以下，而最淡的强调色（护身符火花
          // #70b099）色度 64，卡 70 会把它误当浅底面。
          if (L > 150 && C < 60) offenders.push(`${rel}: ${decl.trim().slice(0, 60)}`)
        })
      })
    })
  })
  assert.deepStrictEqual(offenders, [], `深色主题里混进了浅底面:\n  ${offenders.join("\n  ")}`)
  assert.deepStrictEqual(faint, [], `关闭按钮的 × 太暗，等于按钮不存在:\n  ${faint.join("\n  ")}`)
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
  // 「按钮文字要垂直居中」这条，守的应当是**屏幕上真的有的按钮**，
  // 而不是「类名有没有被抄进 app.wxss 的名单里」。
  // 第一版守的是后者，于是每发现一个漏网就往名单里加一个类名，
  // 守卫和缺陷同层——加名字就能变绿，什么都没一般化。
  // 现在先从 wxml 收集真正用到的类，样式表里的死类不参与判定。
  const appCss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "app.wxss"), "utf8")
  const centerRule = /([^{}]*?)\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*\}/g
  let covered = null
  let m
  while ((m = centerRule.exec(appCss))) {
    if (m[1].indexOf("button") >= 0) { covered = m[1].split(",").map(x => x.trim()).filter(Boolean); break }
  }
  assert.ok(covered, "app.wxss 缺少按钮垂直居中的通用规则")

  // wxml 里出现过的 class，以及它们是不是写在 <button> 上
  const liveClasses = new Set()
  const buttonClasses = new Set()
  const pages = ["index/index", "room/room", "play/play", "result/result", "game/game"]
  pages.forEach(rel => {
    const wxml = fs.readFileSync(path.join(root, ...rel.split("/")) + ".wxml", "utf8")
    const tags = wxml.match(/<(button|view)\b[^>]*class="[^"]*"[^>]*>/g) || []
    tags.forEach(tag => {
      const isButton = tag.slice(0, 8) === "<button "
      const cls = (/class="([^"]*)"/.exec(tag) || ["", ""])[1]
      cls.split(/\s+/).forEach(c => {
        const name = c.replace(/\{\{[\s\S]*/, "").trim()
        if (!name) return
        liveClasses.add("." + name)
        if (isButton) buttonClasses.add("." + name)
      })
    })
  })

  const uncovered = []
  STYLE_RULES.forEach(({ rel, rules }) => {
    rules.forEach(({ sel, body }) => {
      if (!BUTTONISH.test(sel)) return
      if (/\[disabled\]|:active|::after/.test(sel)) return
      if (!/(?:^|;|\{)\s*(?:min-)?height:\s*\d+rpx/.test(body)) return
      if (/line-height:/.test(body)) return
      if (/display:\s*flex/.test(body) && /align-items:\s*center/.test(body)) return
      const cls = (sel.match(/\.[a-z-]+/g) || []).map(x => x.trim())
      // 样式表里的死类不算数：屏幕上没有的按钮不会贴顶
      if (!cls.some(c => liveClasses.has(c))) return
      // <button> 由通用规则里的类型选择器兜住；只有写在 <view> 上的才需要点名
      if (cls.some(c => buttonClasses.has(c))) return
      if (!cls.some(c => covered.indexOf(c) >= 0)) uncovered.push(`${rel}: ${sel.slice(0, 50)}`)
    })
  })
  assert.deepStrictEqual(uncovered, [],
    `这些按钮设了高度但没被居中规则覆盖，文字会贴顶:\n  ${uncovered.join("\n  ")}`)

  // 反过来的一条：按钮不许写死「行高 = 按钮高度」。
  // 那种写法只在单行时看着对，文字一换行每行都占满按钮高度，按钮就裂成两截
  //（「队伍已选齐，指定魔法目标」实测裂开）。垂直居中由 flex 负责，
  // 行高交给 app.wxss 里的统一值。
  const rigid = []
  STYLE_RULES.forEach(({ rel, rules }) => {
    rules.forEach(({ sel, body }) => {
      if (!BUTTONISH.test(sel)) return
      if (/caption|seat-/.test(sel)) return          // 单行截断的标签，写死行高是对的
      const lh = /line-height:\s*(\d+)rpx/.exec(body)
      const h = /(?:min-)?height:\s*(\d+)rpx/.exec(body)
      if (lh && h && Math.abs(Number(lh[1]) - Number(h[1])) <= 6) {
        rigid.push(`${rel}: ${sel.slice(0, 44)} 行高${lh[1]} 高${h[1]}`)
      }
    })
  })
  assert.deepStrictEqual(rigid, [],
    `按钮写死了「行高=高度」，文字换行会裂成两截:\n  ${rigid.join("\n  ")}`)
}

// 队长选展示阵营那一屏放了角色立绘。立绘是 3:4（990x1320），
// 容器必须同比例，否则 aspectFill 会把人裁掉——第一版容器 420x460（0.913），
// 教士的头和脚都被切了。这里锁住比例不许再跑偏。
{
  const wxml = fs.readFileSync(path.join(root, "play", "play.wxml"), "utf8")
  const wxss = fs.readFileSync(path.join(root, "play", "play.wxss"), "utf8")
  const card = /\.claim-card\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(card, "找不到队长选择屏的立绘容器")
  const w = /width:\s*([\d.]+)vh/.exec(card[1])
  const h = /height:\s*([\d.]+)vh/.exec(card[1])
  assert.ok(w && h, "立绘容器应当用同一单位定宽高，才能锁住比例")
  const ratio = Number(w[1]) / Number(h[1])
  assert.ok(Math.abs(ratio - 0.75) < 0.02,
    `立绘是 3:4，容器比例却是 ${ratio.toFixed(3)}，aspectFill 会裁掉人物`)

  // 选择既然移到了揭示之前，揭示页里就不该再留一套选择控件
  assert.ok(wxml.indexOf("leader-claim-box") < 0 && wxml.indexOf("leader-claim-reminder") < 0,
    "揭示页里的展示阵营选择块应当已经移除（选择发生在揭示之前）")
}

console.log("ui binding tests passed")
