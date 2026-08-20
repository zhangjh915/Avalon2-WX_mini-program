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
const TIMEOUT_PATTERN = /-504003|timed out|timeout/i

function invoke(action, payload) {
  return wx.cloud.callFunction({ name: functionName, data: { action, ...(payload || {}) } })
}

function call(action, payload) {
  if (!wx.cloud) return Promise.reject(new Error("请先开启微信云开发"))
  return invoke(action, payload).catch(error => {
    if (!TIMEOUT_PATTERN.test(String(error && (error.errMsg || error.message) || ""))) throw error
    console.warn("[avalonGame] 冷启动超时，重试一次", action)
    return invoke(action, payload)
  }).then(response => {
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
