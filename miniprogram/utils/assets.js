// 美术资产的取图入口。
//
// 分工：
//   任务牌   体积极小（12 张共 0.11MB），直接打进小程序包，用绝对路径取。
//   身份牌   角色立绘三套皮肤共 31.5MB，远超主包 2MB 上限，放云存储。
//            本地文件仍留在 miniprogram/assets/ 作为导出中转，但已通过
//            project.config.json 的 packOptions.ignore 排除出包体。
//
// 云存储 fileID 可以由路径直接拼接，不需要维护清单文件——同一环境下前缀恒定。
// 这一点上传 113 个文件后逐个核对过。
//
// 另：云存储回源的临时 https 链接支持 imageMogr2 实时缩图
// （?...&imageMogr2/thumbnail/300x 实测有效），所以只需存一份高清，
// 将来结算页要小头像时按需缩，不必再存缩略图档。

const CLOUD_PREFIX = "cloud://cloudbase-d6gh6eo4ce2c13e2b.636c-cloudbase-d6gh6eo4ce2c13e2b-1466527090/"

// 一局能出现多次的角色有多张立绘，文件名是 <key>-v<N>.jpg；
// 变体号由服务端在发牌时分配，保证同局不重复。
function roleArtPath(skin, role, artVariant) {
  if (!role) return ""
  const suffix = Number(artVariant) > 0 ? `-v${Number(artVariant)}` : ""
  return `assets/roles/${skin || "painted"}/${role}${suffix}.jpg`
}

function roleArt(skin, role, artVariant) {
  const path = roleArtPath(skin, role, artVariant)
  return path ? CLOUD_PREFIX + path : ""
}

function identityBack(skin) {
  return `${CLOUD_PREFIX}assets/cards/identity/${skin || "painted"}/back.jpg`
}

// 界面图标与场景。和角色立绘一样走云存储，路径即 fileID 后缀。
function uiAsset(name) {
  return CLOUD_PREFIX + "assets/ui/" + name
}

// 长桌是九宫格拼的：四角固定像素、四边只沿单轴平铺、中心 cover。
// 原因是长桌比例不是几个预设值，而是 30 种连续比值（上下边人数决定宽、
// 左右边人数决定高，两者独立），整图拉伸会把桌沿和铆钉抻变形。
//
// 数组顺序即层序：先列的画在上层，所以角在最上、边其次、中心垫底。不要重排。
const LONG_TABLE_SLICES = [
  ["corner_tl.png", "left top", "48rpx 48rpx", "no-repeat"],
  ["corner_tr.png", "right top", "48rpx 48rpx", "no-repeat"],
  ["corner_bl.png", "left bottom", "48rpx 48rpx", "no-repeat"],
  ["corner_br.png", "right bottom", "48rpx 48rpx", "no-repeat"],
  ["edge_top.jpg", "48rpx top", "auto 48rpx", "repeat-x"],
  ["edge_bottom.jpg", "48rpx bottom", "auto 48rpx", "repeat-x"],
  ["edge_left.jpg", "left 48rpx", "48rpx auto", "repeat-y"],
  ["edge_right.jpg", "right 48rpx", "48rpx auto", "repeat-y"],
  ["center.jpg", "center", "cover", "no-repeat"]
]

// 走 CSS background 的图必须先换成 https 临时链接。
//
// 关键限制：**CSS 的 background-image 不认 cloud:// 协议**，只有 <image> 组件的
// src 认。直接把 fileID 写进 background-image 不会报错，图就是不显示——
// 圆桌换图后一片空白就是这么来的。
//
// 临时链接默认 2 小时有效，页面 onShow 时重新解析一次即可覆盖长时间对局。
// 临时链接约 2 小时失效，过期后请求会返回 403（渲染层报 Failed to load image）。
// 缓存必须带时效，否则 onShow 再解析也永远命中旧值——这个洞真实踩到过。
const TEMP_URL_TTL = 90 * 60 * 1000
const tempUrlCache = {}
const tempUrlAt = {}

function resolveTempUrls(fileIDs) {
  // 云开发不可用时退化成「没有背景图」，不要让整页起不来。
  // 单元测试没有 wx 全局对象，这条同时保证 require 页面不炸。
  if (typeof wx === "undefined" || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(tempUrlCache)
  }
  const now = Date.now()
  const missing = fileIDs.filter(id => !tempUrlCache[id] || now - (tempUrlAt[id] || 0) > TEMP_URL_TTL)
  if (!missing.length) return Promise.resolve(tempUrlCache)
  return new Promise(resolve => {
    wx.cloud.getTempFileURL({
      fileList: missing,
      success: res => {
        (res.fileList || []).forEach(item => {
          if (item.tempFileURL) {
            tempUrlCache[item.fileID] = item.tempFileURL
            tempUrlAt[item.fileID] = Date.now()
          }
        })
        resolve(tempUrlCache)
      },
      // 取不到就退化成没有背景图，不至于整页白屏
      fail: () => resolve(tempUrlCache)
    })
  })
}

// 页面需要的全部 CSS 背景，一次解析好再 setData
function backgroundStyles() {
  const singles = {
    roundTableBg: "table-round.jpg",
    floorBg: "floor.jpg",
    sealBg: "seal-base.png",
    homeBg: "home-bg.jpg"
  }
  const ids = Object.keys(singles).map(key => uiAsset(singles[key]))
    .concat(LONG_TABLE_SLICES.map(slice => uiAsset("table-long/" + slice[0])))
  return resolveTempUrls(ids).then(cache => {
    const styles = {}
    Object.keys(singles).forEach(key => {
      const url = cache[uiAsset(singles[key])]
      styles[key] = url ? `background-image:url(${url})` : ""
    })
    const layers = LONG_TABLE_SLICES
      .map(slice => {
        const url = cache[uiAsset("table-long/" + slice[0])]
        return url ? `url(${url}) ${slice[1]} / ${slice[2]} ${slice[3]}` : ""
      })
      .filter(Boolean)
    styles.longTableBg = layers.length === LONG_TABLE_SLICES.length ? "background:" + layers.join(",") : ""
    return styles
  })
}

// 界面上一次性用到的所有图标，applyState 时整体下发，避免逐个拼路径
function uiIcons() {
  return {
    crown: uiAsset("crown.png"),
    amulet: uiAsset("amulet.png"),
    fire: uiAsset("magic-fire.png"),
    tableEmblem: uiAsset("table-emblem.png"),
    crestGood: uiAsset("crest-good.png"),
    crestEvil: uiAsset("crest-evil.png"),
    missionPending: uiAsset("mission-pending.png"),
    missionCurrent: uiAsset("mission-current.png"),
    seal: uiAsset("seal-base.png")
  }
}

// 任务牌在包内，返回绝对路径
function missionCard(skin, face) {
  return `/assets/cards/mission/skin-${skin || "a"}/${face}.jpg`
}

module.exports = {
  CLOUD_PREFIX,
  uiAsset,
  uiIcons,
  resolveTempUrls,
  backgroundStyles,
  LONG_TABLE_SLICES,
  roleArtPath,
  roleArt,
  identityBack,
  missionCard
}
