// 身份牌立绘的变体分配，以及「代码期望」与「磁盘上真实资产」的一致性。
//
// 这两件事一旦漂移，表现是玩家看到裂图或者两张一模一样的身份牌，
// 而且只在特定阵容下才复现，跑一局未必撞得上，所以必须由测试守住。

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const core = require("../cloudfunctions/avalonGame/gameCore")

const ROLES_DIR = path.join(__dirname, "..", "miniprogram", "assets", "roles")
const SKINS = ["painted", "fantasy", "woodcut"]

// ---- 变体分配逻辑 ----

function players(roles) {
  return roles.map((role, index) => ({ id: index + 1, role }))
}

// 同名角色必须拿到互不相同的变体，否则一桌人会看到重复的身份牌
const four = core.assignArtVariants(players(["loyal", "loyal", "loyal", "loyal"]))
assert.deepStrictEqual(four.map(p => p.artVariant), [1, 2, 3, 4])

// 实例数超过变体数时循环复用，不能崩也不能给出越界的编号
const six = core.assignArtVariants(players(["loyal", "loyal", "loyal", "loyal", "loyal", "loyal"]))
assert.deepStrictEqual(six.map(p => p.artVariant), [1, 2, 3, 4, 1, 2])
assert.ok(six.every(p => p.artVariant >= 1 && p.artVariant <= core.roleArtVariants.loyal))

// 不同角色各自独立计数，互不干扰
const mixed = core.assignArtVariants(players(["loyal", "minion", "loyal", "minion", "morgan"]))
assert.deepStrictEqual(mixed.map(p => p.artVariant), [1, 1, 2, 2, 0])

// 没有变体的角色一律 0，客户端据此取 <key>.jpg
assert.strictEqual(core.assignArtVariants(players(["morgan"]))[0].artVariant, 0)

// 整局分配后，同角色不重复（除非实例数真的超过变体数）
const full = core.assignArtVariants(players(["loyal", "loyal", "duke", "duke", "priest", "priest", "arthur"]))
const byRole = {}
full.forEach(p => { (byRole[p.role] = byRole[p.role] || []).push(p.artVariant) })
Object.keys(byRole).forEach(role => {
  const list = byRole[role]
  if (list.length <= (core.roleArtVariants[role] || 1)) {
    assert.strictEqual(new Set(list).size, list.length, `${role} 的变体不应重复`)
  }
})

// ---- 代码期望 vs 磁盘资产 ----

if (!fs.existsSync(ROLES_DIR)) {
  console.log("role art tests passed (资产目录不存在，跳过磁盘校验)")
} else {
  const roleKeys = Object.keys(core.roleInfo)

  SKINS.forEach(skin => {
    const dir = path.join(ROLES_DIR, skin)
    if (!fs.existsSync(dir)) return
    const files = new Set(fs.readdirSync(dir).filter(name => name.endsWith(".jpg")))

    roleKeys.forEach(role => {
      const total = core.roleArtVariants[role]
      if (total) {
        // 有变体的角色：v1..vN 必须齐全，且不应再有无后缀的通用图
        for (let n = 1; n <= total; n += 1) {
          assert.ok(files.has(`${role}-v${n}.jpg`), `${skin} 缺少 ${role}-v${n}.jpg`)
        }
        assert.ok(!files.has(`${role}.jpg`), `${skin} 不应同时存在 ${role}.jpg 与变体文件`)
      } else {
        assert.ok(files.has(`${role}.jpg`), `${skin} 缺少 ${role}.jpg`)
      }
    })

    // 三套皮肤的文件集合必须完全一致，否则换皮肤会出现裂图
    const expected = roleKeys.flatMap(role => {
      const total = core.roleArtVariants[role]
      return total
        ? Array.from({ length: total }, (_, i) => `${role}-v${i + 1}.jpg`)
        : [`${role}.jpg`]
    })
    expected.forEach(name => assert.ok(files.has(name), `${skin} 缺少 ${name}`))
  })

  console.log("role art tests passed")
}
