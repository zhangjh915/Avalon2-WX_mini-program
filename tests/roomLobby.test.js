const assert = require("assert")
const gameUtil = require("../miniprogram/utils/game")

let definition = null
global.Page = value => { definition = value }
global.wx = {
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
console.log("room lobby tests passed")
