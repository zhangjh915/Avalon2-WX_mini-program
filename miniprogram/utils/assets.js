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

// 取图一律用 <image src="cloud://">，**不要用 wx.cloud.getTempFileURL**。
//
// CSS 的 background-image 只认 https，所以用它就必须先换临时链接——而临时链接
// 的有效期实测只有 **约 10 分钟**（连续 curl 同一条链接：9 分 4 秒仍 200，
// 10 分 4 秒变 403）。不是文档给人的「2 小时」印象。
// 我按 2 小时设过 90 分钟的缓存 TTL，比真实有效期长了 9 倍，403 反复出现、
// 修了三轮都没修掉，最后是把整条链路删掉才根治的。
//
// <image src="cloud://"> 由微信自己解析并管理有效期，不经手临时链接，没有这个问题。
// 需要背景图的地方就垫一张绝对定位铺满的 <image>（见 .stage-floor / .page-bg / .seal-base）。

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

// 长桌是七张不同比例的整桌图，按最近的比例挑一张。
//
// 九宫格方案已废弃：它把一张图变成九张的拼装，每处接缝都是一个要精确对齐的约束，
// 实机上始终能看出接缝（边条与中心的色差、角块与 border-radius 的配对）。
// 整图没有拼接，也就没有这一类问题。
//
// .long-table 的长宽比是 29 个连续值（宽只看上下边人数、高只看左右边人数，
// 两个参数独立）。竖向布局用横图转 90°，所以只存长宽比 >= 1 的那一半，
// 七张覆盖 29 个值，最大拉伸 ±8%，绝大多数在 1~5%，肉眼看不出来。
//
// 档位表不手抄，是从 assets/ui/table-long/_meta.json 生成的副本。
// 必须是 .js 不能是 .json：小程序不支持 require .json，会让整个模块抛异常。
// 详见 table-long-meta.js 顶部。
const LONG_TABLES = require("./table-long-meta")

// 挑档。
// 注意 stage 的宽随屏宽变而高固定，所以长宽比必须用**运行时实测的 stage 尺寸**算，
// 不能写死——375pt 屏上 stage 是 1.19、414pt 屏上是 1.32，差 11%，写死会挑错档。
function pickLongTable(widthPct, heightPct, stageW, stageH) {
  const w = (Number(stageW) || 0) * (Number(widthPct) || 0) / 100
  const h = (Number(stageH) || 0) * (Number(heightPct) || 0) / 100
  if (!(w > 0 && h > 0)) return null
  // 竖桌就是横图转 90 度，所以长宽比一律取 >= 1 的那个方向
  const rotate = w < h
  const aspect = rotate ? h / w : w / h
  // 比的是对数距离：拉伸 8% 无论发生在 1.1 还是 2.9 档上，观感代价是一样的，
  // 用差值会偏袒大比例那几档。
  let best = LONG_TABLES[0]
  LONG_TABLES.forEach(item => {
    if (Math.abs(Math.log(aspect / item.aspect)) < Math.abs(Math.log(aspect / best.aspect))) best = item
  })
  // 转 90 度后宽高互换，所以图要按「转之前」的尺寸给，转完才贴合 slot。
  // 圣杯纹章绝不能放进这个元素里——transform 对整个子树生效，会把它一起转过去。
  const boxW = rotate ? h : w
  const boxH = rotate ? w : h
  const centering = "position:absolute;left:50%;top:50%;"
  return {
    src: uiAsset(`table-long/${best.i}.png`),
    tier: best.i,
    rotate,
    slot: `width:${Math.round(w)}px;height:${Math.round(h)}px;`,
    style: `${centering}width:${Math.round(boxW)}px;height:${Math.round(boxH)}px;` +
      `transform:translate(-50%,-50%)${rotate ? " rotate(90deg)" : ""};`
  }
}

// 走 CSS background 的图必须先换成 https 临时链接。
//
// 关键限制：**CSS 的 background-image 不认 cloud:// 协议**，只有 <image> 组件的
// src 认。直接把 fileID 写进 background-image 不会报错，图就是不显示——
// 圆桌换图后一片空白就是这么来的。
//
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

// 地毯色板。四色一次给全，换色是纯本地 setData。
// 注意这里返回的是 cloud:// 而不是 https 临时链接——色块用 <image> 渲染，
// 不再走 CSS background，也就没有临时链接过期那一类问题。
function floorOptions() {
  const active = floorColor()
  return {
    floorColor: active,
    floorSrc: floorAsset(active),
    floorOptions: FLOOR_COLORS.map(item => ({ ...item, src: floorAsset(item.key) }))
  }
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
    seal: uiAsset("seal-base.png"),
    // 下面四个原先走 CSS background，必须先换成 https 临时链接，于是会过期 403。
    // 改成 <image src="cloud://"> 之后由微信自己解析，不再经手临时链接。
    tableRound: uiAsset("table-round.jpg"),
    homeBg: uiAsset("home-bg.jpg"),
    floor: floorAsset(floorColor())
  }
}

// 任务牌在包内，返回绝对路径
function missionCard(skin, face) {
  return `/assets/cards/mission/skin-${skin || "a"}/${face}.jpg`
}

module.exports = {
  CLOUD_PREFIX,
  floorOptions,
  FLOOR_COLORS,
  DEFAULT_FLOOR,
  normalizeFloorColor,
  floorAsset,
  floorColor,
  setFloorColor,
  uiAsset,
  uiIcons,
  LONG_TABLES,
  pickLongTable,
  roleArtPath,
  roleArt,
  identityBack,
  missionCard
}
