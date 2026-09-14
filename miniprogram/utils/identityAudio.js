// 认身份的开场播报：一段固定音频（配音和 BGM 合成好的），只在房主手机上放。
//
// 时间轴以服务端的 claimAt 为锚：进来晚了、切出去再回来，都按「现在减 claimAt」
// 跳到对应位置，所以音乐和屏幕上的倒计时永远对得上。房主点「开始远征」时一秒淡出。
// 音频是锦上添花：下载失败、播放出错一律静默，绝不能卡流程。
const assets = require("./assets")

const STORAGE_KEY = "identityAudioOff"
let ctx = null
let playingKey = ""
let fadeTimer = null
let previewTimer = null

function hasWx() { return typeof wx !== "undefined" && !!wx.createInnerAudioContext }

function enabled() {
  try { return !wx.getStorageSync(STORAGE_KEY) } catch (error) { return true }
}

function setEnabled(on) {
  try { if (on) wx.removeStorageSync(STORAGE_KEY); else wx.setStorageSync(STORAGE_KEY, 1) } catch (error) {}
  if (!on) stop(false)
}

function offsetSeconds(anchorAt, now) {
  return Math.max(0, ((now || Date.now()) - anchorAt) / 1000)
}

function create(src, offset) {
  const audio = wx.createInnerAudioContext()
  audio.obeyMuteSwitch = false   // 拨了静音键也要出声；房主在开局屏有开关和试听
  audio.src = src
  audio.startTime = offset
  audio.volume = 1
  audio.onError(() => {})
  audio.play()
  return audio
}

function destroy(audio) {
  try { audio.stop() } catch (error) {}
  try { audio.destroy() } catch (error) {}
}

// 从锚点开始放；同一个锚点只启动一次（轮询每轮都会来调）
function start(fileID, anchorAt) {
  if (!fileID || !anchorAt || !hasWx() || !enabled()) return
  const key = `${fileID}|${anchorAt}`
  if (playingKey === key) return
  stop(false)
  playingKey = key
  assets.localCopy(fileID).then(src => {
    if (playingKey !== key || !src) return
    ctx = create(src, offsetSeconds(anchorAt))
    ctx.onEnded(() => { if (playingKey === key) ctx = null })   // 放完就完，不循环
  })
}

function stop(fade) {
  const audio = ctx
  playingKey = ""
  ctx = null
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
  if (!audio) return
  if (!fade) { destroy(audio); return }
  let volume = 1
  fadeTimer = setInterval(() => {
    volume -= 0.2
    if (volume <= 0) {
      clearInterval(fadeTimer)
      fadeTimer = null
      destroy(audio)
      return
    }
    try { audio.volume = volume } catch (error) {}
  }, 160)
}

function pause() { if (ctx) { try { ctx.pause() } catch (error) {} } }

// 回到前台：按锚点重新定位再放，别从暂停处接着放
function resume() {
  if (!ctx || !playingKey) return
  const anchorAt = Number(playingKey.split("|")[1])
  if (!anchorAt) return
  try { ctx.seek(offsetSeconds(anchorAt)); ctx.play() } catch (error) {}
}

// 试听：从头放 8 秒后淡出
function preview(fileID) {
  if (!fileID || !hasWx()) return
  stop(false)
  const key = "preview"
  playingKey = key
  assets.localCopy(fileID).then(src => {
    if (playingKey !== key || !src) return
    ctx = create(src, 0)
    previewTimer = setTimeout(() => { if (playingKey === key) stop(true) }, 8000)
  })
}

module.exports = { enabled, setEnabled, offsetSeconds, start, stop, pause, resume, preview }
