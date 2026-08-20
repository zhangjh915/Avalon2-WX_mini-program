const roomStore = require("../../utils/roomStore")
const gameUtil = require("../../utils/game")
const tableLayout = require("../../utils/tableLayout")
const roleGuideData = require("../../data/roleGuides")
const ttsData = require("../../data/ttsLines")
const assets = require("../../utils/assets")

const IDENTITY_READ_MS = 40000

const phaseNames = {
  reveal: "确认身份", night: "命运揭示", amulet: "护身符查验", mission: "组建远征",
  vote: "秘密投票", missionResult: "远征结算", finale: "最终审判"
}

Page({
  data: {
    roomId: "", room: null, game: null, privateView: null, isHost: false,
    phase: "reveal", phaseName: "确认身份", myRole: null, myRoleGuide: roleGuideData.defaultGuide,
    roleVisible: false, identityMode: "prepare", identityCountdown: 3, identitySecondsLeft: 40,
    identityReady: false, identityRemembered: false, identityReadyCount: 0, identityRememberedCount: 0,
    nightCeremony: [], currentNightLine: {}, nightStep: 0, nightLastStep: false, nightProgressPercent: 0,
    nightDirective: { title: "天黑请闭眼", subtitle: "请听指令" },
    leader: null, isLeader: false, missionSize: 0, protectedText: "", missionTrack: [],
    canControlLeader: false,
    tableOrientation: "horizontal",
    longTable: null, stageW: 0, stageH: 0,
    tableWidth: 44,
    tableHeight: 34,
    tableVisible: false, tableMode: "team", tableTitle: "选择同行骑士", tableHint: "",
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
    hunterVoteValue: "", traitorSide: "", traitorTargets: [], voteChoice: "",
    deliverIcon: "", deliverFlying: false, deliverX: 50, deliverY: 50,
    hasBots: false, botPlayers: [], debugVisible: false, syncing: false, devMode: false,
    nextLeaderPlayer: null, nextAmuletPlayer: null, teamPulseId: 0, missionResultCards: [],
    missionCardBack: "", missionCardSuccess: "", missionCardFail: "",
    preloadList: [],
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
    this.setData({ roomId: options.roomId, ui: assets.uiIcons() })
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
    const nightCeremony = ttsData.buildNightCeremonyFromSettings(room.settings || {})
    const nightStep = Math.min(this.data.nightStep, Math.max(nightCeremony.length - 1, 0))
    const ceremonies = this.buildStateCeremonies(previousGame, previousPhase, game, room.phase, decoratedPlayers)
    const tableGeometry = tableLayout.tableGeometry(tableLayout.normalizeLayout(game.players.length, room.seatLayout, room.tableSides))
    // dossier 必须先建：圆桌纪录要用它的 myVotes 标出自己那一轮打的牌。
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
      nightCeremony, nightStep, currentNightLine: nightCeremony[nightStep] || {},
      // 轮询每次都会重算 nightStep（保留房主已推进到的位置），派生字段要跟着一起更新
      nightLastStep: nightStep >= nightCeremony.length - 1,
      nightProgressPercent: nightCeremony.length ? Math.round((nightStep + 1) / nightCeremony.length * 100) : 0,
      nightDirective: ttsData.pickNightDisplay(Number(game.firstLeaderId || 0) + Number(game.playerCount || 0)),
      leader, isLeader: privateView.id === game.leaderId,
      devMode,
      canControlLeader: privateView.id === game.leaderId || (!!result.isHost && !!leader && !!leader.bot && devMode),
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
      tableVisible: phaseChanged ? (room.phase === "mission" && (privateView.id === game.leaderId || (!!result.isHost && !!leader && !!leader.bot && devMode))) : this.data.tableVisible,
      tableMode: phaseChanged && room.phase === "mission" ? "team" : this.data.tableMode,
      tableTitle: phaseChanged && room.phase === "mission" ? "选择同行骑士" : this.data.tableTitle,
      tableHint: phaseChanged && room.phase === "mission" ? `选择${missionSize}名同行骑士` : this.data.tableHint,
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
      myRoleArt,
      identityUnlocked,
      myInitial,
      // 图在第一次真正显示时才开始下载，于是每换一个阶段都要白等一次。
      // 这里把本局用得到的图挂进一个 0 尺寸的隐藏容器，进对局页就先下完，
      // 轮到显示时直接命中缓存。只放本局真的会用到的，不整批预热。
      preloadList: [
        assets.identityBack(roleSkin),
        myRoleArt,
        assets.missionCard(missionSkin, "back"),
        assets.missionCard(missionSkin, "success"),
        assets.missionCard(missionSkin, "fail")
      ].filter(Boolean),
      identityBackArt: assets.identityBack(roleSkin),
      missionCardBack: assets.missionCard(missionSkin, "back"),
      missionCardSuccess: assets.missionCard(missionSkin, "success"),
      missionCardFail: assets.missionCard(missionSkin, "fail"),
      myVotes: dossier.myVotes,
      syncing: false
    })
    this.refreshLongTable()
    this.refreshSelections()
    this.updateClock()
    this.enqueueCeremonies(ceremonies)
    if (phaseChanged) this.setData({ voteChoice: "" })
    if (phaseChanged && room.phase !== "reveal") {
      this.identityFlippedAt = 0
      this.setData({ cardFlipped: false })
    }
    if (phaseChanged && room.phase === "night") this.startNightDirectives()
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
        symbolImage: assets.uiAsset(finalMission.winner === "good" ? "crest-good.png" : "crest-evil.png"),
        title: `第 ${finalMission.round} 次远征${finalMission.winner === "good" ? "成功" : "失败"}`,
        subtitle: `成功 ${finalMission.successCount} 票 · 失败 ${finalMission.failCount} 票`,
        target: null
      })
      events.push({
        type: goodReachedThree ? "finale-good" : "finale-evil",
        symbol: "",
        symbolImage: assets.uiAsset(goodReachedThree ? "crest-good.png" : "crest-evil.png"),
        title: goodReachedThree ? "圣杯三度告捷" : "黑暗三度得手",
        subtitle: "常规远征结束，最终审判开启",
        target: null
      })
      return events
    }
    if (previousFinalStage !== "hunterTargets" && finalStage === "hunterTargets" && game.final.hunterRevealed) {
      const hunter = players.find(player => player.revealed) || null
      events.push({
        type: "hunter", symbol: "", symbolImage: assets.uiAsset("crest-evil.png"), title: "盲眼杀手现身",
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
  BANNER_TYPES: ["crown", "amulet", "magic"],

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
          ? (mission.winner === "good" ? assets.uiAsset("crest-good.png") : assets.uiAsset("crest-evil.png"))
          : (round === game.round ? assets.uiAsset("mission-current.png") : assets.uiAsset("mission-pending.png")),
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
      if (game.final.stage === "hunterDecision") return { text: "等待盲眼杀手做出决定", progress: "" }
      if (game.final.stage === "hunterTargets") return { text: "等待盲眼杀手选择猎杀目标", progress: "" }
    }
    return null
  },

  // 「我的密录」：把服务端下发的私密记录整理成可读文案。
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
    this.sendAction("identityRemembered")
  },
  enterNight() { this.sendAction("enterNight") },

  // 首夜由房主逐条念、逐条推进。
  // 早先是 5 秒定时自动跳过，主持根本跟不上，也没法回看上一条指令；
  // 主持体验是这个产品的核心价值，节奏必须握在人手里。
  startNightDirectives() {
    this.applyNightStep(0)
  },

  applyNightStep(step) {
    const ceremony = this.data.nightCeremony || []
    const total = Math.max(ceremony.length, 1)
    const nightStep = Math.min(Math.max(step, 0), total - 1)
    this.setData({
      nightStep,
      currentNightLine: ceremony[nightStep] || {},
      nightLastStep: nightStep >= total - 1,
      nightProgressPercent: Math.round((nightStep + 1) / total * 100)
    })
  },

  nextNightStep() {
    if (this.data.nightLastStep) return
    this.applyNightStep(this.data.nightStep + 1)
    this.vibrate("light")
  },

  prevNightStep() {
    if (this.data.nightStep <= 0) return
    this.applyNightStep(this.data.nightStep - 1)
  },
  enterMission() { this.sendAction("enterMission") },

  // 长桌挑档要用**运行时实测的 stage 尺寸**：stage 宽随屏宽变而高固定，
  // 375pt 屏上长宽比 1.19、414pt 屏上 1.32，差 11%，写死会挑错档。
  measureStage(attempt) {
    wx.createSelectorQuery().in(this).selectAll(".compact-stage").boundingClientRect(rects => {
      const rect = (rects || []).find(item => item && item.width > 0 && item.height > 0)
      if (!rect) {
        // 面板是 wx:if 出来的，setData 回调里布局往往还没完成，量到 0 就挑不出档、
        // 桌子整个不渲染（第一轮点「选择骑士」桌子不见了就是这么来的）。补量几次。
        if ((attempt || 0) < 5) setTimeout(() => this.measureStage((attempt || 0) + 1), 120)
        return
      }
      if (rect.width === this.data.stageW && rect.height === this.data.stageH) return
      this.setData({ stageW: rect.width, stageH: rect.height }, () => this.refreshLongTable())
    }).exec()
  },

  refreshLongTable() {
    const data = this.data
    if (!data.stageW || !data.stageH) return
    const longTable = assets.pickLongTable(data.tableWidth, data.tableHeight, data.stageW, data.stageH)
    if (!longTable) return
    const previous = data.longTable || {}
    // 只在真的变了才 setData。applyState 由轮询驱动，每次都推一遍会让渲染层
    // 反复重设图片源——上一版长桌背景就是这么把加载拖慢的。
    if (longTable.src === previous.src && longTable.style === previous.style) return
    this.setData({ longTable })
  },

  openTable(event) {
    const mode = event.currentTarget.dataset.mode || "status"
    const titles = { team: "选择同行骑士", magic: "交付魔法指示物", leader: "移交皇冠", amuletOwner: "交付护身符", inspect: "选择查验对象", final: "选择两位玩家", status: "圆桌座位" }
    const hints = {
      team: `选择${this.data.missionSize}名同行骑士`, magic: "只能选择本轮同行骑士",
      leader: "已担任队长或曾持护身符者不可接任", amuletOwner: "不可与新队长为同一人",
      inspect: "不可查验持符者、曾持符者或已被查验者", final: "每位玩家私密选择两人"
    }
    this.setData({
      tableVisible: true, tableMode: mode, tableTitle: titles[mode], tableHint: hints[mode] || "查看本局玩家",
      // 单目标交付的模式才亮出道具；组队模式没有道具
      deliverIcon: this.deliverIconFor(mode), deliverFlying: false
    }, () => this.measureStage())
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
    if (!this.data.deliverIcon || this.data.deliverFlying) return
    const id = Number(event.currentTarget.dataset.id)
    const seat = this.data.decoratedPlayers.find(player => Number(player.id) === id)
    if (!seat) return
    // 座位的 left/top 定的是元素**左上角**（.seat-token 没有 translate(-50%,-50%)），
    // 而道具是按中心定位的。直接用 seat.x/y 道具会停在头像左上角外面，
    // 要加上半个座位的偏移才落在头像正中。
    const target = this.seatCenter(seat)
    this.setData({ deliverFlying: true, deliverX: target.x, deliverY: target.y })
    if (this.deliverTimer) clearTimeout(this.deliverTimer)
    this.deliverTimer = setTimeout(() => this.setData({ deliverIcon: "", deliverFlying: false }), 720)
  },

  // 座位头像的中心点（百分比，相对台面）。座位宽 72rpx，头像在其中居中。
  seatCenter(seat) {
    const half = 36 * ((this.windowWidth || 375) / 750)   // rpx -> pt
    const stageW = this.data.stageW || 0
    const stageH = this.data.stageH || 0
    if (!stageW || !stageH) return { x: seat.x, y: seat.y }
    return { x: seat.x + half / stageW * 100, y: seat.y + half / stageH * 100 }
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
      if (this.data.selectedTeam.indexOf(id) < 0) return wx.showToast({ title: "只能给同行骑士", icon: "none" })
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
