// 认身份阶段的计时：整段时间轴在房主点「统一揭示身份」那一刻定死（跟开场播报的音频一致）。
//   claimAt → lockAt：队长选展示阵营，屏上倒计时
//   lockAt → revealAt：阵营锁定，洗牌，谁都不能翻牌
//   revealAt → closeAt：全局同一个阅读窗口，翻没翻牌都在走；翻了才看得见身份
//   closeAt 之后：收起，进入确认；没翻过牌的人在那一屏补看
const assert = require("assert")
const path = require("path")

let definition = null
global.Page = value => { definition = value }
global.wx = { vibrateShort() {}, showToast() {}, getStorageSync() { return "" }, setStorageSync() {}, removeStorageSync() {} }
require(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js"))
delete global.Page

function ctxAt(offsetMs, opts) {
  const claimAt = Date.now() - offsetMs
  return {
    data: {
      phase: "reveal", finalStage: "", cardFlipped: !!(opts && opts.flipped),
      privateView: { needsLeaderClaim: !!(opts && opts.leader) },
      game: { identity: { claimAt, lockAt: claimAt + 15000, revealAt: claimAt + 18000, closeAt: claimAt + 58000 } }
    },
    setData(v) { Object.assign(this.data, v) },
    vibrate() {},
    updateClock: definition.updateClock,
    flipIdentityCard: definition.flipIdentityCard
  }
}

// 选择窗口：队长看牌和选项并有倒计时，其他人等
const leader = ctxAt(2000, { leader: true }); leader.updateClock()
assert.strictEqual(leader.data.identityMode, "leaderClaim")
assert.strictEqual(leader.data.roleVisible, true)
assert.ok(leader.data.claimSecondsLeft >= 12 && leader.data.claimSecondsLeft <= 13, `倒计时应剩约 13 秒，实际 ${leader.data.claimSecondsLeft}`)
const waiter = ctxAt(2000, {}); waiter.updateClock()
assert.strictEqual(waiter.data.identityMode, "waitLeaderClaim")
assert.strictEqual(waiter.data.roleVisible, false, "非队长在选择窗口不能看到身份")

// 锁定到揭示之间：洗牌，翻牌被拒
const shuffling = ctxAt(16000, {}); shuffling.updateClock()
assert.strictEqual(shuffling.data.identityMode, "shuffling")
shuffling.flipIdentityCard()
assert.strictEqual(shuffling.data.cardFlipped, false, "洗牌中不能翻牌")

// 阅读窗口：全局计时，翻没翻都在走；翻了才可见
const unflipped = ctxAt(20000, {}); unflipped.updateClock()
assert.strictEqual(unflipped.data.identityMode, "reading")
assert.strictEqual(unflipped.data.roleVisible, false)
assert.ok(unflipped.data.identitySecondsLeft >= 37 && unflipped.data.identitySecondsLeft <= 38, `全局窗口应剩约 38 秒，实际 ${unflipped.data.identitySecondsLeft}`)
unflipped.flipIdentityCard()
assert.strictEqual(unflipped.data.cardFlipped, true, "揭示后可以翻牌")
unflipped.updateClock()
assert.strictEqual(unflipped.data.roleVisible, true)
const lateFlip = ctxAt(50000, { flipped: true }); lateFlip.updateClock()
assert.ok(lateFlip.data.identitySecondsLeft <= 8, "翻得晚不再额外补时间，计时是全局的")

// 最后 5 秒：紧迫态
const urgent = ctxAt(55000, { flipped: true }); urgent.updateClock()
assert.strictEqual(urgent.data.readingUrgent, true)

// 收起之后：不管翻没翻都进确认
const done = ctxAt(60000, { flipped: true }); done.updateClock()
assert.strictEqual(done.data.identityMode, "remember")
const never = ctxAt(60000, {}); never.updateClock()
assert.strictEqual(never.data.identityMode, "remember", "没翻牌的人也进确认屏，在那里补看")

// 还没点「统一揭示身份」：准备屏
const idle = { data: { phase: "reveal", finalStage: "", cardFlipped: false, privateView: {}, game: { identity: { claimAt: 0 } } }, setData(v) { Object.assign(this.data, v) }, vibrate() {}, updateClock: definition.updateClock }
idle.updateClock()
assert.strictEqual(idle.data.identityMode, "prepare")

delete global.wx
console.log("identity timing tests passed")
