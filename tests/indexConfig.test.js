const assert = require("assert")

let definition = null
global.Page = value => { definition = value }
global.wx = {
  getStorageSync() { return "" },
  setStorageSync() {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  showModal() {},
  vibrateShort() {}
}

require("../miniprogram/pages/index/index.js")
assert.ok(definition)

const page = {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.assign(this.data, patch) }
}
Object.keys(definition).forEach(key => {
  if (typeof definition[key] === "function") page[key] = definition[key].bind(page)
})

page.onLoad()
assert.strictEqual(page.data.tableType, "long")
assert.strictEqual(page.data.playerCount, 8)
assert.strictEqual(page.data.seatLayout.left, 4)
assert.strictEqual(page.data.seatLayout.right, 4)
assert.strictEqual(page.data.seatLayout.top, 0)
assert.strictEqual(page.data.seatLayout.bottom, 0)
assert.strictEqual(page.data.goodRoleCount, 5)
assert.strictEqual(page.data.evilRoleCount, 3)
assert.match(page.data.goodRoleSummary, /忠臣/)
assert.match(page.data.evilRoleSummary, /摩根勒菲/)

page.setData({ playerName: "测试玩家" })
page.openJoinPad()
assert.strictEqual(page.data.joinPadVisible, true)
for (const digit of [1, 2, 3, 4, 5, 6, 7]) page.pressJoinDigit({ currentTarget: { dataset: { digit } } })
assert.strictEqual(page.data.joinCode, "123456")
assert.deepStrictEqual(page.data.joinSlots, ["1", "2", "3", "4", "5", "6"])
page.deleteJoinDigit()
assert.strictEqual(page.data.joinCode, "12345")
page.clearJoinCode()
assert.strictEqual(page.data.joinCode, "")
assert.deepStrictEqual(page.data.joinSlots, ["", "", "", "", "", ""])
page.closeJoinPad()
assert.strictEqual(page.data.joinPadVisible, false)

page.changePlayerCount({ currentTarget: { dataset: { delta: -1 } } })
assert.strictEqual(page.data.playerCount, 7)
assert.strictEqual(page.data.seatLayout.left, 4)
assert.strictEqual(page.data.seatLayout.right, 3)

page.openLayoutEditor()
page.changeLayoutSide({ currentTarget: { dataset: { region: "left", delta: -1 } } })
assert.strictEqual(page.data.draftRemainingCount, 1)
page.changeLayoutSide({ currentTarget: { dataset: { region: "top", delta: 1 } } })
assert.strictEqual(page.data.draftSeatLayout.top, 1)
assert.strictEqual(page.data.draftRemainingCount, 0)
page.changeLayoutSide({ currentTarget: { dataset: { region: "bottom", delta: 1 } } })
assert.strictEqual(page.data.draftSeatLayout.bottom, 0, "cannot over-assign seats")
page.useSeatLayout()
assert.strictEqual(page.data.seatLayout.top, 1)
assert.strictEqual(page.data.layoutEditorVisible, false)

page.selectTableType({ currentTarget: { dataset: { type: "round" } } })
assert.strictEqual(page.data.tableType, "round")
page.changePlayerCount({ currentTarget: { dataset: { delta: 1 } } })
assert.strictEqual(page.data.playerCount, 8)

page.openRoleEditor()
assert.strictEqual(page.data.roleEditorVisible, true)
assert.ok(page.data.roleEditorList.length > 5)
const arthur = page.data.roleEditorList.find(role => role.role === "arthur")
assert.ok(arthur)
page.toggleRoleSelection({ currentTarget: { dataset: { role: "arthur" } } })
assert.strictEqual(page.data.draftRoleCounts.arthur, 1)
assert.strictEqual(page.data.draftRoleCounts.loyal, 0)
const lancelot = page.data.roleEditorList.find(role => role.role === "lancelotGood")
assert.ok(lancelot)
page.toggleRoleSelection({ currentTarget: { dataset: { role: "arthur" } } })
page.toggleRoleSelection({ currentTarget: { dataset: { role: "lancelotGood" } } })
assert.strictEqual(page.data.draftRoleCounts.lancelotGood, 1)
assert.strictEqual(page.data.draftRoleCounts.lancelotEvil, 1)
page.useRoleDraft()
assert.strictEqual(page.data.roleEditorVisible, false)
assert.strictEqual(page.data.roleCounts.arthur, undefined)
assert.strictEqual(page.data.roleConfigValid, true)
page.openRoleEditor()
page.selectRoleFaction({ currentTarget: { dataset: { faction: "evil" } } })
assert.ok(page.data.roleEditorList.every(role => role.faction === "evil"))
page.closeRoleEditor()

page.toggleUnknownRoles({ detail: { value: true } })
assert.strictEqual(page.data.unknownRoles, true)
assert.strictEqual(page.data.roleEditorVisible, true)
assert.strictEqual(page.data.roleConfigValid, false, "开启未知变体后需要人工多选候选角色")
page.toggleRoleSelection({ currentTarget: { dataset: { role: "arthur" } } })
assert.strictEqual(page.data.draftRoleCounts.arthur, 1)
page.useRoleDraft()
assert.strictEqual(page.data.roleConfigValid, true)
assert.ok(page.data.goodRoleCount > page.data.targetGoodCount || page.data.evilRoleCount > page.data.targetEvilCount)
page.toggleUnknownRoles({ detail: { value: false } })
assert.strictEqual(page.data.unknownRoles, false)
assert.strictEqual(page.data.roleConfigValid, true)
assert.strictEqual(page.data.goodRoleCount, page.data.targetGoodCount)
assert.strictEqual(page.data.evilRoleCount, page.data.targetEvilCount)

delete global.Page
delete global.wx
console.log("index config tests passed")
