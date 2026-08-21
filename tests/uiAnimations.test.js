const assert = require("assert")
const path = require("path")

let definition = null
global.Page = value => { definition = value }
global.wx = {
  vibrateShort() {},
  showToast() {}
}

const playPath = path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js")
delete require.cache[require.resolve(playPath)]
require(playPath)
assert.ok(definition, "play page did not register")

const players = [
  { id: 1, name: "甲", initial: "甲" },
  { id: 2, name: "乙", initial: "乙" },
  { id: 3, name: "丙", initial: "丙" }
]

const previous = {
  leaderId: 1,
  amulet: null,
  current: { team: [], magicTargetId: null }
}
const handoff = {
  leaderId: 2,
  amulet: { ownerId: 3, status: "select" },
  current: { team: [], magicTargetId: null }
}
const handoffEvents = definition.buildStateCeremonies(previous, "missionResult", handoff, "amulet", players)
assert.deepStrictEqual(handoffEvents.map(event => event.type), ["crown", "amulet"])
assert.strictEqual(handoffEvents[0].target.id, 2)
assert.strictEqual(handoffEvents[1].target.id, 3)

const vote = {
  leaderId: 2,
  amulet: null,
  current: { team: [1, 2], magicTargetId: 1 }
}
const magicEvents = definition.buildStateCeremonies(handoff, "mission", vote, "vote", players)
assert.deepStrictEqual(magicEvents.map(event => event.type), ["magic"])
assert.strictEqual(magicEvents[0].target.id, 1)

const repeated = definition.buildStateCeremonies(vote, "vote", vote, "vote", players)
assert.deepStrictEqual(repeated, [])

const finaleGame = { ...vote, round: 3, goodWins: 3, evilWins: 0, missions: [{ round: 3, winner: "good", successCount: 3, failCount: 0 }], final: { stage: "discussion", hunterRevealed: false }, missionPreset: { sizes: [2, 3, 3, 4, 4], protectedRounds: [] } }
const finaleEvents = definition.buildStateCeremonies(vote, "vote", finaleGame, "finale", players)
assert.deepStrictEqual(finaleEvents.map(event => event.type), ["mission-good", "finale-good"])

const hunterGame = { ...finaleGame, final: { stage: "hunterTargets", hunterRevealed: true }, players: players.map((player, index) => ({ ...player, revealed: index === 1 })) }
const hunterEvents = definition.buildStateCeremonies(finaleGame, "finale", hunterGame, "finale", hunterGame.players)
assert.deepStrictEqual(hunterEvents.map(event => event.type), ["hunter"])

const missionCards = definition.buildMissionResultCards({ successCount: 3, failCount: 2 })
assert.deepStrictEqual(missionCards.map(card => card.value), ["success", "success", "success", "fail", "fail"])
assert.deepStrictEqual(missionCards.map(card => card.delay), [0, 150, 300, 450, 600])
assert.strictEqual(definition.resolveFinalSelectionMode("hunterTargets", { role: "hunter" }, ""), "hunter")
assert.strictEqual(definition.resolveFinalSelectionMode("hunterTargets", { role: "loyal", canControlBotHunter: true }, ""), "hunter")
assert.strictEqual(definition.resolveFinalSelectionMode("hunterTargets", { role: "loyal" }, ""), "")
assert.strictEqual(definition.resolveFinalSelectionMode("identify", { role: "traitor", traitorDecision: null }, "good"), "traitor")
assert.strictEqual(definition.resolveFinalSelectionMode("identify", { role: "loyal", finalSubmitted: false }, ""), "identify")
assert.strictEqual(definition.resolveFinalSelectionMode("identify", { role: "loyal", finalSubmitted: true }, ""), "")

const context = {
  data: {
    game: { galahadLeaderId: null },
    decoratedPlayers: players,
    selectedTeam: [],
    finalTargets: [],
    nextLeaderId: 2,
    nextAmuletId: 3
  },
  setData(value) { this.data = { ...this.data, ...value } }
}
definition.refreshSelections.call(context)
assert.strictEqual(context.data.nextLeaderPlayer.id, 2)
assert.strictEqual(context.data.nextAmuletPlayer.id, 3)

const teamContext = {
  data: {
    tableMode: "team",
    selectedTeam: [],
    missionSize: 2,
    teamPulseId: 0,
    decoratedPlayers: players,
    finalTargets: [],
    game: { galahadLeaderId: null },
    nextLeaderId: null,
    nextAmuletId: null
  },
  selectionTimer: null,
  setData(value) { this.data = { ...this.data, ...value } },
  refreshSelections: definition.refreshSelections,
  flyDeliverTo: definition.flyDeliverTo,
  flyDeliverStep: definition.flyDeliverStep,
  BADGE_OFFSET: definition.BADGE_OFFSET,
  deliverIconFor: definition.deliverIconFor,
  vibrate() {}
}
definition.tapSeat.call(teamContext, { currentTarget: { dataset: { id: 2 } } })
assert.deepStrictEqual(teamContext.data.selectedTeam, [2])
assert.strictEqual(teamContext.data.teamPulseId, 2)
assert.strictEqual(teamContext.data.decoratedPlayers.find(player => player.id === 2).justSelected, true)
clearTimeout(teamContext.selectionTimer)

const finalContext = {
  data: {
    tableMode: "team",
    selectedTeam: [],
    missionSize: 2,
    teamPulseId: 0,
    decoratedPlayers: players,
    finalTargets: [],
    game: { galahadLeaderId: null },
    nextLeaderId: null,
    nextAmuletId: null
  },
  setData(value) { this.data = { ...this.data, ...value } },
  refreshSelections: definition.refreshSelections,
  flyDeliverTo: definition.flyDeliverTo,
  flyDeliverStep: definition.flyDeliverStep,
  BADGE_OFFSET: definition.BADGE_OFFSET,
  deliverIconFor: definition.deliverIconFor,
  vibrate() {}
}
definition.tapSeat.call(finalContext, { currentTarget: { dataset: { id: 1, mode: "final" } } })
definition.tapSeat.call(finalContext, { currentTarget: { dataset: { id: 3, mode: "final" } } })
assert.deepStrictEqual(finalContext.data.finalTargets, [1, 3])
assert.deepStrictEqual(finalContext.data.selectedTeam, [])

const history = definition.buildGameHistory({
  missions: [{ round: 1, leaderId: 1, team: [1, 3], magicTargetId: 3, winner: "good", successCount: 2, failCount: 0 }],
  amuletHistory: [{ round: 2, ownerId: 2, targetId: 1 }]
}, players)
assert.strictEqual(history.missions[0].leader, "1号 甲")
assert.strictEqual(history.missions[0].team, "1号 甲、3号 丙")
assert.strictEqual(history.missions[0].magic, "3号 丙")
assert.deepStrictEqual(history.amulets[0], { id: "2-0", round: 2, owner: "2号 乙", target: "1号 甲" })

// 高频事件走不打断的顶部横幅，只有真正的节点才全屏打断线下讨论
const ceremonyContext = {
  data: { ceremonyVisible: false },
  setData(value) { this.data = { ...this.data, ...value } },
  BANNER_TYPES: definition.BANNER_TYPES,
  enqueueCeremonies: definition.enqueueCeremonies,
  showBanner: definition.showBanner,
  playNextCeremony: definition.playNextCeremony,
  vibrate() {},
  ceremonyQueue: []
}
ceremonyContext.enqueueCeremonies([
  { type: "crown", symbol: "👑", title: "皇冠易主", subtitle: "2号 乙 接掌远征" },
  { type: "amulet", symbol: "🧿", title: "护身符授予", subtitle: "3号 丙 获得查验权" }
])
assert.strictEqual(ceremonyContext.data.bannerVisible, true, "皇冠与护身符应走横幅")
assert.strictEqual(ceremonyContext.data.ceremonyVisible, false, "高频事件不应全屏打断")
assert.strictEqual(ceremonyContext.ceremonyQueue.length, 0)

ceremonyContext.ceremonyQueue = []
ceremonyContext.data.ceremonyVisible = false
ceremonyContext.enqueueCeremonies([
  { type: "round", symbol: "2", title: "第 2 轮远征", subtitle: "4名骑士即将出发" }
])
assert.strictEqual(ceremonyContext.data.ceremonyVisible, true, "轮次开场仍然全屏")

// 翻牌不能依赖 backface-visibility：微信渲染器里它配合 preserve-3d 不可靠，
// 换成图片素材后正反面叠加会非常明显。必须是两段 scaleX。
const fs2 = require("fs")
const playWxss = fs2.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.wxss"), "utf8")
const cardRules = playWxss.split("\n").filter(line => /^\.mission-(result-card|card-back|card-front)/.test(line)).join("\n")
assert.ok(!/backface-visibility/.test(cardRules), "翻牌不应再依赖 backface-visibility")
assert.ok(!/preserve-3d/.test(cardRules), "翻牌不应再使用 preserve-3d")
assert.match(cardRules, /card-face-out/, "牌背需要收起动画")
assert.match(cardRules, /card-face-in/, "牌面需要展开动画")
assert.match(playWxss, /@keyframes card-face-out \{ from \{ transform: scaleX\(1\)/, "牌背应从 scaleX(1) 收到 0")
assert.match(playWxss, /@keyframes card-face-in \{ from \{ transform: scaleX\(0\)/, "牌面应从 scaleX(0) 展开")
// 两面必须错开，否则会同时可见
assert.match(cardRules, /\.mission-card-front[^\n]*--flip-delay[^\n]*\+ 540ms/, "牌面必须在牌背收完之后才展开")

const playWxmlFlip = fs2.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.wxml"), "utf8")
assert.match(playWxmlFlip, /--flip-delay: \{\{item\.delay\}\}ms/, "逐张延迟需要通过 CSS 变量传给两面")

// 道具交付：选中后飘向该玩家的座位坐标；组队模式没有道具，不该触发
const deliverCtx = {
  data: {
    ui: { crown: "cloud://crown", amulet: "cloud://amulet", fire: "cloud://fire" },
    deliverIcon: "cloud://crown", deliverFlying: false, deliverX: 50, deliverY: 50,
    decoratedPlayers: [{ id: 2, x: 18, y: 72 }]
  },
  setData(v) { Object.assign(this.data, v) },
  flyDeliverTo: definition.flyDeliverTo,
  flyDeliverStep: definition.flyDeliverStep,
  BADGE_OFFSET: definition.BADGE_OFFSET,
  deliverIconFor: definition.deliverIconFor
}
// 飞行分两段：先瞬回桌心（不带过渡），下一帧再飞出去。
// 这样改选另一个人时也看得到完整飞行——原先第一句 if (!deliverIcon || deliverFlying) return
// 会把第二次点击整个挡住，而道具飞完 720ms 就清空了，于是换人一点动静都没有。
deliverCtx.flyDeliverTo({ currentTarget: { dataset: { id: 2 } } })
assert.strictEqual(deliverCtx.data.deliverX, 50, "第一段：先瞬回桌心")
assert.strictEqual(deliverCtx.data.deliverY, 50)
assert.strictEqual(deliverCtx.data.deliverFlying, false, "第一段不能带飞行态，否则没有过渡起点")
clearTimeout(deliverCtx.deliverTimer)

// 没有台面尺寸时退回座位原坐标
deliverCtx.flyDeliverStep({ id: 2, x: 18, y: 72 }, "leader")
assert.strictEqual(deliverCtx.data.deliverFlying, true, "第二段：开始飞行")
assert.strictEqual(deliverCtx.data.deliverX, 18)
assert.strictEqual(deliverCtx.data.deliverY, 72)

// 有台面尺寸时，终点要偏到该道具自己那枚徽标上：
// 皇冠在座位左上（x 负偏、y 负偏），火球在右上（x 正偏、y 负偏）
const badgeCtx = {
  data: { ui: {}, deliverIcon: "x", deliverFlying: false, deliverX: 50, deliverY: 50,
          stageW: 366, stageH: 656, tableMode: "leader", decoratedPlayers: [{ id: 2, x: 50, y: 50 }] },
  windowWidth: 375,
  setData(v) { Object.assign(this.data, v) },
  BADGE_OFFSET: definition.BADGE_OFFSET,
  flyDeliverStep: definition.flyDeliverStep
}
badgeCtx.flyDeliverStep({ id: 2, x: 50, y: 50 }, "leader")
assert.ok(badgeCtx.data.deliverX < 50, "皇冠落在座位左上，x 应当左偏")
assert.ok(badgeCtx.data.deliverY < 50, "皇冠落在座位左上，y 应当上偏")
clearTimeout(badgeCtx.deliverTimer)
badgeCtx.flyDeliverStep({ id: 2, x: 50, y: 50 }, "magic")
assert.ok(badgeCtx.data.deliverX > 50, "火球落在座位右上，x 应当右偏")
assert.ok(badgeCtx.data.deliverY < 50, "火球落在座位右上，y 应当上偏")
clearTimeout(badgeCtx.deliverTimer)
clearTimeout(deliverCtx.deliverTimer)

// 道具已被清空（飞完那一下）后再点别人，仍要能重新亮出来飞一次
deliverCtx.data.deliverIcon = ""
deliverCtx.data.tableMode = "leader"
deliverCtx.flyDeliverTo({ currentTarget: { dataset: { id: 2 } } })
assert.ok(deliverCtx.data.deliverIcon, "改选目标时要重新亮出道具，而不是直接返回")
clearTimeout(deliverCtx.deliverTimer)

// 座位的 left/top 就是**中心**（.seat-token 带 translate(-50%,-50%)，见 app.wxss），
// 道具也按中心定位，两者天然对齐。别再补半个座位的偏移——那会把道具推到头像右下方。
const appWxssSeat = require("fs").readFileSync(require("path").join(__dirname, "..", "miniprogram", "app.wxss"), "utf8")
assert.match(appWxssSeat, /\.seat-token \{[^}]*transform: translate\(-50%, -50%\)/s, "座位必须按中心定位")
assert.ok(!/seatCenter/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "miniprogram", "pages", "play", "play.js"), "utf8")),
  "不该再有补偏移的 seatCenter")

// 三种单目标模式各自对应一件道具，组队模式没有
assert.strictEqual(deliverCtx.deliverIconFor("leader"), "cloud://crown")
assert.strictEqual(deliverCtx.deliverIconFor("amuletOwner"), "cloud://amulet")
assert.strictEqual(deliverCtx.deliverIconFor("magic"), "cloud://fire")
assert.strictEqual(deliverCtx.deliverIconFor("team"), "", "组队模式没有待交付道具")

delete global.Page
delete global.wx
console.log("UI animation tests passed")
