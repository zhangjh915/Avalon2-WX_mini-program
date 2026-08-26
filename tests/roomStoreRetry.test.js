// 并发重试链路。
//
// 由来：多机实测发现，8 个客户端**同时**发同一个动作，有 3 个会失败——
// 数据库事务冲突，服务端脱敏成「服务器开小差了」。线下玩这不是边角情况：
// 一句「都准备好了吗」之后所有人同时点，必然撞上。
// 单机永远测不出来，因为只有一个人在点。
const assert = require("assert")
const path = require("path")

// roomStore 里的 invoke 不传回调，所以 wx.cloud.callFunction 走 Promise 形态
function loadStore(step) {
  delete require.cache[require.resolve("../miniprogram/utils/roomStore")]
  global.wx = {
    cloud: { callFunction: () => step() },
    getStorageSync: () => "", setStorageSync: () => {}
  }
  return require("../miniprogram/utils/roomStore")
}

const conflict = () => {
  const e = new Error("cloud.callFunction:fail Error: errCode: -504002 functions execute fail | errMsg: Error: 服务器开小差了，请重试（abc-123）")
  e.errCode = -504002
  return e
}
const timeout = () => { const e = new Error("errCode: -504003 timed out"); e.errCode = -504003; return e }
const business = () => new Error("cloud.callFunction:fail Error: errMsg: Error: 只有当前队长可以开始投票")

async function run() {
  // 1) 事务冲突要重试，并最终成功
  {
    let calls = 0
    const store = loadStore(() => {
      calls += 1
      return calls <= 2 ? Promise.reject(conflict()) : Promise.resolve({ result: { ok: true } })
    })
    const out = await store.action("room-1", "identityReady")
    assert.deepStrictEqual(out, { ok: true })
    assert.strictEqual(calls, 3, `冲突后应重试到成功，实际只调用 ${calls} 次`)
  }

  // 2) 冷启动超时同样重试（老行为不能丢）
  {
    let calls = 0
    const store = loadStore(() => {
      calls += 1
      return calls === 1 ? Promise.reject(timeout()) : Promise.resolve({ result: { ok: true } })
    })
    await store.action("room-1", "identityReady")
    assert.strictEqual(calls, 2, "超时要重试")
  }

  // 3) 业务规则拒绝**不能**重试——重试也还是同一个结果，白白让玩家多等
  {
    let calls = 0
    const store = loadStore(() => { calls += 1; return Promise.reject(business()) })
    await store.action("room-1", "startVote").then(
      () => { throw new Error("业务错误不该成功") },
      () => {})
    assert.strictEqual(calls, 1, `业务拒绝不该重试，实际调用 ${calls} 次`)
  }

  // 4) 只读操作不重试：900ms 后的下一轮轮询本来就是免费重试
  {
    let calls = 0
    const store = loadStore(() => { calls += 1; return Promise.reject(conflict()) })
    await store.getState("room-1").then(() => { throw new Error("应失败") }, () => {})
    assert.strictEqual(calls, 1, `只读操作不该重试，实际调用 ${calls} 次`)
  }

  // 5) 重试有上限，不能无限打下去
  {
    let calls = 0
    const store = loadStore(() => { calls += 1; return Promise.reject(conflict()) })
    await store.action("room-1", "identityReady").then(() => { throw new Error("应失败") }, () => {})
    assert.strictEqual(calls, 3, `应为 1 次原始 + 2 次重试，实际 ${calls} 次`)
  }

  delete global.wx
  console.log("room store retry tests passed")
}

run().catch(error => { console.error(error); process.exit(1) })
