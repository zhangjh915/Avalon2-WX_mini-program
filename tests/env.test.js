const fs = require("fs")
const path = require("path")
// 测试模式的可用范围。
// 这是「正式对局不会被测试玩家破坏」的最后一道客户端防线，
// 服务端另有 requireDevRoom 独立校验，两边都不能松。

const assert = require("assert")

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
// 云函数超时。默认 3 秒，而冷启动实测能到 5.7 秒——撞上就失败，
// 表现是「同样的操作有时成功有时失败」。线下玩的节奏（讨论几分钟点一次）
// 恰好每次都赶上冷启动，所以特别致命。
//
// 注意：这个值**微信开发者工具的 cli deploy 不会读**（实测部署后线上仍是 3 秒），
// 只能在云开发控制台手动改。这里断言的是「期望值有记录」，
// 真正的防线是下面那条客户端重试。
const fnConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cloudfunctions", "avalonGame", "config.json"), "utf8"))
assert.ok(Number(fnConfig.timeout) >= 10, `云函数超时期望值要记在 config.json 里，当前 ${fnConfig.timeout || "未设置"}`)

// 客户端还要对超时重试一次兜底：超时不代表没执行成功，服务端有幂等保护
const storeSrc = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "utils", "roomStore.js"), "utf8")
assert.match(storeSrc, /-504003/, "要能识别云函数超时错误码")
assert.match(storeSrc, /invoke\(action, payload\)[\s\S]{0,400}invoke\(action, payload\)/, "超时后要重试一次")

// 云函数部署必须走 scripts/deploy-cloudfunction.sh，它带了 -r。
// 不带 -r 时 CLI 会上传本地 node_modules，而本地从没装过依赖，
// 部署包里就只有源文件、没有 wx-server-sdk——部署显示成功，但所有调用立刻全挂
// （Cannot find module 'wx-server-sdk'），整个小程序不可用。踩过一次。
const deployScript = fs.readFileSync(path.join(__dirname, "..", "scripts", "deploy-cloudfunction.sh"), "utf8")
assert.match(deployScript, /functions deploy[^\n]*\s-r(\s|$)/, "部署脚本必须带 -r，否则云端缺依赖")
assert.ok(fs.existsSync(path.join(__dirname, "..", "cloudfunctions", "avalonGame", "package.json")), "云函数要有 package.json 供云端装依赖")

// 体验版（trial）是发给同事一起玩的，测试模式默认必须**关**——
// 默认开会补满 bot 并允许房主代打，一局就毁了。
// 开发版（develop，模拟器）默认开：在那儿本来就是为了调试。
// 两边都保留开关，只是默认值不同。
{
  const src = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "index", "index.js"), "utf8")
  assert.match(src, /const defaultOn = env\.envVersion\(\) === "develop"/,
    "测试模式的默认值应当只在开发版为开")
  assert.ok(!/testMode: canUseTestMode && \(stored === "" \? true/.test(src),
    "测试模式不该无条件默认开启——体验版会因此补满 bot")
}

console.log("env tests passed")
