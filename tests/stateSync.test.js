const assert = require("assert")
const path = require("path")

function deferred() {
  let resolve
  let reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

async function run() {
  let definition = null
  global.Page = value => { definition = value }
  const modals = []
  const relaunched = []
  global.wx = {
    showToast() {},
    redirectTo() {},
    reLaunch(options) { relaunched.push(options.url) },
    showModal(options) { modals.push(options); if (options.complete) options.complete() }
  }

  const roomStore = require("../miniprogram/utils/roomStore")
  const originalGetState = roomStore.getState
  const originalAction = roomStore.action
  const playPath = path.join(__dirname, "..", "miniprogram", "pages", "play", "play.js")
  delete require.cache[require.resolve(playPath)]
  require(playPath)

  const staleRead = deferred()
  roomStore.getState = () => staleRead.promise
  const applied = []
  const page = {
    data: { roomId: "room-1", syncing: false },
    loading: false,
    stateGeneration: 0,
    setData(patch) { Object.assign(this.data, patch) },
    applyState(result) { applied.push(result) },
    showError() {},
    loadState: definition.loadState,
    handleRoomGone: definition.handleRoomGone,
    stopTimers: definition.stopTimers
  }

  const readPromise = definition.loadState.call(page, false)
  page.stateGeneration += 1
  page.data.syncing = true
  staleRead.resolve({ room: { phase: "mission" } })
  await readPromise
  assert.strictEqual(applied.length, 0, "an in-flight poll must not overwrite a newer write")

  const actionResult = { room: { phase: "vote" } }
  roomStore.action = () => Promise.resolve(actionResult)
  page.data.syncing = false
  page.applyState = result => applied.push(result)
  await definition.sendAction.call(page, "startVote", {}, null, { tableVisible: false })
  assert.strictEqual(applied[0], actionResult)
  assert.strictEqual(page.data.tableVisible, false)
  assert.strictEqual(page.data.syncing, false)

  const failedAction = deferred()
  roomStore.action = () => failedAction.promise
  roomStore.getState = () => Promise.resolve({ room: { phase: "mission" } })
  page.data.tableVisible = true
  page.data.syncing = false
  const failurePromise = definition.sendAction.call(page, "startVote", {}, null, { tableVisible: false })
  failedAction.reject(new Error("network"))
  await failurePromise
  assert.strictEqual(page.data.tableVisible, true, "failed writes keep the current sheet open for retry")

  // 房间失效：必须停表、只弹一次窗，并把玩家送回首页
  const gonePage = {
    data: { roomId: "room-1", syncing: false },
    loading: false,
    stateGeneration: 0,
    setData(patch) { Object.assign(this.data, patch) },
    applyState() { throw new Error("失效房间不应再应用状态") },
    showError() { throw new Error("房间失效应走专用提示，而不是普通错误提示") },
    loadState: definition.loadState,
    handleRoomGone: definition.handleRoomGone,
    stopTimers: definition.stopTimers
  }
  roomStore.getState = () => Promise.reject(new Error("房间不存在或已结束"))
  await definition.loadState.call(gonePage, true)
  assert.strictEqual(modals.length, 1, "房间失效只提示一次")
  assert.deepStrictEqual(relaunched, ["/pages/index/index"], "房间失效后回到首页")
  assert.strictEqual(gonePage.fatalHandled, true)

  await definition.loadState.call(gonePage, true)
  assert.strictEqual(modals.length, 1, "后续轮询失败不应重复弹窗")

  roomStore.getState = originalGetState
  roomStore.action = originalAction
  delete global.Page
  delete global.wx
  console.log("state sync tests passed")
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
