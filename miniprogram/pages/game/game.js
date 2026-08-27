const gameUtil = require("../../utils/game")
const { pickLine } = require("../../data/ttsLines")

const phaseNames = {
  reveal: "身份确认",
  night: "首夜确认",
  amulet: "护身符查验",
  mission: "队长发车",
  vote: "私密投票",
  missionResult: "任务结算",
  finale: "终局翻盘"
}

Page({
  data: {
    game: null,
    phase: "reveal",
    phaseName: phaseNames.reveal,
    hostLine: pickLine("reveal", 0),
    revealedPlayer: null,
    revealedRoleDesc: "",
    showEvilInfo: false,
    showPriestInfo: false,
    showArthurInfo: false,
    showPercivalInfo: false,
    showOutsiderInfo: false,
    showLancelotInfo: false,
    visibleEvils: [],
    knownToEvil: [],
    nightInfo: null,
    revealSteps: [],
    firstLeaderFaction: "",
    leader: null,
    missionSize: 0,
    protectedText: "",
    teamPlayers: [],
    currentVoter: null,
    voteOptions: [],
    voteIndex: 0,
    lastMission: null,
    needsFinale: false,
    legalLeaders: [],
    legalAmuletOwners: [],
    legalAmuletTargets: [],
    nextLeaderId: null,
    nextAmuletId: null,
    amuletOwner: null,
    amuletResult: null,
    pendingDeceiverTargetId: null,
    roundNotices: [],
    finalTargets: [],
    useDuke: false,
    dukeRemoveId: null
  },

  onLoad() {
    const app = getApp()
    const game = app.globalData.game || wx.getStorageSync("currentGame")
    if (!game) {
      wx.redirectTo({ url: "/pages/index/index" })
      return
    }
    app.globalData.game = game
    this.setData({ game })
    this.refreshDerived("reveal")
  },

  setPhase(phase) {
    this.setData({
      phase,
      phaseName: phaseNames[phase],
      hostLine: pickLine(this.hostStage(phase), this.data.game.round + this.data.game.missions.length)
    })
    this.refreshDerived(phase)
  },

  hostStage(phase) {
    if (phase === "reveal") return "reveal"
    if (phase === "night") return "night"
    if (phase === "mission") return "missionStart"
    if (phase === "vote") return "vote"
    if (phase === "missionResult") return "missionResult"
    if (phase === "amulet") return "amulet"
    if (phase === "finale") return "finale"
    return "intro"
  },

  saveGame() {
    getApp().globalData.game = this.data.game
    wx.setStorageSync("currentGame", this.data.game)
  },

  refreshDerived() {
    const game = this.data.game
    if (!game) return
    const missionSize = gameUtil.currentMissionSize(game)
    const leader = gameUtil.getPlayer(game, game.leaderId)
    const firstLeader = gameUtil.getPlayer(game, game.firstLeaderId)
    const nightInfo = gameUtil.getNightInfo(game)
    const revealSteps = gameUtil.getRevealSteps(game)
    const visibleEvils = nightInfo.evilTeamVisible
    const knownToEvil = nightInfo.knownToEvil
    const teamPlayers = game.players.filter(player => game.current.team.indexOf(player.id) >= 0)
    const legalLeaders = gameUtil.legalLeaderTargets(game)
    const legalAmuletOwners = gameUtil.legalAmuletOwners(game).filter(player => player.id !== this.data.nextLeaderId)
    const legalAmuletTargets = gameUtil.legalAmuletTargets(game).filter(player => player.id !== game.amuletOwnerId)
    const amuletOwner = game.amuletOwnerId ? gameUtil.getPlayer(game, game.amuletOwnerId) : null
    const finalTargets = game.players.filter(player => player.finalSelected)
    const roundNotices = gameUtil.getRoundNotices(game)
    const decoratedPlayers = game.players.map(player => ({
      ...player,
      selected: game.current.team.indexOf(player.id) >= 0,
      finalSelected: !!player.finalSelected
    }))
    const decoratedGame = { ...game, players: decoratedPlayers }
    this.setData({
      game: decoratedGame,
      leader,
      missionSize,
      protectedText: gameUtil.isProtectedRound(game) ? "，本轮需要两张失败票才会失败" : "",
      visibleEvils,
      knownToEvil,
      nightInfo,
      revealSteps,
      firstLeaderFaction: firstLeader ? gameUtil.factionLabel(gameUtil.getInspectionFaction(firstLeader)) : "",
      teamPlayers,
      legalLeaders,
      legalAmuletOwners,
      legalAmuletTargets,
      amuletOwner,
      roundNotices,
      finalTargets
    })
  },

  mutateGame(fn) {
    const game = this.data.game
    fn(game)
    this.setData({ game })
    this.saveGame()
    this.refreshDerived()
  },

  showRole(event) {
    const id = Number(event.currentTarget.dataset.id)
    const player = gameUtil.getPlayer(this.data.game, id)
    const role = gameUtil.getRoleInfo(player.role)
    this.setData({
      revealedPlayer: player,
      revealedRoleDesc: role.desc
    })
  },

  hideRole() {
    this.setData({
      revealedPlayer: null,
      revealedRoleDesc: ""
    })
  },

  goNight() {
    this.setPhase("night")
  },

  toggleEvilInfo() {
    this.setData({ showEvilInfo: !this.data.showEvilInfo })
  },

  togglePriestInfo() {
    this.setData({ showPriestInfo: !this.data.showPriestInfo })
  },

  toggleArthurInfo() {
    this.setData({ showArthurInfo: !this.data.showArthurInfo })
  },

  togglePercivalInfo() {
    this.setData({ showPercivalInfo: !this.data.showPercivalInfo })
  },

  toggleOutsiderInfo() {
    this.setData({ showOutsiderInfo: !this.data.showOutsiderInfo })
  },

  toggleLancelotInfo() {
    this.setData({ showLancelotInfo: !this.data.showLancelotInfo })
  },

  startMission() {
    this.setData({ amuletResult: null })
    if (this.data.game.amuletPending) {
      this.setPhase("amulet")
      return
    }
    this.setPhase("mission")
  },

  checkAmulet(event) {
    const targetId = Number(event.currentTarget.dataset.id)
    const target = gameUtil.getPlayer(this.data.game, targetId)
    if (target && target.role === "deceiver") {
      this.setData({ pendingDeceiverTargetId: targetId })
      return
    }
    this.finishAmuletCheck(targetId)
  },

  chooseDeceiverClaim(event) {
    const claimedFaction = event.currentTarget.dataset.faction
    this.finishAmuletCheck(this.data.pendingDeceiverTargetId, claimedFaction)
  },

  finishAmuletCheck(targetId, claimedFaction) {
    this.mutateGame(game => {
      const result = gameUtil.applyAmuletCheck(game, targetId, claimedFaction)
      result.resultName = gameUtil.factionLabel(result.result)
      this.setData({ amuletResult: result })
    })
    this.setData({ pendingDeceiverTargetId: null })
  },

  toggleTeam(event) {
    const id = Number(event.currentTarget.dataset.id)
    this.mutateGame(game => {
      const index = game.current.team.indexOf(id)
      if (index >= 0) {
        game.current.team.splice(index, 1)
        if (game.current.magicTargetId === id) game.current.magicTargetId = null
      } else if (game.current.team.length < gameUtil.currentMissionSize(game)) {
        game.current.team.push(id)
      } else {
        wx.showToast({ title: "人数已满", icon: "none" })
      }
    })
  },

  setMagic(event) {
    const id = Number(event.currentTarget.dataset.id)
    this.mutateGame(game => {
      game.current.magicTargetId = id
    })
  },

  goVote() {
    const game = this.data.game
    const size = gameUtil.currentMissionSize(game)
    if (game.current.team.length !== size) {
      wx.showToast({ title: `请选择 ${size} 名出征成员`, icon: "none" })
      return
    }
    if (!game.current.magicTargetId) {
      wx.showToast({ title: "请选择魔法指示物对象", icon: "none" })
      return
    }
    this.setData({ voteIndex: 0 })
    this.prepareVoter(0)
    this.setPhase("vote")
  },

  prepareVoter(index) {
    const game = this.data.game
    const playerId = game.current.team[index]
    const currentVoter = gameUtil.getPlayer(game, playerId)
    const voteOptions = gameUtil.legalVoteOptions(game, playerId)
    this.setData({ currentVoter, voteOptions, voteIndex: index })
  },

  submitVote(event) {
    const value = event.currentTarget.dataset.value
    const index = this.data.voteIndex
    const player = this.data.currentVoter
    const game = this.data.game
    game.current.votes.push({ playerId: player.id, value })
    this.setData({ game })
    this.saveGame()
    if (index + 1 < game.current.team.length) {
      this.prepareVoter(index + 1)
      return
    }
    const mission = gameUtil.resolveMission(game, game.current.votes)
    mission.winnerName = gameUtil.factionLabel(mission.winner)
    const needsFinale = gameUtil.shouldEnterFinale(game)
    this.setData({
      game,
      lastMission: mission,
      needsFinale,
      currentVoter: null,
      voteOptions: []
    })
    this.saveGame()
    this.setPhase("missionResult")
  },

  selectNextLeader(event) {
    const nextLeaderId = Number(event.currentTarget.dataset.id)
    this.setData({ nextLeaderId })
    this.refreshDerived()
  },

  selectAmuletOwner(event) {
    const nextAmuletId = Number(event.currentTarget.dataset.id)
    this.setData({ nextAmuletId: this.data.nextAmuletId === nextAmuletId ? null : nextAmuletId })
  },

  nextRound() {
    if (!this.data.nextLeaderId) {
      wx.showToast({ title: "请选择下一任队长", icon: "none" })
      return
    }
    this.mutateGame(game => {
      gameUtil.prepareNextRound(game, this.data.nextLeaderId, this.data.nextAmuletId)
    })
    this.setData({ nextLeaderId: null, nextAmuletId: null })
    this.setPhase(this.data.game.amuletPending ? "amulet" : "mission")
  },

  goFinale() {
    this.setPhase("finale")
  },

  toggleFinalTarget(event) {
    const id = Number(event.currentTarget.dataset.id)
    this.mutateGame(game => {
      const player = gameUtil.getPlayer(game, id)
      player.finalSelected = !player.finalSelected
    })
  },

  toggleDuke() {
    this.setData({ useDuke: !this.data.useDuke, dukeRemoveId: null })
  },

  selectDukeRemove(event) {
    this.setData({ dukeRemoveId: Number(event.currentTarget.dataset.id) })
  },

  resolveHunter() {
    const targets = this.data.finalTargets.map(player => player.id)
    if (targets.length !== 2) {
      wx.showToast({ title: "请选择两个猎杀目标", icon: "none" })
      return
    }
    this.mutateGame(game => {
      gameUtil.resolveFinale(game, { hunterTargets: targets })
    })
    wx.redirectTo({ url: "/pages/result/result" })
  },

  resolveGoodIdentify() {
    const targets = this.data.finalTargets.map(player => player.id)
    if (!targets.length) {
      wx.showToast({ title: "请选择指认目标", icon: "none" })
      return
    }
    if (this.data.useDuke && !this.data.dukeRemoveId) {
      wx.showToast({ title: "请选择公爵删除目标", icon: "none" })
      return
    }
    this.mutateGame(game => {
      gameUtil.resolveFinale(game, {
        goodTargets: targets,
        useDuke: this.data.useDuke,
        dukeRemoveId: this.data.dukeRemoveId
      })
    })
    wx.redirectTo({ url: "/pages/result/result" })
  }
})
