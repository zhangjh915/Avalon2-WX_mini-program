// 资产取图路径。
//
// 这里的每条断言都对应一次真金白银的验证：113 个文件上传后逐个核对过
// fileID 由路径拼接的规律，9 个抽样在模拟器里实测可取。
// 路径拼错的表现是玩家看到裂图，且只在特定角色/皮肤组合下复现，必须锁住。

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const assets = require("../miniprogram/utils/assets")
const core = require("../cloudfunctions/avalonGame/gameCore")

// ---- 云端立绘 ----

// 无变体角色不带后缀
assert.strictEqual(assets.roleArtPath("painted", "morgan", 0), "assets/roles/painted/morgan.jpg")
// 变体号为 0 或缺省都视为无变体，不能拼出 -v0
assert.strictEqual(assets.roleArtPath("painted", "morgan"), "assets/roles/painted/morgan.jpg")
assert.ok(!assets.roleArt("painted", "morgan", 0).includes("-v"))
// 有变体角色带 -vN
assert.strictEqual(assets.roleArtPath("woodcut", "loyal", 3), "assets/roles/woodcut/loyal-v3.jpg")
// 皮肤缺省回落到 painted，避免拼出 undefined 路径
assert.strictEqual(assets.roleArtPath("", "arthur", 0), "assets/roles/painted/arthur.jpg")
// 没有角色时返回空串，让界面走占位而不是请求一个坏 fileID
assert.strictEqual(assets.roleArt("painted", "", 0), "")

// fileID 必须是 cloud:// 前缀
assert.ok(assets.roleArt("painted", "morgan", 0).startsWith("cloud://"))
assert.ok(assets.identityBack("fantasy").startsWith("cloud://"))

// ---- 任务牌在包内，必须是绝对路径而不是 cloud:// ----
assert.strictEqual(assets.missionCard("c", "success"), "/assets/cards/mission/skin-c/success.jpg")
assert.ok(assets.missionCard("a", "back").startsWith("/assets/"))
assert.strictEqual(assets.missionCard("", "fail"), "/assets/cards/mission/skin-a/fail.jpg")

// ---- 任务牌必须真的在包里（云端没有它们）----
const missionDir = path.join(__dirname, "..", "miniprogram", "assets", "cards", "mission")
if (fs.existsSync(missionDir)) {
  ;["a", "b", "c", "d"].forEach(skin => {
    ;["back", "success", "fail"].forEach(face => {
      const rel = assets.missionCard(skin, face).replace(/^\//, "")
      const abs = path.join(__dirname, "..", "miniprogram", rel)
      assert.ok(fs.existsSync(abs), `任务牌缺失: ${rel}`)
    })
  })
}

// ---- 每个角色都能拼出路径，且与服务端分配的变体号自洽 ----
Object.keys(core.roleInfo).forEach(role => {
  const total = core.roleArtVariants[role] || 0
  if (total) {
    for (let n = 1; n <= total; n += 1) {
      assert.strictEqual(assets.roleArtPath("painted", role, n), `assets/roles/painted/${role}-v${n}.jpg`)
    }
  } else {
    assert.strictEqual(assets.roleArtPath("painted", role, 0), `assets/roles/painted/${role}.jpg`)
  }
})

// ---- 打包排除必须生效，否则 31MB 会进主包 ----
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "project.config.json"), "utf8"))
const ignored = (cfg.packOptions && cfg.packOptions.ignore || []).map(x => x.value)
assert.ok(ignored.includes("assets/roles"), "assets/roles 必须排除出包体")
assert.ok(ignored.includes("assets/cards/identity"), "assets/cards/identity 必须排除出包体")
assert.ok(!ignored.some(v => v.startsWith("assets/cards/mission")), "任务牌必须留在包里")

// ---- 界面图标与场景 ----

// uiAsset 仍是云存储路径的拼接器（大图用它）；图标改用 packedAsset 走包内
assert.ok(assets.uiAsset("home-bg.jpg").startsWith("cloud://"))
assert.strictEqual(assets.uiAsset("home-bg.jpg"), assets.CLOUD_PREFIX + "assets/ui/home-bg.jpg")
assert.strictEqual(assets.packedAsset("crown.png"), "/assets/ui/crown.png")

// 图标与小图**打进包内**：走云存储时每次都要现拉，表现是换个火球要等一会儿才出现、
// 任务牌翻面动画跑完了图还没到、任务结果只剩个红圈圈（队徽没加载出来）。
// 包内图零网络零解析，点开即有。11 张合计 610KB，主包上限 2MB。
const icons = assets.uiIcons()
const PACKED = ["crown", "amulet", "fire", "tableEmblem", "crestGood", "crestEvil",
  "missionPending", "missionCurrent", "seal", "tableRound", "homeEmblem"]
PACKED.forEach(key => {
  assert.ok(icons[key], `图标 ${key} 缺失`)
  assert.ok(icons[key].startsWith("/assets/ui/"), `图标 ${key} 必须走包内路径，实际 ${icons[key]}`)
  const abs = path.join(__dirname, "..", "miniprogram", icons[key].replace(/^\//, ""))
  assert.ok(fs.existsSync(abs), `包内图标文件缺失 ${icons[key]}`)
})
// 大图上不了主包，只能留云存储
;["homeBg", "floor"].forEach(key => {
  assert.ok(icons[key] && icons[key].startsWith("cloud://"), `${key} 应留在云存储`)
})
// 打包排除要跟着走：排掉大图、别把图标一起排了
const ignoredNow = (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "project.config.json"), "utf8"))
  .packOptions.ignore || []).map(x => x.value)
assert.ok(!ignoredNow.includes("assets/ui"), "整个 assets/ui 被排除的话，包内图标就取不到了")
assert.ok(ignoredNow.includes("assets/ui/table-long"), "长桌 8 张 3.8MB，必须排除")
assert.ok(ignoredNow.some(v => /floor-.*\.jpg/.test(v)), "地毯要排除")

// ---- 长桌：七张整图按比例分档（九宫格已废弃）----
// 九宫格把一张图变成九张的拼装，每处接缝都是要精确对齐的约束，实机上始终能看出
// 接缝和色差（实测五块切片平均亮度 35~68，差近一倍）。整图没有拼接。
assert.ok(!("LONG_TABLE_SLICES" in assets), "九宫格已废弃，不该再导出切片表")
// 长桌不再走 CSS background，改成 <image>，所以背景样式里不该再有它
assert.ok(!("longTableBackground" in assets), "九宫格的背景拼装函数应当已删除")
assert.strictEqual(assets.LONG_TABLES.length, 8)
assets.LONG_TABLES.forEach(item => {
  assert.ok(item.aspect >= 1, "只存长宽比 >= 1 的一半，竖桌用横图转 90 度")
  assert.ok(item.i >= 1 && item.i <= 8)
})

// 档位表必须和资产目录里那份一致。副本是必须的——assets/ui 被 packOptions.ignore
// 排除出包体，运行时 require 不到那边那份；但两份一旦漂移就会挑错档。
const metaAsset = path.join(__dirname, "..", "miniprogram", "assets", "ui", "table-long", "_meta.json")
if (fs.existsSync(metaAsset)) {
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(metaAsset, "utf8")),
    require("../miniprogram/utils/table-long-meta"),
    "utils/table-long-meta.js 与资产目录的 _meta.json 不一致")
  // 必须是 .js：小程序不支持 require .json，会让 assets.js 整个模块抛异常，
  // 连带所有 require 它的页面 Page() 注册失败（页面只剩生命周期方法）。
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "miniprogram", "utils", "table-long-meta.json")),
    "档位表不能是 .json，小程序 require 不了")
  assert.ok(!/require\(["'][^"']*\.json["']\)/.test(fs.readFileSync(path.join(__dirname, "..", "miniprogram", "utils", "assets.js"), "utf8")),
    "小程序侧代码不能 require .json")
  assets.LONG_TABLES.forEach(item => {
    assert.ok(fs.existsSync(path.join(__dirname, "..", "miniprogram", "assets", "ui", "table-long", `${item.i}.png`)),
      `缺少长桌图 ${item.i}.png`)
  })
}

// 挑档：比的是对数距离。拉伸 8% 无论发生在 1.1 还是 2.9 档上观感代价一样，
// 用差值会偏袒大比例那几档。
const wide = assets.pickLongTable(68, 24, 340, 295)     // 很扁的横桌
const narrow = assets.pickLongTable(32, 62, 340, 295)   // 竖桌
assert.ok(wide && narrow)
assert.strictEqual(wide.rotate, false, "横桌不转")
assert.strictEqual(narrow.rotate, true, "竖桌要转 90 度")
assert.ok(/rotate\(90deg\)/.test(narrow.style), "竖桌的内联样式要带旋转")
assert.ok(!/rotate/.test(wide.style), "横桌不该有旋转")
// 转 90 度后宽高互换，所以图要按「转之前」的尺寸给
const nw = Number(/width:(\d+)px/.exec(narrow.style)[1])
const nh = Number(/height:(\d+)px/.exec(narrow.style)[1])
assert.ok(nw > nh, "竖桌的图在旋转前必须是横的")
// 七张覆盖全部真实布局，最大拉伸不超过 8%。
// 遍历的是 tableGeometry 真正会产出的组合，不是手编的数——手编很容易写出
// 根本不存在的组合（比如 height=24：左右无人时走的是 else 分支给 28）。
const tableLayout = require("../miniprogram/utils/tableLayout")
const geometries = []
for (let h = 0; h <= 5; h += 1) {
  for (let v = 0; v <= 5; v += 1) {
    if (h + v === 0) continue
    geometries.push(tableLayout.tableGeometry({ top: h, bottom: h, left: v, right: v }))
  }
}
// 两个舞台形状差别极大，必须都覆盖：
//   play 页 .compact-stage      高固定 590rpx  -> 约 366x295，比 1.24
//   选人页 .selector-page 那个   flex:1 撑满屏高 -> 实测 366x656，比 0.56
// 这里的数字来自模拟器实测，不是估的。上一版我按估的 1.19/1.32 写，
// 结果整个漏掉了选人页那个撑满屏高的舞台，把最坏情况从 20.4% 误算成 9.8%。
const STAGES = [[366, 295], [366, 656], [414, 736]]
let worst = 0
STAGES.forEach(([stageW, stageH]) => {
  geometries.forEach(geo => {
    const picked = assets.pickLongTable(geo.width, geo.height, stageW, stageH)
    assert.ok(picked, `${geo.width}%x${geo.height}% 没挑出档`)
    // 拉伸要拿**桌子实际占的方框**（slot）算，不能拿可用空间算：
    // 桌子按固定形状缩放，本来就不填满可用空间。
    const boxW = Number(/width:(\d+)px/.exec(picked.slot)[1])
    const boxH = Number(/height:(\d+)px/.exec(picked.slot)[1])
    const target = Math.max(boxW, boxH) / Math.min(boxW, boxH)
    const tier = assets.LONG_TABLES.find(item => item.i === picked.tier)
    const stretch = Math.abs(Math.log(target / tier.aspect))
    worst = Math.max(worst, stretch)
    // 9.5% 是候选池的物理下限，不是随便设的：最差落在需求比 1.29~1.54 之间的
    // 中点（9.3%），而候选池里这段区间没有图，再补档也补不上——要压下去得重新生图。
    assert.ok(stretch < 0.095,
      `${geo.width}%x${geo.height}% @${stageW}x${stageH} 挑到 ${picked.tier} 档，拉伸 ${(stretch * 100).toFixed(1)}% 超标`)
    assert.strictEqual(picked.rotate, boxW < boxH, "旋转判断与实际形状不符")
  })
})
assert.ok(worst < 0.095, `最大拉伸 ${(worst * 100).toFixed(1)}%`)

// 同一局在候场页和对局页必须长得一样。
// 桌子形状原先由「舞台形状 × 百分比」共同决定，两个页面舞台比差很远
// （候场 360x438、对局 366x656），于是同一布局挑到不同的档、桌子一胖一瘦。
// 现在形状以对局页舞台比为基准，尺寸再各自适配可用空间。
;[{ top: 0, right: 3, bottom: 0, left: 5 },
  { top: 3, right: 1, bottom: 3, left: 1 },
  { top: 0, right: 5, bottom: 0, left: 5 }].forEach(seatLayout => {
  const geo = tableLayout.tableGeometry(seatLayout)
  const lobby = assets.pickLongTable(geo.width, geo.height, 360, 438)
  const play = assets.pickLongTable(geo.width, geo.height, 366, 656)
  assert.strictEqual(lobby.tier, play.tier, `${JSON.stringify(seatLayout)} 两处挑到了不同的档，桌子会一胖一瘦`)
  assert.strictEqual(lobby.rotate, play.rotate, "旋转方向也要一致")
})

// 尺寸缺失时返回 null 而不是算出 NaN 塞进样式
assert.strictEqual(assets.pickLongTable(32, 60, 0, 0), null)
assert.strictEqual(assets.pickLongTable(0, 0, 340, 295), null)

// 图一律走 <image src="cloud://">，不再有临时链接这一环。
// 反复三轮的 403 就是它带来的：临时链接实测生成后十几分钟就失效，
// 而我按「2 小时」设缓存 TTL，怎么修都修不掉。现在整条链路删掉了。
assert.ok(!("backgroundStyles" in assets), "临时链接机制应当已移除")
assert.ok(!("resolveTempUrls" in assets), "临时链接机制应当已移除")
// 匹配**带左括号的调用形式**。顶部那条「不要用 getTempFileURL」的警示注释写的是
// 不带括号的名字，所以天然不会误伤——比先剥注释再匹配可靠得多，
// 也不用维护一个假的注释解析器（那个剥离器会把字符串里 cloud:// 之后的内容也吃掉）。
const uiSrc = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "utils", "assets.js"), "utf8")
assert.ok(!/getTempFileURL\s*\(/.test(uiSrc), "不该再调用 getTempFileURL")

// 四类原本走 CSS 背景的图，现在都由 <image> 渲染（不再有临时链接那一环）。
// 其中 tableRound / seal 已进包走绝对路径，floor / homeBg 体积大留云存储。
;["tableRound", "homeBg", "floor", "seal"].forEach(key => {
  assert.ok(icons[key], `${key} 缺失`)
  assert.ok(/^(\/assets\/|cloud:\/\/)/.test(icons[key]), `${key} 取图方式不对：${icons[key]}`)
})
// 地毯跟着个人偏好走
const palette = assets.floorOptions()
assert.strictEqual(palette.floorOptions.length, assets.FLOOR_COLORS.length)
// 当前地毯图只有 ui.floor 这一个出口，别再开第二个
assert.ok(icons.floor.startsWith("cloud://"))
assert.ok(!("floorSrc" in palette), "当前地毯图不该有第二个出口")
palette.floorOptions.forEach(option => {
  assert.ok(option.src && option.src.startsWith("cloud://"), "色板也要用 cloud://，不能走 CSS 背景")
  assert.ok(option.key && option.name)
})

// ---- 地毯四色是个人偏好，不进房间数据 ----
assert.strictEqual(assets.DEFAULT_FLOOR, "indigo", "默认靛蓝：与桌子的明度差最大")
// 非法值一律回落默认，不能拼出 floor-undefined.jpg 这种坏 fileID
;["", null, undefined, "紫", "../x"].forEach(bad => {
  assert.strictEqual(assets.normalizeFloorColor(bad), assets.DEFAULT_FLOOR)
})
assets.FLOOR_COLORS.forEach(item => {
  assert.strictEqual(assets.normalizeFloorColor(item.key), item.key)
  assert.strictEqual(assets.floorAsset(item.key), assets.CLOUD_PREFIX + `assets/ui/floor-${item.key}.jpg`)
})
// 没有 wx 时（单元测试）读写偏好不能抛错
assert.strictEqual(assets.floorColor(), assets.DEFAULT_FLOOR)
assert.strictEqual(assets.setFloorColor("wine"), "wine")
assert.strictEqual(assets.setFloorColor("不存在的颜色"), assets.DEFAULT_FLOOR)

// ---- 云端文件必须真实存在（本地那份是上传中转，两者应一致）----
const UI_DIR = path.join(__dirname, "..", "miniprogram", "assets", "ui")
if (fs.existsSync(UI_DIR)) {
  Object.keys(icons).filter(k => icons[k].startsWith("cloud://")).forEach(key => {
    const name = icons[key].slice((assets.CLOUD_PREFIX + "assets/ui/").length)
    assert.ok(fs.existsSync(path.join(UI_DIR, name)), `缺少界面资产 ${name}`)
  })
  ;["table-round.jpg", "home-bg.jpg", "home-emblem.png"].forEach(name => {
    assert.ok(fs.existsSync(path.join(UI_DIR, name)), `缺少界面资产 ${name}`)
  })
  assets.FLOOR_COLORS.forEach(item => {
    assert.ok(fs.existsSync(path.join(UI_DIR, `floor-${item.key}.jpg`)), `缺少地毯 floor-${item.key}.jpg`)
  })
  // 旧的单色地毯已被四色取代，留着会让上传脚本和云端对不上
  assert.ok(!fs.existsSync(path.join(UI_DIR, "floor.jpg")), "floor.jpg 已被四色取代，不应再存在")
}

// 内联下发的只是 background-image，铺法必须写在 wxss 里。
// 漏掉 background-size 就会按原图 1080px 逻辑像素渲染，只看得到左上角一块。
const playWxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.wxss"), "utf8")
const playWxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.wxml"), "utf8")
const roomWxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "room", "room.wxss"), "utf8")
const roomWxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "room", "room.wxml"), "utf8")

// 先确认这个类真的有元素在用。踩过的坑：给一条**没有任何元素命中的死规则**加了
// background-size，测试照样绿，实机纹丝不动——play.wxss 里那条 .compact-table-stage
// 就是重构遗留，wxml 用的一直是 .compact-stage。断言样式前必须先断言类名活着。
function assertStageFloor(wxml, cls, label) {
  assert.ok(new RegExp(`class="[^"]*\\b${cls}\\b`).test(wxml), `${label} 的类 ${cls} 在 wxml 里没有元素在用`)
  // 地毯改成垫底 <image> 之后，铺满由 mode="scaleToFill" 负责，不再是 CSS 的 cover
  const stage = wxml.slice(wxml.indexOf(cls))
  assert.match(stage.slice(0, 400), /<image class="stage-floor"[^>]*mode="scaleToFill"/,
    `${label}要有铺满的垫底地毯图`)
}
assertStageFloor(playWxml, "compact-stage", "对局台面")
assertStageFloor(roomWxml, "lobby-table-stage", "候场台面")
// 垫底图的位置与铺满统一在 app.wxss 声明，别在各页面重复
const appWxssFloor = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "app.wxss"), "utf8")
assert.match(appWxssFloor, /\.stage-floor,[\s\S]{0,120}\{[^}]*position: absolute/, "垫底图样式应统一在 app.wxss")
assert.ok(!/compact-table-stage/.test(playWxss), "已删除的死规则不该再出现")
// 桌面和地面都是正俯视平光，没有可见投影桌子就像贴纸浮在毯子上
const appWxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "app.wxss"), "utf8")
assert.match(appWxss, /\.round-table \{[^}]*box-shadow:[^;]+rgba\(20, 14, 10, 0\.45\)/s, "圆桌必须保留深投影")
// 长桌的投影必须挂在**不旋转的外层** .table-slot 上：直接给 .long-table 加
// box-shadow 的话，竖桌的 rotate(90deg) 会把阴影方向一起转过去（向下变向右）。
// drop-shadow 还能跟随图片 alpha 形状，正好贴合图自带的圆角。
assert.match(appWxss, /\.table-slot \{[^}]*drop-shadow\([^)]*rgba\(20, 14, 10, 0\.45\)/s, "长桌投影要挂在不旋转的外层")
assert.ok(!/\.long-table \{[^}]*box-shadow/s.test(appWxss), "投影不能加在会旋转的 .long-table 上")
// 圆角由图自带，再裁会切掉伸出圆弧的雕花包角
assert.match(appWxss, /\.long-table \{[^}]*border-radius: 0/s, "长桌不能再裁圆角")
// 深色绒毯上的座位文字必须是浅色，否则整排名字消失
assert.ok(!/\.compact-seat-token \.seat-caption \{[^}]*color: #3d332a/.test(roomWxss), "候场页座位文字要翻浅色")

// ---- 大图排除、图标进包，见上文 PACKED 那组断言 ----

// 已进包的图标不许再从云端取。packedAsset 的 11 张图迁移进包后，
// play/result 里仍有调用写着 uiAsset——创建者看不出差别（他有读权限），
// 其他账号的仪式队徽、任务轨道全裂。锁住调用点。
;["play/play", "result/result"].forEach(page => {
  const src = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", ...page.split("/")) + ".js", "utf8")
  const bad = src.match(/uiAsset\("(crest-|mission-|crown|amulet|magic-fire|seal-base|table-emblem|table-round|home-emblem)[^"]*"\)/g)
  assert.ok(!bad, `${page}.js 还在用云端路径取进包图标: ${bad}`)
})

// 预热链：候场页要提前热身份卡背（进对局第一屏的大图，皮肤建房时已定）。
// 断了不会报错，只会退化成「要用时现下」，玩家看到的就是第一屏空一秒。
assert.strictEqual(typeof assets.prefetch, "function")
assert.doesNotThrow(() => assets.prefetch(["cloud://x.y/assets/ui/a.jpg", null]), "无 wx 环境下预热不能炸")
const roomSrc2 = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "room", "room.js"), "utf8")
assert.match(roomSrc2, /prefetch\(\[assets\.identityBack/, "候场页要预热身份卡背")



// 两段异步链路测试**必须串行**：它们都要独占 global.wx 并重载 assets 模块，
// 并行会互相把对方的 wx 换掉（真踩过：第二块先跑，第一块的落地断言就红）。
const asyncChecks = (async () => {
  // 1) 真机链路：正常落地；tmp 标记损坏后改走签名 https
  delete require.cache[require.resolve("../miniprogram/utils/assets")]
  global.wx = {
    cloud: { callFunction: ({ success }) => success({ result: { urls: [{ fileID: "x", url: "https://signed.example/a.jpg" }] } }) },
    downloadFile: ({ success }) => success({ statusCode: 200, tempFilePath: "http://tmp/fake-a" }),
    getStorageSync: () => "", setStorageSync: () => {},
    getSystemInfoSync: () => ({ platform: "ios" })
  }
  const fresh = require("../miniprogram/utils/assets")
  const FID = "cloud://env.x-y/assets/ui/a.jpg"
  const first = await fresh.localCopy(FID)
  assert.strictEqual(first, "http://tmp/fake-a", "正常时应落地为本地文件")
  fresh.markTmpBroken()
  const second = await fresh.localCopy(FID)
  assert.strictEqual(second, "https://signed.example/a.jpg", "tmp 不可用后必须改走签名 https，且不得返回缓存的 tmp")
  console.log("  tmp 降级链路 ok")

  // 2) 开发者工具（含全部虚拟窗口）：直连 https，绝不落地——
  //    虚拟窗口渲染层读 tmp 时好时坏，binderror 兜底又依赖 error 事件可靠派发
  delete require.cache[require.resolve("../miniprogram/utils/assets")]
  global.wx = {
    cloud: { callFunction: ({ success }) => success({ result: { urls: [{ fileID: "x", url: "https://signed.example/dev.jpg" }] } }) },
    downloadFile: () => { throw new Error("devtools 下不该走 downloadFile") },
    getStorageSync: () => "", setStorageSync: () => {},
    getSystemInfoSync: () => ({ platform: "devtools" })
  }
  const devAssets = require("../miniprogram/utils/assets")
  const out = await devAssets.localCopy("cloud://env.x-y/assets/ui/b.jpg")
  assert.strictEqual(out, "https://signed.example/dev.jpg", "devtools 下必须直接用签名 https")
  console.log("  devtools 直连 ok")

  delete global.wx
  delete require.cache[require.resolve("../miniprogram/utils/assets")]
})()

console.log("asset path tests passed")
