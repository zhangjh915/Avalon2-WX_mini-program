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

delete global.Page
delete global.wx
console.log("UI animation tests passed")
