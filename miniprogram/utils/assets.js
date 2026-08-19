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
// 边条一律用 round 而不是 repeat：
// edge_left.jpg 是 72x463，按比例铺开一个单元约 154pt 高，而 8 人竖向长桌才 195pt——
// 1.27 次重复，接缝正好卡在桌子中间，看起来就是桌面从中间断开了。
// round 会把图微调到整数次填满，接缝消失，代价只是纹理密度略变。
const LONG_TABLE_SLICES = [
  ["corner_tl.png", "left top", "48rpx 48rpx", "no-repeat"],
  ["corner_tr.png", "right top", "48rpx 48rpx", "no-repeat"],
  ["corner_bl.png", "left bottom", "48rpx 48rpx", "no-repeat"],
  ["corner_br.png", "right bottom", "48rpx 48rpx", "no-repeat"],
  ["edge_top.jpg", "48rpx top", "auto 48rpx", "round no-repeat"],
  ["edge_bottom.jpg", "48rpx bottom", "auto 48rpx", "round no-repeat"],
  ["edge_left.jpg", "left 48rpx", "48rpx auto", "no-repeat round"],
  ["edge_right.jpg", "right 48rpx", "48rpx auto", "no-repeat round"],
  ["center.jpg", "center", "cover", "no-repeat"]
]

// 角块尺寸必须跟着桌子走，不能写死。
// 8 人竖向长桌只有约 104pt 宽，四个 24pt 的角块就吃掉近一半，
// 中间的木纹被挤成一条，桌子看起来像散了架。
const CORNER_MAX = 48
const CORNER_MIN = 26
function cornerSize(widthPct, heightPct, stageRpx) {
  const shortSide = Math.min(Number(widthPct) || 100, Number(heightPct) || 100) / 100 * (Number(stageRpx) || 650)
  return Math.max(CORNER_MIN, Math.min(CORNER_MAX, Math.round(shortSide * 0.2)))
}

// 按当前桌子尺寸重算九宫格。页面拿到 tableWidth / tableHeight 之后调用，
// 拿不到就退回 backgroundStyles 里那份 48rpx 的默认值。
function longTableBackground(widthPct, heightPct, stageRpx) {
  const corner = cornerSize(widthPct, heightPct, stageRpx) + "rpx"
  const layers = LONG_TABLE_SLICES.map(slice => {
    const url = tempUrlCache[uiAsset("table-long/" + slice[0])]
    if (!url) return ""
    const pos = slice[1].split("48rpx").join(corner)
    const size = slice[2].split("48rpx").join(corner)
    return `url(${url}) ${pos} / ${size} ${slice[3]}`
  }).filter(Boolean)
  return layers.length === LONG_TABLE_SLICES.length ? "background:" + layers.join(",") : ""
}

// 走 CSS background 的图必须先换成 https 临时链接。
//
// 关键限制：**CSS 的 background-image 不认 cloud:// 协议**，只有 <image> 组件的
// src 认。直接把 fileID 写进 background-image 不会报错，图就是不显示——
// 圆桌换图后一片空白就是这么来的。
//
// 临时链接约 2 小时失效，过期后请求返回 403（渲染层报 Failed to load image）。
//
// 两层都必须有，缺一个都不管用：
//   1. 缓存带时效——否则命中就返回，永远拿到过期链接。
//   2. **要有人定期来问**——页面只在 onLoad / onShow 调 loadBackgrounds，
//      而线下一局能打一两个小时、玩家全程不切后台，onShow 根本不会再触发。
//      光有 TTL 没人调用，等于没修：链接照样过期成 403。
//      所以页面轮询里要用 backgroundsStale() 顺带检查一次。
const TEMP_URL_TTL = 90 * 60 * 1000
// 提前量：别等真过期才换，留出一次请求往返的余量
const REFRESH_AHEAD = 5 * 60 * 1000
// 取不到时的退避，避免每个轮询周期都去撞同一个失败
const RETRY_BACKOFF = 30 * 1000
const tempUrlCache = {}
const tempUrlAt = {}
let lastAttemptAt = 0

// 背景链接是不是该换一批了。页面每个轮询周期调一次，开销就是几次数值比较。
function backgroundsStale() {
  const now = Date.now()
  const ids = Object.keys(tempUrlAt)
  if (!ids.length) return now - lastAttemptAt > RETRY_BACKOFF
  const oldest = ids.reduce((min, id) => Math.min(min, tempUrlAt[id]), Infinity)
  if (now - oldest <= TEMP_URL_TTL - REFRESH_AHEAD) return false
  return now - lastAttemptAt > RETRY_BACKOFF
}

function resolveTempUrls(fileIDs) {
  // 云开发不可用时退化成「没有背景图」，不要让整页起不来。
  // 单元测试没有 wx 全局对象，这条同时保证 require 页面不炸。
  if (typeof wx === "undefined" || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.resolve(tempUrlCache)
  }
  const now = Date.now()
  const missing = fileIDs.filter(id => !tempUrlCache[id] || now - (tempUrlAt[id] || 0) > TEMP_URL_TTL - REFRESH_AHEAD)
  if (!missing.length) return Promise.resolve(tempUrlCache)
  lastAttemptAt = now
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

// 地毯四个配色，纯装饰、不承载任何游戏信息，所以做成**个人偏好**而不是房间级设置：
// 房间级要动房间结构和云函数（missionSkin / roleSkin 是那么做的，因为卡面必须全场一致），
// 个人偏好只要本地一个 key，零服务端改动，还能随时换不用重开房。
const FLOOR_COLORS = [
  { key: "indigo", name: "靛蓝" },
  { key: "green", name: "墨绿" },
  { key: "wine", name: "酒红" },
  { key: "umber", name: "金褐" }
]
// 默认靛蓝：四色里它和桌子的明度差、冷暖差都最大，桌子最跳出来
const DEFAULT_FLOOR = "indigo"
const FLOOR_STORAGE_KEY = "floorColor"

function normalizeFloorColor(color) {
  return FLOOR_COLORS.some(item => item.key === color) ? color : DEFAULT_FLOOR
}

function floorAsset(color) {
  return uiAsset("floor-" + normalizeFloorColor(color) + ".jpg")
}

function floorColor() {
  if (typeof wx === "undefined" || !wx.getStorageSync) return DEFAULT_FLOOR
  return normalizeFloorColor(wx.getStorageSync(FLOOR_STORAGE_KEY))
}

function setFloorColor(color) {
  const next = normalizeFloorColor(color)
  if (typeof wx !== "undefined" && wx.setStorageSync) wx.setStorageSync(FLOOR_STORAGE_KEY, next)
  return next
}

// 页面需要的全部 CSS 背景，一次解析好再 setData。
// 四张地毯一次全解析（getTempFileURL 一次调用就能带完），换色才是纯本地 setData，
// 不然每换一次都要等一趟网络。
function backgroundStyles() {
  const singles = {
    roundTableBg: "table-round.jpg",
    sealBg: "seal-base.png",
    homeBg: "home-bg.jpg"
  }
  const ids = Object.keys(singles).map(key => uiAsset(singles[key]))
    .concat(FLOOR_COLORS.map(item => floorAsset(item.key)))
    .concat(LONG_TABLE_SLICES.map(slice => uiAsset("table-long/" + slice[0])))
  return resolveTempUrls(ids).then(cache => {
    const styles = {}
    Object.keys(singles).forEach(key => {
      const url = cache[uiAsset(singles[key])]
      styles[key] = url ? `background-image:url(${url})` : ""
    })
    const active = floorColor()
    styles.floorColor = active
    styles.floorOptions = FLOOR_COLORS.map(item => {
      const url = cache[floorAsset(item.key)]
      return { ...item, bg: url ? `background-image:url(${url})` : "" }
    })
    styles.floorBg = (styles.floorOptions.find(item => item.key === active) || {}).bg || ""
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
  backgroundsStale,
  FLOOR_COLORS,
  DEFAULT_FLOOR,
  normalizeFloorColor,
  floorAsset,
  floorColor,
  setFloorColor,
  uiAsset,
  uiIcons,
  resolveTempUrls,
  backgroundStyles,
  LONG_TABLE_SLICES,
  cornerSize,
  longTableBackground,
  roleArtPath,
  roleArt,
  identityBack,
  missionCard
}
