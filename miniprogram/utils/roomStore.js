const functionName = "avalonGame"

const FALLBACK_MESSAGE = "操作失败，请重试"

// 网络/环境类错误的关键字 → 玩家能看懂的说法。
const NETWORK_HINTS = [
  [/timeout|超时/i, "网络超时，请检查网络后重试"],
  [/fail to fetch|request:fail|网络|ERR_INTERNET|ERR_NETWORK/i, "网络连接失败，请检查网络"],
  [/function not found|FunctionName parameter/i, "云函数未部署，请先部署 avalonGame"],
  [/permission|denied|无权限/i, "没有操作权限，请重新进入房间"],
  [/env|environment/i, "云环境异常，请重新进入小程序"]
]

// 云函数抛出的规则错误文案本身就是给玩家看的，需要原样透出；
// 但云开发会把它包在很长的 errMsg（含堆栈）里，这里只取真正的文案，
// 并对超长/无法识别的内容统一降级，避免把底层堆栈弹给玩家。
function friendlyMessage(error) {
  const raw = String(error && (error.errMsg || error.message) || "").trim()
  if (!raw) return FALLBACK_MESSAGE
  const hit = NETWORK_HINTS.find(([pattern]) => pattern.test(raw))
  if (hit) return hit[1]
  const marker = raw.lastIndexOf("Error: ")
  const text = (marker >= 0 ? raw.slice(marker + 7) : raw).split("\n")[0].trim()
  if (!text || text.length > 40) return FALLBACK_MESSAGE
  return text
}

// 云函数冷启动能跑到 5 秒，而超时上限默认只有 3 秒——实测同一个操作
// 有时 400ms、有时 5720ms，撞上就失败，表现就是「经常操作失败」。
// 根治是把 config.json 的 timeout 调到 20 秒；这里再加一层重试兜底。
//
// 超时**不代表没执行成功**：云函数很可能已经写完库，只是响应没等到。
// 所以只对超时重试，而且只重一次——服务端对这些操作都有幂等保护
// （重复入座无害、startGame 会拒第二次并让客户端改读状态）。
const TIMEOUT_CODE = -504003
const TIMEOUT_PATTERN = /-504003|timed out|timeout/i
// 只读操作不重试：900ms 后的下一轮轮询本来就是一次免费重试，
// 而重试期间页面的 loading 闸门一直关着，等于把「拿不到新状态」的时间翻倍。
const READ_ONLY = ["getState", "getResult", "findRoom"]

// 数据库事务冲突。多人**同时**点同一个动作时，事务会有人抢不到而失败，
// 服务端把它脱敏成「服务器开小差了」。线下玩这不是边角情况而是常态：
// 一句「都准备好了吗」之后所有人同时点，实测 8 个并发有 3 个吃这个错。
// 冲突是瞬时的，重试就好——和超时一样，服务端对这些写操作都有幂等保护。
const CONFLICT_PATTERN = /服务器开小差|AVALON_INTERNAL_ERROR/

function isTimeout(error) {
  // errCode 是结构化的，优先用它；正则只兜住拿不到 errCode 的情况
  if (error && error.errCode === TIMEOUT_CODE) return true
  return TIMEOUT_PATTERN.test(String(error && (error.errMsg || error.message) || ""))
}

function isConflict(error) {
  return CONFLICT_PATTERN.test(String(error && (error.errMsg || error.message) || ""))
}

// 退避带抖动：几个人同时被拒，如果都在同一时刻重试就会再撞一次。
function backoff(attempt) {
  const base = 120 * attempt
  return new Promise(resolve => setTimeout(resolve, base + Math.floor(Math.random() * 120)))
}

function invoke(action, payload) {
  return wx.cloud.callFunction({ name: functionName, data: { action, ...(payload || {}) } })
}

// 写操作最多重试 2 次：单次重试压不住——8 个并发里失败的那 3 个
// 如果同时重试，还会再撞。两次加抖动退避实测能收敛。
const MAX_RETRY = 2

function invokeWithRetry(action, payload, attempt) {
  return invoke(action, payload).catch(error => {
    const retryable = isTimeout(error) || isConflict(error)
    if (READ_ONLY.indexOf(action) >= 0 || !retryable || attempt >= MAX_RETRY) throw error
    console.warn(`[avalonGame] ${isTimeout(error) ? "冷启动超时" : "事务冲突"}，第 ${attempt + 1} 次重试`, action)
    return backoff(attempt + 1).then(() => invokeWithRetry(action, payload, attempt + 1))
  })
}

function call(action, payload) {
  if (!wx.cloud) return Promise.reject(new Error("请先开启微信云开发"))
  return invokeWithRetry(action, payload, 0).then(response => {
    const result = response.result
    if (!result) throw new Error("云函数未返回数据")
    return result
  }).catch(error => {
    // 完整错误留在开发者工具控制台，便于排查；弹窗只给简短文案。
    console.error("[avalonGame] 调用失败", action, error)
    const wrapped = new Error(friendlyMessage(error))
    wrapped.raw = error
    throw wrapped
  })
}

function createRoom(payload) { return call("createRoom", payload) }
// 返回 { room, reason }：reason 为 "expired" 时说明房间码命中了已失效的旧房间。
function findRoomByCode(code) { return call("findRoom", { code }) }
function getState(roomId) { return call("getState", { roomId }) }
function takeSeat(roomId, seatNo, name) { return call("takeSeat", { roomId, seatNo, name }) }
function fillBots(roomId) { return call("fillBots", { roomId }) }
function updateSettings(roomId, settings) { return call("updateSettings", { roomId, ...settings }) }
function startGame(roomId) { return call("startGame", { roomId }) }
function action(roomId, actionName, payload) { return call(actionName, { roomId, ...(payload || {}) }) }
function getResult(roomId) { return call("getResult", { roomId }) }

module.exports = {
  call,
  createRoom,
  findRoomByCode,
  getState,
  takeSeat,
  fillBots,
  updateSettings,
  startGame,
  action,
  getResult
}
