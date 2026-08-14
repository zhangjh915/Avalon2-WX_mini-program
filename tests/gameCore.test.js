const assert = require("assert")
const core = require("../cloudfunctions/avalonGame/gameCore")

function roleCounts(roles) {
  return roles.reduce((counts, role) => {
    counts[role] = (counts[role] || 0) + 1
    return counts
  }, {})
}

function player(id, role, faction, extra) {
  return { id, role, faction, bot: false, revealed: false, ...(extra || {}) }
}

function finaleSecret(players, submissions) {
  return { players, finalSubmissions: submissions }
}

function run() {
  const presets = {
    5: [2, 3, 2, 4, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5]
  }
  Object.keys(presets).forEach(count => assert.deepStrictEqual(core.missionPresets[count].sizes, presets[count]))
  assert.deepStrictEqual(core.missionPresets[6].protectedRounds, [])
  assert.deepStrictEqual(core.missionPresets[7].protectedRounds, [4])
  assert.strictEqual(core.needsAmulet(6, 2), true)
  assert.strictEqual(core.needsAmulet(7, 3), true)
  assert.strictEqual(core.needsAmulet(8, 4), true)
  assert.strictEqual(core.needsAmulet(8, 1), false)

  core.validateSettings({ playerCount: 5, roleCounts: roleCounts(["loyal", "loyal", "loyal", "morgan", "crownPrince"]), unknownRoles: false })
  assert.throws(() => core.validateSettings({ playerCount: 5, roleCounts: roleCounts(["loyal", "loyal", "loyal", "minion", "crownPrince"]), unknownRoles: false }), /摩根勒菲/)
  assert.throws(() => core.validateSettings({ playerCount: 6, roleCounts: roleCounts(["loyal", "loyal", "loyal", "morgan", "lancelotEvil", "minion"]), unknownRoles: false }), /成对加入/)

  const candidateCounts = roleCounts([
    "loyal", "priest", "squire", "troublemaker", "duke", "arthur", "galahad",
    "morgan", "minion", "hunter", "deceiver", "barbarian"
  ])
  core.validateSettings({ playerCount: 8, roleCounts: candidateCounts, unknownRoles: true })
  const candidateSeats = Array.from({ length: 8 }, (_, index) => ({ seatNo: index + 1, name: `玩家${index + 1}` }))
  const drawnLineups = new Set()
  for (let draw = 0; draw < 200; draw += 1) {
    const candidateGame = core.createGame({ playerCount: 8, roleCounts: candidateCounts, unknownRoles: true }, candidateSeats)
    assert.strictEqual(candidateGame.secret.players.length, 8)
    assert.strictEqual(candidateGame.secret.removedRoles.length, 4)
    assert.ok(candidateGame.secret.players.some(item => item.role === "morgan"), "摩根勒菲不得被抽掉")
    assert.deepStrictEqual(candidateGame.secret.players.reduce((counts, item) => {
      counts[item.faction] += 1
      return counts
    }, { good: 0, evil: 0 }), { good: 5, evil: 3 })
    drawnLineups.add(candidateGame.secret.players.map(item => item.role).sort().join(","))
  }
  assert.ok(drawnLineups.size > 1, "候选池应能抽出不同阵容")

  const pairedPool = roleCounts([
    "loyal", "loyal", "loyal", "loyal", "loyal", "priest", "lancelotGood",
    "morgan", "minion", "lancelotEvil"
  ])
  for (let draw = 0; draw < 200; draw += 1) {
    const pairedGame = core.createGame({ playerCount: 9, roleCounts: pairedPool, unknownRoles: true }, candidateSeats.concat({ seatNo: 9, name: "玩家9" }))
    const pairedRoles = pairedGame.secret.players.map(item => item.role)
    assert.strictEqual(pairedRoles.includes("lancelotGood"), pairedRoles.includes("lancelotEvil"), "两位兰斯洛特不得拆对")
  }

  const game = { round: 2, leaderId: 1, current: { team: [1], magicTargetId: 1 } }
  assert.deepStrictEqual(core.legalVoteOptions(game, player(1, "reluctant", "good")), ["fail"])
  assert.deepStrictEqual(core.legalVoteOptions(game, player(1, "saboteur", "evil", { hasLed: false })), ["success"])
  assert.deepStrictEqual(core.legalVoteOptions(game, player(1, "saboteur", "evil", { hasLed: true })), ["fail"])
  assert.deepStrictEqual(core.legalVoteOptions(game, player(1, "morgan", "evil")), ["success", "fail"])
  assert.deepStrictEqual(core.legalVoteOptions(game, player(1, "lunatic", "evil")), ["success"])
  assert.strictEqual(core.automaticVote(game, player(1, "loyal", "good")), "success")
  assert.strictEqual(core.automaticVote(game, player(1, "minion", "evil")), "success")
  assert.strictEqual(core.automaticVote(game, player(1, "morgan", "evil")), "fail")
  const unsealedGame = { round: 1, leaderId: 2, current: { team: [1], magicTargetId: 2 } }
  assert.strictEqual(core.automaticVote(unsealedGame, player(1, "minion", "evil")), "fail")

  const basePlayers = [
    player(1, "loyal", "good"), player(2, "loyal", "good"), player(3, "loyal", "good"),
    player(4, "morgan", "evil"), player(5, "minion", "evil")
  ]
  assert.strictEqual(core.findFinaleCorrection(finaleSecret(basePlayers, {
    1: { targets: [4, 5] }, 2: { targets: [4, 5] }, 3: { targets: [4, 5] }
  }), false).success, true)
  assert.strictEqual(core.findFinaleCorrection(finaleSecret(basePlayers, {
    1: { targets: [3, 4] }, 2: { targets: [4, 5] }, 3: { targets: [4, 5] }
  }), false).success, false)

  const dukePlayers = basePlayers.map(item => ({ ...item }))
  dukePlayers[0].role = "duke"
  const dukeResult = core.findFinaleCorrection(finaleSecret(dukePlayers, {
    1: { targets: [3, 4] }, 2: { targets: [4, 5] }, 3: { targets: [4, 5] }
  }), false)
  assert.strictEqual(dukeResult.success, true)
  assert.ok(dukeResult.corrections.some(value => value.indexOf("公爵") >= 0))

  const twoDukePlayers = [
    player(1, "duke", "good"), player(2, "duke", "good"), player(3, "loyal", "good"), player(4, "loyal", "good"),
    player(5, "morgan", "evil"), player(6, "minion", "evil")
  ]
  const twoDukeResult = core.findFinaleCorrection(finaleSecret(twoDukePlayers, {
    1: { targets: [3, 5] }, 2: { targets: [4, 6] }, 3: { targets: [5, 6] }, 4: { targets: [5, 6] }
  }), false)
  assert.strictEqual(twoDukeResult.success, true)
  assert.strictEqual(twoDukeResult.corrections.filter(value => value.indexOf("公爵") >= 0).length, 2)

  const archPlayers = [
    player(1, "archduke", "good"), player(2, "loyal", "good"), player(3, "loyal", "good"),
    player(4, "morgan", "evil"), player(5, "minion", "evil"), player(6, "shapeshifter", "evil")
  ]
  const archResult = core.findFinaleCorrection(finaleSecret(archPlayers, {
    1: { targets: [3, 4] }, 2: { targets: [4, 5] }, 3: { targets: [4, 5] }
  }), false)
  assert.strictEqual(archResult.success, true)
  assert.ok(archResult.corrections.some(value => value.indexOf("大公") >= 0))

  const apprenticePlayers = basePlayers.map(item => ({ ...item }))
  apprenticePlayers[0].role = "apprentice"
  assert.strictEqual(core.findFinaleCorrection(finaleSecret(apprenticePlayers, {
    1: { targets: [4, 3] }, 2: { targets: [4, 5] }, 3: { targets: [4, 5] }
  }), false).success, true)

  const revealerPlayers = basePlayers.map(item => ({ ...item }))
  revealerPlayers[4].role = "revealer"
  revealerPlayers[4].revealed = true
  assert.strictEqual(core.findFinaleCorrection(finaleSecret(revealerPlayers, {
    1: { targets: [4, 5] }, 2: { targets: [4, 5] }, 3: { targets: [4, 5] }
  }), false).success, true)
  assert.strictEqual(core.findFinaleCorrection(finaleSecret(revealerPlayers, {
    1: { targets: [4, 3] }, 2: { targets: [4, 3] }, 3: { targets: [4, 3] }
  }), false).success, false)

  const hunterGame = { final: {} }
  const hunterPlayers = [player(1, "arthur", "good"), player(2, "loyal", "good"), player(3, "morgan", "evil")]
  core.hunterResult(hunterGame, { players: hunterPlayers }, [1, 3])
  assert.strictEqual(hunterGame.winner, "evil")
  const failedHunterGame = { final: {} }
  core.hunterResult(failedHunterGame, { players: hunterPlayers }, [2, 3])
  assert.strictEqual(failedHunterGame.winner, "good")
}

run()
console.log("gameCore tests passed")
