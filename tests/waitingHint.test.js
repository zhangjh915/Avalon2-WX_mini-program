// 常驻「现在等谁」的文案逻辑。
// 这块每个阶段的判定都不一样，很容易漏或者写错人，因此单独覆盖。

const assert = require("assert")
const path = require("path")

let definition = null
global.Page = value => { definition = value }
require(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js"))
delete global.Page

const players = [
  { id: 1, name: "甲" }, { id: 2, name: "乙" }, { id: 3, name: "丙" },
  { id: 4, name: "丁" }, { id: 5, name: "戊" }
]

function hint(phase, game) {
  return definition.buildWaitingHint({ phase }, game, players)
}

function baseGame(extra) {
  return {
    playerCount: 5,
    leaderId: 2,
    identity: { readyIds: [], rememberedIds: [] },
    current: { team: [], magicTargetId: null, voteCount: 0, votedIds: [] },
    amulet: null,
    final: null,
    ...extra
  }
}

// 准备阶段：点名还没准备好的人
const prepare = hint("reveal", baseGame({ identity: { readyIds: [1, 2, 3], rememberedIds: [] } }))
assert.match(prepare.text, /丁/)
assert.strictEqual(prepare.progress, "3/5")

// 只剩一个人时要能精确点名，这是最有用的场景
const lastOne = hint("reveal", baseGame({ identity: { readyIds: [1, 2, 3, 4], rememberedIds: [] } }))
assert.strictEqual(lastOne.text, "等待 5号 戊 准备")

// 人多时不逐个罗列，避免文案撑爆一行
const many = hint("reveal", baseGame({ identity: { readyIds: [1], rememberedIds: [] } }))
assert.match(many.text, /等 4 人/)

// 全部准备好之后不该继续占位
assert.strictEqual(hint("reveal", baseGame({ identity: { readyIds: [1, 2, 3, 4, 5], rememberedIds: [] } })), null)

// 揭示开始后改为等确认身份
const remember = hint("reveal", baseGame({
  identity: { revealAt: 1, readyIds: [1, 2, 3, 4, 5], rememberedIds: [1, 2] }
}))
assert.match(remember.text, /确认身份/)
assert.strictEqual(remember.progress, "2/5")

// 组队阶段等队长
assert.strictEqual(hint("mission", baseGame()).text, "等待 2号 乙 组建远征队")

// 投票阶段只等还没交牌的车上玩家
const vote = hint("vote", baseGame({ current: { team: [1, 2, 3], voteCount: 2, votedIds: [1, 3] } }))
assert.strictEqual(vote.text, "等待 2号 乙 提交任务牌")
assert.strictEqual(vote.progress, "2/3")

// 没上车的人不该被算进等待名单
const voteAll = hint("vote", baseGame({ current: { team: [1, 2], voteCount: 2, votedIds: [1, 2] } }))
assert.strictEqual(voteAll, null)

// 结算阶段等交接皇冠；加拉哈德接管时要指向他
assert.match(hint("missionResult", baseGame()).text, /2号 乙 交接皇冠/)
assert.match(hint("missionResult", baseGame({ galahadLeaderId: 4 })).text, /4号 丁/)

// 护身符三个子状态各自等不同的人
assert.match(hint("amulet", baseGame({ amulet: { ownerId: 3, status: "select" } })).text, /3号 丙 选择查验对象/)
assert.match(hint("amulet", baseGame({ amulet: { ownerId: 3, status: "claim" } })).text, /被查验者/)
assert.match(hint("amulet", baseGame({ amulet: { ownerId: 3, status: "result" } })).text, /收起护身符/)

// 终局各阶段
assert.match(hint("finale", baseGame({ final: { stage: "hunterDecision" } })).text, /盲眼杀手/)
const identify = hint("finale", baseGame({ final: { stage: "identify", submittedCount: 3 } }))
assert.strictEqual(identify.progress, "3/5")
assert.strictEqual(hint("finale", baseGame({ final: { stage: "identify", submittedCount: 5 } })), null)

// 首夜与已结束阶段不显示等待条
assert.strictEqual(hint("night", baseGame()), null)

console.log("waiting hint tests passed")
