const functionName = "avalonGame"

function call(action, payload) {
  if (!wx.cloud) return Promise.reject(new Error("请先开启微信云开发"))
  return wx.cloud.callFunction({
    name: functionName,
    data: { action, ...(payload || {}) }
  }).then(response => {
    const result = response.result
    if (!result) throw new Error("云函数未返回数据")
    return result
  }).catch(error => {
    const message = error && (error.errMsg || error.message) || "云端请求失败"
    const marker = message.indexOf("Error: ")
    throw new Error(marker >= 0 ? message.slice(marker + 7) : message)
  })
}

function createRoom(payload) { return call("createRoom", payload) }
function findRoomByCode(code) { return call("findRoom", { code }).then(result => result.room) }
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
