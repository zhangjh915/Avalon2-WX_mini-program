const roleInfo = {
  loyal: ["亚瑟的忠臣", "good"], arthur: ["亚瑟", "good"], duke: ["公爵", "good"],
  archduke: ["大公", "good"], priest: ["教士", "good"], squire: ["侍从", "good"],
  apprentice: ["学徒", "good"], troublemaker: ["捣乱者", "good"], morgan: ["摩根勒菲", "evil"],
  minion: ["莫德雷德的爪牙", "evil"], shapeshifter: ["幻形妖", "evil"], crownPrince: ["王储", "evil"],
  hunter: ["盲眼杀手", "evil"], barbarian: ["野蛮人", "evil"], traitor: ["叛徒", "evil"],
  revealer: ["揭露者", "evil"], lunatic: ["疯子", "evil"], deceiver: ["骗徒", "evil"],
  galahad: ["加拉哈德", "good"], reluctant: ["不情愿的领袖", "good"], guard: ["守卫", "good"],
  percival: ["帕西瓦里", "good"], boaster: ["吹嘘者", "evil"], saboteur: ["破坏者", "evil"],
  outsider: ["边缘人", "evil"], lancelotGood: ["正义的兰斯洛特", "good"],
  lancelotEvil: ["邪恶的兰斯洛特", "evil"]
}

const missionPresets = {
  5: { sizes: [2, 3, 2, 4, 3], protectedRounds: [] },
  6: { sizes: [2, 3, 4, 3, 4], protectedRounds: [] },
  7: { sizes: [2, 3, 3, 4, 4], protectedRounds: [4] },
  8: { sizes: [3, 4, 4, 5, 5], protectedRounds: [4] },
  9: { sizes: [3, 4, 4, 5, 5], protectedRounds: [4] },
  10: { sizes: [3, 4, 4, 5, 5], protectedRounds: [4] }
}

const roleLimits = {
  loyal: { min: 5, multiple: true }, arthur: { min: 7 }, duke: { min: 7, maxCopies: 2 }, archduke: { min: 9, maxCopies: 2 },
  priest: { min: 6, maxCopies: 2 }, squire: { min: 6 }, apprentice: { min: 5, maxCopies: 2 }, troublemaker: { min: 7 },
  morgan: { min: 5, required: true }, minion: { min: 5, multiple: true }, shapeshifter: { min: 6 },
  crownPrince: { min: 5, max: 5 }, hunter: { min: 6 }, barbarian: { min: 7 }, traitor: { min: 5 },
  revealer: { min: 7 }, lunatic: { min: 5 }, deceiver: { min: 6 }, galahad: { min: 5 },
  reluctant: { min: 7 }, guard: { min: 6 }, percival: { min: 7 }, boaster: { min: 5 },
  saboteur: { min: 5 }, outsider: { min: 5 },
  lancelotGood: { min: 6, pair: "lancelotEvil" }, lancelotEvil: { min: 6, pair: "lancelotGood" }
}

const factionTotals = {
  5: { good: 3, evil: 2 }, 6: { good: 3, evil: 3 }, 7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 }, 9: { good: 6, evil: 3 }, 10: { good: 6, evil: 4 }
}

const titles = ["北境守护骑士", "黑塔观察员", "茶水间神谕者", "会议室阴谋家", "迟到的圣杯顾问", "沉默圆桌代表", "皇冠临时负责人", "护身符风险专员", "远征项目经理", "背锅预备役"]

function shuffle(list) {
  const values = list.slice()
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const value = values[index]
    values[index] = values[target]
    values[target] = value
  }
  return values
}

function rolesFromCounts(counts) {
  return Object.keys(counts || {}).reduce((roles, role) => {
    for (let index = 0; index < Number(counts[role] || 0); index += 1) roles.push(role)
    return roles
  }, [])
}

function validateSettings(settings) {
  const playerCount = Number(settings.playerCount)
  if (!missionPresets[playerCount]) throw new Error("当前支持5至10人局")
  const counts = settings.roleCounts || {}
  const roles = rolesFromCounts(counts)
  roles.forEach(role => {
    if (!roleInfo[role]) throw new Error(`未知角色：${role}`)
    const limit = roleLimits[role]
    if (playerCount < limit.min || (limit.max && playerCount > limit.max)) throw new Error(`${roleInfo[role][0]}不适用于${playerCount}人局`)
    if (!limit.multiple && Number(counts[role]) > Number(limit.maxCopies || 1)) throw new Error(`${roleInfo[role][0]}最多只能有${limit.maxCopies || 1}名`)
  })
  if (Number(counts.morgan || 0) !== 1) throw new Error("摩根勒菲必须且只能有1名")
  if (Number(counts.lancelotGood || 0) !== Number(counts.lancelotEvil || 0)) throw new Error("两位兰斯洛特必须成对加入")
  const expected = factionTotals[playerCount]
  const actual = roles.reduce((value, role) => {
    value[roleInfo[role][1]] += 1
    return value
  }, { good: 0, evil: 0 })
  if (settings.unknownRoles) {
    if (actual.good < expected.good || actual.evil < expected.evil) throw new Error(`候选池至少需要${expected.good}名正义与${expected.evil}名邪恶角色`)
    if (actual.good === expected.good && actual.evil === expected.evil) throw new Error("未知角色至少需要多选1名候选角色")
  } else if (actual.good !== expected.good || actual.evil !== expected.evil) {
    throw new Error(`角色配置需要${expected.good}名正义与${expected.evil}名邪恶角色`)
  }
  const requiredCounts = roles.reduce((value, role) => {
    if (roleLimits[role] && roleLimits[role].required) value[roleInfo[role][1]] += 1
    return value
  }, { good: 0, evil: 0 })
  if (requiredCounts.good > expected.good || requiredCounts.evil > expected.evil) throw new Error("必选角色超出本局阵营名额")
  return true
}

function prepareRoles(settings) {
  const pool = rolesFromCounts(settings.roleCounts)
  if (!settings.unknownRoles) return { roles: shuffle(pool), removed: [] }
  const expected = factionTotals[settings.playerCount]
  const required = pool.filter(role => roleLimits[role] && roleLimits[role].required)
  const singles = pool.filter(role => !(roleLimits[role] && roleLimits[role].required) && !roleLimits[role].pair)
  const hasLancelotPair = pool.indexOf("lancelotGood") >= 0 && pool.indexOf("lancelotEvil") >= 0
  const requiredCounts = required.reduce((value, role) => {
    value[roleInfo[role][1]] += 1
    return value
  }, { good: 0, evil: 0 })
  const goodSingles = singles.filter(role => roleInfo[role][1] === "good")
  const evilSingles = singles.filter(role => roleInfo[role][1] === "evil")
  const pairOptions = hasLancelotPair ? [false, true] : [false]
  const feasiblePairOptions = pairOptions.filter(includePair => {
    const goodNeeded = expected.good - requiredCounts.good - (includePair ? 1 : 0)
    const evilNeeded = expected.evil - requiredCounts.evil - (includePair ? 1 : 0)
    return goodNeeded >= 0 && evilNeeded >= 0 && goodSingles.length >= goodNeeded && evilSingles.length >= evilNeeded
  })
  if (!feasiblePairOptions.length) throw new Error("未知角色候选池无法抽出合法阵容")
  const includePair = feasiblePairOptions[Math.floor(Math.random() * feasiblePairOptions.length)]
  const selected = required.slice()
  if (includePair) selected.push("lancelotGood", "lancelotEvil")
  selected.push(...shuffle(goodSingles).slice(0, expected.good - requiredCounts.good - (includePair ? 1 : 0)))
  selected.push(...shuffle(evilSingles).slice(0, expected.evil - requiredCounts.evil - (includePair ? 1 : 0)))
  const remaining = selected.reduce((counts, role) => {
    counts[role] = (counts[role] || 0) + 1
    return counts
  }, {})
  const removed = pool.filter(role => {
    if (remaining[role]) {
      remaining[role] -= 1
      return false
    }
    return true
  })
  const roles = selected
  if (roles.length !== settings.playerCount) throw new Error("最终角色数与玩家数不一致")
  return { roles: shuffle(roles), removed }
}

// 同一局里可能出现多次的角色，各自准备了多张不同长相的立绘。
// 数字必须和 miniprogram/assets/roles/<皮肤>/ 下的文件数一致：
// 有变体的角色文件名是 <key>-v<N>.jpg，没变体的是 <key>.jpg。
const roleArtVariants = {
  loyal: 4, minion: 3, duke: 2, archduke: 2, priest: 2, apprentice: 2
}

// 给同名角色分配互不重复的立绘变体，避免一桌人看到两张一模一样的身份牌。
// 实例数超过变体数时循环复用（例如 10 人局 6 个忠臣、只有 4 张立绘）。
function assignArtVariants(players) {
  const used = {}
  players.forEach(player => {
    const total = roleArtVariants[player.role]
    if (!total) {
      player.artVariant = 0
      return
    }
    used[player.role] = (used[player.role] || 0) + 1
    player.artVariant = ((used[player.role] - 1) % total) + 1
  })
  return players
}

function makePlayer(seat, role, index) {
  return {
    id: seat.seatNo,
    openid: seat.openid || "",
    bot: !!seat.bot,
    name: seat.name,
    title: titles[index % titles.length],
    role,
    roleName: roleInfo[role][0],
    faction: roleInfo[role][1],
    artVariant: 0,
    hasLed: false,
    hadAmulet: false,
    fadedAmulet: false,
    revealed: false
  }
}

function createGame(settings, seats, options) {
  validateSettings(settings)
  const prepared = prepareRoles(settings)
  const orderedSeats = seats.slice().sort((a, b) => a.seatNo - b.seatNo)
  const roles = prepared.roles.slice()
  // 测试用：把指定角色换到房主座位上，其余照旧随机。
  // 用交换而不是重排，牌堆构成完全不变——不会因为指定角色而改变本局的角色池。
  const wantedRole = options && options.hostRole
  const hostSeatNo = options && options.hostSeatNo
  if (wantedRole && hostSeatNo) {
    const hostIndex = orderedSeats.findIndex(seat => Number(seat.seatNo) === Number(hostSeatNo))
    const roleIndex = roles.indexOf(wantedRole)
    if (hostIndex >= 0 && roleIndex >= 0 && hostIndex !== roleIndex) {
      const swap = roles[hostIndex]
      roles[hostIndex] = roles[roleIndex]
      roles[roleIndex] = swap
    }
  }
  const players = assignArtVariants(orderedSeats.map((seat, index) => makePlayer(seat, roles[index], index)))
  // 首任队长：默认随机；房主在候场页指定了座位就用那个人。
  // 校验放在这里而不是只信客户端——指定的座位可能已经被人换走了。
  const wantedLeaderSeat = Number(options && options.firstLeaderSeatNo) || 0
  const designated = wantedLeaderSeat
    ? players.find(player => player.id === wantedLeaderSeat)
    : null
  const firstLeader = designated || players[Math.floor(Math.random() * players.length)]
  firstLeader.hasLed = true
  return {
    secret: {
      players,
      removedRoles: prepared.removed,
      votes: {},
      finalSubmissions: {},
      hunterVotes: {},
      inspectionClaim: null
    },
    publicGame: {
      playerCount: settings.playerCount,
      players: players.map(publicPlayer),
      leaderId: firstLeader.id,
      firstLeaderId: firstLeader.id,
      round: 1,
      goodWins: 0,
      evilWins: 0,
      missionPreset: missionPresets[settings.playerCount],
      missions: [],
      amuletHistory: [],
      identity: { readyIds: [], revealAt: 0, closeAt: 0, rememberedIds: [] },
      current: { team: [], magicTargetId: null, voteCount: 0, votedIds: [] },
      amulet: null,
      final: null,
      winner: null
    }
  }
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    title: player.title,
    bot: !!player.bot,
    hasLed: player.hasLed,
    hadAmulet: player.hadAmulet,
    fadedAmulet: player.fadedAmulet,
    revealed: player.revealed,
    revealedRoleName: player.revealed ? player.roleName : ""
  }
}

function syncPublicPlayers(game, secret) {
  game.players = secret.players.map(publicPlayer)
}

function getPlayer(secret, id) {
  return secret.players.find(player => player.id === Number(id))
}

function playerForOpenId(secret, openid) {
  return secret.players.find(player => player.openid === openid) || null
}

function legalVoteOptions(game, player) {
  if (!player || game.current.team.indexOf(player.id) < 0) return []
  const magic = game.current.magicTargetId === player.id
  if (player.role === "reluctant" && game.leaderId === player.id && (game.round === 2 || game.round === 3)) return ["fail"]
  if (player.role === "saboteur" && player.hasLed) return ["fail"]
  if (player.role === "lunatic") return magic ? ["success"] : ["fail"]
  if (player.role === "barbarian" && game.round > 3) return ["success"]
  if (player.role === "morgan") return ["success", "fail"]
  if (player.role === "squire" && magic) return ["fail"]
  if (player.faction === "good") return ["success"]
  if (magic) return ["success"]
  return ["success", "fail"]
}

function automaticVote(game, player) {
  const options = legalVoteOptions(game, player)
  const preferred = player && player.faction === "evil" ? "fail" : "success"
  return options.indexOf(preferred) >= 0 ? preferred : options[0]
}

function displayedFaction(player, claim) {
  if (player.role === "troublemaker") return "evil"
  if (player.role === "deceiver" && (claim === "good" || claim === "evil")) return claim
  return player.faction
}

function privateNightInfo(game, secret, player) {
  const evils = secret.players.filter(item => item.faction === "evil")
  const mutualRoles = ["morgan", "minion", "barbarian", "revealer", "lunatic", "deceiver", "boaster", "saboteur"]
  const knownRoles = ["hunter", "traitor", "lancelotEvil"]
  const info = []
  if (mutualRoles.indexOf(player.role) >= 0) {
    const visible = evils.filter(item => mutualRoles.indexOf(item.role) >= 0 && item.id !== player.id)
    if (visible.length) info.push(`你确认的邪恶方：${visible.map(item => `${item.id}号${item.roleName}`).join("、")}`)
    const known = evils.filter(item => knownRoles.indexOf(item.role) >= 0)
    if (known.length) info.push(`额外得知：${known.map(item => `${item.id}号${item.roleName}`).join("、")}`)
    if (player.role === "morgan") {
      const prince = evils.find(item => item.role === "crownPrince")
      if (prince) info.push(`王储是 ${prince.id}号。`)
    }
  }
  if (player.role === "arthur") {
    const morgan = secret.players.find(item => item.role === "morgan")
    if (morgan) info.push(`摩根勒菲是 ${morgan.id}号。`)
  }
  // 首任队长自己得知道这件事。骗徒有「选择向教士展示什么」那一步，所以他知道；
  // 其他角色的展示是服务端自动完成的，屏幕上从头到尾一个字都没有——
  // 实战中房主指定自己当首任队长，全程不知道教士已经读过自己。
  //
  // 措辞不提「教士」在不在场：角色配置可以是隐藏的（未知角色变体），
  // 说「教士会看到」等于确认场上有教士。只陈述自己被展示成什么。
  if (player.id === game.firstLeaderId && player.role !== "deceiver") {
    info.push(`你是本局首任队长，你的忠诚对外显示为${displayedFaction(player) === "good" ? "正义方" : "邪恶方"}。`)
  }
  if (player.role === "priest") {
    const leader = getPlayer(secret, game.firstLeaderId)
    if (leader && secret.priestClaim) info.push(`第一位领袖显示为${secret.priestClaim === "good" ? "正义方" : "邪恶方"}。`)
    else if (leader && leader.role === "deceiver") info.push("第一位领袖正在选择本次向你展示的阵营。")
  }
  if (player.role === "percival") {
    const priests = secret.players.filter(item => item.role === "priest")
    if (priests.length) info.push(`教士是 ${priests.map(item => `${item.id}号`).join("、")}。`)
  }
  if (player.role === "outsider") {
    info.push(`你知道的其他邪恶方：${evils.filter(item => item.id !== player.id).map(item => `${item.id}号`).join("、")}`)
  }
  if (player.role === "lancelotGood" || player.role === "lancelotEvil") {
    const pair = secret.players.find(item => item.role === (player.role === "lancelotGood" ? "lancelotEvil" : "lancelotGood"))
    if (pair) info.push(`另一位兰斯洛特是 ${pair.id}号。`)
  }
  if (player.role === "hunter") info.push("你不知道邪恶队友；他们会在手机上得知你。")
  if (player.role === "shapeshifter") info.push("你不知道邪恶队友，他们也不知道你。")
  return info
}

// 本人有权回看的护身符查验记录。
// 只给「对外显示的阵营」，绝不给真实阵营——捣乱者和骗徒的伪装必须一直有效。
// 守卫按规则额外知道本局第一次查验的对外结果。
function myInspectionHistory(secret, player) {
  return (secret.amuletHistory || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => item.ownerId === player.id || (player.role === "guard" && index === 0))
    .map(({ item }) => ({
      round: item.round,
      ownerId: item.ownerId,
      targetId: item.targetId,
      displayedFaction: item.displayedFaction
    }))
}

// 本人历轮打出的任务牌，供自己回看（其他人永远看不到）。
function myVoteHistory(secret, player) {
  return Object.keys(secret.votes || {})
    .map(Number)
    .filter(round => Object.prototype.hasOwnProperty.call(secret.votes[String(round)], String(player.id)))
    .sort((a, b) => a - b)
    .map(round => ({ round, value: secret.votes[String(round)][String(player.id)] }))
}

function privateView(game, secret, openid) {
  const player = playerForOpenId(secret, openid)
  if (!player) return null
  const currentVotes = secret.votes[String(game.round)] || {}
  const finalSubmission = secret.finalSubmissions[String(player.id)] || null
  const amulet = game.amulet
  const inspection = secret.currentInspection || null
  let inspectionResult = null
  if (amulet && inspection && amulet.status === "result" && (amulet.ownerId === player.id || (player.role === "guard" && amulet.firstOfGame))) {
    inspectionResult = inspection.displayedFaction
  }
  return {
    id: player.id,
    role: player.role,
    roleName: player.roleName,
    artVariant: player.artVariant || 0,
    faction: player.faction,
    factionName: player.faction === "good" ? "正义方" : "邪恶方",
    nightInfo: privateNightInfo(game, secret, player),
    // 供「我的密录」随时回看：身份、首夜信息之外，还要能查到自己的查验与出牌
    inspectionHistory: myInspectionHistory(secret, player),
    voteHistory: myVoteHistory(secret, player),
    voteOptions: legalVoteOptions(game, player),
    needsLeaderClaim: player.id === game.firstLeaderId && player.role === "deceiver",
    leaderClaimSubmitted: player.id === game.firstLeaderId && player.role === "deceiver" && !!secret.priestClaim,
    leaderClaim: player.id === game.firstLeaderId && player.role === "deceiver" ? (secret.priestClaim || "") : "",
    hasVoted: Object.prototype.hasOwnProperty.call(currentVotes, String(player.id)),
    inspectionOptions: player.role === "deceiver" ? ["good", "evil"] : [displayedFaction(player)],
    isInspectionTarget: !!amulet && !!inspection && amulet.status === "claim" && inspection.targetId === player.id,
    inspectionResult,
    finalSubmitted: !!finalSubmission || !!(player.role === "traitor" && secret.traitorDecision && secret.traitorDecision.side === "good"),
    finalSubmission,
    hunterVoteSubmitted: Object.prototype.hasOwnProperty.call(secret.hunterVotes || {}, String(player.id)),
    traitorDecision: player.role === "traitor" && secret.traitorDecision ? { side: secret.traitorDecision.side, targets: secret.traitorDecision.targets || [] } : null,
    canClaimGalahad: player.role === "galahad" && !player.hasLed && !player.hadAmulet && game.evilWins === 2 && game.missions.length > 0 && game.missions[game.missions.length - 1].winner === "evil" && !game.galahadLeaderId
  }
}

function resolveMission(game, secret) {
  const votes = secret.votes[String(game.round)] || {}
  const values = Object.keys(votes).map(key => votes[key])
  const failCount = values.filter(value => value === "fail").length
  const protectedRound = game.missionPreset.protectedRounds.indexOf(game.round) >= 0
  const winner = failCount >= (protectedRound ? 2 : 1) ? "evil" : "good"
  game.missions.push({
    round: game.round,
    leaderId: game.leaderId,
    team: game.current.team.slice(),
    magicTargetId: game.current.magicTargetId,
    failCount,
    successCount: values.length - failCount,
    protectedRound,
    winner
  })
  game[`${winner}Wins`] += 1
  if (game.evilWins >= 3) {
    const revealer = secret.players.find(player => player.role === "revealer")
    if (revealer) revealer.revealed = true
  }
  game.current.voteCount = values.length
  syncPublicPlayers(game, secret)
  return winner
}

function needsAmulet(playerCount, completedRound) {
  if (playerCount === 6) return completedRound === 2
  if (playerCount === 7) return completedRound === 2 || completedRound === 3
  return playerCount >= 8 && completedRound >= 2 && completedRound <= 4
}

function shouldEnterFinale(game) {
  return game.goodWins >= 3 || game.evilWins >= 3
}

function enterFinale(game, secret, now) {
  const hunter = secret.players.find(player => player.role === "hunter")
  secret.finalHunterId = hunter ? hunter.id : null
  game.final = {
    trigger: game.goodWins >= 3 ? "goodMissions" : "evilMissions",
    stage: "discussion",
    discussionEndsAt: now + 5 * 60 * 1000,
    hunterRevealed: false,
    submittedCount: 0
  }
}

function hunterResult(game, secret, targets) {
  const targetPlayers = targets.map(id => getPlayer(secret, id))
  if (targetPlayers.some(player => !player)) throw new Error("猎杀目标不存在")
  const first = getPlayer(secret, targets[0])
  const priests = secret.players.filter(player => player.role === "priest")
  const allGood = targets.length === 2 && targets.every(id => getPlayer(secret, id).faction === "good")
  const priestIncluded = !priests.length || priests.some(priest => targets.indexOf(priest.id) >= 0)
  const success = !!first && first.role === "arthur" || (allGood && priestIncluded)
  game.final.hunterTargets = targets
  game.final.hunterSuccess = success
  game.final.stage = "resolved"
  game.winner = success ? "evil" : "good"
}

function findFinaleCorrection(secret, traitorConverted) {
  const revealedExcluded = secret.players.filter(player => player.role === "revealer" && player.revealed).map(player => player.id)
  const required = secret.players.filter(player => player.faction === "evil" && revealedExcluded.indexOf(player.id) < 0).map(player => player.id)
  const allowed = secret.players.filter(player => player.faction === "evil").map(player => player.id)
  const traitor = secret.players.find(player => player.role === "traitor")
  if (traitorConverted && traitor && required.indexOf(traitor.id) < 0) required.push(traitor.id)
  const goodPlayers = secret.players.filter(player => player.faction === "good")
  const fixedHands = []
  const flexibleHands = []
  goodPlayers.forEach(player => {
    const submission = secret.finalSubmissions[String(player.id)]
    if (!submission) return
    submission.targets.forEach((targetId, index) => {
      const hand = { playerId: player.id, role: player.role, hand: index + 1, targetId }
      if (player.role === "apprentice" && index === 1) flexibleHands.push(hand)
      else fixedHands.push(hand)
    })
  })
  const dukeCount = goodPlayers.filter(player => player.role === "duke").length
  const archdukeCount = goodPlayers.filter(player => player.role === "archduke").length
  const wrongHands = fixedHands.filter(hand => allowed.indexOf(hand.targetId) < 0)
  const allowedHands = fixedHands.filter(hand => allowed.indexOf(hand.targetId) >= 0)
  const coverage = allowedHands.reduce((counts, hand) => {
    counts[hand.targetId] = (counts[hand.targetId] || 0) + 1
    return counts
  }, {})
  const missing = required.filter(id => !coverage[id])
  const donorHands = []
  const keptByTarget = {}
  allowedHands.forEach(hand => {
    if (required.indexOf(hand.targetId) < 0) {
      donorHands.push(hand)
      return
    }
    keptByTarget[hand.targetId] = (keptByTarget[hand.targetId] || 0) + 1
    if (keptByTarget[hand.targetId] > 1) donorHands.push(hand)
  })
  const minArchOnWrong = Math.max(0, wrongHands.length - dukeCount)
  const maxArchOnWrong = Math.min(archdukeCount, wrongHands.length)
  for (let archOnWrong = minArchOnWrong; archOnWrong <= maxArchOnWrong; archOnWrong += 1) {
    const removeCount = wrongHands.length - archOnWrong
    const remainingArch = archdukeCount - archOnWrong
    const fillCapacity = flexibleHands.length + archOnWrong + Math.min(remainingArch, donorHands.length)
    if (missing.length > fillCapacity) continue
    const corrections = []
    wrongHands.slice(0, removeCount).forEach(hand => corrections.push(`公爵移除${hand.playerId}号的一只手`))
    let missingIndex = 0
    wrongHands.slice(removeCount).forEach(hand => {
      const targetId = missing[missingIndex] || allowed[0]
      if (missing[missingIndex]) missingIndex += 1
      corrections.push(`大公将${hand.playerId}号的一只手改指${targetId}号`)
    })
    flexibleHands.forEach(() => {
      if (!missing[missingIndex]) return
      corrections.push(`学徒补指${missing[missingIndex]}号`)
      missingIndex += 1
    })
    donorHands.slice(0, remainingArch).forEach(hand => {
      if (!missing[missingIndex]) return
      corrections.push(`大公将${hand.playerId}号的一只手改指${missing[missingIndex]}号`)
      missingIndex += 1
    })
    if (missingIndex >= missing.length) return { success: true, corrections }
  }
  return { success: false, corrections: [] }
}

module.exports = {
  roleInfo,
  roleArtVariants,
  assignArtVariants,
  missionPresets,
  validateSettings,
  createGame,
  publicPlayer,
  syncPublicPlayers,
  getPlayer,
  playerForOpenId,
  legalVoteOptions,
  automaticVote,
  displayedFaction,
  privateView,
  resolveMission,
  needsAmulet,
  shouldEnterFinale,
  enterFinale,
  hunterResult,
  findFinaleCorrection
}
