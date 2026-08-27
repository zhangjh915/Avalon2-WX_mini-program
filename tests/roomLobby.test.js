const fs = require("fs")
const path = require("path")
const assert = require("assert")
const gameUtil = require("../miniprogram/utils/game")

let definition = null
global.Page = value => { definition = value }
global.wx = {
  // applyState 每轮会顺带重测台面，查询链要能一路点下去
  createSelectorQuery: () => {
    const chain = { boundingClientRect: () => chain, fields: () => chain, exec: () => {} }
    return { in: () => ({ select: () => chain, selectAll: () => chain, exec: () => {} }) }
  },
  getStorageSync() { return "" },
  setStorageSync() {},
  redirectTo() {},
  showToast() {},
  showModal() {}
}

require("../miniprogram/pages/room/room.js")
assert.ok(definition)

const page = {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.assign(this.data, patch) }
}
Object.keys(definition).forEach(key => {
  if (typeof definition[key] === "function") page[key] = definition[key].bind(page)
})

const seats = Array.from({ length: 8 }, (_, index) => ({
  seatNo: index + 1,
  name: index === 0 ? "加入玩家" : "",
  isMine: index === 0
}))
page.applyState({
  isHost: false,
  room: {
    _id: "room-test",
    code: "123456",
    status: "lobby",
    playerCount: 8,
    tableType: "round",
    seats,
    settings: {
      roleCounts: gameUtil.buildDefaultRoleCounts(8, false),
      unknownRoles: false,
      hunterVoteVariant: false
    }
  }
})

assert.strictEqual(page.data.isHost, false, "joining players use the shared non-host lobby state")
assert.strictEqual(page.data.seatedCount, 1)
assert.strictEqual(page.data.mySeatNo, 1)
assert.strictEqual(page.data.rolePoolCount, 8)
assert.strictEqual(page.data.goodRoleCount, 5)
assert.strictEqual(page.data.evilRoleCount, 3)
assert.ok(page.data.filteredRoleCandidates.every(role => role.faction === "good"))

page.openRoleViewer()
assert.strictEqual(page.data.roleViewerVisible, true)
page.selectRoleFaction({ currentTarget: { dataset: { faction: "evil" } } })
assert.ok(page.data.filteredRoleCandidates.every(role => role.faction === "evil"))
page.closeRoleViewer()
assert.strictEqual(page.data.roleViewerVisible, false)

const topSeat = page.data.room.seats[0]
const rightSeat = page.data.room.seats[2]
assert.strictEqual(50 - topSeat.y, rightSeat.x - 50, "shared lobby round seats should be circular")

delete global.Page
delete global.wx
// 首任队长：房主在候场页点桌面上的座位来指定，默认随机。
// 线下的动作是「指着那个人」，所以入口是座位本身，不是一份名单。
{
  const wxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "room", "room.wxml"), "utf8")
  const js = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "room", "room.js"), "utf8")

  // 座位在指定模式下必须改走另一个 handler，否则点谁就是「我要坐这」
  const seatTag = (wxml.match(/<view wx:for="\{\{room\.seats\}\}"[^>]*>/) || [""])[0]
  assert.ok(seatTag, "找不到候场页座位")
  assert.match(seatTag, /bindtap="\{\{leaderPickMode \? 'pickFirstLeader' : 'chooseSeat'\}\}"/,
    "指定模式下座位应当改走 pickFirstLeader")

  // 空座位不能被指定——服务端会拒，玩家却看不出为什么
  const pick = js.slice(js.indexOf("pickFirstLeader(event) {"))
  assert.match(pick.slice(0, pick.indexOf("\n  },")), /if \(!seat \|\| !seat\.name\)/,
    "点空座位应当被挡下")

  // 座位号要真的传到 startGame
  assert.match(js, /roomStore\.startGame\(this\.data\.roomId, this\.data\.firstLeaderSeatNo\)/,
    "开局时要把指定的座位号带上")

  // 指定的人中途离座要退回随机，否则会带着空座位号去开局
  assert.match(js, /resolveFirstLeader\(seats\)/, "缺少指定失效后的回退")

  // 默认必须是随机（0），不能默认指到某个人身上
  assert.match(js, /firstLeaderSeatNo: 0/, "首任队长默认应为随机")
}

console.log("room lobby tests passed")
