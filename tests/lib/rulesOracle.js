// 规则判官：从《阿瓦隆2 游戏完整说明书》(docs/rules) 和已确认的产品决策
// **独立**写出的规则表。刻意不 require gameCore——它存在的意义就是和 gameCore 互相校对：
// 两边不一致时，要么代码错了，要么这张表错了，两种情况都值得被抓出来。
//
// 每条规则旁标注出处：§ 指说明书章节；「实现清单」指 docs/rules/角色规则实现清单.md；
// 「决策」指 docs/progress 里已确定的产品决策。

const FACTION = {
  loyal: "good", arthur: "good", duke: "good", archduke: "good", priest: "good", squire: "good",
  apprentice: "good", troublemaker: "good", galahad: "good", reluctant: "good", guard: "good",
  percival: "good", lancelotGood: "good",
  morgan: "evil", minion: "evil", shapeshifter: "evil", crownPrince: "evil", hunter: "evil",
  barbarian: "evil", traitor: "evil", revealer: "evil", lunatic: "evil", deceiver: "evil",
  boaster: "evil", saboteur: "evil", outsider: "evil", lancelotEvil: "evil"
}

// §六（一）任务人数表；决策：5-10 人、只用基础面板
const MISSION_SIZES = {
  5: [2, 3, 2, 4, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5]
}

// §四 阵营人数表
const FACTION_TOTALS = {
  5: { good: 3, evil: 2 }, 6: { good: 3, evil: 3 }, 7: { good: 4, evil: 3 },
  8: { good: 5, evil: 3 }, 9: { good: 6, evil: 3 }, 10: { good: 6, evil: 4 }
}

function faction(player) { return FACTION[player.role] }

// §六（二）3：只有 7 人及以上的第 4 次任务要 2 张失败牌
function failsNeeded(playerCount, round) { return playerCount >= 7 && round === 4 ? 2 : 1 }
function isProtectedRound(playerCount, round) { return failsNeeded(playerCount, round) === 2 }
function missionWinner(playerCount, round, failCount) {
  return failCount >= failsNeeded(playerCount, round) ? "evil" : "good"
}

// §四 3 护身符放置：6 人一枚（任务 2-3 之间）、7 人两枚（再加 3-4 之间）、8 人及以上三枚（再加 4-5 之间）
function amuletAfterRound(playerCount, completedRound) {
  if (playerCount <= 5) return false
  if (playerCount === 6) return completedRound === 2
  if (playerCount === 7) return completedRound === 2 || completedRound === 3
  return completedRound >= 2 && completedRound <= 4
}

// §九 捣乱者：被检视必须谎报邪恶；骗徒：自由谎报；其余显示真实阵营
function displayedFaction(player, claim) {
  if (player.role === "troublemaker") return "evil"
  if (player.role === "deceiver") return claim === "good" || claim === "evil" ? claim : null
  return faction(player)
}
function claimOptions(player) {
  return player.role === "deceiver" ? ["good", "evil"] : [displayedFaction(player)]
}

// 任务牌：§六（二）1 基础规则 + §八/§九 各角色的出牌限制
function legalVotes(player, round, isLeader, hasMagic) {
  const role = player.role
  if (role === "morgan") return ["success", "fail"]                       // §八 摩根勒菲忽略魔法
  if (role === "reluctant") return isLeader && (round === 2 || round === 3) ? ["fail"] : ["success"]  // §九 不情愿的领袖，魔法无效
  if (role === "squire") return hasMagic ? ["fail"] : ["success"]        // §九 侍从
  if (role === "lunatic") return hasMagic ? ["success"] : ["fail"]       // §九 疯子
  if (role === "saboteur" && player.hasLed) return ["fail"]              // §九 破坏者：持退伍领袖指示物后必败，魔法无效
  if (role === "barbarian" && round > 3) return ["success"]              // §九 野蛮人：只能在前三个任务出失败
  if (faction(player) === "good") return ["success"]
  return hasMagic ? ["success"] : ["success", "fail"]                     // §三 魔法指示物
}

// 揭露阶段谁知道谁（§五、§八、§九 各角色的补充指令）。
// 说明书只给了「例外」名单，其余邪恶角色都按普通爪牙一起睁眼。
const MUTUAL_EVIL = ["morgan", "minion", "barbarian", "revealer", "lunatic", "deceiver", "boaster", "saboteur"]
// 只竖拇指让爪牙看见、自己不睁眼的邪恶角色
const THUMB_ONLY = ["hunter", "traitor", "lancelotEvil"]

function knownSeats(player, players) {
  const others = players.filter(item => item.id !== player.id)
  const evils = others.filter(item => faction(item) === "evil")
  const withRole = roles => evils.filter(item => roles.indexOf(item.role) >= 0).map(item => item.id)
  if (MUTUAL_EVIL.indexOf(player.role) >= 0) {
    const ids = withRole(MUTUAL_EVIL).concat(withRole(THUMB_ONLY))
    if (player.role === "morgan") ids.push(...withRole(["crownPrince"]))  // §八 王储：摩根知道王储
    return ids
  }
  if (player.role === "arthur") return withRole(["morgan"])               // §九 亚瑟
  if (player.role === "percival") return others.filter(item => item.role === "priest").map(item => item.id)  // §九 珀西瓦里
  // §九 边缘人：爪牙竖起拇指让他看，盲眼杀手/叛徒/邪恶兰斯洛特此前也竖过拇指；
  // 幻形妖从头到尾既不睁眼也不竖拇指，谁都看不见他——包括边缘人
  if (player.role === "outsider") return evils.filter(item => item.role !== "shapeshifter").map(item => item.id)
  if (player.role === "lancelotGood") return others.filter(item => item.role === "lancelotEvil").map(item => item.id)
  if (player.role === "lancelotEvil") return others.filter(item => item.role === "lancelotGood").map(item => item.id)
  // 其余：忠臣/公爵/大公/教士/侍从/学徒/捣乱者/加拉哈德/不情愿/守卫，
  // 以及王储/幻形妖/盲眼杀手/叛徒——不知道任何人的座位
  return []
}

// §六（三）过渡阶段
function canLead(player) { return !player.hasLed && !player.hadAmulet }
function canHoldAmulet(player, nextLeaderId) { return !player.hasLed && !player.hadAmulet && player.id !== nextLeaderId }
function canBeInspected(player, ownerId) { return player.id !== ownerId && !player.hadAmulet && !player.fadedAmulet }

// §九 加拉哈德（实现清单的读法：第二次失败刚出现的那个结算阶段可以发动）
function galahadEligible(player, game) {
  const last = game.missions[game.missions.length - 1]
  return player.role === "galahad" && !player.hasLed && !player.hadAmulet &&
    game.evilWins === 2 && !!last && last.winner === "evil" && !game.galahadLeaderId
}

// §七（二）2(1) 猎杀：第一位命中亚瑟直接胜；否则两位都是正义方且（无教士或含教士）
function hunterSuccess(players, targets) {
  const byId = id => players.find(item => item.id === Number(id))
  const first = byId(targets[0])
  if (first && first.role === "arthur") return true
  const bothGood = targets.length === 2 && targets.every(id => byId(id) && faction(byId(id)) === "good")
  const priests = players.filter(item => item.role === "priest")
  const priestOk = !priests.length || targets.some(id => byId(id) && byId(id).role === "priest")
  return bothGood && priestOk
}

// §十（二）猎杀变体：失败牌 2 张及以上，盲眼杀手必须猎杀
function hunterVoteForcesHunt(votes) {
  return Object.values(votes).filter(value => value === "fail").length >= 2
}

// §七（二）2(2) 正义方最后机会 + §八 公爵/大公 + §九 学徒/揭露者/叛徒。
// 用**枚举**而不是公式：公爵放下哪几只手、大公改哪几只手全部试一遍，
// 被改的手和学徒的第二只手可以指向任何一个还没被覆盖的邪恶方。
function subsetsUpTo(list, size) {
  const result = [[]]
  for (let k = 1; k <= Math.min(size, list.length); k += 1) {
    const walk = (start, chosen) => {
      if (chosen.length === k) { result.push(chosen.slice()); return }
      for (let index = start; index < list.length; index += 1) {
        chosen.push(list[index]); walk(index + 1, chosen); chosen.pop()
      }
    }
    walk(0, [])
  }
  return result
}

function identifySuccess(players, submissions, options) {
  const opts = options || {}
  const revealed = opts.revealedIds || new Set()
  const evil = players.filter(item => faction(item) === "evil")
  const allowed = new Set(evil.map(item => item.id))                       // 指向揭露者不算错
  const required = new Set(evil.filter(item => !(item.role === "revealer" && revealed.has(item.id))).map(item => item.id))
  const good = players.filter(item => faction(item) === "good")           // 叛徒转正前的阵营：他的手不算正义方的手
  const hands = []
  let wildcards = 0
  good.forEach(player => {
    const targets = submissions[player.id]
    if (!targets) return
    hands.push({ owner: player.id, target: Number(targets[0]) })
    if (player.role === "apprentice") wildcards += 1                       // §九 学徒：第二只手在揭露后再伸
    else hands.push({ owner: player.id, target: Number(targets[1]) })
  })
  const dukes = good.filter(item => item.role === "duke").length
  const archdukes = good.filter(item => item.role === "archduke").length
  const wrong = hands.filter(hand => !allowed.has(hand.target))
  const correct = hands.filter(hand => allowed.has(hand.target))
  for (const removed of subsetsUpTo(wrong, dukes)) {
    const remainingWrong = wrong.filter(hand => removed.indexOf(hand) < 0)
    for (const changed of subsetsUpTo(remainingWrong.concat(correct), archdukes)) {
      if (remainingWrong.some(hand => changed.indexOf(hand) < 0)) continue   // 错手必须全部放下或改掉
      const covered = new Set(correct.filter(hand => changed.indexOf(hand) < 0).map(hand => hand.target))
      const missing = Array.from(required).filter(id => !covered.has(id))
      if (changed.length + wildcards >= missing.length) return true
    }
  }
  return false
}

// §七（二）2(2) 特例：每个任务的领袖均为邪恶方，正义方直接获胜
function allLeadersEvil(players, missions) {
  const byId = id => players.find(item => item.id === Number(id))
  return missions.length > 0 && missions.every(mission => byId(mission.leaderId) && faction(byId(mission.leaderId)) === "evil")
}

module.exports = {
  FACTION, MISSION_SIZES, FACTION_TOTALS, MUTUAL_EVIL, THUMB_ONLY,
  faction, failsNeeded, isProtectedRound, missionWinner, amuletAfterRound,
  displayedFaction, claimOptions, legalVotes, knownSeats,
  canLead, canHoldAmulet, canBeInspected, galahadEligible,
  hunterSuccess, hunterVoteForcesHunt, identifySuccess, allLeadersEvil
}
