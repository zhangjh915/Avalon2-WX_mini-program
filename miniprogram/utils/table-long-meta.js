// 长桌七档整图的比例表。
//
// **这份是 assets/ui/table-long/_meta.json 的副本，不要手改。**
// 资产更新后从那份重新生成，tests/assets.test.js 锁住了两边一致。
//
// 为什么要副本、而且必须是 .js 不能是 .json：
//   1. assets/ui 整个目录被 packOptions.ignore 排除出包体，运行时取不到那边那份；
//   2. 微信小程序**不支持 require .json**——直接 require 会让 assets.js 抛异常，
//      连带所有 require 它的页面 Page() 注册失败，表现是页面对象里只剩生命周期
//      方法、所有 bindtap 都失灵。真实踩过。
module.exports = [
  { i: 1, aspect: 1.089, w: 563, h: 517 },
  { i: 2, aspect: 1.2788, w: 578, h: 452 },
  { i: 3, aspect: 1.5441, w: 630, h: 408 },
  { i: 4, aspect: 1.8213, w: 683, h: 375 },
  { i: 5, aspect: 2.1333, w: 736, h: 345 },
  { i: 6, aspect: 2.4542, w: 751, h: 306 },
  { i: 7, aspect: 2.9048, w: 915, h: 315 }
]
