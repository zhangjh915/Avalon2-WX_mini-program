const roomStore = require("../../utils/roomStore")
const gameUtil = require("../../utils/game")
const tableLayout = require("../../utils/tableLayout")

Page({
  data: {
    playerName: "",
    joinCode: "",
    joinSlots: ["", "", "", "", "", ""],
    joinPadVisible: false,
    createSetupVisible: false,
    playerCount: 8,
    tableType: "long",
    seatLayout: tableLayout.balancedLayout(8),
    layoutEditorVisible: false,
    draftSeatLayout: tableLayout.balancedLayout(8),
    draftAssignedCount: 8,
    draftRemainingCount: 0,
    draftOrientation: "horizontal",
    draftTableWidth: 38,
    draftTableHeight: 56,
    unknownRoles: false,
    hunterVoteVariant: false,
    roleCounts: {},
    roleEditorVisible: false,
    roleFactionFilter: "good",
    draftRoleCounts: {},
    roleEditorList: [],
    goodRoleSummary: "",
    evilRoleSummary: "",
    goodRoleCount: 0,
    evilRoleCount: 0,
    targetGoodCount: 0,
    targetEvilCount: 0,
    balanceScore: 0,
    balanceMarkerPercent: 50,
    balanceTitle: "大致平衡",
    balanceWarning: "",
    balanceLevel: "balanced",
    rolePoolCount: 0,
    roleErrors: [],
    roleConfigValid: true
  },

  onLoad() {
    this.setData({ playerName: wx.getStorageSync("playerName") || "" })
    this.resetRoles(false)
  },

  onNameInput(event) {
    const playerName = event.detail.value
    this.setData({ playerName })
    wx.setStorageSync("playerName", playerName)
  },

  openJoinPad() {
    if (!this.ensureName()) return
    this.setData({ joinPadVisible: true })
  },

  closeJoinPad() { this.setData({ joinPadVisible: false }) },

  pressJoinDigit(event) {
    if (this.data.joinCode.length >= 6) return
    const digit = String(event.currentTarget.dataset.digit || "")
    if (!/^\d$/.test(digit)) return
    const joinCode = `${this.data.joinCode}${digit}`
    this.setJoinCode(joinCode)
  },

  deleteJoinDigit() {
    if (!this.data.joinCode.length) return
    this.setJoinCode(this.data.joinCode.slice(0, -1))
  },

  clearJoinCode() { this.setJoinCode("") },

  setJoinCode(joinCode) {
    this.setData({
      joinCode,
      joinSlots: Array.from({ length: 6 }, (_, index) => joinCode[index] || "")
    })
  },

  openCreateSetup() {
    if (!this.ensureName()) return
    this.setData({ createSetupVisible: true })
  },

  closeCreateSetup() { this.setData({ createSetupVisible: false }) },

  selectTableType(event) {
    const tableType = event.currentTarget.dataset.type
    if (["long", "round"].indexOf(tableType) < 0) return
    if (tableType === "long") {
      this.setData({ tableType })
      this.openLayoutEditor()
    } else {
      this.setData({ tableType })
    }
  },

  changePlayerCount(event) {
    const playerCount = Math.max(5, Math.min(10, this.data.playerCount + Number(event.currentTarget.dataset.delta)))
    if (playerCount === this.data.playerCount) return
    const seatLayout = tableLayout.balancedLayout(playerCount)
    this.setData({
      playerCount,
      seatLayout,
      layoutEditorVisible: false
    })
    this.resetRoles(this.data.unknownRoles, playerCount)
  },

  openLayoutEditor() {
    const draftSeatLayout = { ...this.data.seatLayout }
    this.setData({ layoutEditorVisible: true, draftSeatLayout })
    this.refreshLayoutDraft(draftSeatLayout)
  },

  closeLayoutEditor() { this.setData({ layoutEditorVisible: false }) },

  stopPropagation() {},

  changeLayoutSide(event) {
    const region = event.currentTarget.dataset.region
    const delta = Number(event.currentTarget.dataset.delta)
    if (["top", "right", "bottom", "left"].indexOf(region) < 0 || !delta) return
    const layout = { ...this.data.draftSeatLayout }
    if (delta > 0 && tableLayout.assignedCount(layout) >= this.data.playerCount) return
    layout[region] = Math.max(0, Number(layout[region] || 0) + delta)
    this.setData({ draftSeatLayout: layout })
    this.refreshLayoutDraft(layout)
  },

  refreshLayoutDraft(layout) {
    const draftAssignedCount = tableLayout.assignedCount(layout)
    const geometry = tableLayout.tableGeometry(layout)
    this.setData({
      draftAssignedCount,
      draftRemainingCount: this.data.playerCount - draftAssignedCount,
      draftOrientation: geometry.orientation,
      draftTableWidth: geometry.width,
      draftTableHeight: geometry.height
    })
  },

  useSeatLayout() {
    if (this.data.draftAssignedCount !== this.data.playerCount) return
    const seatLayout = { ...this.data.draftSeatLayout }
    this.setData({
      seatLayout,
      layoutEditorVisible: false
    })
  },

  resetSeatLayout() {
    const draftSeatLayout = tableLayout.balancedLayout(this.data.playerCount)
    this.setData({ draftSeatLayout })
    this.refreshLayoutDraft(draftSeatLayout)
  },

  toggleUnknownRoles(event) {
    const unknownRoles = !!event.detail.value
    if (!unknownRoles) {
      this.setData({ unknownRoles })
      this.resetRoles(false)
      return
    }
    const roleCounts = gameUtil.normalizeCandidatePool(this.data.playerCount, this.data.roleCounts, true)
    this.setData({ unknownRoles, roleCounts })
    this.refreshRoles()
    this.openRoleEditor()
  },

  toggleHunterVote(event) {
    this.setData({ hunterVoteVariant: !!event.detail.value })
    this.refreshRoles()
  },

  resetRoles(unknownRoles, playerCount) {
    const roleCounts = gameUtil.buildDefaultRoleCounts(playerCount || this.data.playerCount, !!unknownRoles)
    this.setData({ roleCounts })
    this.refreshRoles()
  },

  roleTargets(unknownRoles) {
    const expected = gameUtil.officialFactionCounts(this.data.playerCount)
    return { good: expected.good, evil: expected.evil }
  },

  reconcileRoleCounts(source, unknownRoles) {
    const counts = gameUtil.normalizeCandidatePool(this.data.playerCount, source, unknownRoles)
    if (unknownRoles) return counts
    const actual = gameUtil.factionCounts(gameUtil.rolesFromCounts(counts))
    const targets = this.roleTargets(false)
    if (actual.good > targets.good || actual.evil > targets.evil) return null
    return counts
  },

  openRoleEditor() {
    const draftRoleCounts = { ...this.data.roleCounts }
    this.setData({ roleEditorVisible: true, roleFactionFilter: "good", draftRoleCounts })
    this.refreshRoleEditor(draftRoleCounts)
  },

  closeRoleEditor() { this.setData({ roleEditorVisible: false }) },

  selectRoleFaction(event) {
    const roleFactionFilter = event.currentTarget.dataset.faction
    if (["good", "evil"].indexOf(roleFactionFilter) < 0) return
    this.setData({ roleFactionFilter })
    this.refreshRoleEditor(this.data.draftRoleCounts)
  },

  toggleRoleSelection(event) {
    const role = event.currentTarget.dataset.role
    if (["loyal", "minion", "morgan"].indexOf(role) >= 0) return
    const info = gameUtil.getRoleInfo(role)
    if (!info) return
    const draft = { ...this.data.draftRoleCounts }
    const roles = info.pair ? [role, info.pair] : [role]
    const selected = roles.every(key => Number(draft[key] || 0) > 0)
    roles.forEach(key => { draft[key] = selected ? 0 : 1 })
    const reconciled = this.reconcileRoleCounts(draft, this.data.unknownRoles)
    if (!reconciled) {
      wx.showToast({ title: "阵营名额已满，请先移除同阵营角色", icon: "none" })
      return
    }
    this.setData({ draftRoleCounts: reconciled })
    this.refreshRoleEditor(reconciled)
  },

  resetRoleDraft() {
    const draftRoleCounts = gameUtil.buildDefaultRoleCounts(this.data.playerCount, this.data.unknownRoles)
    this.setData({ draftRoleCounts })
    this.refreshRoleEditor(draftRoleCounts)
  },

  useRoleDraft() {
    const roleCounts = { ...this.data.draftRoleCounts }
    this.setData({ roleCounts, roleEditorVisible: false })
    this.refreshRoles()
  },

  refreshRoleEditor(counts) {
    const actual = gameUtil.factionCounts(gameUtil.rolesFromCounts(counts))
    const targets = this.roleTargets(this.data.unknownRoles)
    const balance = gameUtil.estimateBalance(this.data.playerCount, counts, this.data.unknownRoles, this.data.hunterVoteVariant)
    const roleEditorList = gameUtil.availableRoles(this.data.playerCount)
      .filter(item => item.faction === this.data.roleFactionFilter && ["loyal", "minion"].indexOf(item.role) < 0)
      .map(item => ({
        ...item,
        selected: Number(counts[item.role] || 0) > 0,
        locked: !!item.required,
        factionName: gameUtil.factionLabel(item.faction),
        packName: gameUtil.packLabel(item.pack),
        pairName: item.pair ? gameUtil.getRoleInfo(item.pair).name : ""
      }))
    this.setData({
      roleEditorList,
      goodRoleCount: actual.good,
      evilRoleCount: actual.evil,
      targetGoodCount: targets.good,
      targetEvilCount: targets.evil,
      balanceScore: balance.score,
      balanceMarkerPercent: balance.markerPercent,
      balanceTitle: balance.title,
      balanceWarning: balance.warning,
      balanceLevel: balance.level
    })
  },

  refreshRoles() {
    const validation = gameUtil.validateRoleConfig(this.data.playerCount, this.data.roleCounts, this.data.unknownRoles)
    const selected = gameUtil.availableRoles(this.data.playerCount)
      .filter(item => Number(this.data.roleCounts[item.role] || 0) > 0)
      .map(item => ({ ...item, count: Number(this.data.roleCounts[item.role] || 0) }))
    const summaryFor = faction => selected.filter(item => item.faction === faction)
      .map(item => `${item.name}${item.count > 1 ? `×${item.count}` : ""}`).join("、")
    const actual = gameUtil.factionCounts(gameUtil.rolesFromCounts(this.data.roleCounts))
    const targets = this.roleTargets(this.data.unknownRoles)
    const balance = gameUtil.estimateBalance(this.data.playerCount, this.data.roleCounts, this.data.unknownRoles, this.data.hunterVoteVariant)
    const rolePoolCount = actual.good + actual.evil
    this.setData({
      goodRoleSummary: summaryFor("good"),
      evilRoleSummary: summaryFor("evil"),
      goodRoleCount: actual.good,
      evilRoleCount: actual.evil,
      targetGoodCount: targets.good,
      targetEvilCount: targets.evil,
      balanceScore: balance.score,
      balanceMarkerPercent: balance.markerPercent,
      balanceTitle: balance.title,
      balanceWarning: balance.warning,
      balanceLevel: balance.level,
      rolePoolCount,
      roleErrors: validation.errors,
      roleConfigValid: validation.valid
    })
  },

  ensureName() {
    if (!this.data.playerName.trim()) {
      wx.showToast({ title: "先填昵称", icon: "none" })
      return false
    }
    return true
  },

  createRoom() {
    if (!this.ensureName()) return
    if (!this.data.roleConfigValid) {
      wx.showToast({ title: this.data.roleErrors[0] || "角色配置不合法", icon: "none" })
      return
    }
    wx.showLoading({ title: "创建中" })
    roomStore.createRoom({
      playerCount: this.data.playerCount,
      roleCounts: this.data.roleCounts,
      unknownRoles: this.data.unknownRoles,
      hunterVoteVariant: this.data.hunterVoteVariant,
      tableType: this.data.tableType,
      seatLayout: this.data.tableType === "long" ? this.data.seatLayout : null
    }).then(({ roomId }) => {
      wx.hideLoading()
      wx.navigateTo({ url: `/pages/room/room?roomId=${roomId}&name=${encodeURIComponent(this.data.playerName)}` })
    }).catch(error => this.showError("创建失败", error))
  },

  joinRoom() {
    if (!this.ensureName()) return
    const code = this.data.joinCode.trim()
    if (code.length !== 6) {
      wx.showToast({ title: "请输入6位房间码", icon: "none" })
      return
    }
    wx.showLoading({ title: "查找房间" })
    roomStore.findRoomByCode(code).then(room => {
      wx.hideLoading()
      if (!room) return wx.showToast({ title: "房间不存在", icon: "none" })
      this.setData({ joinPadVisible: false })
      wx.navigateTo({ url: `/pages/room/room?roomId=${room._id}&name=${encodeURIComponent(this.data.playerName)}` })
    }).catch(error => this.showError("加入失败", error))
  },

  showError(title, error) {
    wx.hideLoading()
    wx.showModal({ title, content: error.message || "请确认已部署 avalonGame 云函数。", showCancel: false })
  }
})
