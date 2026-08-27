const cloud = require("wx-server-sdk")
const core = require("./gameCore")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const command = db.command
const rooms = db.collection("avalon_rooms")
const secrets = db.collection("avalon_game_secrets")

function fail(message) {
  const error = new Error(message)
  error.code = "AVALON_RULE_ERROR"
  throw error
}

function cleanName(value) {
  return String(value || "").trim().slice(0, 12) || "无名骑士"
}

// 房间存活时长；超时后房间码可被回收，加入时也不再命中。
// 注意：avalon_rooms 需要为 code 建立索引，否则房间数增长后查重会变慢。
const ROOM_TTL_MS = 12 * 60 * 60 * 1000

function roomUsable(room, now) {
  if (!room) return false
  if (room.status === "finished") return false
  return !room.expiresAt || Number(room.expiresAt) > now
}

// 按房间码取当前有效房间。历史上同一房间码可能被多次分配，
// 这里同时返回“只找到已失效房间”的情形，便于给出更准确的提示。
async function roomsByCode(code, now) {
  const result = await rooms.where({ code: String(code || "") }).limit(20).get()
  const all = result.data || []
  const usable = all.filter(room => roomUsable(room, now))
  usable.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
  return { room: usable[0] || null, onlyStale: !usable.length && all.length > 0 }
}

// 随机生成房间码并查重，避免与仍然有效的房间冲突。
async function allocateCode(now) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const found = await roomsByCode(code, now)
    if (!found.room) return code
  }
  fail("房间码暂时分配不出来，请稍后重试")
}

// 皮肤在建房时选定并写死，开局后不可更改——否则同一局里不同玩家会看到不同卡背。
// 任务牌与身份牌是两条独立的轴，可以自由组合。
const missionSkins = ["a", "b", "c", "d"]
const roleSkins = ["painted", "fantasy", "woodcut"]

function pickSkin(value, allowed) {
  return allowed.indexOf(String(value)) >= 0 ? String(value) : allowed[0]
}

// 测试骑士相关能力只在开发版房间开放，避免正式对局被误触破坏。
function requireDevRoom(room) {
  if (!room || !room.devMode) fail("测试骑士功能仅在开发版可用")
}

const tableRegions = ["top", "right", "bottom", "left"]

function defaultSeatLayout(playerCount) {
  return { top: 0, right: Math.floor(playerCount / 2), bottom: 0, left: Math.ceil(playerCount / 2) }
}

function seatLayoutFor(playerCount, tableType, value, legacySides) {
  if (tableType !== "long") return null
  const source = value || legacySides
  if (!source) return defaultSeatLayout(playerCount)
  const layout = {
    top: Number(source.top || 0) + Number(source.topLeft || 0) + Number(source.topRight || 0),
    right: Number(source.right || 0),
    bottom: Number(source.bottom || 0) + Number(source.bottomLeft || 0) + Number(source.bottomRight || 0),
    left: Number(source.left || 0)
  }
  const valid = tableRegions.every(region => Number.isInteger(layout[region]) && layout[region] >= 0)
  const total = tableRegions.reduce((sum, region) => sum + layout[region], 0)
  if (!valid || total !== playerCount) fail("长桌座位必须全部分配")
  return layout
}

function publicSettings(payload) {
  return {
    roleCounts: payload.roleCounts || {},
    unknownRoles: !!payload.unknownRoles,
    hunterVoteVariant: !!payload.hunterVoteVariant
  }
}

// 房间被清理或 id 失效时，给出稳定文案，方便客户端识别并把玩家送回首页，
// 而不是落到「服务器开小差了」这种无法处理的兜底错误里。
const ROOM_GONE_MESSAGE = "房间不存在或已结束"

async function loadState(roomId) {
  const [roomResult, secretResult] = await Promise.all([
    rooms.doc(roomId).get().catch(() => ({ data: null })),
    secrets.doc(roomId).get().catch(() => ({ data: null }))
  ])
  if (!roomResult.data || !secretResult.data) fail(ROOM_GONE_MESSAGE)
  return { room: roomResult.data, secret: secretResult.data }
}

async function transactState(roomId, handler) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.runTransaction(async transaction => {
        const transactionRooms = transaction.collection("avalon_rooms")
        const transactionSecrets = transaction.collection("avalon_game_secrets")
        const room = (await transactionRooms.doc(roomId).get().catch(() => ({ data: null }))).data
        const secret = (await transactionSecrets.doc(roomId).get().catch(() => ({ data: null }))).data
        if (!room || !secret) fail(ROOM_GONE_MESSAGE)
        return handler({ room, secret }, transactionRooms.doc(roomId), transactionSecrets.doc(roomId))
      })
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || error)
      if (attempt === 2 || message.indexOf("TransactionConflict") < 0) throw error
      await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)))
    }
  }
  throw new Error("事务重试失败")
}

function isHost(secret, openid) {
  return secret.hostOpenid === openid
}

function requireHost(secret, openid) {
  if (!isHost(secret, openid)) fail("只有房主可以执行该操作")
}

function requirePlayer(secret, openid) {
  const player = core.playerForOpenId(secret, openid)
  if (!player) fail("你不在本局座位中")
  return player
}

function resultView(room, secret, openid) {
  const ownSeatNo = Object.keys(secret.seatBindings || {}).find(key => secret.seatBindings[key] === openid)
  const safeRoom = {
    ...room,
    seats: (room.seats || []).map(seat => ({
      ...seat,
      isMine: Number(ownSeatNo) === seat.seatNo
    }))
  }
  const privateView = room.game && secret.players ? core.privateView(room.game, secret, openid) : null
  if (privateView && isHost(secret, openid)) {
    const roundVotes = secret.votes && room.game ? (secret.votes[String(room.game.round)] || {}) : {}
    privateView.botVotedIds = Object.keys(roundVotes).map(Number).filter(id => {
      const player = core.getPlayer(secret, id)
      return player && player.bot
    })
    const botHunter = secret.players.find(player => player.role === "hunter" && player.bot)
    privateView.canControlBotHunter = !!botHunter && !!room.devMode
  }
  return {
    room: safeRoom,
    private: privateView,
    isHost: isHost(secret, openid)
  }
}

function defaultTargets(secret, playerId) {
  const others = secret.players.filter(player => player.id !== playerId)
  return others.slice(0, 2).map(player => player.id)
}

function seedBotFinalSubmissions(secret) {
  secret.players.filter(player => player.bot && player.role !== "traitor").forEach(player => {
    const key = String(player.id)
    if (!secret.finalSubmissions[key]) secret.finalSubmissions[key] = { targets: defaultTargets(secret, player.id) }
  })
  const botTraitor = secret.players.find(player => player.bot && player.role === "traitor")
  if (botTraitor && !secret.traitorDecision) secret.traitorDecision = { side: "evil", targets: [] }
  if (botTraitor && !secret.finalSubmissions[String(botTraitor.id)]) {
    secret.finalSubmissions[String(botTraitor.id)] = { targets: defaultTargets(secret, botTraitor.id) }
  }
}

function resolveFinalIdentify(game, secret, room) {
  seedBotFinalSubmissions(secret)
  const traitor = secret.players.find(player => player.role === "traitor")
  const traitorConverted = !!(traitor && secret.traitorDecision && secret.traitorDecision.converted)
  const requiredPlayers = secret.players.filter(player => !(traitorConverted && player.role === "traitor"))
  const requiredCount = requiredPlayers.length
  game.final.submittedCount = requiredPlayers.filter(player => !!secret.finalSubmissions[String(player.id)]).length
  if (game.final.submittedCount < requiredCount) return
  const correction = core.findFinaleCorrection(secret, traitorConverted)
  if (traitorConverted) traitor.faction = "good"
  game.final.stage = "resolved"
  game.final.identifySuccess = correction.success
  game.final.corrections = correction.corrections
  game.winner = correction.success ? "good" : "evil"
  room.status = "finished"
  room.phase = "result"
}

function continueWithoutHunt(game, secret, room) {
  if (game.final.trigger === "goodMissions") {
    game.final.stage = "resolved"
    game.winner = "good"
    room.status = "finished"
    room.phase = "result"
    return
  }
  game.final.stage = "identify"
  resolveFinalIdentify(game, secret, room)
}

function revealHunter(game, secret) {
  game.final.stage = "hunterTargets"
  game.final.hunterRevealed = true
  const hunter = core.getPlayer(secret, secret.finalHunterId)
  if (hunter) hunter.revealed = true
  core.syncPublicPlayers(game, secret)
}

function advanceBotFinale(game, secret, room) {
  const final = game.final
  if (!final) return
  if (final.stage === "hunterVote") {
    secret.players.filter(player => player.bot).forEach(player => {
      if (!secret.hunterVotes[String(player.id)]) secret.hunterVotes[String(player.id)] = "success"
    })
    final.hunterVoteCount = Object.keys(secret.hunterVotes).length
    if (final.hunterVoteCount >= game.playerCount) {
      const failures = Object.values(secret.hunterVotes).filter(value => value === "fail").length
      final.hunterVoteFailures = failures
      final.stage = failures >= 2 ? "hunterTargets" : "identify"
      final.hunterRevealed = failures >= 2
      if (final.hunterRevealed) {
        const hunter = core.getPlayer(secret, secret.finalHunterId)
        if (hunter) hunter.revealed = true
        core.syncPublicPlayers(game, secret)
      } else continueWithoutHunt(game, secret, room)
    }
  }
  if (final.stage === "identify") resolveFinalIdentify(game, secret, room)
}

function autoResolveBotAmulet(game, secret, room) {
  const amulet = game.amulet
  if (!amulet) return
  const owner = core.getPlayer(secret, amulet.ownerId)
  if (!owner || !owner.bot) return
  // 逐步模式下不替 bot 自动验人：房主要能一步一步看清每个环节，
  // 由他点「让测试骑士行动」再走（走的还是随机，不是房主替它挑）。
  // 绑的是 stepMode 而不是 devMode——devMode 房间也可能只想让它一口气跑完。
  if (room.stepMode) return
  const target = secret.players.find(player => player.id !== owner.id && !player.hadAmulet && !player.fadedAmulet)
  if (!target) fail("没有可供护身符查验的玩家")
  secret.currentInspection = { targetId: target.id, displayedFaction: core.displayedFaction(target) }
  amulet.status = "result"
  target.fadedAmulet = true
  secret.firstAmuletUsed = true
  secret.amuletHistory = (secret.amuletHistory || []).concat({ round: game.round, ownerId: owner.id, targetId: target.id, displayedFaction: secret.currentInspection.displayedFaction, trueFaction: target.faction })
  game.amuletHistory = (game.amuletHistory || []).concat({ round: game.round, ownerId: owner.id, targetId: target.id })
  core.syncPublicPlayers(game, secret)
  room.phase = "mission"
}

// 测试房间：算出「当前该由哪个测试骑士走、随机走成什么样」，交给前端去调对应的 action。
//
// 只算不执行，是刻意的——执行仍旧走 startVote / handoff / selectAmuletTarget 那几个
// 原有入口，它们的合法性校验一条都不会被绕过。改成在这里直接改状态的话，
// 等于把规则判断抄第二遍，迟早两边走样。
async function botSuggest(event, openid) {
  const state = await loadState(event.roomId)
  requireHost(state.secret, openid)
  if (!state.room.devMode) fail("只有测试房间可以让测试骑士自动行动")
  const room = state.room
  const game = room.game
  const secret = state.secret
  if (!game) fail("对局还没开始")
  const pick = list => list[Math.floor(Math.random() * list.length)]
  const leader = core.getPlayer(secret, game.leaderId)

  if (room.phase === "mission") {
    if (!leader || !leader.bot) fail("当前队长不是测试骑士")
    const size = game.missionPreset.sizes[game.round - 1]
    const pool = secret.players.map(player => player.id)
    const team = []
    while (team.length < size && team.length < pool.length) {
      const id = pick(pool)
      if (team.indexOf(id) < 0) team.push(id)
    }
    return { action: "startVote", payload: { team, magicTargetId: pick(team) }, label: `${leader.name} 组队` }
  }

  if (room.phase === "vote") {
    return { action: "submitBotVotes", payload: {}, label: "测试骑士出牌" }
  }

  if (room.phase === "missionResult") {
    if (!leader || !leader.bot) fail("当前队长不是测试骑士")
    const candidates = secret.players.filter(player => !player.hasLed && !player.hadAmulet)
    if (!candidates.length) fail("没有可以接任队长的玩家")
    const nextLeaderId = game.galahadLeaderId || pick(candidates).id
    const payload = { nextLeaderId }
    if (core.needsAmulet(game.playerCount, game.round)) {
      // 字段名必须是 handoff 实际读取的 amuletOwnerId。
      // 踩过：写成前端 data 的 nextAmuletId，服务端读不到，
      // 报「本轮必须指定护身符持有者」——建议明明带了人，字段名不对等于没带。
      const holders = secret.players.filter(player => !player.hasLed && !player.hadAmulet && player.id !== nextLeaderId)
      if (!holders.length) fail("没有可以接受护身符的玩家")
      payload.amuletOwnerId = pick(holders).id
    }
    return { action: "handoff", payload, label: `${leader.name} 交接皇冠` }
  }

  if (room.phase === "amulet" && game.amulet) {
    const owner = core.getPlayer(secret, game.amulet.ownerId)
    if (!owner || !owner.bot) fail("持符者不是测试骑士")
    // 查验分两步：先选目标，出结果后再收起护身符。两步都要房主点一次。
    if (game.amulet.status === "result") {
      return { action: "completeAmulet", payload: {}, label: `${owner.name} 收起护身符` }
    }
    if (game.amulet.status !== "select") fail("护身符正在等待被查验者表态")
    const targets = secret.players.filter(player => player.id !== owner.id && !player.hadAmulet && !player.fadedAmulet)
    if (!targets.length) fail("没有可供查验的玩家")
    return { action: "selectAmuletTarget", payload: { targetId: pick(targets).id }, label: `${owner.name} 查验` }
  }

  fail("当前阶段没有需要测试骑士决定的事")
}

// 给客户端签发资产的下载链接。
//
// 为什么需要它：云存储权限是「仅创建者可读写」（个人版环境改权限要付费），
// 于是 <image src="cloud://"> 和 wx.cloud.downloadFile 只有上传者本人能用，
// 其他任何账号（多账号调试的虚拟用户、朋友的手机）全是裂图。
// 云函数在服务端以**管理员身份**运行，不受存储权限限制——由它签链接，
// 客户端用普通 https 下载落地，之后一律读本地文件。
// 签名链接约 10 分钟过期，但只在下载那一刻用一次，过期无所谓。
async function assetUrls(event) {
  const ids = (event.fileIDs || [])
    .filter(id => typeof id === "string" && /^cloud:\/\/[^/]+\/assets\//.test(id))
    .slice(0, 20)   // 一次最多 20 个，够任何页面用；防止拿它当通用签名器
  if (!ids.length) fail("没有可签发的资产")
  const res = await cloud.getTempFileURL({ fileList: ids })
  return { urls: (res.fileList || []).map(item => ({ fileID: item.fileID, url: item.tempFileURL || "" })) }
}

async function createRoom(event, openid) {
  const playerCount = Number(event.playerCount)
  if (playerCount < 5 || playerCount > 10) fail("当前支持5至10人局")
  const tableType = event.tableType === "round" ? "round" : "long"
  const seatLayout = seatLayoutFor(playerCount, tableType, event.seatLayout, event.tableSides)
  const now = Date.now()
  const code = await allocateCode(now)
  const roomData = {
    schemaVersion: 1,
    code,
    status: "lobby",
    playerCount,
    devMode: !!event.devMode,
    // 逐步模式：bot 不自动行动，等房主点按钮，方便一步步看清每个环节
    stepMode: !!event.devMode && !!event.stepMode,
    hostRole: event.devMode ? String(event.hostRole || "") : "",
    missionSkin: pickSkin(event.missionSkin, missionSkins),
    roleSkin: pickSkin(event.roleSkin, roleSkins),
    settings: publicSettings(event),
    tableType,
    tableTypeName: tableType === "long" ? "长桌" : "圆桌",
    seatLayout,
    seats: Array.from({ length: playerCount }, (_, index) => ({ seatNo: index + 1, name: "", bot: false })),
    phase: "lobby",
    game: {},
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ROOM_TTL_MS
  }
  const created = await rooms.add({ data: roomData })
  await secrets.doc(created._id).set({
    data: {
      hostOpenid: openid,
      seatBindings: {},
      players: [],
      createdAt: now,
      updatedAt: now
    }
  })
  return { roomId: created._id, code }
}

async function findRoom(event, openid) {
  const found = await roomsByCode(event.code, Date.now())
  if (!found.room) return { room: null, reason: found.onlyStale ? "expired" : "notFound" }
  const secret = (await secrets.doc(found.room._id).get()).data
  return { room: found.room, isHost: isHost(secret, openid) }
}

async function getState(event, openid) {
  const state = await loadState(event.roomId)
  return resultView(state.room, state.secret, openid)
}

async function takeSeat(event, openid) {
  return transactState(event.roomId, async (state, roomDoc, secretDoc) => {
    if (state.room.status !== "lobby") fail("游戏已经开始")
    const seatNo = Number(event.seatNo)
    if (seatNo < 1 || seatNo > state.room.playerCount) fail("座位不存在")
    const occupiedBy = Object.keys(state.secret.seatBindings || {}).find(key => Number(key) === seatNo && state.secret.seatBindings[key] !== openid)
    if (occupiedBy) fail("座位已被选择")
    const previousBindings = state.secret.seatBindings || {}
    const bindings = { ...previousBindings }
    Object.keys(bindings).forEach(key => { if (bindings[key] === openid) delete bindings[key] })
    bindings[String(seatNo)] = openid
    const seats = state.room.seats.map(seat => {
      if (seat.seatNo === seatNo) return { ...seat, name: cleanName(event.name), bot: false }
      if (previousBindings[String(seat.seatNo)] === openid) return { ...seat, name: "", bot: false }
      return seat
    })
    const now = Date.now()
    await roomDoc.update({ data: { seats, updatedAt: now } })
    await secretDoc.update({ data: { seatBindings: bindings, updatedAt: now } })
    state.room.seats = seats
    state.secret.seatBindings = bindings
    return resultView(state.room, state.secret, openid)
  })
}

async function fillBots(event, openid) {
  return transactState(event.roomId, async (state, roomDoc) => {
    requireHost(state.secret, openid)
    requireDevRoom(state.room)
    if (state.room.status !== "lobby") fail("游戏已经开始")
    const seats = state.room.seats.map(seat => seat.name ? seat : { ...seat, name: `测试骑士${seat.seatNo}`, bot: true })
    await roomDoc.update({ data: { seats, updatedAt: Date.now() } })
    state.room.seats = seats
    return resultView(state.room, state.secret, openid)
  })
}

async function updateSettings(event, openid) {
  const state = await loadState(event.roomId)
  requireHost(state.secret, openid)
  if (state.room.status !== "lobby") fail("开局后不能修改角色")
  const settings = publicSettings(event)
  await rooms.doc(event.roomId).update({ data: { settings, updatedAt: Date.now() } })
  state.room.settings = settings
  return resultView(state.room, state.secret, openid)
}

async function startGame(event, openid) {
  const state = await loadState(event.roomId)
  requireHost(state.secret, openid)
  if (state.room.status !== "lobby") fail("游戏已经开始")
  if (state.room.seats.filter(seat => seat.name).length !== state.room.playerCount) fail("人还没有坐满")
  const seats = state.room.seats.map(seat => ({
    ...seat,
    openid: seat.bot ? "" : state.secret.seatBindings[String(seat.seatNo)] || ""
  }))
  if (seats.some(seat => !seat.bot && !seat.openid)) fail("有真人座位缺少微信身份绑定")
  const wantedLeader = Number(event.firstLeaderSeatNo) || 0
  if (wantedLeader && !seats.some(seat => seat.seatNo === wantedLeader && seat.name)) {
    fail("指定的首任队长座位上没有人")
  }
  core.validateSettings({ ...state.room.settings, playerCount: state.room.playerCount })
  // 测试房间可以指定房主自己的角色，方便复现特定角色的问题
  const hostSeatNo = Object.keys(state.secret.seatBindings || {})
    .find(key => state.secret.seatBindings[key] === state.secret.hostOpenid)
  const built = core.createGame(
    { ...state.room.settings, playerCount: state.room.playerCount },
    seats,
    {
      hostRole: state.room.devMode ? state.room.hostRole : "",
      hostSeatNo: hostSeatNo ? Number(hostSeatNo) : 0,
      // 房主在候场页可以指定首任队长；不指定就是随机（默认）
      firstLeaderSeatNo: Number(event.firstLeaderSeatNo) || 0
    }
  )
  const botIds = built.secret.players.filter(player => player.bot).map(player => player.id)
  built.publicGame.identity.readyIds = botIds.slice()
  built.publicGame.identity.rememberedIds = botIds.slice()
  built.secret.hostOpenid = state.secret.hostOpenid
  built.secret.seatBindings = state.secret.seatBindings
  const firstLeader = core.getPlayer(built.secret, built.publicGame.firstLeaderId)
  // 只有 bot 自动填。真人首任队长一律自己点一次——包括非骗徒，
  // 否则「谁在点手机」就把骗徒身份泄出去了（见 privateView 里的说明）。
  if (firstLeader.bot) built.secret.priestClaim = core.displayedFaction(firstLeader)
  const roomUpdate = {
    status: "playing",
    phase: "reveal",
    game: command.set(built.publicGame),
    updatedAt: Date.now()
  }
  await Promise.all([
    rooms.doc(event.roomId).update({ data: roomUpdate }),
    secrets.doc(event.roomId).set({ data: { ...built.secret, updatedAt: Date.now() } })
  ])
  return resultView({ ...state.room, ...roomUpdate, game: built.publicGame }, built.secret, openid)
}

async function identityAction(event, openid) {
  return transactState(event.roomId, async (state, roomDoc, secretDoc) => {
    const player = requirePlayer(state.secret, openid)
    const game = state.room.game
    if (state.room.phase !== "reveal") fail("当前不是身份确认阶段")
    const identity = game.identity
    if (event.action === "identityReady" && identity.readyIds.indexOf(player.id) < 0) identity.readyIds.push(player.id)
    if (event.action === "identityClaim") {
      if (["good", "evil"].indexOf(event.claim) < 0) fail("展示阵营选择不合法")
      if (player.id !== game.firstLeaderId) fail("只有首任队长需要选择展示阵营")
      if (!identity.revealAt || Date.now() < identity.revealAt) fail("身份尚未揭示")
      if (state.secret.priestClaim) fail("展示阵营已经提交")
      // 非骗徒只能亮真实阵营。界面已经置灰了另一个，这里再挡一层——
      // 前端置灰是提示，不是校验。
      const claimLeader = core.getPlayer(state.secret, game.firstLeaderId)
      if (claimLeader && claimLeader.role !== "deceiver" && event.claim !== core.displayedFaction(claimLeader)) {
        fail("只能展示你真实的阵营")
      }
      state.secret.priestClaim = event.claim
    }
    if (event.action === "startIdentity") {
      requireHost(state.secret, openid)
      if (identity.revealAt) fail("身份已经开始揭示")
      if (identity.readyIds.length < game.playerCount) fail("还有玩家未准备好")
      identity.revealAt = Date.now() + 3000
      identity.closeAt = identity.revealAt + 40000
    }
    if (event.action === "identityRemembered") {
      if (!identity.closeAt || Date.now() < identity.closeAt) fail("身份阅读时间尚未结束")
      const firstLeader = core.getPlayer(state.secret, game.firstLeaderId)
      if (firstLeader && firstLeader.id === player.id && !state.secret.priestClaim) fail("请先选择要展示的阵营")
      if (identity.rememberedIds.indexOf(player.id) < 0) identity.rememberedIds.push(player.id)
    }
    const now = Date.now()
    await roomDoc.update({ data: { game: command.set(game), updatedAt: now } })
    await secretDoc.update({ data: { priestClaim: state.secret.priestClaim || null, updatedAt: now } })
    state.room.game = game
    return resultView(state.room, state.secret, openid)
  })
}

async function advancePhase(event, openid) {
  const state = await loadState(event.roomId)
  requireHost(state.secret, openid)
  let phase = state.room.phase
  if (event.action === "enterNight") {
    if (state.room.phase !== "reveal" || !state.room.game.identity.closeAt || Date.now() < state.room.game.identity.closeAt) fail("身份确认尚未结束")
    if (state.room.game.identity.rememberedIds.length < state.room.playerCount) fail("还有玩家未确认身份")
    phase = "night"
  }
  if (event.action === "enterMission") {
    if (state.room.phase !== "night") fail("当前不能开始远征")
    phase = "mission"
  }
  await rooms.doc(event.roomId).update({ data: { phase, updatedAt: Date.now() } })
  state.room.phase = phase
  return resultView(state.room, state.secret, openid)
}

async function missionAction(event, openid) {
  const state = await loadState(event.roomId)
  const game = state.room.game
  const player = requirePlayer(state.secret, openid)
  const leader = core.getPlayer(state.secret, game.leaderId)
  if (player.id !== game.leaderId && !(isHost(state.secret, openid) && leader && leader.bot)) fail("只有当前队长可以组队")
  if (state.room.phase !== "mission") fail("当前不是组队阶段")
  const team = (event.team || []).map(Number)
  const required = game.missionPreset.sizes[game.round - 1]
  if (team.length !== required || new Set(team).size !== required) fail(`本轮需要${required}名同行骑士`)
  if (team.some(id => !core.getPlayer(state.secret, id))) fail("队伍中包含无效座位")
  const magicTargetId = Number(event.magicTargetId)
  if (team.indexOf(magicTargetId) < 0) fail("魔法指示物只能给同行骑士")
  game.current = { team, magicTargetId, voteCount: 0, votedIds: [] }
  state.secret.votes[String(game.round)] = {}
  state.room.phase = "vote"
  await Promise.all([
    rooms.doc(event.roomId).update({ data: { game: command.set(game), phase: "vote", updatedAt: Date.now() } }),
    secrets.doc(event.roomId).update({ data: { votes: state.secret.votes, updatedAt: Date.now() } })
  ])
  return resultView(state.room, state.secret, openid)
}

async function submitVote(event, openid, botPlayerId) {
  return transactState(event.roomId, async (state, roomDoc, secretDoc) => {
    const game = state.room.game
    // 权限校验先于状态校验：正式房间不该因为“阶段不对”才拒绝测试能力。
    if (botPlayerId) {
      requireHost(state.secret, openid)
      requireDevRoom(state.room)
    }
    if (state.room.phase !== "vote") fail("当前不是任务投票阶段")
    let player = null
    if (botPlayerId) {
      player = core.getPlayer(state.secret, botPlayerId)
      if (!player || !player.bot) fail("该座位不是测试骑士")
    } else player = requirePlayer(state.secret, openid)
    if (game.current.team.indexOf(player.id) < 0) fail("你不在本轮任务队伍中")
    const options = core.legalVoteOptions(game, player)
    if (options.indexOf(event.value) < 0) fail("该角色不能打出这张任务牌")
    const roundVotes = state.secret.votes[String(game.round)] || {}
    if (Object.prototype.hasOwnProperty.call(roundVotes, String(player.id))) fail("你已经投过票")
    roundVotes[String(player.id)] = event.value
    state.secret.votes[String(game.round)] = roundVotes
    game.current.voteCount = Object.keys(roundVotes).length
    game.current.votedIds = Object.keys(roundVotes).map(Number)
    if (game.current.voteCount >= game.current.team.length) {
      core.resolveMission(game, state.secret)
      if (core.shouldEnterFinale(game)) {
        const hunter = state.secret.players.find(item => item.role === "hunter")
        if (game.goodWins >= 3 && !hunter) {
          game.winner = "good"
          state.room.status = "finished"
          state.room.phase = "result"
        } else {
          core.enterFinale(game, state.secret, Date.now())
          state.room.phase = "finale"
        }
      } else state.room.phase = "missionResult"
    }
    const now = Date.now()
    await roomDoc.update({ data: { game: command.set(game), phase: state.room.phase, status: state.room.status, updatedAt: now } })
    await secretDoc.update({ data: { votes: state.secret.votes, players: state.secret.players, finalHunterId: state.secret.finalHunterId || null, updatedAt: now } })
    return resultView(state.room, state.secret, openid)
  })
}

async function submitBotVotes(event, openid) {
  return transactState(event.roomId, async (state, roomDoc, secretDoc) => {
    requireHost(state.secret, openid)
    requireDevRoom(state.room)
    const game = state.room.game
    if (state.room.phase !== "vote") fail("当前不是任务投票阶段")
    const roundVotes = state.secret.votes[String(game.round)] || {}
    const bots = game.current.team
      .map(id => core.getPlayer(state.secret, id))
      .filter(player => player && player.bot && !Object.prototype.hasOwnProperty.call(roundVotes, String(player.id)))
    if (!bots.length) fail("本轮没有待投票的测试骑士")
    bots.forEach(player => {
      roundVotes[String(player.id)] = core.automaticVote(game, player)
    })
    state.secret.votes[String(game.round)] = roundVotes
    game.current.voteCount = Object.keys(roundVotes).length
    game.current.votedIds = Object.keys(roundVotes).map(Number)
    if (game.current.voteCount >= game.current.team.length) {
      core.resolveMission(game, state.secret)
      if (core.shouldEnterFinale(game)) {
        const hunter = state.secret.players.find(item => item.role === "hunter")
        if (game.goodWins >= 3 && !hunter) {
          game.winner = "good"
          state.room.status = "finished"
          state.room.phase = "result"
        } else {
          core.enterFinale(game, state.secret, Date.now())
          state.room.phase = "finale"
        }
      } else state.room.phase = "missionResult"
    }
    const now = Date.now()
    await roomDoc.update({ data: { game: command.set(game), phase: state.room.phase, status: state.room.status, updatedAt: now } })
    await secretDoc.update({ data: { votes: state.secret.votes, players: state.secret.players, finalHunterId: state.secret.finalHunterId || null, updatedAt: now } })
    return resultView(state.room, state.secret, openid)
  })
}

async function handoff(event, openid) {
  const state = await loadState(event.roomId)
  const game = state.room.game
  const actor = requirePlayer(state.secret, openid)
  const currentLeader = core.getPlayer(state.secret, game.leaderId)
  if (actor.id !== game.leaderId && !(isHost(state.secret, openid) && currentLeader && currentLeader.bot)) fail("只有当前队长可以移交皇冠")
  if (state.room.phase !== "missionResult") fail("当前不能交接领袖")
  const nextLeader = core.getPlayer(state.secret, game.galahadLeaderId || event.nextLeaderId)
  if (!nextLeader) fail("下一位领袖不存在")
  if (nextLeader.hasLed) fail("该玩家已担任过队长")
  if (nextLeader.hadAmulet) fail("该玩家曾持有护身符，不能接任队长")
  const completedRound = game.round
  const needAmulet = core.needsAmulet(game.playerCount, completedRound)
  let amuletOwner = null
  if (needAmulet) {
    amuletOwner = core.getPlayer(state.secret, event.amuletOwnerId)
    if (!amuletOwner) fail("本轮必须指定护身符持有者")
    if (amuletOwner.id === nextLeader.id || amuletOwner.hasLed || amuletOwner.hadAmulet) fail("该玩家不能获得护身符")
    amuletOwner.hadAmulet = true
  }
  nextLeader.hasLed = true
  if (game.round === 4 && nextLeader.role === "boaster") nextLeader.revealed = true
  game.leaderId = nextLeader.id
  game.round += 1
  game.galahadLeaderId = null
  game.current = { team: [], magicTargetId: null, voteCount: 0, votedIds: [] }
  if (needAmulet) {
    const noPreviousAmulet = !state.secret.firstAmuletUsed
    game.amulet = { ownerId: amuletOwner.id, status: "select", firstOfGame: noPreviousAmulet }
    state.room.phase = "amulet"
    state.secret.currentInspection = null
  } else {
    game.amulet = null
    state.room.phase = "mission"
  }
  autoResolveBotAmulet(game, state.secret, state.room)
  core.syncPublicPlayers(game, state.secret)
  await Promise.all([
    rooms.doc(event.roomId).update({ data: { game: command.set(game), phase: state.room.phase, updatedAt: Date.now() } }),
    secrets.doc(event.roomId).update({ data: { players: state.secret.players, currentInspection: command.set(state.secret.currentInspection || null), firstAmuletUsed: !!state.secret.firstAmuletUsed, amuletHistory: state.secret.amuletHistory || [], updatedAt: Date.now() } })
  ])
  return resultView(state.room, state.secret, openid)
}

async function claimGalahad(event, openid) {
  return transactState(event.roomId, async (state, roomDoc, secretDoc) => {
    const game = state.room.game
    const player = requirePlayer(state.secret, openid)
    const lastMission = game.missions[game.missions.length - 1]
    if (state.room.phase !== "missionResult" || player.role !== "galahad" || player.hasLed || player.hadAmulet || game.evilWins !== 2 || !lastMission || lastMission.winner !== "evil") fail("当前不能发动加拉哈德能力")
    if (game.galahadLeaderId) fail("已有加拉哈德接管皇冠")
    player.revealed = true
    game.galahadLeaderId = player.id
    core.syncPublicPlayers(game, state.secret)
    const now = Date.now()
    await roomDoc.update({ data: { game: command.set(game), updatedAt: now } })
    await secretDoc.update({ data: { players: state.secret.players, updatedAt: now } })
    return resultView(state.room, state.secret, openid)
  })
}

async function amuletAction(event, openid) {
  const state = await loadState(event.roomId)
  const game = state.room.game
  const amulet = game.amulet
  if (state.room.phase !== "amulet" || !amulet) fail("当前没有进行中的护身符")
  const player = requirePlayer(state.secret, openid)
  if (event.action === "selectAmuletTarget") {
    const owner = core.getPlayer(state.secret, amulet.ownerId)
    // 持符者是测试骑士时，房主可以代它提交（目标由服务端随机给出，见 botSuggest）
    const asBot = isHost(state.secret, openid) && owner && owner.bot && state.room.devMode
    if (player.id !== amulet.ownerId && !asBot) fail("只有护身符持有者可以选择查验目标")
    const target = core.getPlayer(state.secret, event.targetId)
    if (!target || target.id === amulet.ownerId || target.hadAmulet || target.fadedAmulet) fail("该玩家不能被查验")
    state.secret.currentInspection = { targetId: target.id, displayedFaction: null }
    amulet.status = "claim"
    if (target.bot) {
      target.fadedAmulet = true
      state.secret.currentInspection.displayedFaction = core.displayedFaction(target)
      amulet.status = "result"
      state.secret.firstAmuletUsed = true
      state.secret.amuletHistory = (state.secret.amuletHistory || []).concat({ round: game.round, ownerId: amulet.ownerId, targetId: target.id, displayedFaction: state.secret.currentInspection.displayedFaction, trueFaction: target.faction })
      game.amuletHistory = (game.amuletHistory || []).concat({ round: game.round, ownerId: amulet.ownerId, targetId: target.id })
      core.syncPublicPlayers(game, state.secret)
    }
  }
  if (event.action === "inspectionClaim") {
    if (!state.secret.currentInspection || player.id !== state.secret.currentInspection.targetId || amulet.status !== "claim") fail("你不是当前被查验者")
    const options = player.role === "deceiver" ? ["good", "evil"] : [core.displayedFaction(player)]
    if (options.indexOf(event.claim) < 0) fail("展示阵营选择不合法")
    player.fadedAmulet = true
    state.secret.currentInspection.displayedFaction = event.claim
    amulet.status = "result"
    state.secret.firstAmuletUsed = true
    state.secret.amuletHistory = (state.secret.amuletHistory || []).concat({ round: game.round, ownerId: amulet.ownerId, targetId: player.id, displayedFaction: event.claim, trueFaction: player.faction })
    game.amuletHistory = (game.amuletHistory || []).concat({ round: game.round, ownerId: amulet.ownerId, targetId: player.id })
    core.syncPublicPlayers(game, state.secret)
  }
  if (event.action === "completeAmulet") {
    // 同 selectAmuletTarget：持符者是测试骑士时，房主可以代它收起护身符
    const holder = core.getPlayer(state.secret, amulet.ownerId)
    const asHolder = player.id === amulet.ownerId ||
      (isHost(state.secret, openid) && holder && holder.bot && state.room.devMode)
    if (!asHolder || amulet.status !== "result") fail("查验结果尚未就绪")
    state.room.phase = "mission"
  }
  await Promise.all([
    rooms.doc(event.roomId).update({ data: { game: command.set(game), phase: state.room.phase, updatedAt: Date.now() } }),
    secrets.doc(event.roomId).update({ data: { players: state.secret.players, currentInspection: command.set(state.secret.currentInspection || null), firstAmuletUsed: !!state.secret.firstAmuletUsed, amuletHistory: state.secret.amuletHistory || [], updatedAt: Date.now() } })
  ])
  return resultView(state.room, state.secret, openid)
}

async function finaleAction(event, openid) {
  return transactState(event.roomId, async (state, roomDoc, secretDoc) => {
    const game = state.room.game
    const final = game.final
    if (state.room.phase !== "finale" || !final) fail("当前不是终局")
    const player = requirePlayer(state.secret, openid)
  if (event.action === "finishDiscussion") {
    requireHost(state.secret, openid)
    if (Date.now() < final.discussionEndsAt && !event.force) fail("终局5分钟讨论尚未结束")
    if (!state.secret.finalHunterId) final.stage = "identify"
    else if (final.trigger === "goodMissions") revealHunter(game, state.secret)
    else if (state.room.settings.hunterVoteVariant) final.stage = "hunterVote"
    else final.stage = "hunterDecision"
    advanceBotFinale(game, state.secret, state.room)
  }
  if (event.action === "hunterVote") {
    if (final.stage !== "hunterVote") fail("当前不是猎杀投票阶段")
    if (state.secret.hunterVotes[String(player.id)]) fail("你已经投过猎杀票")
    const allowed = player.faction === "good" ? ["success"] : ["success", "fail"]
    if (allowed.indexOf(event.value) < 0) fail("该角色不能打出这张票")
    state.secret.hunterVotes[String(player.id)] = event.value
    final.hunterVoteCount = Object.keys(state.secret.hunterVotes).length
    advanceBotFinale(game, state.secret, state.room)
  }
  if (event.action === "hunterDecision") {
    const hunter = core.getPlayer(state.secret, state.secret.finalHunterId)
    const controlsBotHunter = !!(hunter && hunter.bot && state.room.devMode && isHost(state.secret, openid))
    if ((player.id !== state.secret.finalHunterId && !controlsBotHunter) || final.stage !== "hunterDecision") fail("只有盲眼杀手可以做出该决定")
    if (final.trigger === "goodMissions" && !event.hunt) fail("正义方三次任务成功后必须发动猎杀")
    if (event.hunt) {
      revealHunter(game, state.secret)
    } else {
      continueWithoutHunt(game, state.secret, state.room)
    }
  }
  if (event.action === "hunterTargets") {
    const hunter = core.getPlayer(state.secret, state.secret.finalHunterId)
    const controlsBotHunter = !!(hunter && hunter.bot && state.room.devMode && isHost(state.secret, openid))
    if ((player.id !== state.secret.finalHunterId && !controlsBotHunter) || final.stage !== "hunterTargets") fail("当前不能提交猎杀目标")
    const targets = (event.targets || []).map(Number)
    if (targets.length !== 2 || new Set(targets).size !== 2) fail("请选择两位不同玩家")
    if (targets.some(id => !core.getPlayer(state.secret, id))) fail("猎杀目标不存在")
    core.hunterResult(game, state.secret, targets)
    state.room.status = "finished"
    state.room.phase = "result"
  }
  if (event.action === "traitorDecision") {
    if (player.role !== "traitor" || final.stage !== "identify") fail("当前无法选择叛徒阵营")
    if (["evil", "good"].indexOf(event.side) < 0) fail("叛徒选择不合法")
    if (event.side === "good") {
      const targets = (event.targets || []).map(Number)
      if (targets.length !== 2 || new Set(targets).size !== 2 || targets.some(id => !core.getPlayer(state.secret, id))) fail("请选择两位不同玩家")
      const converted = targets.every(id => core.getPlayer(state.secret, id).faction === "good")
      state.secret.traitorDecision = { side: "good", targets, converted }
      state.secret.finalSubmissions[String(player.id)] = { targets }
    } else state.secret.traitorDecision = { side: "evil", targets: [], converted: false }
  }
  if (event.action === "finalIdentify") {
    if (final.stage !== "identify") fail("当前不能提交最后指认")
    const targets = (event.targets || []).map(Number)
    if (targets.length !== 2 || new Set(targets).size !== 2) fail("每位玩家需要私密指认两位玩家")
    if (state.secret.finalSubmissions[String(player.id)]) fail("你已经提交过最后指认")
    state.secret.finalSubmissions[String(player.id)] = { targets }
    final.submittedCount = Object.keys(state.secret.finalSubmissions).length
    resolveFinalIdentify(game, state.secret, state.room)
  }
    if (state.room.status !== "finished") advanceBotFinale(game, state.secret, state.room)
    const now = Date.now()
    await roomDoc.update({ data: { game: command.set(game), phase: state.room.phase, status: state.room.status, updatedAt: now } })
    await secretDoc.update({ data: {
      players: state.secret.players,
      hunterVotes: state.secret.hunterVotes,
      finalSubmissions: state.secret.finalSubmissions,
      traitorDecision: command.set(state.secret.traitorDecision || null),
      finalHunterId: state.secret.finalHunterId || null,
      updatedAt: now
    } })
    return resultView(state.room, state.secret, openid)
  })
}

async function getResult(event, openid) {
  const state = await loadState(event.roomId)
  if (state.room.status !== "finished") fail("本局尚未结束")
  return {
    room: state.room,
    players: state.secret.players.map(player => ({
      id: player.id,
      name: player.name,
      title: player.title,
      role: player.role,
      roleName: player.roleName,
      artVariant: player.artVariant || 0,
      faction: player.faction,
      factionName: player.faction === "good" ? "正义方" : "邪恶方"
    })),
    isHost: isHost(state.secret, openid)
  }
}

async function dispatch(event, openid) {
  switch (event.action) {
    case "createRoom": return createRoom(event, openid)
    case "findRoom": return findRoom(event, openid)
    case "getState": return getState(event, openid)
    case "takeSeat": return takeSeat(event, openid)
    case "fillBots": return fillBots(event, openid)
    case "updateSettings": return updateSettings(event, openid)
    case "startGame": return startGame(event, openid)
    case "identityReady":
    case "identityClaim":
    case "startIdentity":
    case "identityRemembered": return identityAction(event, openid)
    case "enterNight":
    case "enterMission": return advancePhase(event, openid)
    case "startVote": return missionAction(event, openid)
    case "submitVote": return submitVote(event, openid)
    case "submitBotVote": return submitVote(event, openid, Number(event.playerId))
    case "submitBotVotes": return submitBotVotes(event, openid)
    case "claimGalahad": return claimGalahad(event, openid)
    case "handoff": return handoff(event, openid)
    case "selectAmuletTarget":
    case "inspectionClaim":
    case "completeAmulet": return amuletAction(event, openid)
    case "finishDiscussion":
    case "hunterVote":
    case "hunterDecision":
    case "hunterTargets":
    case "traitorDecision":
    case "finalIdentify": return finaleAction(event, openid)
    case "botSuggest": return botSuggest(event, openid)
    case "assetUrls": return assetUrls(event)
    case "getResult": return getResult(event, openid)
    default: fail("未知游戏操作")
  }
}

exports.main = async event => {
  const openid = cloud.getWXContext().OPENID
  try {
    return await dispatch(event, openid)
  } catch (error) {
    // 规则错误的文案本身就是写给玩家看的，原样抛出。
    if (error && error.code === "AVALON_RULE_ERROR") throw error
    // 其余错误（数据库、网络、代码缺陷）可能带很长的堆栈，
    // 完整信息只留在云端日志，客户端只拿到短提示和可排查的 trace id。
    const traceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    console.error("[avalonGame] 未预期错误", JSON.stringify({
      traceId,
      action: event && event.action,
      roomId: event && event.roomId,
      openid,
      message: error && error.message,
      stack: error && error.stack
    }))
    const wrapped = new Error(`服务器开小差了，请重试（${traceId}）`)
    wrapped.code = "AVALON_INTERNAL_ERROR"
    throw wrapped
  }
}
