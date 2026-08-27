// 运行环境判断。
//
// 测试骑士（补满座位、自动投票、代盲眼杀手操作）只允许出现在开发版：
// 体验版会发给同事真实试玩，正式版更不能出现，误触会直接破坏对局。
//
// 注意：必须惰性调用，不能在模块加载或页面 data 初始化时执行——
// 单元测试会在没有 wx 全局对象的环境里 require 页面。

function envVersion() {
  try {
    if (typeof wx === "undefined" || !wx.getAccountInfoSync) return ""
    const info = wx.getAccountInfoSync()
    return (info && info.miniProgram && info.miniProgram.envVersion) || ""
  } catch (error) {
    return ""
  }
}

// 只有微信开发者工具里的开发版才算开发模式；取不到环境时按正式版处理。
function isDevBuild() {
  return envVersion() === "develop"
}

// 是否允许房主打开「测试模式」。
//
// 开发期在开发版和体验版都需要补测试骑士单机走流程，所以两者都放开；
// 正式版一律禁止，避免真实对局被误触破坏。
// 注意：这只控制入口是否出现，最终以创建房间时写入的 devMode 为准，
// 服务端对每一个测试骑士操作都会独立校验。
function canUseTestMode() {
  return ["develop", "trial"].indexOf(envVersion()) >= 0
}

module.exports = {
  envVersion,
  isDevBuild,
  canUseTestMode
}
