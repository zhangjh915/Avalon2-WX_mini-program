// 身份阅读阶段的计时。
//
// 关键规则：阅读倒计时从「本人翻开牌」那一刻算起，不是从全局揭示时刻算起。
// 否则没翻牌的玩家会被全局倒计时直接推进到下一步，整局都没看到自己的身份——
// 这个 bug 真实发生过，改成手动翻牌后才暴露出来。

const assert = require("assert")
const path = require("path")

let definition = null
global.Page = value => { definition = value }
global.wx = { vibrateShort() {}, showToast() {} }
require(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js"))
delete global.Page

const READ_MS = 40000

function makeCtx(opts) {
  const now = Date.now()
  return {
    now,
    identityFlippedAt: opts.flippedAt || 0,
    data: {
      phase: "reveal",
      finalStage: "",
      cardFlipped: !!opts.flipped,
      game: { identity: { revealAt: now - opts.sinceReveal, closeAt: now - opts.sinceReveal + READ_MS } }
    },
    setData(v) { Object.assign(this.data, v) },
    updateClock: definition.updateClock
  }
}

// 未翻牌：即使全局窗口早已结束，也必须停在 reading，牌还能点
const notFlipped = makeCtx({ flipped: false, sinceReveal: 60000 })
notFlipped.updateClock()
assert.strictEqual(notFlipped.data.identityMode, "reading", "没翻牌不能被推进到下一步")
assert.strictEqual(notFlipped.data.readingHint, "翻开后开始计时")
assert.strictEqual(notFlipped.data.roleVisible, false, "没翻牌不应暴露身份")

// 刚揭示就翻牌：倒计时等价于原来的全局 40 秒
const early = makeCtx({ flipped: true, sinceReveal: 5000, flippedAt: Date.now() - 5000 })
early.updateClock()
assert.strictEqual(early.data.identityMode, "reading")
assert.ok(early.data.identitySecondsLeft >= 34 && early.data.identitySecondsLeft <= 36,
  `刚开局翻牌应剩约 35 秒，实际 ${early.data.identitySecondsLeft}`)

// 全局窗口只剩 2 秒时才翻牌：仍然给满 40 秒，不被压缩
const late = makeCtx({ flipped: true, sinceReveal: 38000, flippedAt: Date.now() })
late.updateClock()
assert.strictEqual(late.data.identityMode, "reading", "晚翻牌的人不能立刻被推走")
assert.ok(late.data.identitySecondsLeft >= 39,
  `晚翻牌应仍有约 40 秒，实际 ${late.data.identitySecondsLeft}`)

// 翻牌后读满 40 秒才进入 remember
const done = makeCtx({ flipped: true, sinceReveal: 90000, flippedAt: Date.now() - READ_MS - 1000 })
done.updateClock()
assert.strictEqual(done.data.identityMode, "remember", "读满时间后应进入确认阶段")

// 揭示前仍然是倒数阶段
const before = makeCtx({ flipped: false, sinceReveal: -2000 })
before.updateClock()
assert.strictEqual(before.data.identityMode, "countdown")

delete global.wx
console.log("identity timing tests passed")
