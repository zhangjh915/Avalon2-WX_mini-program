App({
  onLaunch() {
    if (wx.cloud) {
      try {
        const envId = "cloudbase-d6gh6eo4ce2c13e2b"
        wx.cloud.init(envId ? {
          env: envId,
          traceUser: true
        } : {
          traceUser: true
        })
      } catch (error) {
        console.error("云开发初始化失败", error)
      }
    }
  },
  globalData: {
    game: null,
    clientId: null
  }
})
