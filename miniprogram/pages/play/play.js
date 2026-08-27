const roomStore = require("../../utils/roomStore")
const gameUtil = require("../../utils/game")
const tableLayout = require("../../utils/tableLayout")
const roleGuideData = require("../../data/roleGuides")
const ttsData = require("../../data/ttsLines")
const assets = require("../../utils/assets")

const IDENTITY_READ_MS = 40000

const phaseNames = {
  reveal: "确认身份", night: "命运揭示", amulet: "护身符查验", mission: "组建远征",
  vote: "秘密投票", missionResult: "远征结算", finale: "终局之战"
}

Page({
  data: {
    roleArtVisible: false,
    voteSwap: false, claimSwap: false, hunterSwap: false, traitorSwap: false, leadClaimSwap: false,
    seatSize: 42,
    roomId: "", room: null, game: null, privateView: null, isHost: false,
    phase: "reveal", phaseName: "确认身份", myRole: null, myRoleGuide: roleGuideData.defaultGuide,
    roleVisible: false, identityMode: "prepare", identityCountdown: 3, identitySecondsLeft: 40,
    identityReady: false, identityRemembered: false, identityReadyCount: 0, identityRememberedCount: 0,
    leader: null, isLeader: false, missionSize: 0, protectedText: "", missionTrack: [],
    canControlLeader: false,
    tableOrientation: "horizontal",
    longTable: null, stageW: 0, stageH: 0,
    tableWidth: 44,
    tableHeight: 34,
    tableVisible: false, tableMode: "team", tableTitle: "选择出征成员", tableHint: "",
    historyVisible: false, historyMissions: [], historyAmulets: [],
    dossierVisible: false, myInspections: [], myVotes: [],
    waitingHint: null,
    decoratedPlayers: [], selectedTeam: [], magicTargetId: null, teamPlayers: [],
    nextLeaderId: null, nextAmuletId: null, needsAmulet: false,
    voteCount: 0, votePercent: 0, myVotePending: false,
    amulet: null, isAmuletOwner: false, isInspectionTarget: false, inspectionResultName: "",
    canClaimGalahad: false,
    finalStage: "", finalSelectionMode: "", finalSecondsLeft: 300, finalTargets: [], finalSubmitted: false,
    canOperateHunter: false,
    finalClock: "5:00", lastMission: null, myInTeam: false,
    canVoteSuccess: false, canVoteFail: false, canClaimGood: false, canClaimEvil: false,
    canLeadClaimGood: false, canLeadClaimEvil: false,
    hunterVoteValue: "", traitorSide: "", traitorTargets: [], voteChoice: "",
    deliverIcon: "", deliverFlying: false, deliverX: 50, deliverY: 50, deliverTargetId: 0,
    hasBots: false, botPlayers: [], debugVisible: false, syncing: false, devMode: false,
    stepMode: false, botPending: "",
    nextLeaderPlayer: null, nextAmuletPlayer: null, teamPulseId: 0, missionResultCards: [],
    missionCardBack: "", missionCardSuccess: "", missionCardFail: "",
    artRaw: {},
    myRoleArt: "", identityBackArt: "", cardFlipped: false, identityUnlocked: false, myInitial: "", readingHint: "", readingUrgent: false,
    ui: {},
    bannerVisible: false, bannerType: "", bannerSymbol: "", bannerText: "",
    ceremonyVisible: false, ceremonyType: "", ceremonySymbol: "", ceremonySymbolImage: "", ceremonyTitle: "",
    ceremonySubtitle: "", ceremonyTarget: null
  },

  pollTimer: null,
  clockTimer: null,
  ceremonyTimer: null,
  bannerTimer: null,
  nightTimer: null,
  selectionTimer: null,
  deliverTimer: null,
  ceremonyQueue: [],
  loading: false,
  stateGeneration: 0,

  onLoad(options) {
    this.windowWidth = (wx.getSystemInfoSync() || {}).windowWidth || 375
    // 图标集是常量，下发一次即可——放进 applyState 会被 900ms 轮询带着每轮重推
    const ui = assets.uiIcons()
    this.setData({ roomId: options.roomId, ui })
    // 地毯在云端，同样落到本地再用，免得每次开面板重下
    assets.localCopy(ui.floor).then(local => {
      if (local !== ui.floor) this.setData({ "ui.floor": local })
    })
    this.loadState(true)
    this.startTimers()
  },

  // 切后台停表，回到前台立刻补一次拉取：锁屏或切微信聊天回来后
  // 不用等下一个轮询周期，也能马上追上其他玩家的进度。
  onReady() {
    this.measureStage()
  },

  onShow() {
    if (!this.data.roomId || this.fatalHandled) return
    this.startTimers()
    this.loadState(false)
  },

  onHide() { this.stopTimers() },

  startTimers() {
    this.stopTimers()
    this.pollTimer = setInterval(() => this.loadState(false), 900)
    this.clockTimer = setInterval(() => this.updateClock(), 200)
  },

  stopTimers() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.clockTimer) clearInterval(this.clockTimer)
    this.pollTimer = null
    this.clockTimer = null
  },

  onUnload() {
    this.stopTimers()
    if (this.ceremonyTimer) clearTimeout(this.ceremonyTimer)
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
    if (this.nightTimer) clearTimeout(this.nightTimer)
    if (this.selectionTimer) clearTimeout(this.selectionTimer)
    if (this.deliverTimer) clearTimeout(this.deliverTimer)
  },

  // 云端图解析成本地路径后替换上屏。守卫：值没变不 setData（applyState 每 900ms 一轮）。
  resolveRemoteArts(roleSkin, role, artVariant) {
    const wants = {
      myRoleArt: assets.roleArt(roleSkin, role, artVariant),
      identityBackArt: assets.identityBack(roleSkin),
      "ui.floor": assets.uiIcons().floor
    }
    // 原始 fileID 留给 binderror 兜底重签用
    if (this.data.artRaw.myRoleArt !== wants.myRoleArt) {
      this.setData({ artRaw: { myRoleArt: wants.myRoleArt, identityBackArt: wants.identityBackArt, floor: wants["ui.floor"] } })
    }
    Object.keys(wants).forEach(field => {
      const fileID = wants[field]
      if (!fileID) return
      assets.localCopy(fileID).then(path => {
        const current = field === "ui.floor" ? (this.data.ui || {}).floor : this.data[field]
        if (current === path) return
        const patch = {}
        patch[field] = path
        this.setData(patch)
      })
    })
  },

  loadState(showError) {
    if (this.loading || this.data.syncing) return Promise.resolve()
    const generation = this.stateGeneration
    this.loading = true
    return roomStore.getState(this.data.roomId).then(result => {
      if (generation !== this.stateGeneration || this.data.syncing) return
      this.applyState(result)
    }).catch(error => {
      if (this.handleRoomGone(error)) return
      // 轮询时不弹窗（会打断线下讨论），但一定要留日志：
      // applyState 抛异常的表现是整页白屏，静默吞掉就完全无从查起。
      console.error("[play] loadState 失败", error && (error.message || error))
      if (showError) this.showError(error)
    }).finally(() => { this.loading = false })
  },

  // 房间被清理或已结束时轮询会持续失败，停表并把玩家送回首页。
  handleRoomGone(error) {
    if (!/房间不存在|已结束/.test(error && error.message || "")) return false
    if (this.fatalHandled) return true
    this.fatalHandled = true
    this.stopTimers()
    wx.showModal({
      title: "房间已失效",
      content: "这个房间不存在或已经结束。",
      confirmText: "返回首页",
      showCancel: false,
      complete: () => wx.reLaunch({ url: "/pages/index/index" })
    })
    return true
  },

  applyState(result) {
    const room = result.room
    if (room.status === "finished") return this.leaveTo(`/pages/result/result?roomId=${room._id}`)
    // 房间还没开局就进了对局页（分享链接、房间被重置、后退回来），
    // 此时 room.game 是个没有 players 的空壳，往下走会在 game.players.map 上炸，
    // 而整页外层是 wx:if="{{game}}"，炸了就是白屏。送回候场页才是对的。
    if (room.status === "lobby") return this.leaveTo(`/pages/room/room?roomId=${room._id}`)
    const game = room.game
    if (!game || !game.players) return
    const previousGame = this.data.game
    const previousPhase = this.data.phase
    const privateView = result.private || {}
    const phaseChanged = this.data.phase !== room.phase
    const tableType = room.tableType || "round"
    const decoratedPlayers = game.players.map((player, index) => ({
      ...player,
      ...tableLayout.seatPosition(index, game.players.length, tableType, room.seatLayout, room.tableSides),
      selected: this.data.selectedTeam.indexOf(player.id) >= 0,
      finalSelected: this.data.finalTargets.indexOf(player.id) >= 0,
      initial: player.name ? player.name.slice(0, 1) : String(player.id),
      avatar: assets.avatarArt(this.data.roomId, player.id),
      canLead: !player.hasLed && !player.hadAmulet,
      canReceiveAmulet: !player.hasLed && !player.hadAmulet,
      canInspect: !player.hadAmulet && !player.fadedAmulet && (!game.amulet || player.id !== game.amulet.ownerId)
    }))
    const leader = decoratedPlayers.find(player => player.id === game.leaderId) || null
    // 以房间创建时写入的测试模式为准；服务端对每个测试操作另有独立校验，
    // 客户端这里只负责不显示入口。
    const devMode = !!room.devMode
    const pendingBots = decoratedPlayers.filter(player => player.bot
      && game.current.team.indexOf(player.id) >= 0
      && (privateView.botVotedIds || []).indexOf(player.id) < 0)
    const identity = game.identity || { readyIds: [], rememberedIds: [] }
    const amulet = game.amulet || null
    const myRole = privateView.role ? gameUtil.getRoleInfo(privateView.role) : null
    const missionSize = gameUtil.currentMissionSize(game)
    const needsAmulet = gameUtil.shouldGiveAmulet(game.playerCount, game.round)
    const finalStage = game.final ? game.final.stage : ""
    const finalStageChanged = this.data.finalStage !== finalStage
    const retainedTraitorSide = finalStageChanged ? "" : this.data.traitorSide
    const finalSelectionMode = this.resolveFinalSelectionMode(finalStage, privateView, retainedTraitorSide)
    const lastMission = game.missions.length ? game.missions[game.missions.length - 1] : null
    const ceremonies = this.buildStateCeremonies(previousGame, previousPhase, game, room.phase, decoratedPlayers)
    const tableGeometry = tableLayout.tableGeometry(tableLayout.normalizeLayout(game.players.length, room.seatLayout, room.tableSides))
    // dossier 必须先建：远征记录要用它的 myVotes 标出自己那一轮打的牌。
    // 顺序写反的话 applyState 会在这里抛 TypeError，而 game 还没 setData，
    // 于是外层 wx:if="{{game}}" 永远不成立——整个对局页白屏。
    const dossier = this.buildDossier(privateView, decoratedPlayers)
    // 密录和「本局思路」里直接写着自己的角色和阵营。身份揭示前点开就等于提前看牌，
    // 所以这两个入口在本人翻牌之前必须关掉（对局阶段不受影响，那时早就看过了）。
    const identityUnlocked = room.phase !== "reveal" || this.data.cardFlipped
    // 状态印里绝不能出现身份图（卡背也不行，等于把牌又摆了一遍）。
    // 放自己的座位头像：有个人标识，又不泄露任何身份信息。
    const mySeat = decoratedPlayers.find(player => Number(player.id) === Number(privateView.id))
    const myInitial = mySeat ? mySeat.initial : ""
    const history = this.buildGameHistory(game, decoratedPlayers, dossier.myVotes)
    const waitingHint = this.buildWaitingHint(room, game, decoratedPlayers)
    // 皮肤在房间创建时定死，同局所有玩家取同一套图
    const missionSkin = room.missionSkin || "a"
    const roleSkin = room.roleSkin || "painted"
    // 立绘变体号由服务端在发牌时分配，保证同局同角色不重复
    const myRoleArt = assets.roleArt(roleSkin, privateView.role, privateView.artVariant)
    this.setData({
      room, game, privateView, isHost: !!result.isHost, phase: room.phase, phaseName: phaseNames[room.phase] || "圆桌进行中",
      myRole, myRoleGuide: privateView.role ? roleGuideData.getRoleGuide(privateView.role) : roleGuideData.defaultGuide,
      identityReady: identity.readyIds.indexOf(privateView.id) >= 0,
      identityRemembered: identity.rememberedIds.indexOf(privateView.id) >= 0,
      identityReadyCount: identity.readyIds.length, identityRememberedCount: identity.rememberedIds.length,
      canClaimGood: (privateView.inspectionOptions || []).indexOf("good") >= 0,
      canClaimEvil: (privateView.inspectionOptions || []).indexOf("evil") >= 0,
      // 首任队长的展示选项：骗徒两个都能点，其余人只有真实那个能点
      canLeadClaimGood: (privateView.leaderClaimOptions || []).indexOf("good") >= 0,
      canLeadClaimEvil: (privateView.leaderClaimOptions || []).indexOf("evil") >= 0,
      leader, isLeader: privateView.id === game.leaderId,
      devMode,
      stepMode: !!room.stepMode,
      // 逐步模式下，轮到测试骑士行动时给房主一个按钮，而不是替它做决定
      botPending: this.describeBotPending(room, game, privateView, !!result.isHost),
      // 逐步模式下 bot 队长的「代选」入口要关掉——那正是用户不要的"房主替它选"；
      // 组队走推进条的随机建议。自己当队长时不受影响。
      canControlLeader: privateView.id === game.leaderId || (!!result.isHost && !!leader && !!leader.bot && devMode && !room.stepMode),
      missionSize, protectedText: gameUtil.isProtectedRound(game) ? "本轮需要2张失败票" : "",
      missionTrack: this.buildMissionTrack(game), decoratedPlayers,
      tableOrientation: tableGeometry.orientation,
      tableWidth: tableGeometry.width,
      tableHeight: tableGeometry.height,
      voteCount: game.current.voteCount || 0,
      votePercent: game.current.team.length ? Math.round((game.current.voteCount || 0) / game.current.team.length * 100) : 0,
      amulet, isAmuletOwner: !!amulet && amulet.ownerId === privateView.id,
      isInspectionTarget: !!privateView.isInspectionTarget,
      inspectionResultName: privateView.inspectionResult ? gameUtil.factionLabel(privateView.inspectionResult) : "",
      canClaimGalahad: !!privateView.canClaimGalahad,
      finalStage, finalSelectionMode, traitorSide: retainedTraitorSide, finalSubmitted: !!privateView.finalSubmitted,
      canOperateHunter: privateView.role === "hunter" || !!privateView.canControlBotHunter,
      lastMission,
      missionResultCards: this.buildMissionResultCards(lastMission),
      myInTeam: game.current.team.indexOf(privateView.id) >= 0,
      canVoteSuccess: (privateView.voteOptions || []).indexOf("success") >= 0,
      canVoteFail: (privateView.voteOptions || []).indexOf("fail") >= 0,
      hasBots: devMode && pendingBots.length > 0,
      botPlayers: devMode ? pendingBots : [],
      tableVisible: phaseChanged ? (room.phase === "mission" && (privateView.id === game.leaderId || (!!result.isHost && !!leader && !!leader.bot && devMode && !room.stepMode))) : this.data.tableVisible,
      tableMode: phaseChanged && room.phase === "mission" ? "team" : this.data.tableMode,
      tableTitle: phaseChanged && room.phase === "mission" ? "选择出征成员" : this.data.tableTitle,
      tableHint: phaseChanged && room.phase === "mission" ? `选择${missionSize}名出征成员` : this.data.tableHint,
      selectedTeam: phaseChanged ? game.current.team.slice() : this.data.selectedTeam,
      magicTargetId: phaseChanged ? game.current.magicTargetId : this.data.magicTargetId,
      finalTargets: phaseChanged || finalStageChanged ? [] : this.data.finalTargets,
      nextLeaderId: phaseChanged ? null : this.data.nextLeaderId,
      nextAmuletId: phaseChanged ? null : this.data.nextAmuletId,
      needsAmulet,
      historyMissions: history.missions,
      historyAmulets: history.amulets,
      myInspections: dossier.myInspections,
      waitingHint,
      myRoleArt: this.data.myRoleArt || myRoleArt,
      identityUnlocked,
      myInitial,
      // 图在第一次真正显示时才开始下载，于是每换一个阶段都要白等一次。
      // 这里把本局用得到的图挂进一个 0 尺寸的隐藏容器，进对局页就先下完，
      // 轮到显示时直接命中缓存。只放本局真的会用到的，不整批预热。
      identityBackArt: this.data.identityBackArt || assets.identityBack(roleSkin),
      missionCardBack: assets.missionCard(missionSkin, "back"),
      missionCardSuccess: assets.missionCard(missionSkin, "success"),
      missionCardFail: assets.missionCard(missionSkin, "fail"),
      myVotes: dossier.myVotes,
      syncing: false
    })
    const myId = privateView.id || 0
    const round = (game && game.round) || 0
    this.setData({
      voteSwap: gameUtil.choiceSwapped(room.roomId, "vote", round, myId),
      claimSwap: gameUtil.choiceSwapped(room.roomId, "claim", round, myId),
      leadClaimSwap: gameUtil.choiceSwapped(room.roomId, "leadclaim", round, myId),
      hunterSwap: gameUtil.choiceSwapped(room.roomId, "hunter", myId),
      traitorSwap: gameUtil.choiceSwapped(room.roomId, "traitor", myId)
    })
    this.refreshLongTable()
    this.resolveRemoteArts(roleSkin, privateView.role, privateView.artVariant)
    this.refreshSelections()
    this.updateClock()
    this.enqueueCeremonies(ceremonies)
    if (phaseChanged) this.setData({ voteChoice: "" })
    if (phaseChanged && room.phase !== "reveal") {
      this.identityFlippedAt = 0
      this.setData({ cardFlipped: false })
    }
    if (phaseChanged && room.phase === "missionResult") this.vibrate(lastMission && lastMission.winner === "evil" ? "heavy" : "medium")
  },

  buildStateCeremonies(previousGame, previousPhase, game, phase, players) {
    if (!previousGame) return []
    const events = []
    const findPlayer = id => players.find(player => player.id === Number(id)) || null
    const previousFinalStage = previousGame.final && previousGame.final.stage
    const finalStage = game.final && game.final.stage
    if (previousPhase !== "finale" && phase === "finale") {
      const goodReachedThree = game.goodWins >= 3
      const finalMission = game.missions && game.missions[game.missions.length - 1]
      if (finalMission) events.push({
        type: finalMission.winner === "good" ? "mission-good" : "mission-evil",
        symbol: "",
        symbolImage: assets.packedAsset(finalMission.winner === "good" ? "crest-good.png" : "crest-evil.png"),
        title: `第 ${finalMission.round} 次远征${finalMission.winner === "good" ? "成功" : "失败"}`,
        subtitle: `成功 ${finalMission.successCount} 票 · 失败 ${finalMission.failCount} 票`,
        target: null
      })
      events.push({
        type: goodReachedThree ? "finale-good" : "finale-evil",
        symbol: "",
        symbolImage: assets.packedAsset(goodReachedThree ? "crest-good.png" : "crest-evil.png"),
        title: goodReachedThree ? "圣杯三度告捷" : "黑暗三度得手",
        subtitle: "常规远征结束，终局之战开启",
        target: null
      })
      return events
    }
    if (previousFinalStage !== "hunterTargets" && finalStage === "hunterTargets" && game.final.hunterRevealed) {
      const hunter = players.find(player => player.revealed) || null
      events.push({
        type: "hunter", symbol: "", symbolImage: assets.packedAsset("crest-evil.png"), title: "盲眼杀手现身",
        subtitle: hunter ? `${hunter.id}号 ${hunter.name} 发动最后猎杀` : "圆桌禁止交谈，等待最后猎杀",
        target: hunter
      })
      return events
    }
    if (previousGame.leaderId !== game.leaderId) {
      const target = findPlayer(game.leaderId)
      if (target) events.push({
        type: "crown", symbol: "👑", title: "皇冠易主",
        subtitle: `${target.id}号 ${target.name} 接掌远征`, target
      })
    }
    const previousAmuletId = previousGame.amulet && previousGame.amulet.ownerId
    const amuletId = game.amulet && game.amulet.ownerId
    if (amuletId && previousAmuletId !== amuletId) {
      const target = findPlayer(amuletId)
      if (target) events.push({
        type: "amulet", symbol: "🧿", title: "护身符授予",
        subtitle: `${target.id}号 ${target.name} 获得查验权`, target
      })
    }
    if (previousPhase === "mission" && phase === "vote" && game.current.magicTargetId) {
      const target = findPlayer(game.current.magicTargetId)
      if (target) events.push({
        type: "magic", symbol: "🔥", title: "火球落定",
        subtitle: `${target.id}号 ${target.name} 被魔法约束`, target
      })
    }
    const roundAdvanced = Number(previousGame.round) !== Number(game.round)
    if (phase === "mission" && (roundAdvanced || previousPhase === "night" || previousPhase === "amulet")) {
      events.push({
        type: "round", symbol: String(game.round), title: `第 ${game.round} 轮远征`,
        subtitle: `${game.missionPreset.sizes[game.round - 1]}名骑士即将出发${game.missionPreset.protectedRounds.indexOf(game.round) >= 0 ? " · 本轮需要两张失败牌" : ""}`,
        target: null
      })
    }
    return events
  },

  // 只有真正的节点值得打断全场（轮次开场、终局、猎杀现身）。
  // 皇冠交接、护身符、火球这类高频事件降级成顶部横幅：
  // 线下嘴炮才是主体，每人手机连弹三个全屏动画只会打断讨论。
  // 全部走顶部横幅，不再有全屏过场。
  // 轮次开场、几胜几负这类简单动画观感一般又打断线下讨论，先去掉；
  // 过场动画后续会重新设计，到时再决定哪些值得全屏。
  BANNER_TYPES: ["crown", "amulet", "magic", "round", "mission-good", "mission-evil",
    "finale-good", "finale-evil", "hunter"],

  enqueueCeremonies(events) {
    if (!events || !events.length) return
    const banners = events.filter(event => this.BANNER_TYPES.indexOf(event.type) >= 0)
    const fullscreen = events.filter(event => this.BANNER_TYPES.indexOf(event.type) < 0)
    if (banners.length) this.showBanner(banners[banners.length - 1])
    if (!fullscreen.length) return
    this.ceremonyQueue = this.ceremonyQueue.concat(fullscreen)
    if (!this.data.ceremonyVisible && !this.ceremonyTimer) this.playNextCeremony()
  },

  showBanner(event) {
    if (this.bannerTimer) clearTimeout(this.bannerTimer)
    this.setData({
      bannerVisible: true,
      bannerType: event.type,
      bannerSymbol: event.symbol,
      bannerText: event.subtitle || event.title
    })
    this.vibrate("light")
    this.bannerTimer = setTimeout(() => this.setData({ bannerVisible: false }), 2600)
  },

  playNextCeremony() {
    const ceremony = this.ceremonyQueue.shift()
    if (!ceremony) {
      this.ceremonyTimer = null
      return
    }
    this.setData({
      ceremonyVisible: true,
      ceremonyType: ceremony.type,
      ceremonySymbol: ceremony.symbol,
      ceremonyTitle: ceremony.title,
      ceremonySubtitle: ceremony.subtitle,
      ceremonyTarget: ceremony.target
    })
    this.vibrate("medium")
    this.ceremonyTimer = setTimeout(() => {
      this.setData({ ceremonyVisible: false })
      this.ceremonyTimer = setTimeout(() => this.playNextCeremony(), 180)
    }, 1450)
  },

  vibrate(type) {
    if (!wx.vibrateShort) return
    try { wx.vibrateShort({ type: type || "light" }) } catch (error) {}
  },

  buildMissionTrack(game) {
    return game.missionPreset.sizes.map((size, index) => {
      const round = index + 1
      const mission = game.missions.find(item => item.round === round)
      return {
        round, size,
        state: mission ? (mission.winner === "good" ? "success" : "fail") : (round === game.round ? "current" : "future"),
        // 四态各是一张完整图标（自带圆形外观），不再靠 CSS 圆框 + 汉字
        icon: mission
          ? (mission.winner === "good" ? assets.packedAsset("crest-good.png") : assets.packedAsset("crest-evil.png"))
          : (round === game.round ? assets.packedAsset("mission-current.png") : assets.packedAsset("mission-pending.png")),
        label: mission ? (mission.winner === "good" ? "成" : "败") : String(round),
        protected: game.missionPreset.protectedRounds.indexOf(round) >= 0
      }
    })
  },

  buildMissionResultCards(mission) {
    if (!mission) return []
    const cards = []
    for (let index = 0; index < Number(mission.successCount || 0); index += 1) cards.push({ id: `success-${index}`, value: "success", label: "成" })
    for (let index = 0; index < Number(mission.failCount || 0); index += 1) cards.push({ id: `fail-${index}`, value: "fail", label: "败" })
    return cards.map((card, index) => ({ ...card, delay: index * 150 }))
  },

  // 常驻「现在等谁」：8-10 人局最常见的卡顿是全场等一个人，但没人知道等谁。
  // 只用公开信息（谁提交过，不含提交内容），等价于线下交牌时本来就看得见的动作。
  buildWaitingHint(room, game, players) {
    const byId = id => players.find(item => Number(item.id) === Number(id))
    const nameOf = id => {
      const player = byId(id)
      return player ? `${player.id}号 ${player.name}` : `${id}号`
    }
    const listing = ids => {
      if (!ids.length) return ""
      if (ids.length <= 2) return ids.map(nameOf).join("、")
      return `${nameOf(ids[0])} 等 ${ids.length} 人`
    }
    const allIds = players.map(player => player.id)
    const identity = game.identity || { readyIds: [], rememberedIds: [] }
    const missing = done => allIds.filter(id => (done || []).indexOf(id) < 0)

    if (room.phase === "reveal") {
      if (!identity.revealAt) {
        const pending = missing(identity.readyIds)
        return pending.length ? { text: `等待 ${listing(pending)} 准备`, progress: `${identity.readyIds.length}/${allIds.length}` } : null
      }
      const pending = missing(identity.rememberedIds)
      return pending.length ? { text: `等待 ${listing(pending)} 确认身份`, progress: `${identity.rememberedIds.length}/${allIds.length}` } : null
    }
    if (room.phase === "mission") return { text: `等待 ${nameOf(game.leaderId)} 组建远征队`, progress: "" }
    if (room.phase === "vote") {
      const pending = (game.current.team || []).filter(id => (game.current.votedIds || []).indexOf(id) < 0)
      return pending.length
        ? { text: `等待 ${listing(pending)} 提交任务牌`, progress: `${game.current.voteCount || 0}/${(game.current.team || []).length}` }
        : null
    }
    if (room.phase === "missionResult") return { text: `等待 ${nameOf(game.galahadLeaderId || game.leaderId)} 交接皇冠`, progress: "" }
    if (room.phase === "amulet" && game.amulet) {
      if (game.amulet.status === "select") return { text: `等待 ${nameOf(game.amulet.ownerId)} 选择查验对象`, progress: "" }
      if (game.amulet.status === "claim") return { text: "等待被查验者选择展示阵营", progress: "" }
      return { text: `等待 ${nameOf(game.amulet.ownerId)} 收起护身符`, progress: "" }
    }
    if (room.phase === "finale" && game.final) {
      if (game.final.stage === "identify") {
        const submitted = Number(game.final.submittedCount || 0)
        return submitted < allIds.length ? { text: "等待全员提交最后指认", progress: `${submitted}/${allIds.length}` } : null
      }
      if (game.final.stage === "hunterVote") {
        const voted = Number(game.final.hunterVoteCount || 0)
        return { text: "等待全员提交猎杀票", progress: `${voted}/${allIds.length}` }
      }
      // 「等待盲眼杀手…」是说给别人听的。轮到本人（或房主代操作）时要换成行动指令，
      // 否则他会以为在等别人。
      const mine = this.data.canOperateHunter
      if (game.final.stage === "hunterDecision") {
        return { text: mine ? "请决定是否发动猎杀" : "等待盲眼杀手做出决定", progress: "" }
      }
      if (game.final.stage === "hunterTargets") {
        return { text: mine ? "请选择两位猎杀目标" : "等待盲眼杀手选择猎杀目标", progress: "" }
      }
    }
    return null
  },

  // 「身份信息」：把服务端下发的私密记录整理成可读文案。
  // 这里只用 privateView 里的数据，不做任何本地推断，避免显示出玩家本不该知道的信息。
  buildDossier(privateView, players) {
    const label = id => {
      const player = players.find(item => Number(item.id) === Number(id))
      return player ? `${player.id}号 ${player.name}` : `${id}号`
    }
    const myInspections = (privateView.inspectionHistory || []).map((item, index) => ({
      id: `${item.round}-${index}`,
      round: item.round,
      // 守卫看到的是别人查的那一次，所以要写清楚是谁查的
      text: Number(item.ownerId) === Number(privateView.id)
        ? `你查验了 ${label(item.targetId)}`
        : `${label(item.ownerId)} 查验了 ${label(item.targetId)}`,
      faction: item.displayedFaction,
      factionName: gameUtil.factionLabel(item.displayedFaction)
    }))
    const myVotes = (privateView.voteHistory || []).map(item => ({
      round: item.round,
      value: item.value,
      label: item.value === "success" ? "成功" : "失败"
    }))
    return { myInspections, myVotes }
  },

  buildGameHistory(game, players, myVotes) {
    const mine = {}
    ;(myVotes || []).forEach(item => { mine[item.round] = item })
    const byId = id => players.find(player => Number(player.id) === Number(id))
    const playerLabel = id => {
      const player = byId(id)
      return player ? `${player.id}号 ${player.name}` : `${id}号`
    }
    const missions = (game.missions || []).map(mission => ({
      round: mission.round,
      leader: playerLabel(mission.leaderId),
      team: (mission.team || []).map(playerLabel).join("、"),
      magic: playerLabel(mission.magicTargetId),
      result: mission.winner === "good" ? "远征成功" : "远征失败",
      resultClass: mission.winner === "good" ? "good" : "evil",
      votes: `成功 ${mission.successCount} · 失败 ${mission.failCount}`,
      // 自己那一轮打的牌直接标在该轮里，不再单独开一块（原来在密录里，太割裂）
      myVote: mine[mission.round] ? mine[mission.round].label : "",
      myVoteValue: mine[mission.round] ? mine[mission.round].value : ""
    }))
    const amulets = (game.amuletHistory || []).map((item, index) => ({
      id: `${item.round}-${index}`,
      round: item.round,
      owner: playerLabel(item.ownerId),
      target: playerLabel(item.targetId)
    }))
    return { missions, amulets }
  },

  updateClock() {
    const game = this.data.game
    if (!game) return
    const now = Date.now()
    if (this.data.phase === "reveal") {
      const identity = game.identity || {}
      let identityMode = "prepare"
      let roleVisible = false
      let identityCountdown = 3
      let identitySecondsLeft = 40
      // 阅读计时从「本人翻开牌」那一刻算起，不是从全局揭示时刻算起。
      // 否则没翻牌的人会被倒计时直接推到下一步，整局都没看到自己的身份。
      let readingHint = ""
      // 队长先选展示阵营，选完才全员揭示。这一段是那个「只有队长在动」的窗口：
      // 队长看到自己的牌和两个选项，其他人等着。
      // 顺序不能反——教士的首夜信息里写着「第一位领袖显示为X」，
      // 队长还没选就揭示的话，教士读到的是一句空话。
      if (identity.claimAt && !identity.revealAt) {
        const iAmLeader = (this.data.privateView || {}).needsLeaderClaim
        const next = { identityMode: iAmLeader ? "leaderClaim" : "waitLeaderClaim",
                       roleVisible: !!iAmLeader, identityCountdown: 3, identitySecondsLeft: 40,
                       readingHint: "", readingUrgent: false }
        if (Object.keys(next).some(key => this.data[key] !== next[key])) this.setData(next)
        return
      }
      if (identity.revealAt) {
        if (now < identity.revealAt) {
          // 不再做 3-2-1 倒计时：牌本来就要手动翻，等待感由牌背自己承担
          identityMode = "reading"
          readingHint = "翻开后开始计时"
        } else if (!this.data.cardFlipped) {
          // 还没翻牌就一直停在这一步，牌始终可点
          identityMode = "reading"
          readingHint = "翻开后开始计时"
        } else {
          // 全局窗口与「本人翻牌后 40 秒」取较晚者，翻得晚的人不会被压缩阅读时间
          const readEndsAt = Math.max(identity.closeAt, (this.identityFlippedAt || now) + IDENTITY_READ_MS)
          if (now < readEndsAt) {
            identityMode = "reading"
            roleVisible = true
            identitySecondsLeft = Math.max(0, Math.ceil((readEndsAt - now) / 1000))
            readingHint = `阅读时间 ${identitySecondsLeft}秒`
            // 最后 5 秒提醒一次。玩家很可能正埋在密录/攻略里，
            // 那儿是全屏浮层，会把外面的计时完全盖住。
            if (identitySecondsLeft <= 5 && this.lastUrgeSecond !== identitySecondsLeft) {
              this.lastUrgeSecond = identitySecondsLeft
              this.vibrate("light")
            }
          } else identityMode = "remember"
        }
      }
      // 只在真的变了才 setData。这个定时器 200ms 跑一次，无条件 setData 等于
    // 每秒白白推 5 次渲染，和别的更新抢通道。
    // 阅读时间到了**不再**强制收起密录。
    // 原先收是怕浮层挡住「我已记住」，但代价更大：阅读窗口只有 40 秒，
    // 读完「本局思路」基本必定超时，一超时浮层被关、身份牌同时收起，
    // 玩家就再也回不到身份大图了（实战中被抓到）。
    // 现在改成把「我已记住」搬进浮层里，就地读完就地确认。
    const next = { identityMode, roleVisible, identityCountdown, identitySecondsLeft, readingHint,
                   readingUrgent: identityMode === "reading" && roleVisible && identitySecondsLeft <= 5 }
    if (Object.keys(next).some(key => this.data[key] !== next[key])) this.setData(next)
    }
    if (this.data.finalStage === "discussion" && game.final) {
      const finalSecondsLeft = Math.max(0, Math.ceil((game.final.discussionEndsAt - now) / 1000))
      const minutes = Math.floor(finalSecondsLeft / 60)
      const seconds = finalSecondsLeft % 60
      this.setData({ finalSecondsLeft, finalClock: `${minutes}:${seconds < 10 ? "0" : ""}${seconds}` })
    }
  },

  confirmIdentity() {
    this.sendAction("identityReady")
  },

  submitLeaderClaim(event) {
    if (this.data.privateView.leaderClaimSubmitted) return
    const claim = event.currentTarget.dataset.faction
    this.sendAction("identityClaim", { claim })
  },

  startIdentity() { this.sendAction("startIdentity") },
  rememberIdentity() {
    // 这一步也可能是在「身份信息」浮层里点的（阅读时间在浮层开着时走完了）。
    // 点完必须把浮层收掉，否则按钮消失、画面不动，看着像没生效。
    return this.sendAction("identityRemembered").then(() => {
      if (this.data.dossierVisible) this.setData({ dossierVisible: false })
    })
  },

  // 身份牌大图：对局中随时点开自己的立绘看清楚，也方便给同桌看一眼。
  openRoleArt() {
    if (!this.data.identityUnlocked || !this.data.myRoleArt) return
    this.setData({ roleArtVisible: true })
  },
  closeRoleArt() { this.setData({ roleArtVisible: false }) },
  enterNight() { this.sendAction("enterNight") },

  // 首夜由房主逐条念、逐条推进。
  enterMission() { this.sendAction("enterMission") },

  // 长桌挑档要用**运行时实测的 stage 尺寸**：stage 宽随屏宽变而高固定，
  // 375pt 屏上长宽比 1.19、414pt 屏上 1.32，差 11%，写死会挑错档。
  measureStage(attempt) {
    // 防并发：refreshLongTable 每轮轮询都可能来催一次，别叠出一堆重试链
    if (!attempt && this.measuring) return
    this.measuring = true
    wx.createSelectorQuery().in(this).selectAll(".compact-stage").boundingClientRect(rects => {
      const rect = (rects || []).find(item => item && item.width > 0 && item.height > 0)
      if (!rect) {
        // 面板是 wx:if 出来的，setData 回调里布局往往还没完成，量到 0 就挑不出档、
        // 桌子整个不渲染（第一轮点「选择骑士」桌子不见了就是这么来的）。补量几次。
        if ((attempt || 0) < 5) return setTimeout(() => this.measureStage((attempt || 0) + 1), 120)
        this.measuring = false
        return
      }
      this.measuring = false
      if (rect.width === this.data.stageW && rect.height === this.data.stageH) {
        // 尺寸没变也要把挑档补完——owner 切换分支靠「重测」带动 refresh，
        // 这里静默 return 的话 refresh 主体就永远没人执行，longTable 卡在 null，
        // 桌子只剩 image 默认的 320x240 空框（实测注入终局时就是这么死的）。
        this.refreshLongTable()
        return
      }
      this.setData({ stageW: rect.width, stageH: rect.height }, () => this.refreshLongTable())
    }).exec()
  },

  // 座位直径跟着台面实测尺寸走，不写死。
  //
  // 写死为什么不行：选人面板是 flex:1 撑满屏高的（10 人局实测 584pt），
  // 终局猎杀那块只有 395pt——同一个尺寸放两处，要么选人页浪费一半空间、
  // 要么终局 10 人局直接叠在一起（实测重叠 4.6pt）。
  // 取所有座位两两中心距的最小值当步距，减去留白就是能放下的最大直径。
  refreshSeatSize() {
    const players = this.data.decoratedPlayers || []
    const w = this.data.stageW
    const h = this.data.stageH
    if (players.length < 2 || !w || !h) return
    let pitch = Infinity
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const dx = (players[i].x - players[j].x) / 100 * w
        const dy = (players[i].y - players[j].y) / 100 * h
        const gap = Math.sqrt(dx * dx + dy * dy)
        if (gap < pitch) pitch = gap
      }
    }
    // 减掉的 16pt 不是留白，是**名字条**：它排在头像圆下面（65x14pt），
    // 只按圆算间距的话，名字会压在下一个人的脸上——10 人局实测压 7.6pt。
    // 上限 47pt：头像资产按 42pt 画的，再大就开始糊。
    // 下限 32pt：低于这个认不出谁是谁，宁可名字挨着也不缩。
    const size = Math.round(Math.max(32, Math.min(47, pitch - 16)))
    if (size !== this.data.seatSize) this.setData({ seatSize: size })
  },

  refreshLongTable() {
    const data = this.data
    // 选人面板和终局选人区是**两个尺寸不同的台面**，却共用一份 stageW/stageH。
    // 从一个切到另一个时若不重测，就会拿旧尺寸算桌子——终局那块台面更矮，
    // 桌子于是超出上下边缘被切掉。这里用当前可见台面的实测值兜一层。
    if (data.finalSelectionMode !== this.lastStageOwner) {
      this.lastStageOwner = data.finalSelectionMode
      this.measureStage()
      return
    }
    if (!data.stageW || !data.stageH) {
      // 选人面板还会被 applyState **自动**打开（队长进入组队阶段，见 tableVisible 那行），
      // 那条路径不经过 openTable，测量从来没发生过——于是挑不出档、长桌整个不渲染。
      // 实测 e2e 跑真实对局时第 2 轮就是这样：地毯和座位都在，桌子没了。
      if (data.tableVisible) this.measureStage()
      return
    }
    // 座位尺寸只依赖台面实测值和座位坐标，和长桌挑档无关——
    // 放在挑档之后会被「桌子没变就 return」挡掉，圆桌局更是压根走不到那儿。
    this.refreshSeatSize()
    const longTable = assets.pickLongTable(data.tableWidth, data.tableHeight, data.stageW, data.stageH)
    if (!longTable) return
    const previous = data.longTable || {}
    // 只在真的变了才 setData。applyState 由轮询驱动，每次都推一遍会让渲染层
    // 反复重设图片源——上一版长桌背景就是这么把加载拖慢的。
    if (longTable.src === previous.src && longTable.style === previous.style) return
    // **等本地文件就绪再上屏**，中途不要先用 cloud:// 顶一下——src 变两次
    // 等于让 <image> 重新加载一次，看到的就是桌子闪一下。
    // 落本地的理由：cloud:// 每次渲染都要重新解析、HTTP 缓存命中不了，
    // 每次开选人面板都要重下一遍；本地路径读盘，零网络。
    assets.localCopy(longTable.src).then(local => {
      const current = this.data.longTable || {}
      if (current.tier === longTable.tier && current.src === (local || longTable.src)) return
      this.setData({ longTable: { ...longTable, src: local || longTable.src, raw: longTable.src } })
    })
  },

  openTable(event) {
    const mode = event.currentTarget.dataset.mode || "status"
    const titles = { team: "选择出征成员", magic: "指定魔法目标指示物", leader: "移交皇冠", amuletOwner: "交付护身符", inspect: "选择查验对象", final: "选择两位玩家", status: "圆桌座位" }
    const hints = {
      // 面板全屏盖住主界面，人数与保护轮必须在这里再说一遍
      team: `本轮 ${this.data.missionSize} 人任务，选满为止${this.data.protectedText ? "；双败保护：需 2 张失败票才失败" : ""}`,
      magic: "只能选择本轮出征成员",
      leader: "已担任队长或曾持护身符者不可接任", amuletOwner: "不可与新队长为同一人",
      inspect: "不可查验持符者、曾持符者或已被查验者", final: "每位玩家私密选择两人"
    }
    this.setData({
      tableVisible: true, tableMode: mode, tableTitle: titles[mode], tableHint: hints[mode] || "查看本局玩家",
      // 单目标交付的模式才亮出道具；组队模式没有道具
      deliverIcon: this.deliverIconFor(mode), deliverFlying: false
    }, () => this.measureStage())
  },

  // 现在轮到哪个测试骑士、要做什么。返回空串表示没有需要房主推的事。
  describeBotPending(room, game, privateView, isHost) {
    if (!room.stepMode || !isHost || !game) return ""
    const bot = id => {
      const player = (game.players || []).find(item => Number(item.id) === Number(id))
      return player && player.bot ? player : null
    }
    const leader = bot(game.leaderId)
    if (room.phase === "mission" && leader) return `${leader.name} 组队`
    if (room.phase === "vote") {
      // 只数**队内的** bot：队外的根本不用出牌，服务端也只等队内的。
      // 数全部 bot 会把「7 位出牌」挂在只有 3 人的任务上，误导房主。
      const team = (game.current && game.current.team) || []
      const pending = (game.players || []).filter(p =>
        p.bot && team.indexOf(p.id) >= 0 && (game.current.votedIds || []).indexOf(p.id) < 0)
      return pending.length ? `${pending.length} 位测试骑士出牌` : ""
    }
    if (room.phase === "missionResult" && leader) return `${leader.name} 交接皇冠`
    if (room.phase === "amulet" && game.amulet) {
      const owner = bot(game.amulet.ownerId)
      if (owner && game.amulet.status === "select") return `${owner.name} 查验`
      if (owner && game.amulet.status === "result") return `${owner.name} 收起护身符`
    }
    return ""
  },

  // 让当前该行动的测试骑士随机走一步。
  // 服务端只给建议，真正执行仍走原有 action，规则校验一条不少。
  runBotStep() {
    if (this.data.syncing) return Promise.resolve()
    this.setData({ syncing: true })
    return roomStore.action(this.data.roomId, "botSuggest", {}).then(suggestion => {
      if (!suggestion || !suggestion.action) throw new Error("没有需要测试骑士决定的事")
      return roomStore.action(this.data.roomId, suggestion.action, suggestion.payload || {})
    }).then(result => this.applyState(result))
      .catch(error => this.showError(error))
      .finally(() => this.setData({ syncing: false }))
  },

  openHistory() { this.setData({ historyVisible: true }) },
  closeHistory() { this.setData({ historyVisible: false }) },

  // 点击牌背翻开身份牌。翻开后保持，不做来回翻转——
  // 玩家需要的是看清楚，不是反复动画。
  flipIdentityCard() {
    if (this.data.cardFlipped) return
    this.identityFlippedAt = Date.now()
    this.setData({ cardFlipped: true, identityUnlocked: true })
    this.vibrate("medium")
  },

  // 离开对局页。先停表并上锁：轮询每 900ms 就会再发一次导航，
  // 后一次会打断前一次，页面能一直卡着跳不出去。
  leaveTo(url) {
    if (this.navigating) return
    this.navigating = true
    this.stopTimers()
    wx.redirectTo({
      url,
      fail: error => {
        this.navigating = false
        this.startTimers()
        console.error("[play] 跳转失败", url, error && error.errMsg)
      }
    })
  },

  // 同 room 页：落地 tmp 文件在虚拟窗口渲染层读不了（500），报错时现签 https 顶上
  onRemoteImageError(event) {
    const field = event.currentTarget.dataset.field
    const raw = event.currentTarget.dataset.raw
    if (!field || !raw || String(raw).indexOf("cloud://") !== 0) return
    // 读当前 src：失败的若是落地的本地文件，说明本窗口渲染层读不了 tmp
    //（多账号调试的虚拟窗口如此），整个窗口降级为直接用签名 https
    const current = field.split(".").reduce((obj, key) => (obj || {})[key], this.data)
    if (/^(http:\/\/tmp\/|wxfile:\/\/)/.test(String(current || ""))) assets.markTmpBroken()
    if (!this.remoteErrorCount) this.remoteErrorCount = {}
    const count = (this.remoteErrorCount[field] || 0) + 1
    this.remoteErrorCount[field] = count
    if (count > 3) return   // 防死循环
    assets.remoteUrl(raw).then(url => {
      if (!url || url === raw) return
      const patch = {}
      patch[field] = url
      this.setData(patch)
    })
  },

  openDossier() {
    // 兜底：界面上已经藏了入口，这里再挡一层，免得别处误调
    if (!this.data.identityUnlocked) {
      wx.showToast({ title: "先翻开身份牌", icon: "none" })
      return
    }
    this.setData({ dossierVisible: true })
  },
  closeDossier() { this.setData({ dossierVisible: false }) },

  closeTable() {
    this.setData({ deliverIcon: "", deliverFlying: false })
    if (this.data.syncing) return
    this.setData({ tableVisible: false })
  },
  stopPropagation() {},

  resolveFinalSelectionMode(finalStage, privateView, traitorSide) {
    if (finalStage === "hunterTargets" && (privateView.role === "hunter" || privateView.canControlBotHunter)) return "hunter"
    if (finalStage !== "identify") return ""
    if (privateView.role === "traitor" && !privateView.traitorDecision) return traitorSide === "good" ? "traitor" : ""
    return privateView.finalSubmitted ? "" : "identify"
  },

  // 待交付的道具：皇冠/护身符/火球。组队模式没有道具，返回空串即不渲染。
  // 选中后道具飘向该玩家的头像位置；座位坐标本来就是百分比，直接过渡 left/top
  flyDeliverTo(event) {
    const id = Number(event.currentTarget.dataset.id)
    const seat = this.data.decoratedPlayers.find(player => Number(player.id) === id)
    if (!seat) return
    // 改选另一个人时也要能重播：原先第一句是
    //   if (!deliverIcon || deliverFlying) return
    // 而道具飞完 720ms 就被清空，于是第二次点击直接被挡在门外，一点动静都没有。
    const icon = this.data.deliverIcon || this.deliverIconFor(this.data.tableMode)
    if (!icon) return
    if (this.deliverTimer) clearTimeout(this.deliverTimer)
    // 先瞬回桌心（不带过渡），下一帧再飞出去，这样每次改选都看得到完整的飞行
    // 记下目标：飞行期间要把那枚徽标藏起来，否则点击瞬间徽标就冒出来，
    // 和还在飞的道具同时存在——看着就是「两个火球」。
    this.setData({ deliverIcon: icon, deliverFlying: false, deliverX: 50, deliverY: 50, deliverTargetId: id })
    this.deliverTimer = setTimeout(() => this.flyDeliverStep(seat, this.data.tableMode), 40)
  },

  // 每件道具最终都落在座位上自己那枚徽标里：皇冠在左上、火球在右上、护身符在右下
  // （见 play.wxss 的 .leader-badge / .magic-badge / .amulet-badge）。
  // 飞行终点必须就是徽标位置，否则会看到「飞到头像中间淡出 + 徽标在角上突然冒出来」
  // 两段割裂的动作。偏移相对座位中心，单位 rpx：座位 72rpx 见方、徽标 28rpx。
  BADGE_OFFSET: {
    leader: { x: -24, y: -31 },
    amuletOwner: { x: 24, y: 24 },
    magic: { x: 24, y: -31 }
  },

  flyDeliverStep(seat, mode) {
    // 座位的 left/top 就是中心（.seat-token 带 translate(-50%,-50%)），
    // 在此基础上偏到徽标那个角，让飞行终点和徽标出现的位置重合。
    const offset = this.BADGE_OFFSET[mode || this.data.tableMode] || { x: 0, y: 0 }
    const rpx = (this.windowWidth || 375) / 750
    const stageW = this.data.stageW || 0
    const stageH = this.data.stageH || 0
    const x = stageW ? seat.x + offset.x * rpx / stageW * 100 : seat.x
    const y = stageH ? seat.y + offset.y * rpx / stageH * 100 : seat.y
    this.setData({ deliverFlying: true, deliverX: x, deliverY: y })
    this.deliverTimer = setTimeout(() => this.setData({ deliverIcon: "", deliverFlying: false, deliverTargetId: 0 }), 720)
  },

  deliverIconFor(mode) {
    const icons = this.data.ui || {}
    if (mode === "leader") return icons.crown || ""
    if (mode === "amuletOwner") return icons.amulet || ""
    if (mode === "magic") return icons.fire || ""
    return ""
  },

  tapSeat(event) {
    this.flyDeliverTo(event)
    const id = Number(event.currentTarget.dataset.id)
    const player = this.data.decoratedPlayers.find(item => item.id === id)
    const mode = event.currentTarget.dataset.mode || this.data.tableMode
    if (mode === "team") {
      const selected = this.data.selectedTeam.slice()
      const index = selected.indexOf(id)
      if (index >= 0) selected.splice(index, 1)
      else if (selected.length < this.data.missionSize) selected.push(id)
      else return wx.showToast({ title: `最多选${this.data.missionSize}人`, icon: "none" })
      this.setData({ selectedTeam: selected, teamPulseId: index < 0 ? id : 0 })
      if (this.selectionTimer) clearTimeout(this.selectionTimer)
      this.selectionTimer = setTimeout(() => {
        this.setData({ teamPulseId: 0 })
        this.refreshSelections()
      }, 560)
      this.vibrate("light")
    }
    if (mode === "magic") {
      if (this.data.selectedTeam.indexOf(id) < 0) return wx.showToast({ title: "只能给出征成员", icon: "none" })
      this.setData({ magicTargetId: id })
      this.vibrate("medium")
    }
    if (mode === "leader") {
      if (!player.canLead) return wx.showToast({ title: player.hasLed ? "已担任过队长" : "曾持有护身符", icon: "none" })
      this.setData({ nextLeaderId: id, nextAmuletId: id === this.data.nextAmuletId ? null : this.data.nextAmuletId })
      this.vibrate("medium")
    }
    if (mode === "amuletOwner") {
      const handoffLeaderId = this.data.game.galahadLeaderId || this.data.nextLeaderId
      if (!player.canReceiveAmulet || id === handoffLeaderId) return wx.showToast({ title: "该玩家不能获得护身符", icon: "none" })
      this.setData({ nextAmuletId: id })
      this.vibrate("medium")
    }
    if (mode === "inspect") {
      if (!player.canInspect) return wx.showToast({ title: "该玩家不能被查验", icon: "none" })
      this.sendAction("selectAmuletTarget", { targetId: id }, null, { tableVisible: false })
      return
    }
    if (mode === "final") {
      const targets = this.data.finalTargets.slice()
      const index = targets.indexOf(id)
      if (index >= 0) targets.splice(index, 1)
      else if (targets.length < 2) targets.push(id)
      else return wx.showToast({ title: "只能选择两人", icon: "none" })
      this.setData({ finalTargets: targets })
    }
    this.refreshSelections()
  },

  refreshSelections() {
    const decoratedPlayers = (this.data.decoratedPlayers || []).map(player => ({
      ...player,
      selected: this.data.selectedTeam.indexOf(player.id) >= 0,
      finalSelected: this.data.finalTargets.indexOf(player.id) >= 0,
      justSelected: Number(this.data.teamPulseId) === Number(player.id)
    }))
    this.setData({
      decoratedPlayers,
      teamPlayers: decoratedPlayers.filter(player => this.data.selectedTeam.indexOf(player.id) >= 0),
      nextLeaderPlayer: decoratedPlayers.find(player => player.id === Number(this.data.game && this.data.game.galahadLeaderId || this.data.nextLeaderId)) || null,
      nextAmuletPlayer: decoratedPlayers.find(player => player.id === Number(this.data.nextAmuletId)) || null
    })
  },

  chooseMagicMode() {
    if (this.data.selectedTeam.length !== this.data.missionSize) return wx.showToast({ title: "队伍还没选齐", icon: "none" })
    this.openTable({ currentTarget: { dataset: { mode: "magic" } } })
  },

  startVote() {
    if (this.data.selectedTeam.length !== this.data.missionSize || !this.data.magicTargetId) return wx.showToast({ title: "请完成队伍和魔法选择", icon: "none" })
    this.sendAction("startVote", { team: this.data.selectedTeam, magicTargetId: this.data.magicTargetId })
  },

  submitVote(event) {
    // 先本地标记，让选中的牌翻转投出、另一张碎裂——不等服务端往返
    const picked = event.currentTarget.dataset.value
    if (this.data.voteChoice) return
    if (picked === "success" && !this.data.canVoteSuccess) return
    if (picked === "fail" && !this.data.canVoteFail) return
    this.setData({ voteChoice: picked })
    this.vibrate("medium")
    if (this.data.privateView.hasVoted || this.data.myVotePending) return
    this.setData({ myVotePending: true })
    this.sendAction("submitVote", { value: event.currentTarget.dataset.value }, { myVotePending: false })
  },

  submitBotVotes() { this.sendAction("submitBotVotes") },

  claimGalahad() { this.sendAction("claimGalahad") },

  handoff() {
    if (!this.data.nextLeaderId && !this.data.game.galahadLeaderId) return wx.showToast({ title: "请选择下一位队长", icon: "none" })
    if (this.data.needsAmulet && !this.data.nextAmuletId) return wx.showToast({ title: "本轮需要分配护身符", icon: "none" })
    this.sendAction("handoff", { nextLeaderId: this.data.nextLeaderId || this.data.game.galahadLeaderId, amuletOwnerId: this.data.nextAmuletId || null })
  },

  inspectionClaim(event) { this.sendAction("inspectionClaim", { claim: event.currentTarget.dataset.faction }) },
  completeAmulet() { this.sendAction("completeAmulet") },

  finishDiscussion() { this.sendAction("finishDiscussion", { force: false }) },
  forceFinishDiscussion() { this.sendAction("finishDiscussion", { force: true }) },
  hunterVote(event) { this.sendAction("hunterVote", { value: event.currentTarget.dataset.value }) },
  revealHunter() { this.sendAction("hunterDecision", { hunt: true }) },
  silenceHunter() { this.sendAction("hunterDecision", { hunt: false }) },

  submitHunterTargets() {
    if (this.data.finalTargets.length !== 2) return wx.showToast({ title: "请选择两位猎杀目标", icon: "none" })
    this.sendAction("hunterTargets", { targets: this.data.finalTargets })
  },

  chooseTraitorSide(event) {
    const side = event.currentTarget.dataset.side
    this.setData({
      traitorSide: side,
      finalSelectionMode: side === "good" ? "traitor" : "",
      finalTargets: []
    })
    if (side === "evil") this.sendAction("traitorDecision", { side: "evil" })
  },

  submitTraitorDecision() {
    if (this.data.finalTargets.length !== 2) return wx.showToast({ title: "请选择两位正义玩家", icon: "none" })
    this.sendAction("traitorDecision", { side: "good", targets: this.data.finalTargets })
  },

  submitFinalIdentify() {
    if (this.data.finalTargets.length !== 2) return wx.showToast({ title: "请私密指认两位玩家", icon: "none" })
    this.sendAction("finalIdentify", { targets: this.data.finalTargets })
  },

  toggleDebug() { this.setData({ debugVisible: !this.data.debugVisible }) },

  sendSequence(actions) {
    if (this.data.syncing) return
    this.stateGeneration += 1
    this.setData({ syncing: true })
    actions.reduce((promise, item) => promise.then(() => roomStore.action(this.data.roomId, item[0], item[1])), Promise.resolve())
      .then(result => this.applyState(result)).catch(error => {
        if (!this.handleRoomGone(error)) this.showError(error)
        this.stateGeneration += 1
      }).finally(() => this.setData({ syncing: false }))
  },

  sendAction(action, payload, after, successAfter) {
    if (this.data.syncing) return Promise.resolve()
    this.stateGeneration += 1
    this.setData({ syncing: true })
    let succeeded = false
    return roomStore.action(this.data.roomId, action, payload).then(result => {
      succeeded = true
      this.applyState(result)
      if (successAfter) this.setData(successAfter)
    }).catch(error => {
      if (!this.handleRoomGone(error)) this.showError(error)
      this.stateGeneration += 1
    }).finally(() => {
      this.setData({ syncing: false, ...(after || {}) })
      if (!succeeded) this.loadState(false)
    })
  },

  showError(error) { wx.showToast({ title: error.message || "操作失败", icon: "none", duration: 2600 }) }
})
