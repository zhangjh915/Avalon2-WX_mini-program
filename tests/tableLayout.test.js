const assert = require("assert")
const layout = require("../miniprogram/utils/tableLayout")

assert.deepStrictEqual(layout.balancedLayout(5), {
  top: 0, right: 2, bottom: 0, left: 3
})
assert.deepStrictEqual(layout.normalizeLayout(8, null, { top: 3, bottom: 5 }), {
  top: 3, right: 0, bottom: 5, left: 0
})

const custom = { top: 3, right: 1, bottom: 3, left: 1 }
assert.strictEqual(layout.assignedCount(custom), 8)
assert.strictEqual(layout.isValidLayout(8, custom), true)
assert.strictEqual(layout.isValidLayout(7, custom), false)
assert.strictEqual(layout.orientationFor(custom), "horizontal")
assert.strictEqual(layout.orientationFor({ ...layout.emptyLayout(), left: 4, right: 4 }), "vertical")

const positions = Array.from({ length: 8 }, (_, index) => layout.longPosition(index, 8, custom))
assert.strictEqual(positions[0].y, 24.5)
assert.strictEqual(positions[1].y, 24.5)
assert.strictEqual(positions[2].y, 24.5)
assert.strictEqual(positions[3].x, 84.5)
assert.ok(positions[4].x > positions[6].x, "bottom seats should continue clockwise from right to left")
assert.strictEqual(positions[7].x, 15.5)

const vertical = { ...layout.emptyLayout(), left: 4, right: 4 }
const verticalPositions = Array.from({ length: 8 }, (_, index) => layout.longPosition(index, 8, vertical))
assert.strictEqual(verticalPositions[0].x, 74)
assert.strictEqual(verticalPositions[4].x, 26)
// 座位改成「按最长边的间距开格子、居中占用」后，跨度是边长的 (count-1)/count，
// 4 人时占 75%（52 → 39）。旧算法贴着两端所以能到 100%，阈值跟着调。
assert.ok(verticalPositions[3].y - verticalPositions[0].y > 35, "long-side seats should use most of the table edge")

// 两条对边人数不同时，间距必须一致、人少的那边居中——
// 否则人少的边只剩两头各一个、中间空一大片（左4右2 时右边正好和左边最上最下平齐）。
const uneven = { ...layout.emptyLayout(), left: 4, right: 2, bottom: 2 }
const un = Array.from({ length: 8 }, (_, i) => layout.longPosition(i, 8, uneven))
const rightYs = [un[0].y, un[1].y]                       // right 先排
const leftYs = [un[4].y, un[5].y, un[6].y, un[7].y]
const gap = (ys) => Math.abs(ys[1] - ys[0])
assert.ok(Math.abs(gap(rightYs) - gap(leftYs)) < 0.01, "对边座位间距要一致")
const mid = (ys) => (Math.min(...ys) + Math.max(...ys)) / 2
assert.ok(Math.abs(mid(rightYs) - mid(leftYs)) < 0.01, "人少的那边要居中，不能贴两端")
// 且不能贴到边缘（贴边正是旧算法的毛病）
assert.ok(Math.min(...rightYs) > Math.min(...leftYs) + 1, "人少的边不该和人多的边最上端平齐")

const verticalWithBottomSeat = { top: 0, right: 4, bottom: 1, left: 4 }
const verticalMixedGeometry = layout.tableGeometry(verticalWithBottomSeat)
assert.deepStrictEqual(verticalMixedGeometry, { width: 35, height: 60, orientation: "vertical" })
assert.ok(verticalMixedGeometry.height > verticalMixedGeometry.width * 1.6, "left/right-heavy layout should remain visibly vertical")
const bottomSeat = layout.longPosition(4, 9, verticalWithBottomSeat)
assert.ok(bottomSeat.y >= 85, "bottom seat should remain outside the long table edge")

assert.deepStrictEqual(layout.normalizeLayout(8, {
  top: 2, right: 1, bottom: 2, left: 1,
  topLeft: 1, topRight: 0, bottomRight: 1, bottomLeft: 0
}), { top: 3, right: 1, bottom: 3, left: 1 })
assert.ok(layout.tableGeometry({ top: 5, right: 0, bottom: 5, left: 0 }).width > layout.tableGeometry(vertical).width)

const round = layout.roundPosition(0, 8)
assert.strictEqual(round.x, 50)
assert.strictEqual(round.y, 13)
const roundRight = layout.roundPosition(2, 8)
assert.strictEqual(roundRight.x - 50, 50 - round.y, "round seats must use the same horizontal and vertical radius")

console.log("table layout tests passed")
