// 测试模式的可用范围。
// 这是「正式对局不会被测试玩家破坏」的最后一道客户端防线，
// 服务端另有 requireDevRoom 独立校验，两边都不能松。

const assert = require("assert")
const path = require("path")

const envPath = path.join(__dirname, "..", "miniprogram", "utils", "env.js")

function loadWith(envVersion) {
  delete require.cache[require.resolve(envPath)]
  global.wx = envVersion === undefined
    ? undefined
    : { getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }
  return require(envPath)
}

// 开发版与体验版都要能开测试模式：开发期两边都需要补测试玩家单机走流程
assert.strictEqual(loadWith("develop").canUseTestMode(), true, "开发版应允许测试模式")
assert.strictEqual(loadWith("trial").canUseTestMode(), true, "体验版应允许测试模式")

// 正式版一律禁止
assert.strictEqual(loadWith("release").canUseTestMode(), false, "正式版必须禁止测试模式")

// 拿不到运行环境时按最严格处理，宁可少给能力
assert.strictEqual(loadWith(undefined).canUseTestMode(), false, "取不到环境时应按正式版处理")
assert.strictEqual(loadWith("").canUseTestMode(), false, "环境为空时应按正式版处理")

// wx 存在但接口抛错也不能放行
delete require.cache[require.resolve(envPath)]
global.wx = { getAccountInfoSync() { throw new Error("boom") } }
assert.strictEqual(require(envPath).canUseTestMode(), false, "接口异常时应按正式版处理")

// isDevBuild 只认开发版
assert.strictEqual(loadWith("develop").isDevBuild(), true)
assert.strictEqual(loadWith("trial").isDevBuild(), false)
assert.strictEqual(loadWith("release").isDevBuild(), false)

delete global.wx
console.log("env tests passed")
