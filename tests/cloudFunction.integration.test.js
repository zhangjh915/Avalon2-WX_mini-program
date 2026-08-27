const assert = require("assert")
const Module = require("module")
const gameUtil = require("../miniprogram/utils/game")
const core = require("../cloudfunctions/avalonGame/gameCore")

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function createCloudMock() {
  const collections = new Map()
  let openid = "host"
  let nextId = 1
  const setMarker = Symbol("set")
  const command = { set: value => ({ [setMarker]: true, value }) }

  function records(name) {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)
  }

  function isSet(value) {
    return !!(value && value[setMarker])
  }

  function applyPath(target, path, value) {
    const parts = path.split(".")
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index]
      if (cursor[part] === undefined) cursor[part] = {}
      if (cursor[part] === null || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
        throw new Error(`Cannot create field '${parts[index + 1]}' in element {${part}: ${cursor[part]}}`)
      }
      cursor = cursor[part]
    }
    cursor[parts[parts.length - 1]] = clone(value)
  }

  function flattenUpdate(value, prefix, output) {
    if (isSet(value)) {
      output.push([prefix, value.value])
      return
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value)
      if (keys.length) {
        keys.forEach(key => flattenUpdate(value[key], prefix ? `${prefix}.${key}` : key, output))
        return
      }
    }
    output.push([prefix, value])
  }

  function docApi(name, id) {
    return {
      async get() {
        const value = records(name).get(String(id))
        if (!value) throw new Error(`document ${name}/${id} not found`)
        return { data: clone(value) }
      },
      async set({ data }) {
        const normalized = {}
        Object.keys(data).forEach(key => {
          normalized[key] = isSet(data[key]) ? clone(data[key].value) : clone(data[key])
        })
        normalized._id = normalized._id || String(id)
        records(name).set(String(id), normalized)
        return { stats: { created: 1 } }
      },
      async update({ data }) {
        const current = records(name).get(String(id))
        if (!current) throw new Error(`document ${name}/${id} not found`)
        const updates = []
        Object.keys(data).forEach(key => flattenUpdate(data[key], key, updates))
        updates.forEach(([path, value]) => applyPath(current, path, value))
        records(name).set(String(id), current)
        return { stats: { updated: 1 } }
      }
    }
  }

  function collectionApi(name) {
    return {
      doc(id) { return docApi(name, id) },
      async add({ data }) {
        const id = `room-${nextId++}`
        records(name).set(id, { ...clone(data), _id: id })
        return { _id: id }
      },
      where(query) {
        return {
          limit() { return this },
          async get() {
            const data = Array.from(records(name).values()).filter(item => Object.keys(query).every(key => item[key] === query[key]))
            return { data: clone(data) }
          }
        }
      }
    }
  }

  const database = {
    command,
    collection: collectionApi,
    async runTransaction(handler) {
      return handler({ collection: collectionApi })
    }
  }

  return {
    sdk: {
      DYNAMIC_CURRENT_ENV: "test",
      init() {},
      database: () => database,
      getWXContext: () => ({ OPENID: openid }),
      // 服务端签名接口：管理员身份、不受存储权限限制，这里给个可辨认的假链接
      async getTempFileURL({ fileList }) {
        return { fileList: (fileList || []).map(id => ({ fileID: id, tempFileURL: "https://signed.example/" + id.split("/").pop() })) }
      }
    },
    setOpenid(value) { openid = value },
    get(name, id) { return records(name).get(String(id)) },
    reset() {
      collections.clear()
      openid = "host"
      nextId = 1
    }
  }
}

const cloudMock = createCloudMock()
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "wx-server-sdk") return cloudMock.sdk
  return originalLoad.call(this, request, parent, isMain)
}
const cloudFunction = require("../cloudfunctions/avalonGame/index")
Module._load = originalLoad

async function action(name, payload, openid) {
  cloudMock.setOpenid(openid || "host")
  return cloudFunction.main({ action: name, ...(payload || {}) })
}

async function expectFailure(promise, message) {
  let error = null
  try { await promise } catch (caught) { error = caught }
  assert.ok(error, `expected failure: ${message}`)
  assert.match(error.message, message)
}

function room(roomId) {
  return cloudMock.get("avalon_rooms", roomId)
}

function secret(roomId) {
  return cloudMock.get("avalon_game_secrets", roomId)
}

async function createStartedRoom(playerCount, roleCounts, options) {
  const created = await action("createRoom", {
    playerCount,
    roleCounts: roleCounts || gameUtil.buildDefaultRoleCounts(playerCount, false),
    unknownRoles: !!(options && options.unknownRoles),
    hunterVoteVariant: !!(options && options.hunterVoteVariant),
    tableType: options && options.tableType || "round",
    devMode: true
  })
  await action("takeSeat", { roomId: created.roomId, seatNo: 1, name: "房主" })
  await action("fillBots", { roomId: created.roomId })
  const originalRandom = Math.random
  Math.random = () => 0.5
  try { await action("startGame", { roomId: created.roomId }) } finally { Math.random = originalRandom }
  return created.roomId
}

// options.firstLeaderSeatNo：指定首任队长（不传 = 随机，服务端默认行为）
// options.realRandom：不要钉住 Math.random。默认钉住是为了让绝大多数用例可复现；
//   只有专门验「默认确实是随机的」那条才需要放开。
// 首任队长**都**要提交一次「对外展示的阵营」，不只是骗徒——
// 只有骗徒需要点的话，「谁在点手机」本身就泄露了骗徒身份。
// 非骗徒只有一个合法选项，这里按服务端给的选项提交。
async function submitLeaderClaim(roomId) {
  const game = room(roomId).game
  if (!game || secret(roomId).priestClaim) return
  const leader = core.getPlayer(secret(roomId), game.firstLeaderId)
  if (!leader || leader.bot) return
  // 揭示有 3 秒延迟（revealAt = now + 3000），测试里直接把它推到过去，
  // 不然刚 startIdentity 就提交会被「身份尚未揭示」挡下
  if (game.identity && game.identity.revealAt > Date.now()) game.identity.revealAt = Date.now() - 1
  const who = leader.id === 1 ? "host" : `user-${leader.id}`
  const claim = leader.role === "deceiver" ? "good" : core.displayedFaction(leader)
  await action("identityClaim", { roomId, claim }, who)
}

async function createHumanRoom(playerCount, roleCounts, options) {
  const opts = options || {}
  const created = await action("createRoom", {
    playerCount,
    roleCounts: roleCounts || gameUtil.buildDefaultRoleCounts(playerCount, false),
    unknownRoles: false,
    hunterVoteVariant: false,
    tableType: "round"
  })
  for (let seatNo = 1; seatNo <= playerCount; seatNo += 1) {
    await action("takeSeat", { roomId: created.roomId, seatNo, name: `玩家${seatNo}` }, seatNo === 1 ? "host" : `user-${seatNo}`)
  }
  const payload = { roomId: created.roomId }
  if (opts.firstLeaderSeatNo) payload.firstLeaderSeatNo = opts.firstLeaderSeatNo
  const originalRandom = Math.random
  if (!opts.realRandom) Math.random = () => 0
  try { await action("startGame", payload, "host") } finally { Math.random = originalRandom }
  return created.roomId
}

async function finishIdentity(roomId) {
  const host = secret(roomId).players.find(player => player.openid === "host")
  await action("identityReady", { roomId })
  await action("startIdentity", { roomId })
  await submitLeaderClaim(roomId)
  room(roomId).game.identity.closeAt = Date.now() - 1
  await action("identityRemembered", { roomId })
  await action("enterNight", { roomId })
  await action("enterMission", { roomId })
  assert.strictEqual(room(roomId).phase, "mission")
}

function chooseTeam(roomId, winner) {
  const state = room(roomId)
  const privateState = secret(roomId)
  const size = state.game.missionPreset.sizes[state.game.round - 1]
  const threshold = state.game.missionPreset.protectedRounds.includes(state.game.round) ? 2 : 1
  const players = privateState.players
  const combinations = (items, count, start = 0, chosen = [], result = []) => {
    if (chosen.length === count) result.push(chosen.slice())
    else for (let index = start; index <= items.length - (count - chosen.length); index += 1) {
      chosen.push(items[index])
      combinations(items, count, index + 1, chosen, result)
      chosen.pop()
    }
    return result
  }
  for (const team of combinations(players, size)) {
    for (const magicCandidate of team) {
      const previousTeam = state.game.current.team
      const previousTarget = state.game.current.magicTargetId
      state.game.current.team = team.map(player => player.id)
      state.game.current.magicTargetId = magicCandidate.id
      const options = team.map(player => core.legalVoteOptions(state.game, player))
      state.game.current.team = previousTeam
      state.game.current.magicTargetId = previousTarget
      const works = winner === "good"
        ? options.every(values => values.includes("success"))
        : options.filter(values => values.includes("fail")).length >= threshold
      if (works) return { team: team.map(player => player.id), magicTargetId: magicCandidate.id, threshold }
    }
  }
  assert.fail(`${state.playerCount}人第${state.game.round}轮找不到可产生${winner === "good" ? "成功" : "失败"}结果的合法车队：${players.map(player => player.role).join("/")}`)
}

async function playMission(roomId, winner) {
  const selection = chooseTeam(roomId, winner)
  await action("startVote", { roomId, team: selection.team, magicTargetId: selection.magicTargetId })
  const game = room(roomId).game
  const privateState = secret(roomId)
  const teamPlayers = selection.team.map(id => core.getPlayer(privateState, id))
  const options = new Map(teamPlayers.map(player => [player.id, core.legalVoteOptions(game, player)]))
  const mandatoryFailers = winner === "evil" ? teamPlayers.filter(player => !options.get(player.id).includes("success")) : []
  const optionalFailers = winner === "evil"
    ? teamPlayers.filter(player => options.get(player.id).includes("fail") && !mandatoryFailers.includes(player))
    : []
  const failers = mandatoryFailers.concat(optionalFailers.slice(0, Math.max(0, selection.threshold - mandatoryFailers.length))).map(player => player.id)
  if (winner === "evil") assert.ok(failers.length >= selection.threshold)
  for (const player of teamPlayers) {
    const value = failers.includes(player.id) ? "fail" : "success"
    if (player.bot) await action("submitBotVote", { roomId, playerId: player.id, value })
    else await action("submitVote", { roomId, value }, player.openid)
  }
  const lastMission = room(roomId).game.missions.slice(-1)[0]
  assert.strictEqual(lastMission.winner, winner)
}

function handoffTargets(roomId) {
  const state = room(roomId)
  const privateState = secret(roomId)
  const eligible = privateState.players.filter(player => !player.hasLed && !player.hadAmulet)
  assert.ok(eligible.length)
  const nextLeader = eligible[0]
  const needsAmulet = core.needsAmulet(state.playerCount, state.game.round)
  const amuletOwner = needsAmulet ? eligible.find(player => player.id !== nextLeader.id) : null
  if (needsAmulet) assert.ok(amuletOwner)
  return { nextLeaderId: nextLeader.id, amuletOwnerId: amuletOwner && amuletOwner.id }
}

async function playFiveRoundGame(playerCount) {
  cloudMock.reset()
  const roomId = await createStartedRoom(playerCount)
  await finishIdentity(roomId)
  const winners = ["evil", "good", "evil", "good", "evil"]
  for (let index = 0; index < winners.length; index += 1) {
    await playMission(roomId, winners[index])
    if (index < winners.length - 1) {
      const targets = handoffTargets(roomId)
      await action("handoff", { roomId, ...targets })
      assert.strictEqual(room(roomId).game.round, index + 2)
      assert.strictEqual(room(roomId).phase, "mission")
    }
  }
  assert.strictEqual(room(roomId).phase, "finale")
  await action("finishDiscussion", { roomId, force: true })
  if (room(roomId).game.final.stage === "hunterDecision") {
    await action("hunterDecision", { roomId, hunt: false })
  }
  if (room(roomId).game.final.stage === "identify") {
    const targets = secret(roomId).players.filter(player => player.openid !== "host").slice(0, 2).map(player => player.id)
    await action("finalIdentify", { roomId, targets })
  }
  assert.strictEqual(room(roomId).status, "finished")
  assert.strictEqual(room(roomId).game.winner, "evil")
  const result = await action("getResult", { roomId })
  assert.strictEqual(result.players.length, playerCount)
}

async function testHumanAmuletFlow() {
  cloudMock.reset()
  const roomId = await createStartedRoom(8)
  await finishIdentity(roomId)
  await playMission(roomId, "good")
  await action("handoff", { roomId, ...handoffTargets(roomId) })
  await playMission(roomId, "evil")
  const privateState = secret(roomId)
  const host = privateState.players.find(player => player.openid === "host")
  host.hasLed = false
  const nextLeader = privateState.players.find(player => player.bot && !player.hasLed && !player.hadAmulet)
  await action("handoff", { roomId, nextLeaderId: nextLeader.id, amuletOwnerId: host.id })
  assert.strictEqual(room(roomId).phase, "amulet")
  const target = secret(roomId).players.find(player => player.bot && !player.hadAmulet && !player.fadedAmulet)
  await action("selectAmuletTarget", { roomId, targetId: target.id })
  assert.strictEqual(room(roomId).game.amulet.status, "result")
  await action("completeAmulet", { roomId })
  assert.strictEqual(room(roomId).phase, "mission")
}

async function testInvalidClicks() {
  cloudMock.reset()
  const roomId = await createStartedRoom(5)
  await expectFailure(action("startGame", { roomId }), /游戏已经开始/)
  await expectFailure(action("enterMission", { roomId }), /当前不能开始远征/)
  await finishIdentity(roomId)
  const selection = chooseTeam(roomId, "good")
  const nonTeamPlayer = secret(roomId).players.find(player => !selection.team.includes(player.id))
  await expectFailure(action("startVote", { roomId, team: selection.team.slice(1), magicTargetId: selection.magicTargetId }), /本轮需要/)
  await expectFailure(action("startVote", { roomId, team: selection.team, magicTargetId: nonTeamPlayer.id }), /只能给同行骑士/)
  await action("startVote", { roomId, team: selection.team, magicTargetId: selection.magicTargetId })
  const invalidVote = nonTeamPlayer.bot
    ? action("submitBotVote", { roomId, playerId: nonTeamPlayer.id, value: "success" })
    : action("submitVote", { roomId, value: "success" }, nonTeamPlayer.openid)
  await expectFailure(invalidVote, /不在本轮任务队伍/)
}

async function testUnknownRoles() {
  cloudMock.reset()
  const counts = gameUtil.buildDefaultRoleCounts(8, true)
  const roomId = await createStartedRoom(8, counts, { unknownRoles: true })
  assert.strictEqual(secret(roomId).players.length, 8)
  assert.strictEqual(secret(roomId).removedRoles.length, 4)
}

async function testFirstLeaderDeceiverClaim() {
  cloudMock.reset()
  const counts = gameUtil.countRoles(["loyal", "priest", "squire", "morgan", "hunter", "deceiver"])
  const roomId = await createHumanRoom(6, counts)
  const privateState = secret(roomId)
  const firstLeader = privateState.players.find(player => player.id === room(roomId).game.firstLeaderId)
  firstLeader.role = "deceiver"
  firstLeader.roleName = "骗徒"
  firstLeader.faction = "evil"
  secret(roomId).priestClaim = null
  const leaderOpenid = firstLeader.id === 1 ? "host" : `user-${firstLeader.id}`
  const other = privateState.players.find(player => player.id !== firstLeader.id)
  const otherOpenid = other.id === 1 ? "host" : `user-${other.id}`
  assert.strictEqual(core.privateView(room(roomId).game, privateState, otherOpenid).needsLeaderClaim, false)
  await expectFailure(action("identityClaim", { roomId, claim: "good" }, otherOpenid), /只有首任队长/)
  for (const player of privateState.players) await action("identityReady", { roomId }, player.id === 1 ? "host" : `user-${player.id}`)
  await action("startIdentity", { roomId }, "host")
  // 新时序：startIdentity 之后先只开「队长选展示阵营」这一步，
  // 队长提交完才开始全员揭示与阅读窗口。
  assert.ok(room(roomId).game.identity.claimAt, "应当先进入队长选择阶段")
  assert.strictEqual(room(roomId).game.identity.revealAt, 0, "队长没选之前不该开始揭示")
  await expectFailure(action("identityRemembered", { roomId }, leaderOpenid), /尚未结束|请先选择/)
  await action("identityClaim", { roomId, claim: "good" }, leaderOpenid)
  assert.strictEqual(secret(roomId).priestClaim, "good")
  assert.ok(room(roomId).game.identity.revealAt > 0, "队长选完就该开始全员揭示")
  room(roomId).game.identity.closeAt = Date.now() - 1
  await action("identityRemembered", { roomId }, leaderOpenid)
}

async function testDeceiverChoosesAgainWhenInspected() {
  cloudMock.reset()
  const counts = gameUtil.countRoles(["loyal", "priest", "squire", "morgan", "hunter", "deceiver"])
  const roomId = await createHumanRoom(6, counts)
  const privateState = secret(roomId)
  const game = room(roomId).game
  const deceiver = privateState.players.find(player => player.role === "deceiver")
  const owner = privateState.players.find(player => player.id !== deceiver.id)
  const deceiverOpenid = deceiver.id === 1 ? "host" : `user-${deceiver.id}`

  game.firstLeaderId = owner.id
  assert.strictEqual(core.privateView(game, privateState, deceiverOpenid).needsLeaderClaim, false)
  room(roomId).phase = "amulet"
  game.amulet = { ownerId: owner.id, status: "claim", firstOfGame: true }
  privateState.currentInspection = { targetId: deceiver.id, displayedFaction: null }

  const before = await action("getState", { roomId }, deceiverOpenid)
  assert.strictEqual(before.private.isInspectionTarget, true)
  assert.deepStrictEqual(before.private.inspectionOptions, ["good", "evil"])
  await action("inspectionClaim", { roomId, claim: "evil" }, deceiverOpenid)
  assert.strictEqual(secret(roomId).currentInspection.displayedFaction, "evil")
  assert.strictEqual(room(roomId).game.amulet.status, "result")
}

async function testTableLayoutSettings() {
  cloudMock.reset()
  const created = await action("createRoom", {
    playerCount: 8,
    roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
    tableType: "long",
    seatLayout: { top: 3, right: 1, bottom: 3, left: 1 }
  })
  assert.strictEqual(room(created.roomId).tableType, "long")
  assert.deepStrictEqual(room(created.roomId).seatLayout, { top: 3, right: 1, bottom: 3, left: 1 })
  const legacy = await action("createRoom", {
    playerCount: 8,
    roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
    tableType: "long",
    tableSides: { top: 3, bottom: 5 }
  })
  assert.deepStrictEqual(room(legacy.roomId).seatLayout, { top: 3, right: 0, bottom: 5, left: 0 })
  await expectFailure(action("createRoom", {
    playerCount: 8,
    roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
    tableType: "long",
    seatLayout: { top: 3, bottom: 4 }
  }), /必须全部分配/)
  const migrated = await action("createRoom", {
    playerCount: 8,
    roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
    tableType: "long",
    seatLayout: { top: 3, bottom: 3, topLeft: 2 }
  })
  assert.deepStrictEqual(room(migrated.roomId).seatLayout, { top: 5, right: 0, bottom: 3, left: 0 })
}

async function testHunterFlow() {
  cloudMock.reset()
  const counts = gameUtil.countRoles(["loyal", "loyal", "loyal", "morgan", "hunter", "shapeshifter"])
  const roomId = await createStartedRoom(6, counts)
  await finishIdentity(roomId)
  for (const winner of ["good", "evil", "good", "evil", "good"]) {
    await playMission(roomId, winner)
    if (room(roomId).phase === "missionResult") await action("handoff", { roomId, ...handoffTargets(roomId) })
  }
  assert.strictEqual(room(roomId).game.final.stage, "discussion")
  await action("finishDiscussion", { roomId, force: true })
  const hunter = secret(roomId).players.find(player => player.role === "hunter")
  assert.strictEqual(room(roomId).game.final.stage, "hunterTargets")
  if (hunter.bot) {
    const hostState = await action("getState", { roomId })
    assert.strictEqual(hostState.private.canControlBotHunter, true)
    const good = secret(roomId).players.filter(player => player.faction === "good")
    await action("hunterTargets", { roomId, targets: good.slice(0, 2).map(player => player.id) })
    assert.strictEqual(room(roomId).status, "finished")
  } else {
    const good = secret(roomId).players.filter(player => player.faction === "good")
    const hunterOpenid = hunter.id === 1 ? "host" : `user-${hunter.id}`
    await action("hunterTargets", { roomId, targets: good.slice(0, 2).map(player => player.id) }, hunterOpenid)
    assert.strictEqual(room(roomId).status, "finished")
  }
}

async function testRealMultiplayerFlow() {
  cloudMock.reset()
  const roomId = await createHumanRoom(6)
  const players = secret(roomId).players
  for (const player of players) {
    const openid = player.id === 1 ? "host" : `user-${player.id}`
    await action("identityReady", { roomId }, openid)
  }
  await action("startIdentity", { roomId }, "host")
  const firstLeader = players.find(player => player.id === room(roomId).game.firstLeaderId)
  await submitLeaderClaim(roomId)
  room(roomId).game.identity.closeAt = Date.now() - 1
  for (const player of players) {
    await action("identityRemembered", { roomId }, player.id === 1 ? "host" : `user-${player.id}`)
  }
  await action("enterNight", { roomId }, "host")
  await action("enterMission", { roomId }, "host")
  assert.strictEqual(room(roomId).game.leaderId, 1)
  const team = [1, 2]
  await expectFailure(action("startVote", { roomId, team, magicTargetId: 2 }, "user-2"), /只有当前队长/)
  await action("startVote", { roomId, team, magicTargetId: 2 }, "host")
  await action("submitVote", { roomId, value: core.automaticVote(room(roomId).game, players[0]) }, "host")
  await action("submitVote", { roomId, value: core.automaticVote(room(roomId).game, players[1]) }, "user-2")
  assert.strictEqual(room(roomId).phase, "missionResult")
  const nextLeader = players.find(player => !player.hasLed && !player.hadAmulet)
  await expectFailure(action("handoff", { roomId, nextLeaderId: nextLeader.id }, `user-${nextLeader.id}`), /只有当前队长/)
  await action("handoff", { roomId, nextLeaderId: nextLeader.id }, "host")
  assert.strictEqual(room(roomId).game.leaderId, nextLeader.id)
}

async function testHumanInspectionClaim() {
  cloudMock.reset()
  const roomId = await createHumanRoom(6)
  const privateState = secret(roomId)
  const host = privateState.players[0]
  const claim = core.displayedFaction(host)
  for (const player of privateState.players) {
    const openid = player.id === 1 ? "host" : `user-${player.id}`
    await action("identityReady", { roomId }, openid)
  }
  await action("startIdentity", { roomId }, "host")
  const firstLeader = privateState.players.find(player => player.id === room(roomId).game.firstLeaderId)
  await submitLeaderClaim(roomId)
  room(roomId).game.identity.closeAt = Date.now() - 1
  for (const player of privateState.players) await action("identityRemembered", { roomId }, player.id === 1 ? "host" : `user-${player.id}`)
  await action("enterNight", { roomId }, "host")
  await action("enterMission", { roomId }, "host")
  for (let round = 1; round <= 2; round += 1) {
    const game = room(roomId).game
    const leader = secret(roomId).players.find(player => player.id === game.leaderId)
    const leaderOpenid = leader.id === 1 ? "host" : `user-${leader.id}`
    const size = game.missionPreset.sizes[round - 1]
    const team = secret(roomId).players.slice(0, size)
    const magicTargetId = team[0].id
    await action("startVote", { roomId, team: team.map(player => player.id), magicTargetId }, leaderOpenid)
    for (const player of team) {
      await action("submitVote", { roomId, value: core.automaticVote(room(roomId).game, player) }, player.id === 1 ? "host" : `user-${player.id}`)
    }
    if (round === 1) {
      const next = secret(roomId).players.find(player => !player.hasLed && !player.hadAmulet)
      await action("handoff", { roomId, nextLeaderId: next.id }, leaderOpenid)
    } else {
      const eligible = secret(roomId).players.filter(player => !player.hasLed && !player.hadAmulet)
      const next = eligible[0]
      const owner = eligible[1]
      await action("handoff", { roomId, nextLeaderId: next.id, amuletOwnerId: owner.id }, leaderOpenid)
      assert.strictEqual(room(roomId).phase, "amulet")
      const target = secret(roomId).players.find(player => player.id !== owner.id && !player.hadAmulet && !player.fadedAmulet)
      const ownerOpenid = owner.id === 1 ? "host" : `user-${owner.id}`
      const targetOpenid = target.id === 1 ? "host" : `user-${target.id}`
      await expectFailure(action("selectAmuletTarget", { roomId, targetId: target.id }, targetOpenid), /只有护身符持有者/)
      await action("selectAmuletTarget", { roomId, targetId: target.id }, ownerOpenid)
      assert.strictEqual(room(roomId).game.amulet.status, "claim")
      await expectFailure(action("inspectionClaim", { roomId, claim }, ownerOpenid), /不是当前被查验者/)
      const displayed = core.displayedFaction(target)
      await action("inspectionClaim", { roomId, claim: displayed }, targetOpenid)
      assert.strictEqual(room(roomId).game.amulet.status, "result")
      const publicInspection = room(roomId).game.amuletHistory.slice(-1)[0]
      assert.deepStrictEqual(publicInspection, { round: room(roomId).game.round, ownerId: owner.id, targetId: target.id })
      assert.strictEqual(Object.prototype.hasOwnProperty.call(publicInspection, "displayedFaction"), false)
      assert.strictEqual(Object.prototype.hasOwnProperty.call(publicInspection, "trueFaction"), false)
      await action("completeAmulet", { roomId }, ownerOpenid)
      assert.strictEqual(room(roomId).phase, "mission")

      // 「我的密录」：查验结果在阶段过去之后仍然要能被查验者本人查到，
      // 但只能是对外显示的阵营，且其他玩家看不到。
      const ownerView = (await action("getState", { roomId }, ownerOpenid)).private
      assert.deepStrictEqual(ownerView.inspectionHistory, [{
        round: room(roomId).game.round,
        ownerId: owner.id,
        targetId: target.id,
        displayedFaction: displayed
      }], "查验者本人应能回看自己的查验结果")

      const outsiderId = secret(roomId).players.find(player =>
        player.id !== owner.id && player.id !== target.id && player.role !== "guard").id
      const outsiderView = (await action("getState", { roomId }, outsiderId === 1 ? "host" : `user-${outsiderId}`)).private
      assert.deepStrictEqual(outsiderView.inspectionHistory, [], "无关玩家不应看到任何查验结果")

      // 真实阵营绝不能下发，否则捣乱者/骗徒的伪装形同虚设
      const serialized = JSON.stringify(ownerView)
      assert.ok(!/trueFaction/.test(serialized), "私密视图不得包含真实阵营字段")

      // 出牌记录只包含自己的
      const ownerVotes = ownerView.voteHistory || []
      assert.ok(ownerVotes.every(item => ["success", "fail"].indexOf(item.value) >= 0), "出牌记录格式应为成功/失败")
      const teamIds = room(roomId).game.missions.map(mission => mission.team).flat()
      if (teamIds.indexOf(owner.id) < 0) assert.strictEqual(ownerVotes.length, 0, "没上过车就不该有出牌记录")
    }
  }
}

async function testBotConvenienceActions() {
  cloudMock.reset()
  const roomId = await createStartedRoom(8)
  await finishIdentity(roomId)
  const game = room(roomId).game
  const size = game.missionPreset.sizes[game.round - 1]
  const bots = secret(roomId).players.filter(player => player.bot)
  const evilBots = bots.filter(player => player.faction === "evil")
  const team = evilBots.concat(bots.filter(player => player.faction === "good")).slice(0, size)
  const magicTarget = team.find(player => player.faction === "good") || team[team.length - 1]
  await action("startVote", { roomId, team: team.map(player => player.id), magicTargetId: magicTarget.id })
  await action("submitBotVotes", { roomId })
  assert.strictEqual(room(roomId).phase, "missionResult")
  await expectFailure(action("submitBotVotes", { roomId }), /当前不是任务投票阶段/)
  const targets = handoffTargets(roomId)
  await action("handoff", { roomId, ...targets })
  assert.strictEqual(room(roomId).phase, "mission")
}

async function testHunterDecisionBranches() {
  const counts = gameUtil.countRoles(["loyal", "loyal", "loyal", "morgan", "hunter", "shapeshifter"])
  for (const hunt of [false, true]) {
    cloudMock.reset()
    const roomId = await createHumanRoom(6, counts)
    const hunter = secret(roomId).players.find(player => player.role === "hunter")
    const hunterOpenid = hunter.id === 1 ? "host" : `user-${hunter.id}`
    room(roomId).phase = "finale"
    room(roomId).game.final = { trigger: "evilMissions", stage: "hunterDecision", discussionEndsAt: 0, hunterRevealed: false, submittedCount: 0 }
    secret(roomId).finalHunterId = hunter.id
    if (!hunt) {
      await action("hunterDecision", { roomId, hunt: false }, hunterOpenid)
      assert.strictEqual(room(roomId).status, "playing")
      assert.strictEqual(room(roomId).game.final.stage, "identify")
    } else {
      await action("hunterDecision", { roomId, hunt: true }, hunterOpenid)
      assert.strictEqual(room(roomId).game.final.stage, "hunterTargets")
      const good = secret(roomId).players.filter(player => player.faction === "good")
      await expectFailure(action("hunterTargets", { roomId, targets: [good[0].id, good[0].id] }, hunterOpenid), /两位不同玩家/)
      await action("hunterTargets", { roomId, targets: good.slice(0, 2).map(player => player.id) }, hunterOpenid)
      assert.strictEqual(room(roomId).status, "finished")
    }
  }
}

async function testGoodMissionHunterCannotStaySilent() {
  cloudMock.reset()
  const counts = gameUtil.countRoles(["loyal", "loyal", "loyal", "morgan", "hunter", "shapeshifter"])
  const roomId = await createHumanRoom(6, counts)
  const hunter = secret(roomId).players.find(player => player.role === "hunter")
  const hunterOpenid = hunter.id === 1 ? "host" : `user-${hunter.id}`
  room(roomId).phase = "finale"
  room(roomId).game.final = { trigger: "goodMissions", stage: "hunterDecision", discussionEndsAt: 0, hunterRevealed: false, submittedCount: 0 }
  secret(roomId).finalHunterId = hunter.id
  await expectFailure(action("hunterDecision", { roomId, hunt: false }, hunterOpenid), /必须发动猎杀/)
}

async function testHunterVoteVariant() {
  cloudMock.reset()
  const counts = gameUtil.countRoles(["loyal", "loyal", "loyal", "morgan", "hunter", "shapeshifter"])
  const created = await action("createRoom", { playerCount: 6, roleCounts: counts, hunterVoteVariant: true, tableType: "round" })
  for (let seatNo = 1; seatNo <= 6; seatNo += 1) await action("takeSeat", { roomId: created.roomId, seatNo, name: `玩家${seatNo}` }, seatNo === 1 ? "host" : `user-${seatNo}`)
  const originalRandom = Math.random
  Math.random = () => 0
  try { await action("startGame", { roomId: created.roomId }) } finally { Math.random = originalRandom }
  const roomId = created.roomId
  const hunter = secret(roomId).players.find(player => player.role === "hunter")
  secret(roomId).finalHunterId = hunter.id
  room(roomId).phase = "finale"
  room(roomId).game.final = { trigger: "evilMissions", stage: "discussion", discussionEndsAt: Date.now() + 10000, hunterRevealed: false, submittedCount: 0 }
  await expectFailure(action("finishDiscussion", { roomId, force: false }), /5分钟讨论尚未结束/)
  await action("finishDiscussion", { roomId, force: true })
  assert.strictEqual(room(roomId).game.final.stage, "hunterVote")
  for (const player of secret(roomId).players) {
    const openid = player.id === 1 ? "host" : `user-${player.id}`
    const value = player.faction === "evil" && player.id !== hunter.id ? "fail" : "success"
    await action("hunterVote", { roomId, value }, openid)
  }
  assert.ok(["hunterTargets", "identify", "resolved"].includes(room(roomId).game.final.stage))
}

// 正式版房间（devMode 未开）必须拒绝一切测试玩家能力，
// 否则正式对局可能被误触破坏。
async function testDevModeGating() {
  cloudMock.reset()
  const created = await action("createRoom", {
    playerCount: 5,
    roleCounts: gameUtil.buildDefaultRoleCounts(5, false),
    tableType: "round"
  })
  assert.strictEqual(room(created.roomId).devMode, false, "未声明 devMode 的房间应为正式房间")
  await action("takeSeat", { roomId: created.roomId, seatNo: 1, name: "房主" })
  await expectFailure(action("fillBots", { roomId: created.roomId }), /仅在开发版可用/)
  await expectFailure(action("submitBotVotes", { roomId: created.roomId }), /仅在开发版可用/)
  await expectFailure(
    action("submitBotVote", { roomId: created.roomId, playerId: 2, value: "success" }),
    /仅在开发版可用/
  )
}

// 房间码必须唯一，且失效房间不能再被加入。
async function testRoomCodeLifecycle() {
  cloudMock.reset()
  const make = () => action("createRoom", {
    playerCount: 5,
    roleCounts: gameUtil.buildDefaultRoleCounts(5, false),
    tableType: "round",
    devMode: true
  })

  const codes = new Set()
  for (let index = 0; index < 12; index += 1) codes.add((await make()).code)
  assert.strictEqual(codes.size, 12, "同时有效的房间码不能重复")

  const target = await make()
  assert.strictEqual((await action("findRoom", { code: target.code })).room._id, target.roomId)

  // 过期房间不再被命中，并且能区分“过期”和“不存在”
  room(target.roomId).expiresAt = Date.now() - 1
  const expired = await action("findRoom", { code: target.code })
  assert.strictEqual(expired.room, null, "过期房间不应被加入")
  assert.strictEqual(expired.reason, "expired")
  assert.strictEqual((await action("findRoom", { code: "000000" })).reason, "notFound")

  // 过期后房间码可以被新房间复用，且复用后能正确命中新房间
  const reused = await action("createRoom", {
    playerCount: 5,
    roleCounts: gameUtil.buildDefaultRoleCounts(5, false),
    tableType: "round",
    devMode: true
  })
  room(reused.roomId).code = target.code
  const found = await action("findRoom", { code: target.code })
  assert.strictEqual(found.room._id, reused.roomId, "应命中仍然有效的新房间")

  // 已结束的房间同样不该被加入
  room(reused.roomId).status = "finished"
  assert.strictEqual((await action("findRoom", { code: target.code })).room, null)
}

// 房间失效必须是客户端可识别的稳定文案，才能把玩家送回首页。
async function testMissingRoomMessage() {
  cloudMock.reset()
  for (const name of ["getState", "takeSeat", "startGame"]) {
    let error = null
    try { await action(name, { roomId: "不存在的房间", seatNo: 1, name: "甲" }) } catch (caught) { error = caught }
    assert.ok(error, `${name} 操作不存在的房间应当失败`)
    assert.strictEqual(error.code, "AVALON_RULE_ERROR", `${name} 应返回规则错误`)
    assert.match(error.message, /房间不存在或已结束/)
  }
}

// 非规则类错误（数据库、代码缺陷）不能把堆栈直接抛给客户端。
async function testInternalErrorSanitized() {
  cloudMock.reset()
  const created = await action("createRoom", {
    playerCount: 5,
    roleCounts: gameUtil.buildDefaultRoleCounts(5, false),
    tableType: "round"
  })
  // 构造一个真实的内部故障：座位数据损坏会让 seats.map 抛 TypeError
  room(created.roomId).seats = null
  let error = null
  try { await action("takeSeat", { roomId: created.roomId, seatNo: 1, name: "甲" }) } catch (caught) { error = caught }
  assert.ok(error, "损坏的房间数据应当导致失败")
  assert.strictEqual(error.code, "AVALON_INTERNAL_ERROR")
  assert.match(error.message, /服务器开小差了/)
  assert.ok(!/TypeError|null|seats|at Object/.test(error.message), "不能泄露底层错误细节")
  assert.ok(error.message.length < 60, "面向玩家的错误文案必须简短")
}

// 逐步模式：bot 不自动行动，房主每点一次「让测试骑士行动」才走一步。
// botSuggest 只给建议，执行仍走原有 action——规则校验一条都不绕过。
async function testStepModeBotSuggest() {
  cloudMock.reset()
  const created = await action("createRoom", {
    playerCount: 5, roleCounts: gameUtil.buildDefaultRoleCounts(5, false),
    unknownRoles: false, hunterVoteVariant: false, tableType: "round",
    devMode: true, stepMode: true
  })
  const roomId = created.roomId
  await action("takeSeat", { roomId, seatNo: 1, name: "房主" })
  await action("fillBots", { roomId })
  await action("startGame", { roomId })
  await finishIdentity(roomId)

  assert.strictEqual(room(roomId).phase, "mission")
  const leader = secret(roomId).players.find(p => p.id === room(roomId).game.leaderId)
  if (leader.bot) {
    const s1 = await action("botSuggest", { roomId })
    assert.strictEqual(s1.action, "startVote", "组队阶段该建议组队")
    assert.strictEqual(s1.payload.team.length, room(roomId).game.missionPreset.sizes[0], "队伍人数要对")
    assert.ok(s1.payload.team.indexOf(s1.payload.magicTargetId) >= 0, "魔法指示物必须给同行骑士")
    await action(s1.action, { roomId, ...s1.payload })
    assert.strictEqual(room(roomId).phase, "vote")

    const s2 = await action("botSuggest", { roomId })
    assert.strictEqual(s2.action, "submitBotVotes", "投票阶段该建议代出牌")
  }

  // 非房主不能用
  let denied = ""
  try { await action("botSuggest", { roomId }, "other") } catch (error) { denied = error.message }
  assert.ok(denied, "只有房主能让测试骑士行动")
  console.log("  step mode bot suggest ok")
}

// 逐步模式的交接建议必须能被 handoff 原样接受——尤其是护身符轮次。
// 之前的用例用 5 人局，needsAmulet 永远 false，正好漏过这个洞：
// botSuggest 给的字段名是前端的 nextAmuletId，而 handoff 读 amuletOwnerId，
// 实机在 8 人局第 2 轮交接时当场报「本轮必须指定护身符持有者」。
async function testStepModeHandoffAmulet() {
  cloudMock.reset()
  const created = await action("createRoom", {
    playerCount: 8, roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
    unknownRoles: false, hunterVoteVariant: false, tableType: "round",
    devMode: true, stepMode: true
  })
  const roomId = created.roomId
  await action("takeSeat", { roomId, seatNo: 1, name: "房主" })
  await action("fillBots", { roomId })
  await action("startGame", { roomId })
  await finishIdentity(roomId)

  // 第 1 轮（8 人局第 1 轮结束不发护身符），交接时指定一个 bot 接任，
  // 确保第 2 轮队长是测试骑士、botSuggest 有活可干
  await playMission(roomId, "good")
  const nextBot = secret(roomId).players.find(p => p.bot && !p.hasLed)
  await action("handoff", { roomId, nextLeaderId: nextBot.id })
  assert.strictEqual(room(roomId).phase, "mission")

  // 第 2 轮结束后 needsAmulet(8, 2) = true，建议必须带 amuletOwnerId 且能原样执行
  await playMission(roomId, "good")
  assert.strictEqual(room(roomId).phase, "missionResult")
  const suggestion = await action("botSuggest", { roomId })
  assert.strictEqual(suggestion.action, "handoff")
  assert.ok(suggestion.payload.amuletOwnerId, "护身符轮次的交接建议必须带 amuletOwnerId")
  await action(suggestion.action, { roomId, ...suggestion.payload })
  assert.strictEqual(room(roomId).phase, "amulet", "带护身符的交接应当进入查验阶段")
  console.log("  step mode handoff amulet ok")
}

// assetUrls：云函数以管理员身份给客户端签资产链接。
// 存在的原因：云存储权限是「仅创建者可读写」（个人版改权限要付费），
// 非创建者读 cloud:// 全裂——多账号调试的虚拟用户第一次暴露了这个问题。
async function testAssetUrls() {
  cloudMock.reset()
  const good = await action("assetUrls", { fileIDs: [
    "cloud://env-id.x-y/assets/ui/floor-indigo.jpg",
    "cloud://env-id.x-y/assets/roles/painted/morgan.jpg"
  ] })
  assert.strictEqual(good.urls.length, 2)
  assert.ok(good.urls.every(item => item.url.indexOf("https://") === 0), "要返回可直接下载的 https 链接")

  // 白名单：只签 assets/ 目录，不能当通用签名器用
  let denied = ""
  try { await action("assetUrls", { fileIDs: ["cloud://env-id.x-y/secrets/dump.json"] }) } catch (error) { denied = error.message }
  assert.ok(denied, "assets/ 之外的路径必须拒绝")
  console.log("  asset urls ok")
}


// ===== 多端一致性 =====
// 这一组模拟「每个人一台手机」：每个动作都以对应玩家的 openid 发出，
// 每个玩家单独拉自己的 getState。手点多账号调试窗口只能抽查看到的那几屏，
// 这里是把**每个玩家在每个阶段拿到的整份 payload** 都翻一遍。

// 把整份 payload 拍平成「路径 -> 值」，用来找藏在任意层级里的泄底字段
function flatten(value, prefix, out) {
  out = out || []
  if (value === null || value === undefined) return out
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out))
  } else if (typeof value === "object") {
    Object.keys(value).forEach(key => flatten(value[key], prefix ? `${prefix}.${key}` : key, out))
  } else {
    out.push([prefix, value])
  }
  return out
}

// 开一局到「已发身份」，返回每人的 openid 与真实身份
async function dealtGame(playerCount) {
  const roomId = await createHumanRoom(playerCount)
  const players = secret(roomId).players
  const who = id => (id === 1 ? "host" : `user-${id}`)
  for (const player of players) await action("identityReady", { roomId }, who(player.id))
  await action("startIdentity", { roomId }, "host")
  return { roomId, players, who }
}

// 一号大坑：别人的身份不能出现在我的 payload 里的**任何**角落。
// 社交推理游戏泄了底就没得玩，而这种漏只有多端才看得见——
// 单机跑永远是房主视角，房主本来就该知道自己的身份，看不出问题。
async function testNoRoleLeakAcrossClients() {
  cloudMock.reset()
  const { roomId, players, who } = await dealtGame(8)
  const leaks = []
  for (const me of players) {
    const view = await action("getState", { roomId }, who(me.id))
    const flat = flatten(view, "")
    const mine = view.private || {}
    assert.strictEqual(mine.id, me.id, `${who(me.id)} 拿到的私有视图不是自己的`)
    assert.strictEqual(mine.role, me.role, `${who(me.id)} 的身份对不上`)
    for (const other of players) {
      if (other.id === me.id) continue
      flat.forEach(([keyPath, value]) => {
        // 只看字符串值；privateView 里是我自己的东西，跳过
        if (typeof value !== "string" || keyPath.indexOf("private") === 0) return
        if (value === other.role || value === other.roleName) {
          leaks.push(`${who(me.id)}(${me.role}) 能看到 ${other.id}号 的 ${value} @ ${keyPath}`)
        }
      })
    }
  }
  assert.deepStrictEqual(leaks, [], `身份泄露:\n  ${leaks.join("\n  ")}`)
  console.log("  多端身份隔离 ok")
}

// 二号大坑：任何人都不能替别人操作。
// 单机测不出来——房主在测试模式下**本来就**被允许代 bot 行动，
// 那条豁免不能扩散到真人身上。
// 检查的是**真正被写入的那个集合**（identity.rememberedIds）：
// 一开始我比对的是玩家对象，那东西这个动作压根不碰，测了个寂寞。
async function testNoActingForOthers() {
  cloudMock.reset()
  const { roomId, players, who } = await dealtGame(6)
  const first = players.find(p => p.role === "deceiver" && p.id === room(roomId).game.firstLeaderId)
  await submitLeaderClaim(roomId)
  room(roomId).game.identity.closeAt = Date.now() - 1

  const me = players[0]
  const victim = players[1]
  // 带着别人的 playerId 去点「记住了」，服务端必须只认调用者自己
  await action("identityRemembered", { roomId, playerId: victim.id }, who(me.id))
  const remembered = room(roomId).game.identity.rememberedIds
  assert.ok(remembered.indexOf(me.id) >= 0, "调用者自己应被记为已读")
  assert.ok(remembered.indexOf(victim.id) < 0,
    `${who(me.id)} 用 playerId 参数替 ${victim.id}号 点了「记住了」`)

  // 队长动作同理：非队长带着队长的 id 也不能开投票
  for (const p of players) await action("identityRemembered", { roomId }, who(p.id))
  await action("enterNight", { roomId }, "host")
  await action("enterMission", { roomId }, "host")
  const leader = players.find(p => p.id === room(roomId).game.leaderId)
  const notLeader = players.find(p => p.id !== leader.id)
  const team = [players[0].id, players[1].id]
  await expectFailure(
    action("startVote", { roomId, team, magicTargetId: team[1], playerId: leader.id }, who(notLeader.id)),
    /只有当前队长/)
  console.log("  越权代打拦截 ok")
}

// 三号大坑：投票在开票前不能被别人看到。
// 这个在单机上永远看不出——一台机器上只有一个人在投。
async function testVoteSecrecyBeforeReveal() {
  cloudMock.reset()
  const { roomId, players, who } = await dealtGame(6)
  const first = players.find(p => p.role === "deceiver" && p.id === room(roomId).game.firstLeaderId)
  await submitLeaderClaim(roomId)
  room(roomId).game.identity.closeAt = Date.now() - 1
  for (const p of players) await action("identityRemembered", { roomId }, who(p.id))
  await action("enterNight", { roomId }, "host")
  await action("enterMission", { roomId }, "host")
  const leader = players.find(p => p.id === room(roomId).game.leaderId)
  const team = [players[0].id, players[1].id]
  await action("startVote", { roomId, team, magicTargetId: team[1] }, who(leader.id))

  const voter = players.find(p => p.id === team[0])
  const value = core.automaticVote(room(roomId).game, voter)
  await action("submitVote", { roomId, value }, who(voter.id))

  // 另一个队员还没投，此时任何人都不该看得到已投的那张牌
  const peeks = []
  for (const me of players) {
    const view = await action("getState", { roomId }, who(me.id))
    flatten(view, "").forEach(([keyPath, v]) => {
      if (keyPath.indexOf("private") === 0) return
      if (v === value && /vote|card|ballot/i.test(keyPath)) {
        peeks.push(`${who(me.id)} 在开票前看到了 ${voter.id}号 的票 @ ${keyPath}`)
      }
    })
  }
  assert.deepStrictEqual(peeks, [], `投票提前泄露:\n  ${peeks.join("\n  ")}`)
  console.log("  开票前投票保密 ok")
}

// 四号大坑：并发与改票。线下玩最容易撞——大家围着一张桌子，
// 两个人同时伸手点，或者有人看完别人的反应想把自己那张换掉。
//
// 注意别像我第一版那样写空断言：投票是按 player.id 存的，重复提交只会覆盖
// 同一个 key，「票数不超过队伍人数」永远成立，把去重拦截整个删掉都照样绿。
// 要断言的是**第二次必须被拒、且存下来的还是第一张**。
async function testConcurrentSubmissionsCountOnce() {
  cloudMock.reset()
  const { roomId, players, who } = await dealtGame(6)
  const first = players.find(p => p.role === "deceiver" && p.id === room(roomId).game.firstLeaderId)
  await submitLeaderClaim(roomId)
  room(roomId).game.identity.closeAt = Date.now() - 1
  for (const p of players) await action("identityRemembered", { roomId }, who(p.id))
  await action("enterNight", { roomId }, "host")
  await action("enterMission", { roomId }, "host")
  const leader = players.find(p => p.id === room(roomId).game.leaderId)
  const team = [players[0].id, players[1].id]
  await action("startVote", { roomId, team, magicTargetId: team[1] }, who(leader.id))

  const voter = players.find(p => p.id === team[0])
  const options = core.legalVoteOptions(room(roomId).game, voter)
  const firstVote = options[0]
  await action("submitVote", { roomId, value: firstVote }, who(voter.id))
  const round = String(room(roomId).game.round)
  const stored = secret(roomId).votes[round][String(voter.id)]

  // 想改成另一张（有得选才测得出来；只有一个合法选项时退化为「重复提交同一张」）
  const changeTo = options.find(v => v !== firstVote) || firstVote
  await expectFailure(action("submitVote", { roomId, value: changeTo }, who(voter.id)), /已经投过/)
  assert.strictEqual(secret(roomId).votes[round][String(voter.id)], stored,
    `${who(voter.id)} 投完之后把票改掉了`)

  // 队长连点两次「开始投票」，不能把已投的票清空
  const before = Object.keys(secret(roomId).votes[round] || {}).length
  try { await action("startVote", { roomId, team, magicTargetId: team[1] }, who(leader.id)) } catch (e) { /* 拒绝是对的 */ }
  const after = Object.keys(secret(roomId).votes[String(room(roomId).game.round)] || {}).length
  assert.ok(after >= before, `重复开始投票把 ${before} 张已投的票清成了 ${after} 张`)
  console.log("  并发/改票拦截 ok")
}

// 五号大坑：所有人看到的公共状态必须一致（阶段、轮次、队长、比分）。
// 分叉了就会出现「我这边还在投票，他那边已经进下一轮」。
async function testPublicStateAgreesAcrossClients() {
  cloudMock.reset()
  const { roomId, players, who } = await dealtGame(7)
  const views = []
  for (const me of players) views.push(await action("getState", { roomId }, who(me.id)))
  const key = v => JSON.stringify({
    phase: v.room && v.room.phase,
    round: v.room && v.room.game && v.room.game.round,
    leaderId: v.room && v.room.game && v.room.game.leaderId,
    missions: v.room && v.room.game && (v.room.game.missions || []).map(m => m.winner),
    seats: (v.room && v.room.seats || []).map(s => s.name)
  })
  const distinct = new Set(views.map(key))
  assert.strictEqual(distinct.size, 1,
    `${distinct.size} 种不同的公共状态:\n  ${[...distinct].join("\n  ")}`)
  console.log("  公共状态多端一致 ok")
}


// 首任队长：默认随机，房主可在候场页指定。
async function testFirstLeaderChoice() {
  // 1) 不指定 = 随机。跑多局，首任队长不能永远是同一个人
  const seen = new Set()
  for (let i = 0; i < 30; i += 1) {
    cloudMock.reset()
    const roomId = await createHumanRoom(6, null, { realRandom: true })
    seen.add(room(roomId).game.firstLeaderId)
  }
  assert.ok(seen.size > 1, `默认应当随机，30 局却只出现过 ${[...seen]} 号`)

  // 2) 指定了就必须是那个人。逐个座位试一遍，别只测一个碰巧对的
  for (let seat = 1; seat <= 6; seat += 1) {
    cloudMock.reset()
    const roomId = await createHumanRoom(6, null, { firstLeaderSeatNo: seat })
    assert.strictEqual(room(roomId).game.firstLeaderId, seat,
      `指定了 ${seat} 号，实际首任队长是 ${room(roomId).game.firstLeaderId} 号`)
    // 指定的人同时要被标记为「已当过队长」，否则轮转会把他算成还没轮到
    const leader = secret(roomId).players.find(p => p.id === seat)
    assert.ok(leader.hasLed, `${seat} 号当了首任队长却没被标记 hasLed`)
  }

  // 3) 指定一个没人坐的座位要被拒——客户端可能拿着过期的座位号。
  // 这里不能用 createHumanRoom：它自己就把局开了，第二次 startGame 会先撞上
  //「游戏已经开始」，测不到我们想测的那条校验。
  cloudMock.reset()
  const created = await action("createRoom", {
    playerCount: 6, roleCounts: gameUtil.buildDefaultRoleCounts(6, false),
    unknownRoles: false, hunterVoteVariant: false, tableType: "round"
  })
  for (let seatNo = 1; seatNo <= 6; seatNo += 1) {
    await action("takeSeat", { roomId: created.roomId, seatNo, name: `玩家${seatNo}` },
      seatNo === 1 ? "host" : `user-${seatNo}`)
  }
  await expectFailure(action("startGame", { roomId: created.roomId, firstLeaderSeatNo: 99 }, "host"), /没有人/)
  // 拒绝之后房间必须还停在候场，不能被改坏
  assert.strictEqual(room(created.roomId).status, "lobby", "开局被拒后房间状态不该变")
  console.log("  first leader choice ok")
}


// 首任队长**都**要走「选择对外展示的阵营」这一步，不只是骗徒。
//
// 线下所有人都盯着谁在点手机：只有骗徒需要点的话，「有人在点」本身
// 就等于宣布他是骗徒。非骗徒也点，只是他只有一个合法选项。
// 同理这一步和场上有没有教士无关——没教士也照走，否则「这局没人点」
// 就等于告诉所有人本局没有教士。
async function testEveryFirstLeaderClaims() {
  // 1) 无论什么角色，首任队长都要走这一步；别人都不用
  cloudMock.reset()
  const roomId = await createHumanRoom(7)
  const players = secret(roomId).players
  const who = id => (id === 1 ? "host" : `user-${id}`)
  const leaderId = room(roomId).game.firstLeaderId
  const leader = players.find(p => p.id === leaderId)
  secret(roomId).priestClaim = null

  const view = core.privateView(room(roomId).game, secret(roomId), who(leaderId))
  assert.strictEqual(view.needsLeaderClaim, true, `${leader.role} 当首任队长却不用选择展示阵营`)
  const other = players.find(p => p.id !== leaderId)
  assert.strictEqual(core.privateView(room(roomId).game, secret(roomId), who(other.id)).needsLeaderClaim, false,
    "非首任队长不该出现这一步")

  // 2) 骗徒两个都能选，其余人只有真实那个能选
  const opts = view.leaderClaimOptions || []
  if (leader.role === "deceiver") {
    assert.deepStrictEqual(opts.slice().sort(), ["evil", "good"], "骗徒应当两个阵营都能展示")
  } else {
    assert.deepStrictEqual(opts, [core.displayedFaction(leader)],
      `${leader.role} 只应能展示真实阵营，实际 ${opts}`)
  }

  // 3) 非骗徒提交另一个阵营要被服务端拒——界面置灰只是提示，不是校验
  if (leader.role !== "deceiver") {
    // 选择阶段由 startIdentity 开启（claimAt），不再依赖 revealAt
    room(roomId).game.identity.claimAt = room(roomId).game.identity.claimAt || Date.now()
    const wrong = core.displayedFaction(leader) === "good" ? "evil" : "good"
    await expectFailure(action("identityClaim", { roomId, claim: wrong }, who(leaderId)), /真实的阵营/)
  }

  // 4) 一局里**没有教士**时这一步照样存在。
  // 少了它，「这局没人点手机」就等于公开本局没有教士。
  cloudMock.reset()
  const noPriest = gameUtil.countRoles(["loyal", "loyal", "squire", "morgan", "hunter", "minion"])
  const roomB = await createHumanRoom(6, noPriest)
  assert.ok(!secret(roomB).players.some(p => p.role === "priest"), "这局本不该有教士")
  secret(roomB).priestClaim = null
  const leaderB = core.getPlayer(secret(roomB), room(roomB).game.firstLeaderId)
  const viewB = core.privateView(room(roomB).game, secret(roomB), leaderB.id === 1 ? "host" : `user-${leaderB.id}`)
  assert.strictEqual(viewB.needsLeaderClaim, true, "没有教士时也必须走这一步，否则等于公开没有教士")
  console.log("  every first leader claims ok")
}


// 时序：队长必须在**全员揭示之前**选完展示阵营。
// 教士的首夜信息里写着「第一位领袖显示为X」——队长还没选就揭示的话，
// 教士读到的是一句空话，他这个角色本轮就废了。
async function testLeaderClaimsBeforeReveal() {
  cloudMock.reset()
  const counts = gameUtil.countRoles(["loyal", "priest", "squire", "morgan", "hunter", "deceiver"])
  const created = await action("createRoom", {
    playerCount: 6, roleCounts: counts, unknownRoles: false, hunterVoteVariant: false, tableType: "round"
  })
  const roomId = created.roomId
  for (let seatNo = 1; seatNo <= 6; seatNo += 1) {
    await action("takeSeat", { roomId, seatNo, name: `玩家${seatNo}` }, seatNo === 1 ? "host" : `user-${seatNo}`)
  }
  const originalRandom = Math.random
  Math.random = () => 0
  try { await action("startGame", { roomId }) } finally { Math.random = originalRandom }

  const players = secret(roomId).players
  const who = id => (id === 1 ? "host" : `user-${id}`)
  for (const p of players) await action("identityReady", { roomId }, who(p.id))
  await action("startIdentity", { roomId }, "host")

  // 队长没选之前：不能开始揭示
  assert.strictEqual(room(roomId).game.identity.revealAt, 0,
    "队长还没选展示阵营，不该开始全员揭示——教士会读到空信息")
  assert.ok(room(roomId).game.identity.claimAt > 0, "应当停在队长选择阶段")

  // 此时教士拿到的信息里不该出现「显示为」——本来也还没有值
  const priest = players.find(p => p.role === "priest")
  const before = core.privateView(room(roomId).game, secret(roomId), who(priest.id))
  assert.ok(!(before.nightInfo || []).some(t => /显示为/.test(t)),
    "队长还没选，教士不该已经拿到展示结果")

  // 队长选完：揭示才开始，教士的信息也齐了
  const leader = core.getPlayer(secret(roomId), room(roomId).game.firstLeaderId)
  const claim = leader.role === "deceiver" ? "good" : core.displayedFaction(leader)
  await action("identityClaim", { roomId, claim }, who(leader.id))
  assert.ok(room(roomId).game.identity.revealAt > 0, "队长选完就该开始全员揭示")
  const after = core.privateView(room(roomId).game, secret(roomId), who(priest.id))
  assert.ok((after.nightInfo || []).some(t => /第一位领袖显示为/.test(t)),
    "队长选完之后，教士必须拿到展示结果")
  console.log("  leader claims before reveal ok")
}

async function run() {
  await testDevModeGating()
  await testRoomCodeLifecycle()
  await testMissingRoomMessage()
  await testInternalErrorSanitized()
  for (const playerCount of [5, 6, 7, 8, 9, 10]) await playFiveRoundGame(playerCount)
  await testHumanAmuletFlow()
  await testInvalidClicks()
  await testUnknownRoles()
  await testFirstLeaderDeceiverClaim()
  await testDeceiverChoosesAgainWhenInspected()
  await testTableLayoutSettings()
  await testHunterFlow()
  await testRealMultiplayerFlow()
  await testHumanInspectionClaim()
  await testBotConvenienceActions()
  await testHunterDecisionBranches()
  await testGoodMissionHunterCannotStaySilent()
  await testHunterVoteVariant()
  await testStepModeBotSuggest()
  await testStepModeHandoffAmulet()
  await testAssetUrls()
  await testFirstLeaderChoice()
  await testEveryFirstLeaderClaims()
  await testLeaderClaimsBeforeReveal()
  await testNoRoleLeakAcrossClients()
  await testNoActingForOthers()
  await testVoteSecrecyBeforeReveal()
  await testConcurrentSubmissionsCountOnce()
  await testPublicStateAgreesAcrossClients()
  console.log("cloud function integration tests passed")
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
