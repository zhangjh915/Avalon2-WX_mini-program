// 开场播报播放器：只在房主机上放、以 claimAt 为锚定位、同一锚点只启动一次、关掉开关就不响。
const assert = require("assert")

const created = []
const storage = {}
global.wx = {
  createInnerAudioContext() {
    const audio = { calls: [], obeyMuteSwitch: true, src: "", startTime: 0, volume: 1,
      play() { this.calls.push("play") }, pause() { this.calls.push("pause") }, stop() { this.calls.push("stop") },
      destroy() { this.calls.push("destroy") }, seek(v) { this.calls.push(`seek:${Math.round(v)}`) },
      onError() {}, onEnded(cb) { this.ended = cb } }
    created.push(audio)
    return audio
  },
  getStorageSync(key) { return storage[key] },
  setStorageSync(key, value) { storage[key] = value },
  removeStorageSync(key) { delete storage[key] }
}
const audio = require("../miniprogram/utils/identityAudio")
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

;(async () => {
  const anchor = Date.now() - 12000
  audio.start("cloud://x/assets/audio/identity-briefing.mp3", anchor)
  await tick()
  assert.strictEqual(created.length, 1, "应当创建一个播放器")
  assert.strictEqual(created[0].obeyMuteSwitch, false, "静音键不能压掉播报")
  assert.ok(created[0].startTime >= 11.5 && created[0].startTime <= 13, `进来晚了 12 秒就该从 12 秒起放，实际 ${created[0].startTime}`)
  assert.deepStrictEqual(created[0].calls, ["play"])

  // 轮询会反复调 start：同一个锚点不重启
  audio.start("cloud://x/assets/audio/identity-briefing.mp3", anchor)
  await tick()
  assert.strictEqual(created.length, 1, "同一锚点不该重复启动")

  // 切后台/回前台：暂停后按锚点重新定位
  audio.pause()
  audio.resume()
  assert.ok(created[0].calls.indexOf("pause") >= 0 && created[0].calls.some(call => /^seek:1[1-3]$/.test(call)), `回前台应按锚点重新定位：${created[0].calls}`)

  // 离开阶段：淡出后停掉并销毁
  audio.stop(true)
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.ok(created[0].calls.indexOf("destroy") >= 0, "淡出后应销毁播放器")

  // 开关关掉：什么都不放
  audio.setEnabled(false)
  assert.strictEqual(audio.enabled(), false)
  audio.start("cloud://x/assets/audio/identity-briefing.mp3", Date.now())
  await tick()
  assert.strictEqual(created.length, 1, "开关关了不该再创建播放器")
  audio.setEnabled(true)
  assert.strictEqual(audio.enabled(), true)

  // 试听从头放
  audio.preview("cloud://x/assets/audio/identity-briefing.mp3")
  await tick()
  assert.strictEqual(created.length, 2)
  assert.strictEqual(created[1].startTime, 0)
  audio.stop(false)
  assert.ok(created[1].calls.indexOf("destroy") >= 0)

  console.log("identity audio tests passed")
})().catch(error => { console.error(error); process.exitCode = 1 })
