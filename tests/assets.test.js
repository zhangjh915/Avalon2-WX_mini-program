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

console.log("asset path tests passed")
