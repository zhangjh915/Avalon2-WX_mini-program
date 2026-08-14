const hostLines = {
  intro: [
    {
      text: "诸位骑士，请入座。今日的圆桌将见证忠诚、背叛，以及一些赛后很难解释的决定。",
      voice: "庄重男声，低沉、有史诗感，语速中慢，像纪录片旁白。"
    },
    {
      text: "圣杯远征即将开始。请保管好你的身份，也请保管好你即将失去的信任。",
      voice: "冷幽默女声，清晰、克制，尾音带一点审判感。"
    },
    {
      text: "命运已经洗牌，圆桌已经开灯。现在，请各位接受今晚的角色。",
      voice: "中性主持声，温和但有仪式感，适合线下聚会。"
    }
  ],
  reveal: [
    {
      text: "请依次长按查看身份。看完请收起表情，尤其是那些已经开始笑的人。",
      voice: "轻松吐槽风，语速适中，像桌游店主持。"
    },
    {
      text: "命运之手已经落下。请确认你的身份，不要让旁边的骑士偷走你的秘密。",
      voice: "史诗女声，神秘、轻柔，背景适合低音氛围。"
    }
  ],
  night: [
    {
      text: "夜幕降临。黑暗势力确认彼此，盲眼杀手仍在迷雾之中。教士，请记住你看到的第一道光。",
      voice: "庄重男声，压低音量，节奏缓慢。"
    },
    {
      text: "圆桌闭眼。有人在黑暗里交换眼神，有人只负责假装自己什么都不知道。",
      voice: "悬疑解说风，带一点戏谑，语气不要太夸张。"
    }
  ],
  missionStart: [
    {
      text: "新一轮远征开始。队长，请选择同行骑士。其他人可以发表意见，但队长通常会选择性失聪。",
      voice: "阴阳怪气主持风，轻快，适合熟人局。"
    },
    {
      text: "皇冠在手，责任也在手。队长，请决定谁将登上这辆命运之车。",
      voice: "史诗男声，坚定、有压迫感。"
    },
    {
      text: "远征队伍即将出发。请注意，今天的车门没有投票按钮。",
      voice: "冷幽默女声，平稳，最后一句略停顿。"
    }
  ],
  vote: [
    {
      text: "同行骑士请私密投票。成功或失败，都将在片刻后成为复盘素材。",
      voice: "中性主持声，清晰、克制。"
    },
    {
      text: "请提交任务牌。愿忠诚的人不被误会，愿背叛的人稍微演得像一点。",
      voice: "轻松吐槽风，带笑意但不破坏仪式感。"
    }
  ],
  missionResult: [
    {
      text: "远征结果已经揭晓。圆桌请记住这一刻，尤其是刚才信誓旦旦的人。",
      voice: "阴阳怪气主持风，语速适中。"
    },
    {
      text: "任务尘埃落定。圣杯又近了一步，或者离大家的信任更远了一步。",
      voice: "史诗女声，温和、略带遗憾。"
    }
  ],
  amulet: [
    {
      text: "护身符开始低语。持有者，请私密选择查验对象。真相会出现，但未必会被正确使用。",
      voice: "神秘女声，轻声、慢速。"
    },
    {
      text: "现在进入护身符查验。请安静一点，让这位骑士独自面对真相和接下来的表演压力。",
      voice: "桌游主持风，轻松、带一点看热闹。"
    }
  ],
  finale: [
    {
      text: "三次胜利已经达成，但这不是故事的终点。最后的翻盘审判，现在开始。",
      voice: "庄重男声，低沉、紧张，语速慢。"
    },
    {
      text: "圆桌进入终局。现在，每一次选择都可能让刚才的自信变成历史材料。",
      voice: "悬疑解说风，节奏收紧。"
    }
  ],
  ending: [
    {
      text: "身份即将公开。请各位保持体面，尤其是那些刚刚保错人的骑士。",
      voice: "冷幽默女声，克制、清楚。"
    },
    {
      text: "今日远征落幕。忠诚与背叛都已归档，圆桌秘史将记录这一夜。",
      voice: "史诗男声，庄重收束。"
    }
  ]
}

const ceremonyLines = {
  closeEyes: {
    text: "夜幕降临。请所有骑士闭上眼睛，将手机扣在桌面上。不要交谈，也不要触碰其他玩家。",
    voice: "低沉中性旁白，庄重、克制，语速偏慢；句间留出明确停顿。"
  },
  mutualEvil: {
    text: "{roles}，请睁开眼睛。安静地确认与你共享黑暗的同伴。",
    voice: "神秘低沉男声，音量稍低，语速缓慢；角色名清晰，结尾留五秒空白。"
  },
  noMutualEvil: {
    text: "本局没有需要在现实中互相确认的黑暗角色。所有骑士继续保持闭眼。",
    voice: "中性旁白，平稳、简短，不制造额外暗示。"
  },
  hiddenRoles: {
    text: "{roles}保持闭眼。所有单向身份关系已经通过命运密令传递；不要举手，不要发出声音。",
    voice: "冷静女声，清晰强调“保持闭眼”和“不要举手”，语速中慢。"
  },
  evilClose: {
    text: "黑暗中的共谋者，请闭上眼睛。记住你看到的面孔，收起所有表情。",
    voice: "低沉男声，神秘但不过度表演；结尾留两秒停顿。"
  },
  dawn: {
    text: "命运已经完成低语。天色渐明，诸位骑士，请睁开眼睛。第一场远征即将开始。",
    voice: "史诗感女声，由轻到明亮，最后一句坚定、有启程感。"
  }
}

const nightDisplayDirectives = [
  { title: "天黑请闭眼", subtitle: "请听指令" },
  { title: "夜幕已至", subtitle: "请听主持人指令" },
  { title: "命运正在低语", subtitle: "保持安静，请听指令" }
]

function pickNightDisplay(seed) {
  return nightDisplayDirectives[Math.abs(Number(seed) || 0) % nightDisplayDirectives.length]
}

function buildNightCeremony(game) {
  const mutualRoles = game.players
    .filter(player => ["morgan", "minion", "barbarian", "revealer", "lunatic", "deceiver", "saboteur"].indexOf(player.role) >= 0)
    .map(player => player.roleName)
  const uniqueRoles = mutualRoles.filter((name, index) => mutualRoles.indexOf(name) === index)
  const hiddenRoles = game.players
    .filter(player => ["hunter", "shapeshifter", "crownPrince", "traitor", "outsider", "lancelotEvil"].indexOf(player.role) >= 0)
    .map(player => player.roleName)
    .filter((name, index, list) => list.indexOf(name) === index)
  const steps = [ceremonyLines.closeEyes]
  if (mutualRoles.length >= 2) {
    steps.push({
      ...ceremonyLines.mutualEvil,
      text: ceremonyLines.mutualEvil.text.replace("{roles}", uniqueRoles.join("、"))
    })
    if (hiddenRoles.length) {
      steps.push({ ...ceremonyLines.hiddenRoles, text: ceremonyLines.hiddenRoles.text.replace("{roles}", hiddenRoles.join("、")) })
    }
    steps.push(ceremonyLines.evilClose)
  } else {
    steps.push(ceremonyLines.noMutualEvil)
    if (hiddenRoles.length) {
      steps.push({ ...ceremonyLines.hiddenRoles, text: ceremonyLines.hiddenRoles.text.replace("{roles}", hiddenRoles.join("、")) })
    }
  }
  steps.push(ceremonyLines.dawn)
  return steps.map((line, index) => ({ ...line, id: `night-${index + 1}` }))
}

function buildNightCeremonyFromSettings(settings) {
  const counts = settings.roleCounts || {}
  const has = role => Number(counts[role] || 0) > 0
  const mutualNames = [
    ["morgan", "摩根勒菲"], ["minion", "莫德雷德的爪牙"], ["barbarian", "野蛮人"],
    ["revealer", "揭露者"], ["lunatic", "疯子"], ["deceiver", "骗徒"], ["boaster", "吹嘘者"], ["saboteur", "破坏者"]
  ].filter(item => has(item[0])).map(item => item[1])
  const hiddenNames = [
    ["hunter", "盲眼杀手"], ["shapeshifter", "幻形妖"], ["crownPrince", "王储"],
    ["traitor", "叛徒"], ["outsider", "边缘人"], ["lancelotEvil", "邪恶的兰斯洛特"]
  ].filter(item => has(item[0])).map(item => item[1])
  const steps = [ceremonyLines.closeEyes]
  if (mutualNames.length) {
    steps.push({ ...ceremonyLines.mutualEvil, text: ceremonyLines.mutualEvil.text.replace("{roles}", mutualNames.join("、")) })
    steps.push(ceremonyLines.evilClose)
  } else steps.push(ceremonyLines.noMutualEvil)
  if (hiddenNames.length) steps.push({ ...ceremonyLines.hiddenRoles, text: ceremonyLines.hiddenRoles.text.replace("{roles}", hiddenNames.join("、")) })
  if (has("lancelotGood") && has("lancelotEvil")) {
    steps.push({
      text: "正义的兰斯洛特与邪恶的兰斯洛特，请同时睁开眼睛，确认彼此。五、四、三、二、一。请闭上眼睛。",
      voice: "低沉中性旁白，角色名清晰，倒数稳定，前后各留两秒空白。"
    })
  }
  steps.push(ceremonyLines.dawn)
  return steps.map((line, index) => ({ ...line, id: `night-${index + 1}` }))
}

function pickLine(stage, seed) {
  const lines = hostLines[stage] || hostLines.intro
  return lines[seed % lines.length]
}

module.exports = {
  hostLines,
  ceremonyLines,
  nightDisplayDirectives,
  pickNightDisplay,
  buildNightCeremony,
  buildNightCeremonyFromSettings,
  pickLine
}
