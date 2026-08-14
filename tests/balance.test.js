const assert = require("assert")
const game = require("../miniprogram/utils/game")

function replaceRole(playerCount, removed, added) {
  const counts = game.buildDefaultRoleCounts(playerCount, false)
  counts[removed] = Number(counts[removed] || 0) - 1
  counts[added] = Number(counts[added] || 0) + 1
  return game.estimateBalance(playerCount, counts, false, false)
}

for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
  const counts = game.buildDefaultRoleCounts(playerCount, false)
  assert.strictEqual(game.validateRoleConfig(playerCount, counts, false).valid, true)
  assert.strictEqual(game.estimateBalance(playerCount, counts, false, false).score, 0)
  if (playerCount >= 6) assert.strictEqual(counts.hunter, 1, `${playerCount}人默认应有盲眼杀手`)
}

const manualPool = game.normalizeCandidatePool(8, {
  ...game.buildDefaultRoleCounts(8, false),
  arthur: 1,
  galahad: 1,
  deceiver: 1,
  barbarian: 1
}, true)
const manualPoolValidation = game.validateRoleConfig(8, manualPool, true)
assert.strictEqual(manualPoolValidation.valid, true)
assert.ok(manualPoolValidation.actual.good > manualPoolValidation.expected.good)
assert.ok(manualPoolValidation.actual.evil > manualPoolValidation.expected.evil)

const exactUnknownPool = game.normalizeCandidatePool(8, game.buildDefaultRoleCounts(8, false), true)
assert.match(game.validateRoleConfig(8, exactUnknownPool, true).errors.join(" "), /至少需要多选1名/)

assert.ok(replaceRole(8, "loyal", "reluctant").score > 0, "不情愿的领袖应让邪恶方更轻松")
assert.ok(replaceRole(8, "minion", "deceiver").score > 0, "骗徒应让邪恶方更轻松")
assert.ok(replaceRole(8, "minion", "revealer").score < 0, "揭露者应让正义方更轻松")
assert.ok(replaceRole(8, "minion", "shapeshifter").score < 0, "幻形妖应让正义方更轻松")
assert.ok(replaceRole(8, "priest", "loyal").score > 0, "移除教士应让邪恶方更轻松")
assert.ok(replaceRole(9, "loyal", "archduke").score < 0, "大公应让正义方更轻松")
assert.ok(replaceRole(8, "minion", "barbarian").score < 0, "野蛮人应让正义方更轻松")
assert.ok(replaceRole(8, "minion", "lunatic").score < 0, "疯子应让正义方更轻松")
assert.ok(replaceRole(8, "minion", "saboteur").score < 0, "破坏者应让正义方更轻松")
assert.ok(replaceRole(8, "minion", "outsider").score < 0, "边缘人应让正义方更轻松")

const goodHeavy = game.buildDefaultRoleCounts(9, false)
goodHeavy.squire -= 1
goodHeavy.apprentice = 1
goodHeavy.minion -= 1
goodHeavy.revealer = 1
const goodHeavyEstimate = game.estimateBalance(9, goodHeavy, false, false)
assert.ok(goodHeavyEstimate.score <= -4)
assert.ok(goodHeavyEstimate.warning)
assert.ok(goodHeavyEstimate.markerPercent < 25)

const stackedEvil = game.buildDefaultRoleCounts(8, false)
stackedEvil.duke -= 1
stackedEvil.reluctant = 1
stackedEvil.minion -= 1
stackedEvil.deceiver = 1
const stackedEstimate = game.estimateBalance(8, stackedEvil, false, false)
assert.ok(stackedEstimate.score >= 4)
assert.ok(stackedEstimate.warning)
assert.ok(stackedEstimate.markerPercent > 75)

console.log("balance tests passed")
