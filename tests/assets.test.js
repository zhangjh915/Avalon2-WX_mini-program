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

// 全部走云存储：包内绝对路径取不到（assets/ui 已排除出包体）
assert.ok(assets.uiAsset("crown.png").startsWith("cloud://"))
assert.strictEqual(assets.uiAsset("crown.png"), assets.CLOUD_PREFIX + "assets/ui/crown.png")

// applyState 一次性下发的图标集，键名与界面绑定一一对应
const icons = assets.uiIcons()
;["crown", "amulet", "fire", "tableEmblem", "crestGood", "crestEvil",
  "missionPending", "missionCurrent", "seal"].forEach(key => {
  assert.ok(icons[key] && icons[key].startsWith("cloud://"), `图标 ${key} 缺失`)
})

// 长桌九宫格：层序即数组顺序，角在最上、中心垫底，重排会让角被中心盖住
assert.strictEqual(assets.LONG_TABLE_SLICES.length, 9)
assert.strictEqual(assets.LONG_TABLE_SLICES[0][0], "corner_tl.png", "角块必须排在最前（最上层）")
assert.strictEqual(assets.LONG_TABLE_SLICES[8][0], "center.jpg", "中心必须排在最后（垫底）")
// 边条只沿单轴平铺。**不要改成 round**：round 按整个盒子算整数次填充，
// 而这里用 background-position 把边条起点偏移了一个角块的距离，两者不兼容——
// 接缝会跟角块完全对不齐，桌子看起来像拼错了。真实踩过并回退。
assert.ok(assets.LONG_TABLE_SLICES.filter(s => s[3] === "repeat-x").length === 2, "上下边条 repeat-x")
assert.ok(assets.LONG_TABLE_SLICES.filter(s => s[3] === "repeat-y").length === 2, "左右边条 repeat-y")
assert.ok(!assets.LONG_TABLE_SLICES.some(s => /round/.test(s[3])), "边条不能用 round，会和角块错位")

// 长桌背景只能在 loadBackgrounds 里算一次。放进 applyState 的话，
// 900ms 的轮询每次都会重算并 setData 一个 1.4KB 的新字符串（9 个图片链接），
// 渲染层每次都重新解析背景、重新请求那 9 张图，桌子要等很久才出得来。
;["play", "room"].forEach(name => {
  const src = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", name, `${name}.js`), "utf8")
  // 必须锚在方法定义上。用 indexOf("applyState(") 会先撞上 loadState 里的
  // this.applyState(result) 那个调用，截出来的根本不是方法体——这条守卫因此假绿过一次。
  const applyStart = src.indexOf("\n  applyState(result) {")
  assert.ok(applyStart > 0, `${name}.js 没有 applyState 方法定义`)
  const applyBody = src.slice(applyStart, src.indexOf("\n  },", applyStart + 5))
  assert.ok(!/longTableBg\s*:/.test(applyBody), `${name}.applyState 不能每次轮询都重算长桌背景`)
})

// CSS 的 background-image 不认 cloud:// 协议，必须先换成 https 临时链接。
// 没有 wx.cloud 时（单元测试、云开发未初始化）要安全退化成空串而不是抛错。
assets.backgroundStyles().then(styles => {
  ;["roundTableBg", "floorBg", "sealBg", "homeBg", "longTableBg"].forEach(key => {
    assert.ok(key in styles, `缺少背景样式 ${key}`)
    assert.ok(!String(styles[key]).includes("cloud://"), `${key} 不能把 cloud:// 写进 CSS`)
  })
  // 四色地毯一次全解析：换色才能是纯本地 setData，不用每换一次等一趟网络
  assert.strictEqual(styles.floorOptions.length, assets.FLOOR_COLORS.length, "四色地毯要一次全下发")
  assert.strictEqual(styles.floorColor, assets.DEFAULT_FLOOR)
  styles.floorOptions.forEach(option => {
    assert.ok(option.key && option.name, "色板要带 key 和中文名")
    assert.ok(!String(option.bg).includes("cloud://"), "色板预览同样不能把 cloud:// 写进 CSS")
  })
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
  Object.keys(icons).forEach(key => {
    const name = icons[key].slice((assets.CLOUD_PREFIX + "assets/ui/").length)
    assert.ok(fs.existsSync(path.join(UI_DIR, name)), `缺少界面资产 ${name}`)
  })
  assets.LONG_TABLE_SLICES.forEach(slice => {
    assert.ok(fs.existsSync(path.join(UI_DIR, "table-long", slice[0])), `缺少长桌切片 ${slice[0]}`)
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
function assertStageCover(wxss, wxml, cls, label) {
  assert.ok(new RegExp(`class="[^"]*\\b${cls}\\b`).test(wxml), `${label} 的类 ${cls} 在 wxml 里没有元素在用`)
  assert.match(wxss, new RegExp(`\\.${cls} \\{[^}]*background-size:\\s*cover`, "s"), `${label}必须 cover 铺地毯`)
}
assertStageCover(playWxss, playWxml, "compact-stage", "对局台面")
assertStageCover(roomWxss, roomWxml, "lobby-table-stage", "候场台面")
assert.ok(!/compact-table-stage/.test(playWxss), "已删除的死规则不该再出现")
// 桌面和地面都是正俯视平光，没有可见投影桌子就像贴纸浮在毯子上
const appWxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "app.wxss"), "utf8")
assert.match(appWxss, /\.round-table,\s*\n\.long-table \{[^}]*box-shadow:[^;]+rgba\(20, 14, 10, 0\.45\)/s, "桌子必须保留深投影")
// 深色绒毯上的座位文字必须是浅色，否则整排名字消失
assert.ok(!/\.compact-seat-token \.seat-caption \{[^}]*color: #3d332a/.test(roomWxss), "候场页座位文字要翻浅色")

// ---- 界面资产必须排除出包体，否则 1.1MB 会挤占 2MB 主包 ----
assert.ok(ignored.includes("assets/ui"), "assets/ui 必须排除出包体")

console.log("asset path tests passed")
