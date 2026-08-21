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

// 大图走云存储（体积上不了主包）。
function uiAsset(name) {
  return CLOUD_PREFIX + "assets/ui/" + name
}

// 图标与小图**打进包内**，用绝对路径取——包内图零网络、零解析，点开即有。
// 走云存储时它们每次都要现拉：换个火球要等一会儿才出现、任务牌翻面动画跑完了
// 图还没到、任务结果只剩一个红圈圈（队徽没加载出来）。这些都是加载延迟的表现。
// 11 张合计 610KB，主包上限 2MB、当前约 460KB，装得下。
function packedAsset(name) {
  return "/assets/ui/" + name
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

// 对局页选人面板的舞台宽高比（实测 366x656）。桌子形状以它为准，
// 免得同一局在候场页和对局页长得不一样。
const REFERENCE_STAGE_ASPECT = 366 / 656

// 挑档。
// 注意 stage 的宽随屏宽变而高固定，所以长宽比必须用**运行时实测的 stage 尺寸**算，
// 不能写死——375pt 屏上 stage 是 1.19、414pt 屏上是 1.32，差 11%，写死会挑错档。
function pickLongTable(widthPct, heightPct, stageW, stageH) {
  const availW = (Number(stageW) || 0) * (Number(widthPct) || 0) / 100
  const availH = (Number(stageH) || 0) * (Number(heightPct) || 0) / 100
  if (!(availW > 0 && availH > 0)) return null
  // 桌子的形状该由**座位布局**决定，不该随舞台形状变。
  // widthPct / heightPct 分别相对舞台宽和舞台高，直接拿像素比会把舞台形状混进来：
  // 同一局 8 人左5右3，候场页舞台 360x438 算出需求比 2.36（挑第 6 档），
  // 对局页 366x656 算出 3.47（挑第 8 档）——两处桌子长得不一样，就是这么来的。
  //
  // 以**对局页选人面板**的舞台比为基准定形状（那处的观感是认可的），
  // 再在各自的可用空间里按这个形状取最大尺寸。这样候场页和对局页长得一样，
  // 且对局页保持原尺寸不变。
  const shapeAspect = (Number(widthPct) || 1) / (Number(heightPct) || 1) * REFERENCE_STAGE_ASPECT
  const rotate = shapeAspect < 1
  const aspect = rotate ? 1 / shapeAspect : shapeAspect
  // 按固定形状塞进可用空间：先顶满宽，放不下再退到顶满高
  let w = availW
  let h = w / shapeAspect
  if (h > availH) { h = availH; w = h * shapeAspect }
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
// 地毯四个配色。纯装饰、不承载游戏信息，所以做成**个人偏好**而不是房间级设置：
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

// 缓存偏好：storage 只有本进程会改，所以缓存永远是准的。
// 不缓存的话 uiIcons() 每次调用都要一次同步 wx.getStorageSync（阻塞式 JSBridge 往返），
// 而 uiIcons() 在 applyState 里被 900ms 的轮询带着跑——一局能有四千次。
let cachedFloor = null

function floorColor() {
  if (cachedFloor) return cachedFloor
  if (typeof wx === "undefined" || !wx.getStorageSync) return DEFAULT_FLOOR
  cachedFloor = normalizeFloorColor(wx.getStorageSync(FLOOR_STORAGE_KEY))
  return cachedFloor
}

function setFloorColor(color) {
  const next = normalizeFloorColor(color)
  cachedFloor = next
  if (typeof wx !== "undefined" && wx.setStorageSync) wx.setStorageSync(FLOOR_STORAGE_KEY, next)
  return next
}

// 界面图标。除地毯外全是编译期常量，所以只算一次；页面在 onLoad 下发一次即可，
// **不要放进 applyState** —— 那是 900ms 轮询驱动的，每轮重建并整体 setData
// 1.4KB 全常量，渲染层还要把十几处绑定重新求值一遍。
const STATIC_ICONS = {
  crown: packedAsset("crown.png"),
  amulet: packedAsset("amulet.png"),
  fire: packedAsset("magic-fire.png"),
  tableEmblem: packedAsset("table-emblem.png"),
  crestGood: packedAsset("crest-good.png"),
  crestEvil: packedAsset("crest-evil.png"),
  missionPending: packedAsset("mission-pending.png"),
  missionCurrent: packedAsset("mission-current.png"),
  seal: packedAsset("seal-base.png"),
  tableRound: packedAsset("table-round.jpg"),
  homeEmblem: packedAsset("home-emblem.png"),
  // 这两类体积大，只能留在云存储
  homeBg: uiAsset("home-bg.jpg")
}

function uiIcons() {
  // 只有地毯跟着个人偏好走，换色时重新下发一次
  return { ...STATIC_ICONS, floor: floorAsset(floorColor()) }
}

// 地毯色板：四色一次给全，换色是纯本地 setData。
// 给的是 cloud:// 而不是 https 临时链接——色块用 <image> 渲染，不走 CSS background。
function floorOptions() {
  return {
    floorColor: floorColor(),
    floorOptions: FLOOR_COLORS.map(item => ({ ...item, src: floorAsset(item.key) }))
  }
}

// 把云端图**落到本地文件**，之后一律用本地路径渲染。
//
// 为什么必须这么做：<image src="cloud://"> 每次渲染微信都要重新解析 fileID，
// 拿到的临时 URL 带每次不同的 sign/t，HTTP 缓存永远命中不了——于是每次开选人面板
// 桌子和地毯都要重新下一遍。预加载池救不了这个（池子里的图和面板里的是两次独立请求）。
// downloadFile 拿到的 tempFilePath 在小程序生命周期内有效，读本地零网络。
const localFiles = {}

function localCopy(fileID) {
  if (!fileID || fileID.indexOf("cloud://") !== 0) return Promise.resolve(fileID)
  if (localFiles[fileID]) return Promise.resolve(localFiles[fileID])
  if (typeof wx === "undefined" || !wx.cloud || !wx.cloud.downloadFile) return Promise.resolve(fileID)
  return new Promise(resolve => {
    wx.cloud.downloadFile({
      fileID,
      success: res => {
        if (res && res.tempFilePath) localFiles[fileID] = res.tempFilePath
        resolve(localFiles[fileID] || fileID)
      },
      // 下不下来就退回 cloud://，至少还能显示
      fail: () => resolve(fileID)
    })
  })
}

// 任务牌在包内，返回绝对路径
function missionCard(skin, face) {
  return `/assets/cards/mission/skin-${skin || "a"}/${face}.jpg`
}

module.exports = {
  CLOUD_PREFIX,
  floorOptions,
  localCopy,
  FLOOR_COLORS,
  DEFAULT_FLOOR,
  normalizeFloorColor,
  floorAsset,
  floorColor,
  setFloorColor,
  uiAsset,
  packedAsset,
  uiIcons,
  LONG_TABLES,
  pickLongTable,
  roleArtPath,
  roleArt,
  identityBack,
  missionCard
}
