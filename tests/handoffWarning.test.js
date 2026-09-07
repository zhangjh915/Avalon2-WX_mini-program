// 「全队长邪恶」提醒：说明书特例——每次远征的队长都是邪恶方时正义方直接获胜。
// 提醒只能用队长手机上本来就有的信息，绝不能变成新的信息来源：
//   - 只提醒邪恶方队长；
//   - 此前每一任队长、以及他正要选的下一任，都必须是他**自己认识**的邪恶方；
//   - 盲眼杀手/叛徒/幻形妖这类不认识队友的角色永远收不到提醒；
//   - 前两轮之后才开始提醒（第三任及以后）。
const assert = require("assert")
const { handoffWarning } = require("../miniprogram/utils/game")

const missions = leaders => leaders.map((leaderId, index) => ({ round: index + 1, leaderId }))
const evil = (id, knownEvilIds) => ({ id, faction: "evil", knownEvilIds })

// 邪恶队长 2 认识 1、3；前两任 1、2 都是邪恶，第三任选 3 → 提醒
assert.ok(handoffWarning(evil(2, [1, 3]), { missions: missions([1, 2]) }, 3), "第三任交给认识的邪恶方应当提醒")
// 提醒文案里不能带任何座位号，避免旁人瞄一眼就得到信息
assert.ok(!/\d+号/.test(handoffWarning(evil(2, [1, 3]), { missions: missions([1, 2]) }, 3)), "提醒文案不该出现座位号")
// 正义方队长永远不提醒
assert.strictEqual(handoffWarning({ id: 2, faction: "good", knownEvilIds: [1, 3] }, { missions: missions([1, 2]) }, 3), "")
// 下一任不是他认识的邪恶方（比如盲眼杀手）→ 不提醒，哪怕对方真是邪恶方
assert.strictEqual(handoffWarning(evil(2, [1]), { missions: missions([1, 2]) }, 3), "")
// 此前有一任队长他不认识 → 不提醒（否则提醒本身就泄露了那一任是邪恶方）
assert.strictEqual(handoffWarning(evil(2, [3]), { missions: missions([1, 2]) }, 3), "")
// 只完成一次远征时还早
assert.strictEqual(handoffWarning(evil(1, [2, 3]), { missions: missions([1]) }, 2), "")
// 第四、五任照样提醒（三败可能还没凑齐）
assert.ok(handoffWarning(evil(3, [1, 2, 4]), { missions: missions([1, 2, 3]) }, 4))
// 不认识任何队友的角色（叛徒、盲眼杀手、幻形妖、王储）：knownEvilIds 为空，永远不提醒
assert.strictEqual(handoffWarning(evil(2, []), { missions: missions([5, 2]) }, 6), "")
// 没选人 / 没视图时安静
assert.strictEqual(handoffWarning(null, { missions: missions([1, 2]) }, 3), "")
assert.strictEqual(handoffWarning(evil(2, [1, 3]), { missions: missions([1, 2]) }, null), "")
console.log("handoff warning tests passed")
