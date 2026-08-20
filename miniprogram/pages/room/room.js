const roomStore = require("../../utils/roomStore")
const gameUtil = require("../../utils/game")
const tableLayout = require("../../utils/tableLayout")
const assets = require("../../utils/assets")

Page({
  data: {
    roomId: "",
    room: null,
    playerName: "",
    isHost: false,
    devMode: false,
    ui: {}, roundTableBg: "", longTableBg: "", floorBg: "",
    floorColor: "", floorOptions: [],
    mySeatNo: 0,
    seatedCount: 0,
    tableType: "round",
    tableOrientation: "horizontal",
    longTable: null, stageW: 0, stageH: 0,
    tableWidth: 44,
    tableHeight: 34,
    settingsSummary: "",
    rolePoolCount: 0,
    goodRoleCount: 0,
    evilRoleCount: 0,
    roleCandidates: [],
    filteredRoleCandidates: [],
    roleFactionFilter: "good",
    roleViewerVisible: false,
    writing: false
  },

  pollTimer: null,
  loading: false,
  stateGeneration: 0,

  onLoad(options) {
    const playerName = decodeURIComponent(options.name || wx.getStorageSync("playerName") || "")
    this.setData({ playerName })
    if (options.roomId) return this.enterRoom(options.roomId)
    wx.redirectTo({ url: "/pages/index/index" })
  },

  enterRoom(roomId) {
    this.setData({ roomId })
    this.loadBackgrounds()
    this.loadRoom(true)
    this.startPolling()
  },

  onUnload() { this.stopPolling() },

  // CSS 背景不认 cloud://，先换成 https 临时链接
  loadBackgrounds() {
    assets.backgroundStyles().then(styles => this.setData(styles))
  },

  // 切后台时停止轮询省流量，回到前台立刻补一次拉取，
  // 不必等下一个轮询周期才恢复到最新状态。
  onReady() {
    this.measureStage()
  },

  onShow() {
    if (!this.data.roomId || this.fatalHandled) return
    this.loadBackgrounds()
    this.startPolling()
    this.loadRoom(false)
  },

  onHide() { this.stopPolling() },

  startPolling() {
    this.stopPolling()
    this.pollTimer = setInterval(() => {
      this.loadRoom(false)
      // 临时链接会过期成 403，而 onShow 在一局里根本不会再触发
      if (assets.backgroundsStale()) this.loadBackgrounds()
    }, 1200)
  },

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  },

  loadRoom(showError) {
    if (this.loading || this.data.writing) return Promise.resolve()
    const generation = this.stateGeneration
    this.loading = true
    return roomStore.getState(this.data.roomId).then(result => {
      if (generation !== this.stateGeneration || this.data.writing) return
      this.applyState(result)
    }).catch(error => {
      if (this.handleRoomGone(error)) return
      if (showError) this.showWriteError(error)
    }).finally(() => { this.loading = false })
  },

  // 房间被清理或已结束时，轮询会一直失败；直接停下并送玩家回首页。
  handleRoomGone(error) {
    if (!/房间不存在|已结束/.test(error && error.message || "")) return false
    if (this.fatalHandled) return true
    this.fatalHandled = true
    this.stopPolling()
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
    if (room.status === "playing") return this.leaveTo(`/pages/play/play?roomId=${room._id}`)
    if (room.status === "finished") return this.leaveTo(`/pages/result/result?roomId=${room._id}`)
    const seats = this.decorateSeats(room.seats || [], room.playerCount, room.tableType || "round", room.seatLayout, room.tableSides)
    const roleCounts = room.settings && room.settings.roleCounts || {}
    const roleCandidates = Object.keys(roleCounts).filter(role => roleCounts[role]).map(role => {
      const info = gameUtil.getRoleInfo(role) || { name: role, faction: "good", pack: "base", desc: "" }
      return {
        role,
        name: info.name,
        faction: info.faction,
        packName: gameUtil.packLabel(info.pack),
        desc: info.desc,
        pairName: info.pair ? (gameUtil.getRoleInfo(info.pair) || {}).name : "",
        count: Number(roleCounts[role]) || 0
      }
    })
    const roleFactionFilter = this.data.roleFactionFilter
    const filteredRoleCandidates = roleCandidates.filter(role => role.faction === roleFactionFilter)
    const settings = []
    if (room.tableType === "long") settings.push("长桌自定义座位")
    else settings.push("圆桌")
    if (room.settings && room.settings.unknownRoles) settings.push("未知角色")
    if (room.settings && room.settings.hunterVoteVariant) settings.push("猎杀投票")
    const mySeat = seats.find(seat => seat.isMine)
    const tableGeometry = tableLayout.tableGeometry(tableLayout.normalizeLayout(room.playerCount, room.seatLayout, room.tableSides))
    this.setData({
      room: { ...room, seats },
      tableType: room.tableType || "round",
      tableOrientation: tableGeometry.orientation,
      tableWidth: tableGeometry.width,
      tableHeight: tableGeometry.height,
      isHost: !!result.isHost,
      ui: assets.uiIcons(),
      // 以房间创建时写入的测试模式为准；服务端对每个测试操作另有独立校验
      devMode: !!room.devMode,
      mySeatNo: mySeat ? mySeat.seatNo : 0,
      seatedCount: seats.filter(seat => seat.name).length,
      settingsSummary: settings.length ? settings.join(" · ") : "基础规则",
      rolePoolCount: roleCandidates.reduce((total, role) => total + role.count, 0),
      goodRoleCount: roleCandidates.filter(role => role.faction === "good").reduce((total, role) => total + role.count, 0),
      evilRoleCount: roleCandidates.filter(role => role.faction === "evil").reduce((total, role) => total + role.count, 0),
      roleCandidates,
      filteredRoleCandidates
    })
    this.refreshLongTable()
  },

  // 地毯是个人偏好，只写本地 storage，不进房间数据——不同玩家看到不同颜色不影响对局
  selectFloorColor(event) {
    const floorColor = assets.setFloorColor(event.currentTarget.dataset.color)
    const option = this.data.floorOptions.find(item => item.key === floorColor)
    this.setData({ floorColor, floorBg: option ? option.bg : "" })
  },

  // 离开候场页。必须先停轮询并上锁：轮询每 1200ms 就会再发一次 redirectTo，
  // 后一次会打断前一次正在进行的导航，页面能一直卡在候场页跳不出去
  // （表现为「点了开始游戏没反应，再点一次报游戏已经开始」）。
  // redirectTo 本身也要接 fail——它默认静默失败，出了问题日志上什么都看不到。
  leaveTo(url) {
    if (this.navigating) return
    this.navigating = true
    this.stopPolling()
    wx.redirectTo({
      url,
      fail: error => {
        this.navigating = false
        this.startPolling()
        console.error("[room] 跳转失败", url, error && error.errMsg)
      }
    })
  },

  // 长桌挑档要用**运行时实测的 stage 尺寸**：stage 宽随屏宽变而高固定，
  // 375pt 屏上长宽比 1.19、414pt 屏上 1.32，差 11%，写死会挑错档。
  measureStage(attempt) {
    wx.createSelectorQuery().in(this).selectAll(".lobby-table-stage").boundingClientRect(rects => {
      const rect = (rects || []).find(item => item && item.width > 0 && item.height > 0)
      if (!rect) {
        // 量到 0 就挑不出档、桌子整个不渲染。布局没完成时补量几次。
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

  openRoleViewer() { this.setData({ roleViewerVisible: true }) },

  closeRoleViewer() { this.setData({ roleViewerVisible: false }) },

  selectRoleFaction(event) {
    const roleFactionFilter = event.currentTarget.dataset.faction
    if (["good", "evil"].indexOf(roleFactionFilter) < 0) return
    const filteredRoleCandidates = this.data.roleCandidates.filter(role => role.faction === roleFactionFilter)
    this.setData({ roleFactionFilter, filteredRoleCandidates })
  },

  onNameInput(event) {
    const playerName = event.detail.value
    this.setData({ playerName })
    wx.setStorageSync("playerName", playerName)
  },

  decorateSeats(seats, count, tableType, seatLayout, tableSides) {
    return seats.map((seat, index) => {
      const pos = tableLayout.seatPosition(index, count, tableType, seatLayout, tableSides)
      return { ...seat, x: pos.x, y: pos.y, initial: seat.name ? seat.name.slice(0, 1) : String(seat.seatNo) }
    })
  },

  chooseSeat(event) {
    if (this.data.writing) return Promise.resolve()
    if (!this.data.room || this.data.room.status !== "lobby") return Promise.resolve()
    if (!this.data.playerName.trim()) {
      wx.showToast({ title: "先填写昵称", icon: "none" })
      return Promise.resolve()
    }
    const seatNo = Number(event.currentTarget.dataset.seat)
    const seat = this.data.room.seats.find(item => item.seatNo === seatNo)
    if (seat.name && !seat.isMine) {
      wx.showToast({ title: "座位已被选择", icon: "none" })
      return Promise.resolve()
    }
    const optimisticSeats = this.data.room.seats.map(item => ({
      ...item,
      isMine: item.seatNo === seatNo,
      name: item.seatNo === seatNo ? this.data.playerName : (item.isMine ? "" : item.name)
    }))
    this.stateGeneration += 1
    this.setData({ room: { ...this.data.room, seats: optimisticSeats }, mySeatNo: seatNo, writing: true })
    return roomStore.takeSeat(this.data.roomId, seatNo, this.data.playerName).then(result => this.applyState(result)).catch(error => {
      this.showWriteError(error)
      this.loadRoom(false)
    }).finally(() => this.setData({ writing: false }))
  },

  fillTestSeats() {
    if (this.data.writing) return Promise.resolve()
    this.stateGeneration += 1
    this.setData({ writing: true })
    return roomStore.fillBots(this.data.roomId).then(result => this.applyState(result)).catch(error => this.showWriteError(error))
      .finally(() => this.setData({ writing: false }))
  },

  startGame() {
    if (this.data.writing) return Promise.resolve()
    if (this.data.seatedCount !== this.data.room.playerCount) {
      wx.showToast({ title: "人还没坐满", icon: "none" })
      return Promise.resolve()
    }
    this.stateGeneration += 1
    this.setData({ writing: true })
    wx.showLoading({ title: "命运洗牌中" })
    return roomStore.startGame(this.data.roomId).then(result => {
      wx.hideLoading()
      this.applyState(result)
    }).catch(error => {
      wx.hideLoading()
      return roomStore.getState(this.data.roomId).then(result => {
        if (result.room && result.room.status !== "lobby") this.applyState(result)
        else this.showWriteError(error)
      }).catch(() => this.showWriteError(error))
    }).finally(() => this.setData({ writing: false }))
  },

  showWriteError(error) {
    wx.showModal({ title: "房间同步失败", content: error.message || "请检查 avalonGame 云函数。", showCancel: false })
  }
})
