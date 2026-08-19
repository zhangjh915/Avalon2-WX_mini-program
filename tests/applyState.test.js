// 对局页 applyState 的冒烟测试。
//
// 为什么必须有这一条：applyState 是 play 页唯一的数据入口，而整页外层是
// wx:if="{{game}}"。它在设置 game 之前抛任何异常，结果都不是报错弹窗，而是
// **整个对局页白屏**——轮询里的 catch 还会把异常静默吞掉，日志上什么都看不到。
//
// 真实踩到过：把 buildGameHistory(game, players) 改成多传一个 dossier.myVotes，
// 却把这行放在了 const dossier = ... 的上面。14 个测试全绿，实机点开始游戏白屏。
// 那次没被抓到，是因为当时没有任何测试真正执行过 applyState。

const assert = require("assert")
const path = require("path")
const core = require("../cloudfunctions/avalonGame/gameCore")
const gameUtil = require("../miniprogram/utils/game")

const PLAYER_COUNT = 7
const seats = Array.from({ length: PLAYER_COUNT }, (_, index) => ({
  seatNo: index + 1, name: `玩家${index + 1}`, bot: index > 0, openid: index === 0 ? "me" : `bot-${index}`
}))
const settings = {
  playerCount: PLAYER_COUNT,
  roleCounts: gameUtil.buildDefaultRoleCounts(PLAYER_COUNT, false),
  unknownRoles: false,
  hunterVoteVariant: false
}
const created = core.createGame(settings, seats)
const secret = created.secret
const game = created.publicGame
assert.ok(game, "createGame 应当返回可下发的对局数据")

const storage = {}
global.Page = value => { global.__playDefinition = value }
global.wx = {
  vibrateShort() {}, showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
  redirectTo() {}, reLaunch() {}, navigateTo() {},
  setStorageSync(key, value) { storage[key] = value },
  getStorageSync(key) { return storage[key] },
  createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }) })
}

const playPath = path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js")
delete require.cache[require.resolve(playPath)]
require(playPath)
const definition = global.__playDefinition
assert.ok(definition, "play page did not register")

// 每个阶段都过一遍：崩溃点往往只在某一个阶段的分支里
const PHASES = ["reveal", "night", "mission", "vote", "amulet", "finale"]
PHASES.forEach(phase => {
  const view = core.privateView(game, secret, "me")
  assert.ok(view, "privateView 应当能取到本人视角")
  const result = {
    room: {
      _id: "room-1", status: "playing", phase,
      playerCount: PLAYER_COUNT, tableType: "round", seats,
      settings, game, missionSkin: "a", roleSkin: "painted"
    },
    private: view,
    isHost: true
  }

  // 用页面自己的初始 data 起步，避免测试里手写一份很快就过期的假数据
  const context = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
    ceremonyQueue: [],
    vibrate() {},
    enqueueCeremonies() {},
    startNightAuto() {},
    stopTimers() {}
  })

  // 断言的是「不抛异常」——抛了就是白屏，报错信息本身不重要
  assert.doesNotThrow(() => context.applyState(result), `applyState 在 ${phase} 阶段抛异常`)
  assert.ok(context.data.game, `${phase} 阶段没有把 game 写进 data，对局页会整页白屏`)
  assert.strictEqual(context.data.decoratedPlayers.length, PLAYER_COUNT, `${phase} 阶段座位数不对`)
  assert.strictEqual(context.data.phase, phase)
})

delete global.Page
delete global.wx
delete global.__playDefinition
console.log("applyState smoke tests passed")
