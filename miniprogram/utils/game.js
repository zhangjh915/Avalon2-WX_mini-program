const roleInfo = {
  loyal: { name: "亚瑟的忠臣", pack: "base", faction: "good", minPlayers: 5, maxCopies: 10, desc: "正义方。无特殊能力。" },
  arthur: { name: "亚瑟", pack: "base", faction: "good", minPlayers: 7, desc: "知道摩根勒菲。若被盲眼杀手第一个命中，邪恶方立即获胜。" },
  duke: { name: "公爵", pack: "base", faction: "good", minPlayers: 7, maxCopies: 2, desc: "最后指认中可以让一位玩家放下一只手。" },
  archduke: { name: "大公", pack: "base", faction: "good", minPlayers: 9, maxCopies: 2, desc: "邪恶方揭露后，可改变一位玩家一只手的指向。" },
  priest: { name: "教士", pack: "base", faction: "good", minPlayers: 6, maxCopies: 2, desc: "知道第一位领袖对外显示的阵营。" },
  squire: { name: "侍从", pack: "base", faction: "good", minPlayers: 6, desc: "持有魔法指示物时必须打出失败牌。" },
  apprentice: { name: "学徒", pack: "base", faction: "good", minPlayers: 5, maxCopies: 2, desc: "最后指认中第二只手可在邪恶方揭露后补充指向。" },
  troublemaker: { name: "捣乱者", pack: "base", faction: "good", minPlayers: 7, desc: "被教士或护身符检视时必须显示为邪恶方。" },
  morgan: { name: "摩根勒菲", pack: "base", faction: "evil", minPlayers: 5, required: true, desc: "必选邪恶角色。可忽略魔法指示物，自由打出成功或失败牌。" },
  minion: { name: "莫德雷德的爪牙", pack: "base", faction: "evil", minPlayers: 5, maxCopies: 10, desc: "邪恶方。无特殊能力。" },
  shapeshifter: { name: "幻形妖", pack: "base", faction: "evil", minPlayers: 6, desc: "不知道其他邪恶方，其他邪恶方也不知道你。" },
  crownPrince: { name: "王储", pack: "base", faction: "evil", minPlayers: 5, maxPlayers: 5, desc: "不知道邪恶方，但摩根勒菲知道你。" },
  hunter: { name: "盲眼杀手", pack: "base", faction: "evil", minPlayers: 6, desc: "不知道邪恶队友。终局可公开身份并猎杀两位正义玩家。" },
  barbarian: { name: "野蛮人", pack: "base", faction: "evil", minPlayers: 7, desc: "只能在前三个任务中打出失败牌。" },
  traitor: { name: "叛徒", pack: "base", faction: "evil", minPlayers: 5, desc: "不知道邪恶队友。终局可主动投向正义，正义方仍必须指认出叛徒。" },
  revealer: { name: "揭露者", pack: "base", faction: "evil", minPlayers: 7, desc: "第三次任务失败后公开身份，最后指认无需覆盖他。" },
  lunatic: { name: "疯子", pack: "base", faction: "evil", minPlayers: 5, desc: "默认必须打出失败牌；持有魔法指示物时必须改为成功牌。" },
  deceiver: { name: "骗徒", pack: "base", faction: "evil", minPlayers: 6, desc: "被教士或护身符检视时可自由显示正义或邪恶。" },
  galahad: { name: "加拉哈德", pack: "promo", faction: "good", minPlayers: 5, desc: "未当过领袖且未拿过护身符时，第二次任务失败后可揭露并接任。" },
  reluctant: { name: "不情愿的领袖", pack: "promo", faction: "good", minPlayers: 7, desc: "担任任务二或三领袖且上车时，必须打出失败牌。" },
  guard: { name: "守卫", pack: "promo", faction: "good", minPlayers: 6, desc: "同步看到第一次护身符查验的对外显示结果。" },
  percival: { name: "帕西瓦里", pack: "promo", faction: "good", minPlayers: 7, desc: "知道教士是谁。" },
  boaster: { name: "吹嘘者", pack: "promo", faction: "evil", minPlayers: 5, desc: "若成为第五次任务的领袖，组队前必须公开身份。" },
  saboteur: { name: "破坏者", pack: "promo", faction: "evil", minPlayers: 5, desc: "担任过领袖后，上车必须打出失败牌，魔法指示物无效。" },
  outsider: { name: "边缘人", pack: "promo", faction: "evil", minPlayers: 5, desc: "知道其他邪恶方，但其他邪恶方不知道你。" },
  lancelotGood: { name: "正义的兰斯洛特", pack: "promo", faction: "good", minPlayers: 6, pair: "lancelotEvil", desc: "与邪恶的兰斯洛特知道彼此。" },
  lancelotEvil: { name: "邪恶的兰斯洛特", pack: "promo", faction: "evil", minPlayers: 6, pair: "lancelotGood", desc: "与正义的兰斯洛特知道彼此；不知道其他邪恶方。" }
}

const officialRolePresets = {
  5: ["loyal", "loyal", "loyal", "morgan", "crownPrince"],
  6: ["loyal", "priest", "squire", "morgan", "minion", "hunter"],
  7: ["priest", "squire", "troublemaker", "duke", "morgan", "minion", "hunter"],
  8: ["loyal", "priest", "squire", "troublemaker", "duke", "morgan", "minion", "hunter"],
  9: ["loyal", "priest", "squire", "troublemaker", "duke", "archduke", "morgan", "minion", "hunter"],
  10: ["loyal", "priest", "squire", "troublemaker", "duke", "archduke", "morgan", "minion", "minion", "hunter"]
}

// Positive values favor evil; negative values favor good. Values are deliberately
// coarse because table experience and player skill matter more than small gaps.
const roleBalanceImpacts = {
  loyal: 0,
  arthur: -1,
  duke: -1,
  archduke: -2,
  priest: -2,
  squire: 2,
  apprentice: -1,
  troublemaker: 2,
  morgan: 2,
  minion: 0,
  shapeshifter: -2,
  crownPrince: -1,
  hunter: 2,
  barbarian: -1,
  traitor: -1,
  revealer: -2,
  lunatic: -1,
  deceiver: 2,
  galahad: -1,
  reluctant: 2,
  guard: -1,
  percival: -1,
  boaster: -1,
  saboteur: -1,
  outsider: -1,
  lancelotGood: -1,
  lancelotEvil: -1
}

const missionPresets = {
  5: { sizes: [2, 3, 2, 4, 3], protectedRounds: [] },
  6: { sizes: [2, 3, 4, 3, 4], protectedRounds: [] },
  7: { sizes: [2, 3, 3, 4, 4], protectedRounds: [4] },
  8: { sizes: [3, 4, 4, 5, 5], protectedRounds: [4] },
  9: { sizes: [3, 4, 4, 5, 5], protectedRounds: [4] },
  10: { sizes: [3, 4, 4, 5, 5], protectedRounds: [4] }
}

function countRoles(roles) {
  return roles.reduce((counts, role) => {
    counts[role] = (counts[role] || 0) + 1
    return counts
  }, {})
}

function rolesFromCounts(counts) {
  return Object.keys(counts || {}).reduce((roles, role) => {
    const count = Math.max(0, Number(counts[role]) || 0)
    for (let index = 0; index < count; index += 1) roles.push(role)
    return roles
  }, [])
}

function factionCounts(roles) {
  return roles.reduce((counts, role) => {
    const info = roleInfo[role]
    if (info) counts[info.faction] += 1
    return counts
  }, { good: 0, evil: 0 })
}

function officialFactionCounts(playerCount) {
  return factionCounts(officialRolePresets[playerCount] || [])
}

function validateRoleConfig(playerCount, roleCounts, unknownRoles) {
  const roles = rolesFromCounts(roleCounts)
  const errors = []
  const expected = officialFactionCounts(playerCount)
  const actual = factionCounts(roles)
  if (unknownRoles) {
    if (actual.good < expected.good || actual.evil < expected.evil) errors.push(`候选池至少需要 ${expected.good} 名正义和 ${expected.evil} 名邪恶角色`)
    if (actual.good === expected.good && actual.evil === expected.evil) errors.push("未知角色至少需要多选1名候选角色")
  } else if (actual.good !== expected.good || actual.evil !== expected.evil) {
    errors.push(`需要 ${expected.good} 名正义和 ${expected.evil} 名邪恶角色`)
  }
  if ((roleCounts.morgan || 0) !== 1) errors.push("摩根勒菲必须且只能有1名")
  const goodLancelot = Number(roleCounts.lancelotGood || 0)
  const evilLancelot = Number(roleCounts.lancelotEvil || 0)
  if (goodLancelot !== evilLancelot) errors.push("两位兰斯洛特必须成对加入")
  Object.keys(roleCounts || {}).forEach(role => {
    const info = roleInfo[role]
    const count = Number(roleCounts[role]) || 0
    if (!info && count) errors.push(`未知角色：${role}`)
    if (info && count && (playerCount < info.minPlayers || (info.maxPlayers && playerCount > info.maxPlayers))) {
      errors.push(`${info.name}不适用于${playerCount}人局`)
    }
    if (info && count > (info.maxCopies || 1)) errors.push(`${info.name}最多可选${info.maxCopies || 1}名`)
  })
  return { valid: errors.length === 0, errors, roles, expected, actual }
}

function buildDefaultRoleCounts(playerCount, unknownRoles) {
  const counts = countRoles(officialRolePresets[playerCount] || [])
  if (!unknownRoles) return counts
  const goodCandidates = ["priest", "squire", "apprentice", "arthur", "troublemaker", "galahad", "guard", "percival"]
  const evilCandidates = ["hunter", "lunatic", "deceiver", "barbarian", "traitor", "revealer", "boaster", "saboteur", "outsider"]
  const addRole = candidates => {
    const role = candidates.find(key => {
      const info = roleInfo[key]
      return info && playerCount >= info.minPlayers && (!info.maxPlayers || playerCount <= info.maxPlayers) && !counts[key]
    })
    if (role) counts[role] = 1
  }
  addRole(goodCandidates)
  if (playerCount >= 6) addRole(goodCandidates)
  if (playerCount >= 6) {
    addRole(evilCandidates)
    addRole(evilCandidates)
  }
  return counts
}

function normalizeCandidatePool(playerCount, source, unknownRoles) {
  const expected = officialFactionCounts(playerCount)
  const counts = { morgan: 1 }
  Object.keys(source || {}).forEach(role => {
    if (["loyal", "minion", "morgan"].indexOf(role) >= 0) return
    const info = roleInfo[role]
    if (info && Number(source[role] || 0) > 0) counts[role] = Math.min(Number(source[role]), info.maxCopies || 1)
  })
  const actual = factionCounts(rolesFromCounts(counts))
  counts.loyal = Math.max(0, expected.good - actual.good)
  counts.minion = Math.max(0, expected.evil - actual.evil)
  return counts
}

function rawBalanceScore(playerCount, roleCounts) {
  let score = rolesFromCounts(roleCounts).reduce((total, role) => total + Number(roleBalanceImpacts[role] || 0), 0)
  const has = role => Number(roleCounts && roleCounts[role] || 0) > 0
  if (has("arthur") && has("hunter")) score += 1
  if (has("deceiver") && playerCount >= 6) score += 0.5
  if (has("troublemaker") && has("priest")) score += 0.5
  if (has("percival") && !has("priest")) score += 1
  return score
}

function balanceLabel(score) {
  const absolute = Math.abs(score)
  if (absolute <= 1.25) return { level: "balanced", title: "大致平衡", warning: "" }
  const side = score < 0 ? "正义方" : "邪恶方"
  if (absolute <= 2.75) return { level: "slight", title: `略偏${side}`, warning: "该配置已超出推荐平衡区间" }
  if (absolute <= 4.5) return { level: "uneven", title: `明显偏${side}`, warning: `建议替换一名强化${side}的角色` }
  return { level: "extreme", title: `严重偏${side}`, warning: "该配置可能产生明显的阵营优势" }
}

function estimateBalance(playerCount, roleCounts, unknownRoles, hunterVoteVariant) {
  const baseline = rawBalanceScore(playerCount, buildDefaultRoleCounts(playerCount, !!unknownRoles))
  let score = rawBalanceScore(playerCount, roleCounts) - baseline
  if (hunterVoteVariant && Number(roleCounts && roleCounts.hunter || 0) > 0) score += 0.5
  score = Math.round(score * 2) / 2
  const markerPercent = Math.max(6, Math.min(94, 50 + score / 6 * 44))
  return { score, markerPercent, ...balanceLabel(score) }
}

function roleBalanceLabel(role) {
  const impact = Number(roleBalanceImpacts[role] || 0)
  if (!impact) return "影响中性"
  return impact < 0 ? `偏正义 ${Math.abs(impact)}` : `偏邪恶 ${impact}`
}

function availableRoles(playerCount) {
  return Object.keys(roleInfo)
    .filter(role => playerCount >= roleInfo[role].minPlayers && (!roleInfo[role].maxPlayers || playerCount <= roleInfo[role].maxPlayers))
    .map(role => ({ role, ...roleInfo[role] }))
}

function currentMissionSize(game) {
  const preset = game.missionPreset || missionPresets[game.playerCount]
  return preset.sizes[game.round - 1]
}

function isProtectedRound(game) {
  const preset = game.missionPreset || missionPresets[game.playerCount]
  return preset.protectedRounds.indexOf(game.round) >= 0
}

function shouldGiveAmulet(playerCount, completedRound) {
  if (playerCount === 6) return completedRound === 2
  if (playerCount === 7) return completedRound === 2 || completedRound === 3
  if (playerCount >= 8) return completedRound >= 2 && completedRound <= 4
  return false
}

function getRoleInfo(role) {
  return roleInfo[role] || null
}

function factionLabel(faction) {
  return faction === "good" ? "正义方" : "邪恶方"
}

function packLabel(pack) {
  return pack === "promo" ? "扩展角色" : "基础角色"
}

// 私密选择的左右顺序按人、按轮打乱。
//
// 为什么要打乱：线下玩的时候，「成功/失败」「正义/邪恶」固定在左右两边，
// 旁边的人不用看屏幕，光看你手指往哪边落就知道你选了什么——实战中被抓到过。
//
// 为什么必须**稳定**而不是每次渲染真随机：这一屏由 900ms 的轮询驱动重绘，
// 真随机会让按钮在手指落下的一瞬间对调，而在这个游戏里点错一张任务牌就是一局。
// 所以从「房间号 + 用途 + 轮次 + 座号」派生：同一个人在同一次决策里方向永远不变，
// 换个人、换一轮、换个用途就变。
function choiceSwapped(...parts) {
  const key = parts.join("|")
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 1000003
  return hash % 2 === 1
}

module.exports = {
  choiceSwapped,
  roleInfo,
  officialRolePresets,
  missionPresets,
  countRoles,
  rolesFromCounts,
  factionCounts,
  officialFactionCounts,
  validateRoleConfig,
  buildDefaultRoleCounts,
  normalizeCandidatePool,
  roleBalanceImpacts,
  rawBalanceScore,
  estimateBalance,
  roleBalanceLabel,
  availableRoles,
  currentMissionSize,
  isProtectedRound,
  shouldGiveAmulet,
  getRoleInfo,
  factionLabel,
  packLabel
}
