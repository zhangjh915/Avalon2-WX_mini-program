const assert = require("assert")
const automator = require("miniprogram-automator")
const gameUtil = require("../miniprogram/utils/game")

const endpoint = process.env.WECHAT_AUTOMATION_ENDPOINT || "ws://127.0.0.1:9420"
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint: endpoint })

  async function call(action, payload) {
    return miniProgram.evaluate((actionName, actionPayload) => {
      return wx.cloud.callFunction({
        name: "avalonGame",
        data: { action: actionName, ...(actionPayload || {}) }
      }).then(response => response.result)
    }, action, payload || {})
  }

  async function expectFailure(action, payload, message) {
    let error = null
    try { await call(action, payload) } catch (caught) { error = caught }
    assert.ok(error, `${action} 应失败`)
    assert.match(String(error.message || error), message)
  }

  async function state(roomId) {
    return call("getState", { roomId })
  }

  async function setupSeatsWithRace(roomId) {
    return miniProgram.evaluate(id => {
      const invoke = (action, payload) => wx.cloud.callFunction({
        name: "avalonGame",
        data: { action, roomId: id, ...(payload || {}) }
      })
      return Promise.all([
        invoke("takeSeat", { seatNo: 1, name: "云端自动巡检" }),
        invoke("fillBots")
      ]).then(() => true)
    }, roomId)
  }

  async function submitMission(roomId, team, forceFailure, checkInvalid) {
    if (checkInvalid) {
      await expectFailure("startVote", { roomId, team: team.slice(1), magicTargetId: team[0] }, /本轮需要/)
      const outside = (await state(roomId)).room.game.players.find(player => team.indexOf(player.id) < 0)
      await expectFailure("startVote", { roomId, team, magicTargetId: outside.id }, /只能给同行骑士/)
    }

    await call("startVote", { roomId, team, magicTargetId: team[0] })
    await expectFailure("startVote", { roomId, team, magicTargetId: team[0] }, /当前不是组队阶段/)

    let failerId = null
    if (forceFailure) {
      for (const playerId of team) {
        try {
          await call("submitBotVote", { roomId, playerId, value: "fail" })
          failerId = playerId
          break
        } catch (error) {
          assert.match(String(error.message || error), /不能打出这张任务牌/)
        }
      }
    }
    for (const playerId of team) {
      if (playerId !== failerId) await call("submitBotVote", { roomId, playerId, value: "success" })
    }
    const result = await state(roomId)
    assert.strictEqual(result.room.phase, "missionResult")
    return result.room.game.missions[result.room.game.missions.length - 1]
  }

  async function performHandoff(roomId, completedRound) {
    const before = await state(roomId)
    const game = before.room.game
    const eligibleBots = game.players.filter(player => {
      return player.bot && !player.hasLed && !player.hadAmulet
    })
    const nextLeader = eligibleBots[0]
    assert.ok(nextLeader, "缺少可接任的测试队长")
    await expectFailure("handoff", { roomId, nextLeaderId: game.leaderId }, /已担任过队长/)

    const needsAmulet = gameUtil.shouldGiveAmulet(game.playerCount, game.round)
    let amuletOwner = null
    if (needsAmulet) {
      await expectFailure("handoff", {
        roomId,
        nextLeaderId: nextLeader.id,
        amuletOwnerId: nextLeader.id
      }, /不能获得护身符/)
      amuletOwner = eligibleBots.find(player => player.id !== nextLeader.id)
      assert.ok(amuletOwner, "缺少可持有护身符的测试玩家")
    }

    await call("handoff", {
      roomId,
      nextLeaderId: nextLeader.id,
      amuletOwnerId: amuletOwner ? amuletOwner.id : null
    })
    await expectFailure("handoff", {
      roomId,
      nextLeaderId: nextLeader.id,
      amuletOwnerId: amuletOwner ? amuletOwner.id : null
    }, /当前不能交接领袖/)
    const after = await state(roomId)
    assert.strictEqual(after.room.game.round, completedRound + 1)
    assert.strictEqual(after.room.phase, "mission")
    return after
  }

  try {
    const created = await call("createRoom", {
      playerCount: 8,
      roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
      unknownRoles: false,
      hunterVoteVariant: false,
      tableType: "long",
      seatLayout: { top: 3, right: 1, bottom: 3, left: 1 },
      devMode: true
    })
    const roomId = created.roomId

    await setupSeatsWithRace(roomId)
    let current = await state(roomId)
    assert.strictEqual(current.room.tableType, "long")
    assert.deepStrictEqual(current.room.seatLayout, { top: 3, right: 1, bottom: 3, left: 1 })
    const firstSeat = current.room.seats.find(seat => seat.seatNo === 1)
    assert.strictEqual(firstSeat.name, "云端自动巡检")
    assert.strictEqual(firstSeat.bot, false, "并发补测试玩家不能覆盖真人座位")
    assert.strictEqual(firstSeat.isMine, true)
    assert.strictEqual(current.room.seats.filter(seat => seat.name).length, 8)

    await call("startGame", { roomId })
    current = await state(roomId)
    assert.strictEqual(current.room.status, "playing")
    assert.ok(current.private && current.private.role, "房主应收到私密身份")

    await call("identityReady", { roomId })
    await call("identityReady", { roomId })
    await call("startIdentity", { roomId })
    await expectFailure("startIdentity", { roomId }, /已经开始揭示/)
    await sleep(43500)
    await call("identityRemembered", { roomId })
    await call("identityRemembered", { roomId })
    await call("enterNight", { roomId })
    await expectFailure("enterNight", { roomId }, /身份确认尚未结束/)
    await call("enterMission", { roomId })

    current = await state(roomId)
    const botIds = current.room.game.players
      .filter(player => player.bot)
      .map(player => player.id)
    assert.strictEqual(botIds.length, 7)

    const round1Team = botIds.slice(0, 3)
    const round2Team = botIds.slice(3, 7)
    const round3Team = [round1Team[0], round2Team[0]].concat(
      botIds.filter(id => id !== round1Team[0] && id !== round2Team[0]).slice(0, 2)
    )

    const round1 = await submitMission(roomId, round1Team, true, true)
    await performHandoff(roomId, 1)
    const round2 = await submitMission(roomId, round2Team, true, false)
    await performHandoff(roomId, 2)
    const needsEvilRound = round1.winner === "good" && round2.winner === "good"
    const round3 = await submitMission(roomId, round3Team, needsEvilRound, false)
    assert.strictEqual(round3.winner, needsEvilRound ? "evil" : "good")
    current = await performHandoff(roomId, 3)

    assert.strictEqual(current.room.game.round, 4)
    assert.strictEqual(current.room.game.missions.length, 3)
    assert.strictEqual(current.room.phase, "mission")
    console.log(JSON.stringify({
      roomId,
      roomCode: current.room.code,
      round: current.room.game.round,
      phase: current.room.phase,
      missionWinners: current.room.game.missions.map(mission => mission.winner),
      verified: ["并发入座", "非法点击", "重复提交", "第二轮护身符交接", "第三轮护身符交接"]
    }, null, 2))
  } finally {
    miniProgram.disconnect()
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
