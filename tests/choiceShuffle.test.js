// 私密选择的左右打乱。
//
// 由来：实战中发现「成功/失败」「正义/邪恶」固定在左右两边，
// 旁边的人光看手指落点就能反推你选了什么。
const assert = require("assert")
const fs = require("fs")
const path = require("path")
const game = require("../miniprogram/utils/game")

// 1) 必须稳定：这一屏由 900ms 轮询驱动重绘，方向在手指落下时对调 = 点错一局
const once = game.choiceSwapped("room-abc", "vote", 2, 5)
for (let i = 0; i < 50; i += 1) {
  assert.strictEqual(game.choiceSwapped("room-abc", "vote", 2, 5), once, "同样输入必须给同样方向")
}

// 2) 换人要变：同一轮里所有人都朝同一边，等于没打乱
{
  const dirs = []
  for (let id = 1; id <= 10; id += 1) dirs.push(game.choiceSwapped("room-abc", "vote", 2, id))
  const swapped = dirs.filter(Boolean).length
  assert.ok(swapped > 0 && swapped < dirs.length,
    `10 个玩家的方向应当有分有合，实际翻转 ${swapped} 个`)
}

// 3) 换轮要变：否则第一轮看穿了某人的方向，后面几轮就一直能读
{
  const dirs = []
  for (let round = 1; round <= 5; round += 1) dirs.push(game.choiceSwapped("room-abc", "vote", round, 3))
  assert.ok(new Set(dirs).size > 1, "同一个人跨轮次的方向不能恒定")
}

// 4) 换用途要变：任务牌和查验若同向，看穿一个就看穿另一个
{
  const uses = ["vote", "claim", "hunter", "traitor"].map(u => game.choiceSwapped("room-abc", u, 2, 5))
  assert.ok(new Set(uses).size > 1, "不同用途的方向不能恒定")
}

// 5) 大样本要接近五五开，不能偏向一边
{
  let swapped = 0
  const total = 2000
  for (let i = 0; i < total; i += 1) {
    if (game.choiceSwapped("room-" + i, "vote", (i % 5) + 1, (i % 10) + 1)) swapped += 1
  }
  const ratio = swapped / total
  assert.ok(ratio > 0.42 && ratio < 0.58, `翻转比例应接近五五开，实际 ${(ratio * 100).toFixed(1)}%`)
}

// 6) **最要紧的一条**：翻转只能改视觉顺序，不能改提交的值。
// 实现方式是 CSS 的 row-reverse / direction，DOM 顺序和 data-value 原地不动；
// 一旦有人改成「交换 data-value」，就会出现点了成功却提交失败——一局就毁了。
{
  const wxml = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.wxml"), "utf8")
  const wxss = fs.readFileSync(path.join(__dirname, "..", "miniprogram", "pages", "play", "play.wxss"), "utf8")
  assert.match(wxss, /\.swap-order\s*\{[^}]*row-reverse/, "翻转应当由 CSS 顺序实现")
  // 四处私密选择都要挂上翻转类
  ;["voteSwap", "claimSwap", "hunterSwap", "traitorSwap"].forEach(flag => {
    assert.ok(wxml.indexOf(`{{${flag} ? 'swap-order' : ''}}`) >= 0, `${flag} 没有接到界面上`)
  })
  // data-value / data-side 必须是字面量，不能跟着 swap 走
  const dynamicValue = wxml.match(/data-(value|side|faction)="\{\{[^}]*[Ss]wap/g)
  assert.ok(!dynamicValue, `提交的值不能跟着翻转变：${dynamicValue}`)
  // 每处都要有小字说明，否则玩家会照着别人的位置点
  const notes = (wxml.match(/class="shuffle-note"/g) || []).length
  assert.ok(notes >= 4, `四处私密选择都要有位置随机的说明，实际 ${notes} 处`)
}

console.log("choice shuffle tests passed")
