// 随机对局机：让 5-10 个模拟玩家把真实的云函数代码打完几百局，
// 每一步都拿「规则判官」(tests/lib/rulesOracle.js) 核对，专抓纯逻辑层面的问题：
//
//   1. 身份信息：每个人手机上的秘密信息，恰好等于说明书允许他知道的那几个座位，多一个少一个都算错
//   2. 不泄密：公开的房间文档里没有任何人的角色/阵营，私密视图只含本人有权看的东西
//   3. 规则：任务牌选项、任务胜负、护身符轮次与人选限制、队长接任限制、加拉哈德/揭露者/吹嘘者、终局判定
//   4. 状态机：合法操作后阶段与公开状态一致；**非法操作**（越权、错阶段、重复提交、非法选项）
//      必须被拒、拒绝理由正确、且状态一个字节都不变
//   5. 客户端派生数据：抽样把每个人的视图喂给 play.js 的 applyState，核对屏幕上会显示的关键字段
//
// 输入是随机的（合法与非法混打），但整局可复现：失败时打印 seed 和局号，
//   SIM_SEED=<seed> SIM_GAMES=<n> node tests/gameSimulation.test.js
// 其他开关：SIM_CLIENT_EVERY（每几次审计跑一次客户端检查，默认 4）、SIM_VERBOSE=1 打印每局摘要。

const assert = require("assert")
const path = require("path")
const core = require("../cloudfunctions/avalonGame/gameCore")
const gameUtil = require("../miniprogram/utils/game")
const oracle = require("./lib/rulesOracle")
const { createCloudMock, loadCloudFunction, clone } = require("./lib/cloudMock")

const GAMES = Number(process.env.SIM_GAMES) || 200
const SEED = Number(process.env.SIM_SEED) || 20260907
const CLIENT_EVERY = Number(process.env.SIM_CLIENT_EVERY) || 4
const VERBOSE = !!process.env.SIM_VERBOSE

// ---------- 可复现的随机 ----------
function mulberry32(seed) {
  let state = seed >>> 0
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const nativeRandom = Math.random
const rng = mulberry32(SEED)
Math.random = rng   // 云函数里的洗牌/首任队长/房间码全走这条，整局才可复现

const chance = p => rng() < p
const pick = list => list[Math.floor(rng() * list.length)]
function shuffled(list) {
  const values = list.slice()
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1))
    const value = values[index]; values[index] = values[target]; values[target] = value
  }
  return values
}
const sample = (list, count) => shuffled(list).slice(0, count)
const setEqual = (a, b) => a.size === b.size && Array.from(a).every(item => b.has(item))
const ROLE_LIMITS = {
  loyal: { min: 5, many: true }, arthur: { min: 7 }, duke: { min: 7, copies: 2 }, archduke: { min: 9, copies: 2 },
  priest: { min: 6, copies: 2 }, squire: { min: 6 }, apprentice: { min: 5, copies: 2 }, troublemaker: { min: 7 },
  morgan: { min: 5 }, minion: { min: 5, many: true }, shapeshifter: { min: 6 }, crownPrince: { min: 5, max: 5 },
  hunter: { min: 6 }, barbarian: { min: 7 }, traitor: { min: 5 }, revealer: { min: 7 }, lunatic: { min: 5 },
  deceiver: { min: 6 }, galahad: { min: 5 }, reluctant: { min: 7 }, guard: { min: 6 }, percival: { min: 7 },
  boaster: { min: 5 }, saboteur: { min: 5 }, outsider: { min: 5 }, lancelotGood: { min: 6 }, lancelotEvil: { min: 6 }
}

// ---------- 云函数 ----------
const mock = createCloudMock()
const cloud = loadCloudFunction(mock)
async function call(name, payload, openid) {
  mock.setOpenid(openid)
  return cloud.main({ action: name, ...(payload || {}) })
}

// ---------- 客户端 play.js（只用来核对派生数据） ----------
const storage = {}
global.Page = value => { global.__playDefinition = value }
global.wx = {
  vibrateShort() {}, showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
  redirectTo() {}, reLaunch() {}, navigateTo() {},
  setStorageSync(key, value) { storage[key] = value },
  getStorageSync(key) { return storage[key] },
  createSelectorQuery: () => {
    const chain = { boundingClientRect: () => chain, fields: () => chain, exec: () => {} }
    return { in: () => ({ select: () => chain, selectAll: () => chain, exec: () => {} }) }
  }
}
require(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js"))
const playDefinition = global.__playDefinition
assert.ok(playDefinition, "play 页没有注册")
function playContext(roomId) {
  const context = Object.assign({}, playDefinition, {
    data: clone(playDefinition.data),
    setData(patch) { Object.assign(this.data, patch) },
    ceremonyQueue: [], vibrate() {}, enqueueCeremonies() {}, measureStage() {},
    startTimers() {}, stopTimers() {}, leaveTo(url) { this.leftTo = url }
  })
  context.data.roomId = roomId
  return context
}

// ---------- 违规收集：不在第一处停下，把整批局跑完再一起报 ----------
const violations = new Map()
const coverage = {
  games: 0, finished: 0, byCount: {}, rolesSeen: {}, probes: 0, audits: 0, clientChecks: 0,
  unknownRoles: 0, hunterVote: 0, withBots: 0, deceiverLies: 0, inspections: 0, deceiverInspectLies: 0,
  galahadClaims: 0, hunts: 0, huntSuccess: 0, hunterVotesForced: 0, traitorConverted: 0,
  identifyRuns: 0, identifyGood: 0, correctionsUsed: 0, goodByMissions: 0, allLeadersEvil: 0, winners: { good: 0, evil: 0 }
}
class Violation extends Error {}
function record(key, detail, sim) {
  const entry = violations.get(key) || { count: 0, sample: null }
  entry.count += 1
  if (!entry.sample) entry.sample = { detail, game: sim && sim.index, seed: SEED, playerCount: sim && sim.config.playerCount, roles: sim && sim.roleSummary(), log: sim ? sim.log.slice(-14) : [] }
  violations.set(key, entry)
}

// ---------- 随机但合法的角色配置 ----------
function randomRoleCounts(playerCount, unknownRoles) {
  const totals = oracle.FACTION_TOTALS[playerCount]
  const optional = Object.keys(ROLE_LIMITS).filter(role => ["loyal", "minion", "morgan"].indexOf(role) < 0)
  const allowed = optional.filter(role => playerCount >= ROLE_LIMITS[role].min && (!ROLE_LIMITS[role].max || playerCount <= ROLE_LIMITS[role].max))
  const counts = { morgan: 1 }
  shuffled(allowed).forEach(role => {
    if (role === "lancelotEvil") return
    if (!chance(0.4)) return
    const copies = ROLE_LIMITS[role].copies && chance(0.3) ? 2 : 1
    if (role === "lancelotGood") { counts.lancelotGood = 1; counts.lancelotEvil = 1; return }
    counts[role] = copies
  })
  const extra = unknownRoles ? 1 : 0     // 未知角色变体：候选池可以比名额多
  const trim = side => {
    const cap = totals[side] + extra
    const roles = () => Object.keys(counts).filter(role => oracle.FACTION[role] === side)
    const total = () => roles().reduce((sum, role) => sum + counts[role], 0)
    while (total() > cap) {
      const role = pick(roles().filter(role => role !== "morgan"))
      if (!role) break
      if (role === "lancelotGood" || role === "lancelotEvil") { delete counts.lancelotGood; delete counts.lancelotEvil } else if (counts[role] > 1) counts[role] -= 1
      else delete counts[role]
    }
    const missing = totals[side] - total()
    if (missing > 0) counts[side === "good" ? "loyal" : "minion"] = (counts[side === "good" ? "loyal" : "minion"] || 0) + missing
  }
  trim("good"); trim("evil")
  return counts
}

function legalRoleCounts(playerCount, unknownRoles) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const counts = randomRoleCounts(playerCount, unknownRoles)
    if (unknownRoles) {
      // 候选池至少要比名额多一个人；多出来的用忠臣补最省事
      const total = Object.keys(counts).reduce((sum, role) => sum + counts[role], 0)
      if (total <= playerCount) counts.loyal = (counts.loyal || 0) + 1
    }
    try { core.validateSettings({ playerCount, roleCounts: counts, unknownRoles }); return counts } catch (error) { /* 再来一次 */ }
  }
  return gameUtil.buildDefaultRoleCounts(playerCount, unknownRoles)
}

// ---------- 一局 ----------
class Sim {
  constructor(index) {
    this.index = index
    this.log = []
    const playerCount = 5 + Math.floor(rng() * 6)
    const withBots = chance(0.15)
    const unknownRoles = chance(0.25)
    this.config = {
      playerCount, withBots, unknownRoles,
      hunterVoteVariant: chance(0.3),
      tableType: chance(0.5) ? "round" : "long",
      roleCounts: legalRoleCounts(playerCount, unknownRoles),
      // 三成的局故意让邪恶方轮流当队长、带着同伙上车，逼出「所有队长都是邪恶方」这条特例
      evilLeaderBias: chance(0.3),
      hostSeat: 1 + Math.floor(rng() * playerCount),
      firstLeaderSeat: chance(0.5) ? 1 + Math.floor(rng() * playerCount) : 0,
      humanCount: withBots ? 1 + Math.floor(rng() * (playerCount - 1)) : playerCount
    }
    this.votes = {}          // round -> { id: value }
    this.inspections = []    // { round, ownerId, targetId, displayed }
    this.missionLog = []     // { round, leaderId, team, magicTargetId }
    this.leaderClaim = null
    this.finale = { hunterVotes: {}, hunt: null, hunterTargets: null, submissions: {}, traitorSide: null, traitorTargets: null }
    this.stepCount = 0
    this.auditCount = 0
    this.galahadClaimed = false
  }

  room() { return mock.get("avalon_rooms", this.roomId) }
  secret() { return mock.get("avalon_game_secrets", this.roomId) }
  players() { return this.secret().players }
  byId(id) { return this.players().find(player => player.id === Number(id)) }
  humans() { return this.players().filter(player => player.openid) }
  openidOf(player) { return player.openid }
  host() { return this.players().find(player => player.openid === "host") }
  otherHuman(player) { return pick(this.humans().filter(item => item.id !== player.id)) }
  roleSummary() { return this.players().map(player => `${player.id}:${player.role}${player.openid ? "" : "(bot)"}`).join(" ") }

  note(text) { this.log.push(text); if (this.log.length > 60) this.log.shift() }
  snapshot() { return JSON.stringify([this.room(), this.secret()]) }

  // 应当成功的操作：成功后立即做一轮审计
  async ok(name, payload, openid) {
    this.stepCount += 1
    if (this.stepCount > 2500) throw new Violation("步数超过 2500，流程可能在打转")
    let result
    try {
      result = await call(name, payload, openid)
    } catch (error) {
      throw new Violation(`应当成功的操作被拒：${name} by ${openid} ${JSON.stringify(payload)} → ${error.message}`)
    }
    this.note(`ok ${name} ${openid} ${JSON.stringify(payload)}`)
    await this.audit(name)
    return result
  }

  // 非法操作：必须被拒、理由匹配、状态不变
  async bad(name, payload, openid, pattern, label) {
    this.stepCount += 1
    coverage.probes += 1
    const before = this.snapshot()
    let error = null
    try { await call(name, payload, openid) } catch (caught) { error = caught }
    this.note(`bad ${name} ${openid} ${JSON.stringify(payload)} → ${error ? error.message : "居然成功了"}`)
    if (!error) record(`accepted-illegal:${label}`, `${name} ${JSON.stringify(payload)} by ${openid} 被接受了`, this)
    else if (pattern && !pattern.test(error.message)) record(`reject-reason:${label}`, `${name} 拒绝理由不对：${error.message}`, this)
    if (this.snapshot() !== before) record(`illegal-mutated:${label}`, `${name} 被拒后状态却变了`, this)
  }

  async run() {
    mock.reset()
    await this.setup()
    let guard = 0
    while (this.room().status !== "finished") {
      guard += 1
      if (guard > 60) throw new Violation(`阶段循环 60 次仍未结束，卡在 ${this.room().phase}`)
      const phase = this.room().phase
      if (phase === "reveal") await this.identityPhase()
      else if (phase === "mission") await this.missionPhase()
      else if (phase === "vote") await this.votePhase()
      else if (phase === "missionResult") await this.resultPhase()
      else if (phase === "amulet") await this.amuletPhase()
      else if (phase === "finale") await this.finalePhase()
      else throw new Violation(`未知阶段 ${phase}`)
    }
    await this.finished()
  }

  async setup() {
    const cfg = this.config
    coverage.byCount[cfg.playerCount] = (coverage.byCount[cfg.playerCount] || 0) + 1
    if (cfg.unknownRoles) coverage.unknownRoles += 1
    if (cfg.hunterVoteVariant) coverage.hunterVote += 1
    if (cfg.withBots) coverage.withBots += 1
    const created = await call("createRoom", {
      playerCount: cfg.playerCount, roleCounts: cfg.roleCounts, unknownRoles: cfg.unknownRoles,
      hunterVoteVariant: cfg.hunterVoteVariant, tableType: cfg.tableType, devMode: cfg.withBots
    }, "host")
    this.roomId = created.roomId
    const seats = shuffled(Array.from({ length: cfg.playerCount }, (_, index) => index + 1))
    const humanSeats = [cfg.hostSeat].concat(seats.filter(seat => seat !== cfg.hostSeat).slice(0, cfg.humanCount - 1))
    for (const seat of shuffled(humanSeats)) {
      const openid = seat === cfg.hostSeat ? "host" : `u${seat}`
      await call("takeSeat", { roomId: this.roomId, seatNo: seat, name: `玩家${seat}` }, openid)
    }
    if (cfg.withBots) await call("fillBots", { roomId: this.roomId }, "host")
    else if (cfg.humanCount < cfg.playerCount) throw new Error("非测试房间必须坐满")
    // 开局前的非法操作
    if (chance(0.5)) await this.bad("startGame", { roomId: this.roomId }, "u-stranger", /只有房主/, "startGame-by-stranger")
    if (chance(0.5)) await this.bad("startVote", { roomId: this.roomId, team: [1, 2], magicTargetId: 1 }, "host", /不在本局座位|不是组队阶段|只有当前队长/, "startVote-in-lobby")
    const payload = { roomId: this.roomId }
    if (cfg.firstLeaderSeat) payload.firstLeaderSeatNo = cfg.firstLeaderSeat
    await this.ok("startGame", payload, "host")
    const game = this.room().game
    if (cfg.firstLeaderSeat && game.firstLeaderId !== cfg.firstLeaderSeat) record("first-leader-not-honored", `指定 ${cfg.firstLeaderSeat} 号，实际 ${game.firstLeaderId}`, this)
    this.players().forEach(player => { coverage.rolesSeen[player.role] = (coverage.rolesSeen[player.role] || 0) + 1 })
    if (this.room().status !== "playing" || this.room().phase !== "reveal") throw new Violation("开局后应当进入 reveal")
    if (chance(0.5)) await this.bad("getResult", { roomId: this.roomId }, "host", /尚未结束/, "getResult-early")
  }

  // ---------- 身份阶段 ----------
  async identityPhase() {
    const humans = shuffled(this.humans())
    for (let index = 0; index < humans.length; index += 1) {
      if (index === 1 && humans.length > 1 && chance(0.6)) await this.bad("startIdentity", { roomId: this.roomId }, "host", /未准备好/, "startIdentity-before-ready")
      await this.ok("identityReady", { roomId: this.roomId }, humans[index].openid)
    }
    if (chance(0.5)) await this.ok("identityReady", { roomId: this.roomId }, pick(humans).openid)   // 重复准备是幂等的
    const nonHost = this.humans().find(player => player.openid !== "host")
    if (nonHost && chance(0.6)) await this.bad("startIdentity", { roomId: this.roomId }, nonHost.openid, /只有房主/, "startIdentity-by-player")
    await this.ok("startIdentity", { roomId: this.roomId }, "host")
    await this.bad("startIdentity", { roomId: this.roomId }, "host", /已经开始揭示/, "startIdentity-twice")

    const leader = this.byId(this.room().game.firstLeaderId)
    if (leader.openid) {
      const options = oracle.claimOptions(leader)
      const other = this.otherHuman(leader)
      if (other && chance(0.7)) await this.bad("identityClaim", { roomId: this.roomId, claim: "good" }, other.openid, /只有首任队长/, "claim-by-non-leader")
      if (options.length === 1 && chance(0.8)) {
        const wrong = options[0] === "good" ? "evil" : "good"
        await this.bad("identityClaim", { roomId: this.roomId, claim: wrong }, leader.openid, /只能展示你真实的阵营/, "claim-wrong-faction")
      }
      if (chance(0.5)) await this.bad("identityClaim", { roomId: this.roomId, claim: "both" }, leader.openid, /不合法/, "claim-garbage")
      if (chance(0.5)) await this.bad("identityRemembered", { roomId: this.roomId }, leader.openid, /尚未结束|请先选择/, "remember-before-claim")
      const claim = pick(options)
      if (leader.role === "deceiver" && claim !== "evil") coverage.deceiverLies += 1
      this.leaderClaim = claim
      await this.ok("identityClaim", { roomId: this.roomId, claim }, leader.openid)
      await this.bad("identityClaim", { roomId: this.roomId, claim }, leader.openid, /已经提交/, "claim-twice")
    } else {
      this.leaderClaim = this.secret().priestClaim   // bot 队长开局就填好了
    }
    const identity = this.room().game.identity
    if (!identity.revealAt || !identity.closeAt) throw new Violation("队长选完展示阵营后应当进入全员揭示")
    if (chance(0.7)) await this.bad("enterMission", { roomId: this.roomId }, "host", /身份确认尚未结束/, "enterMission-before-close")
    if (chance(0.5)) await this.bad("identityRemembered", { roomId: this.roomId }, pick(this.humans()).openid, /尚未结束/, "remember-before-close")
    this.room().game.identity.closeAt = Date.now() - 1     // 40 秒阅读时间直接拨过去
    const rememberOrder = shuffled(this.humans())
    for (let index = 0; index < rememberOrder.length; index += 1) {
      if (index === 1 && chance(0.6)) await this.bad("enterMission", { roomId: this.roomId }, "host", /还有玩家未确认身份/, "enterMission-before-all-remembered")
      await this.ok("identityRemembered", { roomId: this.roomId }, rememberOrder[index].openid)
    }
    if (nonHost && chance(0.5)) await this.bad("enterMission", { roomId: this.roomId }, nonHost.openid, /只有房主/, "enterMission-by-player")
    await this.ok("enterMission", { roomId: this.roomId }, "host")
    if (this.room().phase !== "mission") throw new Violation("enterMission 后应当进入 mission")
    await this.bad("enterMission", { roomId: this.roomId }, "host", /当前不能开始远征/, "enterMission-twice")
  }

  // ---------- 组队 ----------
  async missionPhase() {
    const game = this.room().game
    const leader = this.byId(game.leaderId)
    const size = oracle.MISSION_SIZES[game.playerCount][game.round - 1]
    if (game.missionPreset.sizes[game.round - 1] !== size) record("mission-size", `第 ${game.round} 轮人数 ${game.missionPreset.sizes[game.round - 1]}，说明书 ${size}`, this)
    if (game.round === 5 && leader.role === "boaster" && !leader.revealed) record("boaster-not-revealed", "吹嘘者当第五轮队长却没公开", this)
    if (!leader.openid) {
      const suggestion = await call("botSuggest", { roomId: this.roomId }, "host")
      await this.ok(suggestion.action, { roomId: this.roomId, ...suggestion.payload }, "host")
    } else {
      const ids = this.players().map(player => player.id)
      let team = sample(ids, size)
      if (this.config.evilLeaderBias && oracle.faction(leader) === "evil") {
        const evils = shuffled(this.players().filter(player => oracle.faction(player) === "evil" && player.id !== leader.id).map(player => player.id))
        const rest = shuffled(ids.filter(id => id !== leader.id && evils.indexOf(id) < 0))
        team = [leader.id].concat(evils, rest).slice(0, size)
      }
      const magicTargetId = pick(team)
      const other = this.otherHuman(leader)
      if (other && chance(0.5)) await this.bad("startVote", { roomId: this.roomId, team, magicTargetId }, other.openid, /只有当前队长/, "startVote-by-non-leader")
      if (chance(0.5)) await this.bad("startVote", { roomId: this.roomId, team: team.slice(1), magicTargetId }, leader.openid, /本轮需要/, "startVote-short-team")
      if (chance(0.4)) await this.bad("startVote", { roomId: this.roomId, team: [team[0]].concat(team.slice(0, size - 1)), magicTargetId: team[0] }, leader.openid, /本轮需要/, "startVote-duplicate")
      if (size < ids.length && chance(0.5)) {
        const outside = pick(ids.filter(id => team.indexOf(id) < 0))
        await this.bad("startVote", { roomId: this.roomId, team, magicTargetId: outside }, leader.openid, /只能给同行骑士/, "magic-outside-team")
      }
      if (chance(0.3)) await this.bad("startVote", { roomId: this.roomId, team: team.slice(0, size - 1).concat([99]), magicTargetId }, leader.openid, /无效座位|本轮需要/, "startVote-bad-seat")
      await this.ok("startVote", { roomId: this.roomId, team, magicTargetId }, leader.openid)
    }
    const after = this.room().game
    this.missionLog.push({ round: after.round, leaderId: after.leaderId, team: after.current.team.slice(), magicTargetId: after.current.magicTargetId })
    if (this.room().phase !== "vote") throw new Violation("startVote 后应当进入 vote")
    if (after.current.team.length !== size) throw new Violation("队伍人数与说明书不符")
    if (after.current.team.indexOf(after.current.magicTargetId) < 0) throw new Violation("魔法目标不在队伍里")
  }

  // ---------- 出牌 ----------
  async votePhase() {
    const game = this.room().game
    const round = game.round
    this.votes[round] = this.votes[round] || {}
    const team = game.current.team.map(id => this.byId(id))
    const humansOnTeam = shuffled(team.filter(player => player.openid))
    const outsiders = this.humans().filter(player => game.current.team.indexOf(player.id) < 0)
    for (const player of humansOnTeam) {
      const view = await call("getState", { roomId: this.roomId }, player.openid)
      const expected = oracle.legalVotes(player, round, game.leaderId === player.id, game.current.magicTargetId === player.id)
      if (!setEqual(new Set(view.private.voteOptions), new Set(expected))) {
        record(`vote-options:${player.role}`, `${player.role} 第 ${round} 轮 ${game.current.magicTargetId === player.id ? "持魔法" : ""} 服务端给 ${view.private.voteOptions}，说明书 ${expected}`, this)
      }
      if (expected.length === 1 && chance(0.8)) {
        await this.bad("submitVote", { roomId: this.roomId, value: expected[0] === "success" ? "fail" : "success" }, player.openid, /不能打出这张任务牌/, `vote-illegal:${player.role}`)
      }
      if (outsiders.length && chance(0.3)) await this.bad("submitVote", { roomId: this.roomId, value: "success" }, pick(outsiders).openid, /不在本轮任务队伍/, "vote-by-outsider")
      if (chance(0.2)) await this.bad("submitVote", { roomId: this.roomId, value: "maybe" }, player.openid, /不能打出这张任务牌/, "vote-garbage")
      const value = expected.length === 1 ? expected[0] : (oracle.faction(player) === "evil" && chance(0.6) ? "fail" : pick(expected))
      this.votes[round][player.id] = value
      await this.ok("submitVote", { roomId: this.roomId, value }, player.openid)
      if (this.room().phase === "vote" && chance(0.5)) await this.bad("submitVote", { roomId: this.roomId, value }, player.openid, /已经投过票/, "vote-twice")
      if (this.room().phase === "vote") {
        const voted = new Set(this.room().game.current.votedIds)
        const expectedVoted = new Set(Object.keys(this.secret().votes[String(round)] || {}).map(Number))
        if (!setEqual(voted, expectedVoted)) record("votedIds", "公开的已出牌名单与实际不符", this)
      }
    }
    if (team.some(player => !player.openid)) {
      await this.ok("submitBotVotes", { roomId: this.roomId }, "host")
      const roundVotes = this.secret().votes[String(round)] || {}
      team.filter(player => !player.openid).forEach(player => { this.votes[round][player.id] = roundVotes[String(player.id)] })
    }
    const room = this.room()
    if (room.phase === "vote") throw new Violation("全员出牌后仍停在 vote")
    const mission = room.game.missions[room.game.missions.length - 1]
    if (!mission || mission.round !== round) throw new Violation("出牌完毕后没有生成本轮任务记录")
    const fails = Object.values(this.votes[round]).filter(value => value === "fail").length
    const successes = Object.values(this.votes[round]).length - fails
    if (mission.failCount !== fails || mission.successCount !== successes) record("mission-tally", `第 ${round} 轮记录 ${mission.successCount}/${mission.failCount}，实际 ${successes}/${fails}`, this)
    if (mission.winner !== oracle.missionWinner(room.playerCount, round, fails)) record("mission-winner", `第 ${round} 轮 ${fails} 张失败判为 ${mission.winner}`, this)
    if (mission.protectedRound !== oracle.isProtectedRound(room.playerCount, round)) record("protected-round-flag", `第 ${round} 轮保护轮标记 ${mission.protectedRound}`, this)
    const evilWins = room.game.missions.filter(item => item.winner === "evil").length
    if (evilWins >= 3) {
      this.players().filter(player => player.role === "revealer").forEach(player => {
        if (!player.revealed) record("revealer-not-revealed", "第三次失败后揭露者没公开", this)
      })
    }
    if (room.status === "finished") return
    if (room.phase === "finale") {
      if (!(room.game.goodWins >= 3 || room.game.evilWins >= 3)) throw new Violation("没到三胜就进了终局")
      return
    }
    if (room.game.goodWins >= 3 || room.game.evilWins >= 3) throw new Violation("三胜后没有进终局")
    if (room.phase !== "missionResult") throw new Violation(`出牌后阶段异常 ${room.phase}`)
  }

  // ---------- 结算与交接 ----------
  async resultPhase() {
    const game = this.room().game
    const completedRound = game.round
    const leader = this.byId(game.leaderId)
    // 加拉哈德：能不能发动，服务端给客户端的标志必须和说明书一致
    for (const player of this.humans()) {
      const view = await call("getState", { roomId: this.roomId }, player.openid)
      const eligible = oracle.galahadEligible(player, game)
      if (!!view.private.canClaimGalahad !== eligible) record("galahad-flag", `${player.role} canClaimGalahad=${view.private.canClaimGalahad}，说明书 ${eligible}`, this)
    }
    const galahad = this.humans().find(player => oracle.galahadEligible(player, game))
    const nonGalahad = this.humans().find(player => !oracle.galahadEligible(player, game))
    if (nonGalahad && chance(0.4)) await this.bad("claimGalahad", { roomId: this.roomId }, nonGalahad.openid, /当前不能发动加拉哈德/, "galahad-by-ineligible")
    let galahadTook = false
    if (galahad && chance(0.7)) {
      this.galahadClaimed = true
      await this.ok("claimGalahad", { roomId: this.roomId }, galahad.openid)
      coverage.galahadClaims += 1
      galahadTook = true
      if (!this.byId(galahad.id).revealed) record("galahad-not-revealed", "加拉哈德发动后没公开", this)
      await this.bad("claimGalahad", { roomId: this.roomId }, galahad.openid, /已有加拉哈德|当前不能/, "galahad-twice")
    }
    const needAmulet = oracle.amuletAfterRound(game.playerCount, completedRound)
    const noInspectionYet = this.inspections.length === 0
    const eligible = this.players().filter(player => oracle.canLead(player))
    if (!leader.openid) {
      const suggestion = await call("botSuggest", { roomId: this.roomId }, "host")
      await this.ok(suggestion.action, { roomId: this.roomId, ...suggestion.payload }, "host")
    } else {
      const evilEligible = eligible.filter(player => oracle.faction(player) === "evil")
      const nextLeaderId = galahadTook ? galahad.id : (this.config.evilLeaderBias && evilEligible.length ? pick(evilEligible).id : pick(eligible).id)
      const holders = this.players().filter(player => oracle.canHoldAmulet(player, nextLeaderId))
      const amuletOwnerId = needAmulet ? pick(holders).id : null
      const other = this.otherHuman(leader)
      if (other && chance(0.5)) await this.bad("handoff", { roomId: this.roomId, nextLeaderId, amuletOwnerId }, other.openid, /只有当前队长/, "handoff-by-non-leader")
      const led = this.players().find(player => player.hasLed && player.id !== game.galahadLeaderId)
      if (led && !galahadTook && chance(0.6)) await this.bad("handoff", { roomId: this.roomId, nextLeaderId: led.id, amuletOwnerId }, leader.openid, /已担任过队长/, "handoff-to-former-leader")
      const held = this.players().find(player => player.hadAmulet && !player.hasLed)
      if (held && !galahadTook && chance(0.6)) await this.bad("handoff", { roomId: this.roomId, nextLeaderId: held.id, amuletOwnerId }, leader.openid, /曾持有护身符/, "handoff-to-amulet-holder")
      if (needAmulet) {
        if (chance(0.6)) await this.bad("handoff", { roomId: this.roomId, nextLeaderId, amuletOwnerId: null }, leader.openid, /必须指定护身符持有者/, "handoff-missing-amulet")
        if (chance(0.6)) await this.bad("handoff", { roomId: this.roomId, nextLeaderId, amuletOwnerId: nextLeaderId }, leader.openid, /不能获得护身符/, "amulet-to-next-leader")
        const badHolder = this.players().find(player => (player.hasLed || player.hadAmulet) && player.id !== nextLeaderId)
        if (badHolder && chance(0.5)) await this.bad("handoff", { roomId: this.roomId, nextLeaderId, amuletOwnerId: badHolder.id }, leader.openid, /不能获得护身符/, "amulet-to-ineligible")
      }
      await this.ok("handoff", { roomId: this.roomId, nextLeaderId, amuletOwnerId }, leader.openid)
    }
    const after = this.room()
    if (after.game.round !== completedRound + 1) throw new Violation("交接后轮次没有 +1")
    const newLeader = this.byId(after.game.leaderId)
    if (galahadTook && newLeader.id !== galahad.id) record("galahad-not-leader", "加拉哈德发动后皇冠没到他手上", this)
    if (!newLeader.hasLed) record("leader-hasLed", "新队长没有标记 hasLed", this)
    if (after.game.round === 5 && newLeader.role === "boaster" && !newLeader.revealed) record("boaster-not-revealed", "吹嘘者接任第五轮队长时没公开", this)
    if (needAmulet) {
      if (!after.game.amulet) throw new Violation(`第 ${completedRound} 轮后应当出现护身符`)
      const owner = this.byId(after.game.amulet.ownerId)
      if (!owner.hadAmulet) record("amulet-owner-flag", "持符者没有标记 hadAmulet", this)
      if (owner.id === newLeader.id) record("amulet-owner-is-leader", "护身符落到了新队长手上", this)
      if (after.game.amulet.firstOfGame !== noInspectionYet) record("amulet-firstOfGame", "firstOfGame 标记不对", this)
      if (after.phase !== "amulet" && !(!owner.openid && after.phase === "mission")) throw new Violation(`护身符出现后阶段异常 ${after.phase}`)
      if (!owner.openid && after.phase === "mission") this.syncInspections()
    } else {
      if (after.game.amulet) record("amulet-unexpected", `第 ${completedRound} 轮后不该有护身符`, this)
      if (after.phase !== "mission") throw new Violation(`交接后阶段异常 ${after.phase}`)
    }
  }

  // 查验记录以 secret 里的流水为准（bot 持符者的自动查验也在里面），这里只做同步
  syncInspections() {
    const history = this.secret().amuletHistory || []
    while (this.inspections.length < history.length) {
      const item = history[this.inspections.length]
      this.inspections.push({ round: item.round, ownerId: item.ownerId, targetId: item.targetId, displayed: item.displayedFaction })
      coverage.inspections += 1
    }
  }

  // ---------- 护身符 ----------
  async amuletPhase() {
    const game = this.room().game
    const amulet = game.amulet
    const owner = this.byId(amulet.ownerId)
    if (!owner.openid) throw new Violation("bot 持符者应当在交接时自动完成查验")
    const targets = this.players().filter(player => oracle.canBeInspected(player, owner.id))
    const other = this.otherHuman(owner)
    if (other && chance(0.6)) await this.bad("selectAmuletTarget", { roomId: this.roomId, targetId: targets[0].id }, other.openid, /只有护身符持有者/, "inspect-by-non-owner")
    if (chance(0.5)) await this.bad("selectAmuletTarget", { roomId: this.roomId, targetId: owner.id }, owner.openid, /不能被查验/, "inspect-self")
    const blocked = this.players().find(player => player.id !== owner.id && (player.hadAmulet || player.fadedAmulet))
    if (blocked && chance(0.7)) await this.bad("selectAmuletTarget", { roomId: this.roomId, targetId: blocked.id }, owner.openid, /不能被查验/, "inspect-blocked")
    if (chance(0.5)) await this.bad("completeAmulet", { roomId: this.roomId }, owner.openid, /尚未就绪/, "complete-before-result")
    const target = pick(targets)
    await this.ok("selectAmuletTarget", { roomId: this.roomId, targetId: target.id }, owner.openid)
    let displayed
    if (target.openid) {
      if (this.room().game.amulet.status !== "claim") throw new Violation("真人被查验后应当进入 claim")
      const options = oracle.claimOptions(target)
      const bystander = pick(this.humans().filter(player => player.id !== target.id))
      if (bystander && chance(0.6)) await this.bad("inspectionClaim", { roomId: this.roomId, claim: "good" }, bystander.openid, /不是当前被查验者/, "claim-by-bystander")
      if (options.length === 1 && chance(0.8)) await this.bad("inspectionClaim", { roomId: this.roomId, claim: options[0] === "good" ? "evil" : "good" }, target.openid, /不合法/, `inspection-claim-wrong:${target.role}`)
      if (chance(0.5)) await this.bad("completeAmulet", { roomId: this.roomId }, owner.openid, /尚未就绪/, "complete-during-claim")
      const view = await call("getState", { roomId: this.roomId }, target.openid)
      if (!view.private.isInspectionTarget) record("inspection-target-flag", "被查验者的视图没标记 isInspectionTarget", this)
      if (!setEqual(new Set(view.private.inspectionOptions), new Set(options))) record(`inspection-options:${target.role}`, `服务端给 ${view.private.inspectionOptions}，说明书 ${options}`, this)
      displayed = pick(options)
      if (target.role === "deceiver" && displayed === "good") coverage.deceiverInspectLies += 1
      await this.ok("inspectionClaim", { roomId: this.roomId, claim: displayed }, target.openid)
      await this.bad("inspectionClaim", { roomId: this.roomId, claim: displayed }, target.openid, /不是当前被查验者/, "inspection-claim-twice")
    } else {
      // 测试骑士被查验由服务端代答：骗徒 bot 不会撒谎，亮真实阵营
      displayed = target.role === "deceiver" ? "evil" : oracle.displayedFaction(target)
    }
    this.syncInspections()
    const recorded = this.inspections[this.inspections.length - 1]
    if (!recorded || recorded.targetId !== target.id || recorded.displayed !== displayed) record("inspection-recorded", `服务端记录的查验 ${JSON.stringify(recorded)}，实际 ${target.id} 号展示 ${displayed}`, this)
    if (this.room().game.amulet.status !== "result") throw new Violation("查验后应当进入 result")
    if (!this.byId(target.id).fadedAmulet) record("faded-flag", "被查验者没有标记褪色护身符", this)
    const ownerView = await call("getState", { roomId: this.roomId }, owner.openid)
    if (ownerView.private.inspectionResult !== displayed) record("inspection-result-owner", `持符者看到 ${ownerView.private.inspectionResult}，应为 ${displayed}`, this)
    if (other && chance(0.6)) await this.bad("completeAmulet", { roomId: this.roomId }, other.openid, /尚未就绪/, "complete-by-non-owner")
    await this.ok("completeAmulet", { roomId: this.roomId }, owner.openid)
    if (this.room().phase !== "mission") throw new Violation("收起护身符后应当进入 mission")
    const history = this.room().game.amuletHistory
    const last = history[history.length - 1]
    if (!last || last.ownerId !== owner.id || last.targetId !== target.id || last.round !== game.round) record("amulet-history", "公开的护身符记录与实际不符", this)
    if (last && Object.prototype.hasOwnProperty.call(last, "displayedFaction")) record("amulet-history-leak", "公开记录里带了查验结果", this)
  }

  // ---------- 终局 ----------
  async finalePhase() {
    const room = this.room()
    const final = room.game.final
    if (final.stage === "discussion") {
      const nonHost = this.humans().find(player => player.openid !== "host")
      if (nonHost && chance(0.6)) await this.bad("finishDiscussion", { roomId: this.roomId, force: true }, nonHost.openid, /只有房主/, "finish-by-player")
      if (chance(0.7)) await this.bad("finishDiscussion", { roomId: this.roomId, force: false }, "host", /讨论尚未结束/, "finish-before-time")
      if (chance(0.5)) await this.bad("finalIdentify", { roomId: this.roomId, targets: [1, 2] }, pick(this.humans()).openid, /当前不能提交最后指认/, "identify-during-discussion")
      await this.ok("finishDiscussion", { roomId: this.roomId, force: true }, "host")
      return
    }
    if (final.stage === "hunterVote") return this.hunterVoteStage()
    if (final.stage === "hunterDecision") return this.hunterDecisionStage()
    if (final.stage === "hunterTargets") return this.hunterTargetsStage()
    if (final.stage === "identify") return this.identifyStage()
    throw new Violation(`未知终局阶段 ${final.stage}`)
  }

  async hunterVoteStage() {
    for (const player of shuffled(this.humans())) {
      if (oracle.faction(player) === "good" && chance(0.7)) await this.bad("hunterVote", { roomId: this.roomId, value: "fail" }, player.openid, /不能打出这张票/, "hunter-vote-good-fail")
      const value = oracle.faction(player) === "evil" && chance(0.6) ? "fail" : "success"
      this.finale.hunterVotes[player.id] = value
      await this.ok("hunterVote", { roomId: this.roomId, value }, player.openid)
      if (this.room().game.final.stage === "hunterVote" && chance(0.4)) await this.bad("hunterVote", { roomId: this.roomId, value }, player.openid, /已经投过猎杀票/, "hunter-vote-twice")
    }
    const votes = this.secret().hunterVotes
    this.players().filter(player => !player.openid).forEach(player => { this.finale.hunterVotes[player.id] = votes[String(player.id)] })
    const forced = oracle.hunterVoteForcesHunt(this.finale.hunterVotes)
    const stage = this.room().game.final.stage
    if (forced) {
      coverage.hunterVotesForced += 1
      if (stage !== "hunterTargets") throw new Violation(`两张以上失败票后应当强制猎杀，实际 ${stage}`)
      this.finale.hunt = true
    } else if (stage === "hunterTargets") throw new Violation("失败票不足两张却进入了猎杀")
  }

  async hunterDecisionStage() {
    const hunter = this.players().find(player => player.role === "hunter")
    const final = this.room().game.final
    const actor = hunter.openid ? hunter.openid : "host"
    // 盲眼杀手是测试骑士时房主有权代它操作，旁观者探针要避开房主
    const bystander = this.humans().find(player => player.id !== hunter.id && player.openid !== actor)
    if (bystander && chance(0.6)) await this.bad("hunterDecision", { roomId: this.roomId, hunt: true }, bystander.openid, /只有盲眼杀手/, "hunter-decision-by-other")
    if (final.trigger === "goodMissions") {
      if (chance(0.7)) await this.bad("hunterDecision", { roomId: this.roomId, hunt: false }, actor, /必须发动猎杀/, "hunter-silent-after-good-wins")
      this.finale.hunt = true
    } else this.finale.hunt = chance(0.6)
    await this.ok("hunterDecision", { roomId: this.roomId, hunt: this.finale.hunt }, actor)
    const stage = this.room().game.final.stage
    if (this.finale.hunt && stage !== "hunterTargets") throw new Violation(`发动猎杀后阶段 ${stage}`)
    if (!this.finale.hunt && this.room().status !== "finished" && stage !== "identify") throw new Violation(`放弃猎杀后阶段 ${stage}`)
    if (this.finale.hunt && !this.byId(hunter.id).revealed) record("hunter-not-revealed", "发动猎杀后盲眼杀手没公开", this)
  }

  async hunterTargetsStage() {
    const hunter = this.players().find(player => player.role === "hunter")
    const actor = hunter.openid ? hunter.openid : "host"
    const others = this.players().filter(player => player.id !== hunter.id)
    const good = others.filter(player => oracle.faction(player) === "good")
    const priest = good.find(player => player.role === "priest")
    const arthur = good.find(player => player.role === "arthur")
    let targets
    const roll = rng()
    if (roll < 0.35) targets = priest ? [priest.id, pick(good.filter(player => player.id !== priest.id)).id] : sample(good, 2).map(player => player.id)
    else if (roll < 0.5 && arthur) targets = [arthur.id, pick(others.filter(player => player.id !== arthur.id)).id]
    else targets = sample(others, 2).map(player => player.id)
    if (chance(0.5)) await this.bad("hunterTargets", { roomId: this.roomId, targets: [targets[0]] }, actor, /两位不同玩家/, "hunt-one-target")
    if (chance(0.4)) await this.bad("hunterTargets", { roomId: this.roomId, targets: [targets[0], targets[0]] }, actor, /两位不同玩家/, "hunt-same-target")
    const bystander = this.humans().find(player => player.id !== hunter.id && player.openid !== actor)
    if (bystander && chance(0.6)) await this.bad("hunterTargets", { roomId: this.roomId, targets }, bystander.openid, /当前不能提交猎杀目标/, "hunt-by-other")
    this.finale.hunterTargets = targets
    coverage.hunts += 1
    await this.ok("hunterTargets", { roomId: this.roomId, targets }, actor)
    const expected = oracle.hunterSuccess(this.players(), targets) ? "evil" : "good"
    if (expected === "evil") coverage.huntSuccess += 1
    if (this.room().status !== "finished") throw new Violation("猎杀后应当结束")
    if (this.room().game.winner !== expected) record("hunt-winner", `猎杀 ${targets} 判为 ${this.room().game.winner}，说明书 ${expected}`, this)
  }

  async identifyStage() {
    coverage.identifyRuns += 1
    const players = this.players()
    const evilIds = players.filter(player => oracle.faction(player) === "evil").map(player => player.id)
    const traitor = players.find(player => player.role === "traitor")
    const preFactions = players.map(player => ({ id: player.id, role: player.role }))
    if (traitor && traitor.openid) {
      const bystander = this.humans().find(player => player.id !== traitor.id)
      if (bystander && chance(0.5)) await this.bad("traitorDecision", { roomId: this.roomId, side: "good", targets: [1, 2] }, bystander.openid, /无法选择叛徒阵营/, "traitor-decision-by-other")
      const side = chance(0.5) ? "good" : "evil"
      this.finale.traitorSide = side
      if (side === "good") {
        const good = players.filter(player => oracle.faction(player) === "good")
        const targets = chance(0.5) ? sample(good, 2).map(player => player.id) : sample(players.filter(player => player.id !== traitor.id), 2).map(player => player.id)
        this.finale.traitorTargets = targets
        if (chance(0.4)) await this.bad("traitorDecision", { roomId: this.roomId, side: "good", targets: [targets[0]] }, traitor.openid, /两位不同玩家/, "traitor-one-target")
        await this.ok("traitorDecision", { roomId: this.roomId, side, targets }, traitor.openid)
        const converted = targets.every(id => oracle.faction(this.byId(id)) === "good")
        if (!!this.secret().traitorDecision.converted !== converted) record("traitor-converted-flag", "叛徒转正判定与说明书不符", this)
        if (converted) coverage.traitorConverted += 1
      } else await this.ok("traitorDecision", { roomId: this.roomId, side }, traitor.openid)
    }
    const converted = !!(this.secret().traitorDecision && this.secret().traitorDecision.converted)
    // 叛徒选「投向正义」时指的那两人就算他的最终指认（不论有没有转正成功），不再另外提交
    const submitters = shuffled(this.humans().filter(player => !(player.role === "traitor" && this.finale.traitorSide === "good")))
    for (const player of submitters) {
      if (this.room().status === "finished") break
      let targets
      const informed = oracle.faction(player) === "good" && chance(0.55)
      if (informed) targets = sample(evilIds, 2)
      else if (chance(0.3)) targets = [pick(evilIds), pick(players.filter(item => item.id !== player.id && evilIds.indexOf(item.id) < 0).map(item => item.id) || evilIds)]
      else targets = sample(players.filter(item => item.id !== player.id), 2).map(item => item.id)
      if (targets.length < 2 || targets[0] === targets[1] || targets.some(id => id === undefined)) targets = sample(players.filter(item => item.id !== player.id), 2).map(item => item.id)
      if (chance(0.3)) await this.bad("finalIdentify", { roomId: this.roomId, targets: [targets[0]] }, player.openid, /两位/, "identify-one-target")
      this.finale.submissions[player.id] = targets
      await this.ok("finalIdentify", { roomId: this.roomId, targets }, player.openid)
      if (this.room().status !== "finished" && chance(0.4)) await this.bad("finalIdentify", { roomId: this.roomId, targets }, player.openid, /已经提交过/, "identify-twice")
    }
    if (this.room().status !== "finished") throw new Violation("全员指认后仍未结束")
    // bot 的指认由服务端代填，从 secret 里取回来喂判官
    const submissions = {}
    Object.keys(this.secret().finalSubmissions).forEach(key => { submissions[Number(key)] = this.secret().finalSubmissions[key].targets })
    const revealedIds = new Set(players.filter(player => player.revealed).map(player => player.id))
    const byHands = oracle.identifySuccess(preFactions, submissions, { revealedIds }) ? "good" : "evil"
    const leadersAllEvil = oracle.allLeadersEvil(preFactions, this.room().game.missions)
    let expected = byHands
    if (leadersAllEvil) { coverage.allLeadersEvil += 1; expected = "good" }
    if (expected === "good") coverage.identifyGood += 1
    if ((this.room().game.final.corrections || []).length) coverage.correctionsUsed += 1
    if (this.room().game.winner !== expected) {
      const key = leadersAllEvil && byHands === "evil" ? "identify-winner:all-leaders-evil" : "identify-winner:hands"
      record(key, `最终指认判为 ${this.room().game.winner}，说明书 ${expected}（按手势 ${byHands}，全部队长邪恶=${leadersAllEvil}，叛徒转正=${converted}，修正=${JSON.stringify(this.room().game.final.corrections)}，指认=${JSON.stringify(submissions)}，队长=${this.room().game.missions.map(item => item.leaderId)}）`, this)
    }
  }

  async finished() {
    const room = this.room()
    coverage.finished += 1
    coverage.winners[room.game.winner] = (coverage.winners[room.game.winner] || 0) + 1
    if (room.phase !== "result" || !room.game.winner) throw new Violation("结束后 phase/winner 异常")
    if (room.game.goodWins >= 3 && !room.game.final) coverage.goodByMissions += 1
    for (const player of sample(this.humans(), 2)) {
      const result = await call("getResult", { roomId: this.roomId }, player.openid)
      if (result.players.length !== room.playerCount) record("result-players", "结果页人数不对", this)
      const converted = !!(this.secret().traitorDecision && this.secret().traitorDecision.converted)
      result.players.forEach(item => {
        const truth = this.byId(item.id)
        const faction = converted && truth.role === "traitor" ? "good" : oracle.faction(truth)   // §九 叛徒转正后加入正义方
        if (item.role !== truth.role || item.faction !== faction) record("result-roles", `结果页 ${item.id} 号 ${item.role}/${item.faction}，真实 ${truth.role}/${faction}`, this)
      })
    }
    await this.bad("submitVote", { roomId: this.roomId, value: "success" }, "host", /不是任务投票阶段|不在本局/, "vote-after-finish")
  }

  // ---------- 审计：每一步成功操作之后 ----------
  async audit(afterAction) {
    this.auditCount += 1
    coverage.audits += 1
    const room = this.room()
    const secret = this.secret()
    this.checkPublic(room, secret)
    if (!room.game || !room.game.players || room.status === "finished") return
    for (const player of this.humans()) {
      const view = await call("getState", { roomId: this.roomId }, player.openid)
      this.checkPrivate(view, player, room, secret)
    }
    if (this.auditCount % CLIENT_EVERY === 0) {
      const player = pick(this.humans())
      const view = await call("getState", { roomId: this.roomId }, player.openid)
      this.checkClient(view, player, room, secret)
    }
  }

  checkPublic(room, secret) {
    const game = room.game
    if (!game || !game.players) return
    const publicText = JSON.stringify({ game: room.game, seats: room.seats })
    if (room.status !== "finished") {
      secret.players.forEach(player => {
        if (!player.revealed && publicText.indexOf(player.roleName) >= 0) record("public-rolename-leak", `公开文档里出现了未公开玩家的角色名 ${player.roleName}`, this)
      })
    }
    if (/"(role|faction|priestClaim|displayedFaction|trueFaction|hunterVotes|finalSubmissions|traitorDecision)"/.test(publicText)) record("public-secret-field", "公开文档里出现了私密字段", this)
    game.players.forEach(pub => {
      const truth = secret.players.find(player => player.id === pub.id)
      ;["hasLed", "hadAmulet", "fadedAmulet", "revealed"].forEach(key => {
        if (!!pub[key] !== !!truth[key]) record(`public-flag:${key}`, `${pub.id} 号公开的 ${key}=${pub[key]}，真实 ${truth[key]}`, this)
      })
      if (pub.revealedRoleName !== (truth.revealed ? truth.roleName : "")) record("revealedRoleName", `${pub.id} 号 revealedRoleName 不对`, this)
    })
    // 谁可以处于公开状态：加拉哈德发动、揭露者三败后、吹嘘者第五轮队长、盲眼杀手发动猎杀
    secret.players.forEach(player => {
      if (!player.revealed) return
      const allowed = (player.role === "galahad" && this.galahadClaimed) ||
        (player.role === "revealer" && game.evilWins >= 3) ||
        (player.role === "boaster" && game.round === 5 && game.leaderId === player.id) ||
        (player.role === "hunter" && game.final && game.final.hunterRevealed)
      if (!allowed) record(`unexpected-reveal:${player.role}`, `${player.id} 号 ${player.roleName} 不该处于公开状态`, this)
    })
    const goodWins = game.missions.filter(item => item.winner === "good").length
    const evilWins = game.missions.filter(item => item.winner === "evil").length
    if (game.goodWins !== goodWins || game.evilWins !== evilWins) record("win-counters", `比分 ${game.goodWins}:${game.evilWins}，记录 ${goodWins}:${evilWins}`, this)
    game.missions.forEach(mission => {
      const logged = this.missionLog.find(item => item.round === mission.round)
      if (!logged) return
      if (mission.leaderId !== logged.leaderId || mission.magicTargetId !== logged.magicTargetId || mission.team.join() !== logged.team.join()) record("mission-record", `第 ${mission.round} 轮记录与实际组队不符`, this)
    })
    this.syncInspections()
    if (game.amuletHistory.length !== this.inspections.length) record("amulet-history-count", `公开护身符记录 ${game.amuletHistory.length} 条，私密流水 ${this.inspections.length}`, this)
    game.amuletHistory.forEach((item, index) => {
      const truth = this.inspections[index]
      if (!truth || truth.ownerId !== item.ownerId || truth.targetId !== item.targetId || truth.round !== item.round) record("amulet-history-mismatch", `公开护身符记录第 ${index + 1} 条与私密流水不符`, this)
    })
    const leader = secret.players.find(player => player.id === game.leaderId)
    if (leader && !leader.hasLed) record("leader-hasLed", "现任队长没有 hasLed", this)
    // 查验一开始就公开目标（线下看得见护身符递给了谁），且必须和私密记录一致
    if (game.amulet && (game.amulet.status === "claim" || game.amulet.status === "result")) {
      const current = secret.currentInspection || {}
      if (game.amulet.targetId !== current.targetId) record("amulet-target-public", `公开目标 ${game.amulet.targetId}，实际 ${current.targetId}`, this)
    }
    if (room.status === "playing" && ["reveal", "mission", "vote", "missionResult", "amulet", "finale"].indexOf(room.phase) < 0) record("phase-unknown", room.phase, this)
  }

  checkPrivate(view, me, room, secret) {
    const pv = view.private
    if (!pv) { record("private-missing", `${me.id} 号拿不到私密视图`, this); return }
    if (pv.id !== me.id || pv.role !== me.role || pv.faction !== oracle.faction(me) || pv.roleName !== me.roleName) record("private-identity", `${me.id} 号看到的身份不是自己的`, this)
    if (view.isHost !== (me.openid === "host")) record("isHost", `${me.id} 号 isHost 不对`, this)
    // 秘密信息里提到的座位号，必须恰好是说明书允许他知道的那些
    const mentioned = new Set()
    pv.nightInfo.forEach(line => { for (const match of line.matchAll(/(\d+)号/g)) mentioned.add(Number(match[1])) })
    const expected = new Set(oracle.knownSeats(me, secret.players))
    if (!setEqual(mentioned, expected)) {
      record(`knowledge:${me.role}`, `${me.roleName}(${me.id}号) 秘密信息提到 [${Array.from(mentioned)}]，说明书应为 [${Array.from(expected)}]；全桌 ${this.roleSummary()}；原文 ${JSON.stringify(pv.nightInfo)}`, this)
    }
    // 「全队长邪恶」提醒用的 knownEvilIds 必须和秘密信息同源：恰好是他认识的那些邪恶方
    const knownEvil = new Set(oracle.knownSeats(me, secret.players).filter(id => oracle.faction(secret.players.find(item => item.id === id)) === "evil"))
    if (!setEqual(new Set(pv.knownEvilIds || []), knownEvil)) record(`knownEvilIds:${me.role}`, `${me.roleName} knownEvilIds=${pv.knownEvilIds}，应为 ${Array.from(knownEvil)}`, this)
    if (me.role === "priest") {
      const claim = secret.priestClaim
      if (claim) {
        const wanted = `第一位领袖显示为${claim === "good" ? "正义方" : "邪恶方"}`
        if (!pv.nightInfo.some(line => line.indexOf(wanted) >= 0)) record("priest-claim-line", `教士没读到「${wanted}」：${JSON.stringify(pv.nightInfo)}`, this)
      } else if (pv.nightInfo.some(line => /正在选择/.test(line))) {
        record("priest-deceiver-hint-leak", `队长还没选展示阵营时，教士的视图就写着「正在选择」——这句只在队长是骗徒时出现，等于提前告诉教士队长是骗徒：${JSON.stringify(pv.nightInfo)}`, this)
      }
    }
    // 首任队长的展示选项
    const isFirstLeader = me.id === room.game.firstLeaderId
    if (!!pv.needsLeaderClaim !== isFirstLeader) record("needsLeaderClaim", `${me.id} 号 needsLeaderClaim=${pv.needsLeaderClaim}`, this)
    const claimOptions = isFirstLeader ? oracle.claimOptions(me) : []
    if (!setEqual(new Set(pv.leaderClaimOptions), new Set(claimOptions))) record(`leaderClaimOptions:${me.role}`, `${me.role} 得到 ${pv.leaderClaimOptions}，应为 ${claimOptions}`, this)
    if (isFirstLeader && pv.leaderClaim && pv.leaderClaim !== secret.priestClaim) record("leaderClaim-echo", "队长回显的展示阵营不对", this)
    if (!isFirstLeader && pv.leaderClaim) record("leaderClaim-leak", "非队长看到了展示阵营", this)
    // 出牌选项：只有在队伍里且在投票阶段才有
    // 本轮队伍在交接前一直保留，所以结算阶段队员仍带着自己的出牌选项——是本人信息，不算泄露
    const inTeam = room.game.current.team.indexOf(me.id) >= 0
    const votes = inTeam ? oracle.legalVotes(me, room.game.round, room.game.leaderId === me.id, room.game.current.magicTargetId === me.id) : []
    if (!setEqual(new Set(pv.voteOptions), new Set(votes))) record(`voteOptions-view:${me.role}`, `${me.role} voteOptions=${pv.voteOptions}，应为 ${votes}（phase=${room.phase}）`, this)
    if (!setEqual(new Set(pv.inspectionOptions), new Set(oracle.claimOptions(me)))) record(`inspectionOptions:${me.role}`, `${me.role} inspectionOptions=${pv.inspectionOptions}`, this)
    // 查验记录：只有自己查的，守卫多看全局第一次
    pv.inspectionHistory.forEach(item => {
      const first = this.inspections[0]
      const own = item.ownerId === me.id
      const guardFirst = me.role === "guard" && first && first.ownerId === item.ownerId && first.targetId === item.targetId
      if (!own && !guardFirst) record("inspection-history-leak", `${me.roleName} 看到了别人的查验记录 ${JSON.stringify(item)}`, this)
      const truth = this.inspections.find(record => record.ownerId === item.ownerId && record.targetId === item.targetId)
      if (truth && truth.displayed !== item.displayedFaction) record("inspection-history-value", `查验记录显示 ${item.displayedFaction}，实际展示 ${truth.displayed}`, this)
      if (truth) {
        const target = secret.players.find(player => player.id === truth.targetId)
        const legal = oracle.displayedFaction(target, truth.displayed)
        if (legal !== truth.displayed) record("displayed-faction-rule", `${target.roleName} 展示了 ${truth.displayed}`, this)
      }
    })
    if (pv.inspectionResult) {
      const amulet = room.game.amulet
      const allowed = amulet && amulet.status === "result" && (amulet.ownerId === me.id || (me.role === "guard" && amulet.firstOfGame))
      if (!allowed) record("inspection-result-leak", `${me.roleName} 不该看到查验结果`, this)
    }
    pv.voteHistory.forEach(item => {
      if ((this.votes[item.round] || {})[me.id] !== item.value) record("vote-history", `${me.id} 号回看的任务牌与实际不符`, this)
    })
    if (pv.traitorDecision && me.role !== "traitor") record("traitor-decision-leak", "非叛徒看到了叛徒决定", this)
    if (pv.finalSubmission && !this.finale.submissions[me.id] && me.role !== "traitor") record("final-submission-leak", "看到了不是自己的指认", this)
    if (typeof pv.canClaimGalahad !== "boolean") record("galahad-flag-type", "canClaimGalahad 不是布尔", this)
    // 服务端这个标志不看阶段（结算屏之外客户端不放按钮，claimGalahad 本身也会拒），按同样口径比
    const galahadNow = oracle.galahadEligible(me, room.game)
    if (pv.canClaimGalahad !== galahadNow) record("galahad-flag-view", `${me.role} canClaimGalahad=${pv.canClaimGalahad}，应为 ${galahadNow}（phase=${room.phase}）`, this)
    // 视图里的公开部分必须和房间文档一致
    if (JSON.stringify(view.room.game) !== JSON.stringify(room.game)) record("view-room-mismatch", "视图里的公开对局数据与房间文档不一致", this)
    if (me.openid !== "host" && (pv.botVotedIds || pv.canControlBotHunter)) record("host-only-fields", "非房主拿到了房主专用字段", this)
  }

  checkClient(view, me, room, secret) {
    coverage.clientChecks += 1
    const page = playContext(this.roomId)
    try { page.applyState(view) } catch (error) { record("client-applyState-throws", `${room.phase}: ${error.message}`, this); return }
    const data = page.data
    const game = room.game
    if (room.status === "finished") {
      if (!/pages\/result\/result/.test(page.leftTo || "")) record("client-finished-redirect", "结束后没有跳结果页", this)
      return
    }
    const bad = (key, detail) => record(`client:${key}`, `${room.phase} ${me.role}: ${detail}`, this)
    if (data.phase !== room.phase) bad("phase", `data.phase=${data.phase}`)
    if (data.isLeader !== (me.id === game.leaderId)) bad("isLeader", `${data.isLeader}`)
    if (data.tableVisible !== false) bad("tableVisible", "选人面板自动开了")
    if (data.myInTeam !== (game.current.team.indexOf(me.id) >= 0)) bad("myInTeam", `${data.myInTeam}`)
    if (data.myRole && data.myRole.name !== me.roleName) bad("myRole", `${data.myRole.name}`)
    const leader = secret.players.find(player => player.id === game.leaderId)
    const expectControl = me.id === game.leaderId || (me.openid === "host" && !!leader && !leader.openid && !!room.devMode && !room.stepMode)
    if (data.canControlLeader !== expectControl) bad("canControlLeader", `${data.canControlLeader}，应为 ${expectControl}`)
    const votes = new Set(view.private.voteOptions)
    if (data.canVoteSuccess !== votes.has("success") || data.canVoteFail !== votes.has("fail")) bad("canVote", `${data.canVoteSuccess}/${data.canVoteFail} vs ${Array.from(votes)}`)
    if (data.isAmuletOwner !== !!(game.amulet && game.amulet.ownerId === me.id)) bad("isAmuletOwner", `${data.isAmuletOwner}`)
    if (data.isInspectionTarget !== !!view.private.isInspectionTarget) bad("isInspectionTarget", `${data.isInspectionTarget}`)
    const resultName = view.private.inspectionResult ? (view.private.inspectionResult === "good" ? "正义方" : "邪恶方") : ""
    if (data.inspectionResultName !== resultName) bad("inspectionResultName", `${data.inspectionResultName}`)
    if (data.canClaimGalahad !== !!view.private.canClaimGalahad) bad("canClaimGalahad", `${data.canClaimGalahad}`)
    if (data.historyMissions.length !== game.missions.length) bad("historyMissions", `${data.historyMissions.length} vs ${game.missions.length}`)
    data.historyMissions.forEach((item, index) => {
      const mission = game.missions[index]
      if (item.leader.indexOf(`${mission.leaderId}号`) !== 0) bad("history-leader", `${item.leader}`)
      const mine = (this.votes[mission.round] || {})[me.id]
      if ((mine ? (mine === "success" ? "成功" : "失败") : "") !== item.myVote) bad("history-myVote", `${item.myVote} vs ${mine}`)
      if (item.result !== (mission.winner === "good" ? "远征成功" : "远征失败")) bad("history-result", item.result)
    })
    if (data.historyAmulets.length !== game.amuletHistory.length) bad("historyAmulets", `${data.historyAmulets.length}`)
    if (data.myInspections.length !== view.private.inspectionHistory.length) bad("myInspections", `${data.myInspections.length}`)
    if (data.myVotes.length !== view.private.voteHistory.length) bad("myVotes", `${data.myVotes.length}`)
    if (data.canOperateHunter !== (me.role === "hunter" || !!view.private.canControlBotHunter)) bad("canOperateHunter", `${data.canOperateHunter}`)
    if (data.identityUnlocked !== (room.phase !== "reveal")) bad("identityUnlocked", `${data.identityUnlocked}`)
    const hint = data.waitingHint
    if (room.phase === "mission" && !(hint && hint.text.indexOf(`${game.leaderId}号`) >= 0)) bad("hint-mission", JSON.stringify(hint))
    if (room.phase === "vote") {
      const pending = game.current.team.filter(id => game.current.votedIds.indexOf(id) < 0)
      if (pending.length && !(hint && hint.progress === `${game.current.voteCount}/${game.current.team.length}`)) bad("hint-vote", JSON.stringify(hint))
    }
    if (room.phase === "missionResult") {
      const who = game.galahadLeaderId || game.leaderId
      if (!(hint && hint.text.indexOf(`${who}号`) >= 0 && /交接皇冠/.test(hint.text) && !/^等待/.test(hint.text))) bad("hint-result", JSON.stringify(hint))
      if (data.needsAmulet !== oracle.amuletAfterRound(game.playerCount, game.round)) bad("needsAmulet", `${data.needsAmulet}`)
    }
    if (room.phase === "amulet" && game.amulet.status === "select" && !(hint && hint.text.indexOf(`${game.amulet.ownerId}号`) >= 0)) bad("hint-amulet", JSON.stringify(hint))
    if (room.phase === "amulet" && game.amulet.status === "claim") {
      if (!(hint && hint.text.indexOf(`${game.amulet.targetId}号`) >= 0)) bad("hint-amulet-claim", JSON.stringify(hint))
      const pair = data.inspectionPairText || ""
      if (pair.indexOf(`${game.amulet.ownerId}号`) < 0 || pair.indexOf(`${game.amulet.targetId}号`) < 0) bad("inspectionPairText-claim", pair)
    }
    if (room.phase === "reveal") {
      const identity = game.identity
      let mode = "prepare"
      if (identity.claimAt && !identity.revealAt) mode = view.private.needsLeaderClaim ? "leaderClaim" : "waitLeaderClaim"
      else if (identity.revealAt) mode = "reading"    // 没翻牌就一直是 reading
      if (data.identityMode !== mode) bad("identityMode", `${data.identityMode}，应为 ${mode}`)
      if (data.canLeadClaimGood !== view.private.leaderClaimOptions.indexOf("good") >= 0) bad("canLeadClaimGood", `${data.canLeadClaimGood}`)
    }
    if (room.phase === "finale") {
      const stage = game.final.stage
      if (stage === "identify") {
        const expectMode = me.role === "traitor" && !view.private.traitorDecision ? "" : (view.private.finalSubmitted ? "" : "identify")
        if (data.finalSelectionMode !== expectMode) bad("finalSelectionMode", `${data.finalSelectionMode}，应为 ${expectMode}`)
      }
      if (stage === "hunterTargets" && me.role === "hunter" && data.finalSelectionMode !== "hunter") bad("finalSelectionMode-hunter", data.finalSelectionMode)
      if (data.finalStage !== stage) bad("finalStage", data.finalStage)
    }
  }
}

// ---------- 跑批 ----------
async function main() {
  const startedAt = Date.now()
  for (let index = 0; index < GAMES; index += 1) {
    const sim = new Sim(index)
    coverage.games += 1
    try {
      await sim.run()
      if (VERBOSE) console.log(`#${index} ${sim.config.playerCount}人${sim.config.withBots ? "(含bot)" : ""} ${sim.roleSummary()} → ${sim.room().game.winner} 步数 ${sim.stepCount}`)
    } catch (error) {
      record(error instanceof Violation ? `flow:${error.message.slice(0, 40)}` : `crash:${error.message.slice(0, 60)}`, `${error.stack}`, sim)
    }
  }
  Math.random = nativeRandom
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`随机对局机：${coverage.games} 局（seed ${SEED}），${coverage.finished} 局打完，${seconds}s`)
  console.log(`  人数分布 ${JSON.stringify(coverage.byCount)}；未知角色 ${coverage.unknownRoles} 局；猎杀投票变体 ${coverage.hunterVote} 局；含测试骑士 ${coverage.withBots} 局`)
  console.log(`  角色出场 ${Object.keys(coverage.rolesSeen).length}/27 种：${Object.keys(coverage.rolesSeen).map(role => `${role}×${coverage.rolesSeen[role]}`).join(" ")}`)
  console.log(`  审计 ${coverage.audits} 次，非法操作探针 ${coverage.probes} 次，客户端派生检查 ${coverage.clientChecks} 次`)
  console.log(`  护身符查验 ${coverage.inspections} 次（骗徒谎报 ${coverage.deceiverInspectLies}）；首任队长骗徒谎报 ${coverage.deceiverLies} 次；加拉哈德发动 ${coverage.galahadClaims} 次`)
  console.log(`  猎杀 ${coverage.hunts} 次（得手 ${coverage.huntSuccess}，投票强制 ${coverage.hunterVotesForced}）；最终指认 ${coverage.identifyRuns} 次（正义 ${coverage.identifyGood}，用到修正 ${coverage.correctionsUsed}，叛徒转正 ${coverage.traitorConverted}，全队长邪恶 ${coverage.allLeadersEvil}）`)
  console.log(`  胜负 正义 ${coverage.winners.good || 0} / 邪恶 ${coverage.winners.evil || 0}，其中三胜直接结束 ${coverage.goodByMissions}`)
  if (!violations.size) {
    console.log("game simulation tests passed")
    return
  }
  console.log(`\n发现 ${violations.size} 类问题：`)
  for (const [key, entry] of violations) {
    const sample = entry.sample
    console.log(`\n[${key}] ×${entry.count}  局 #${sample.game}（${sample.playerCount} 人，seed ${sample.seed}）`)
    console.log(`  ${sample.detail}`)
    console.log(`  桌面：${sample.roles}`)
    console.log(`  最近操作：\n    ${sample.log.join("\n    ")}`)
  }
  process.exitCode = 1
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
