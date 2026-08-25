const gameUtil = require("../../utils/game")
const { pickLine } = require("../../data/ttsLines")
const roomStore = require("../../utils/roomStore")
const assets = require("../../utils/assets")

Page({
  data: {
    game: null,
    winnerName: "",
    report: "",
    missionLines: [],
    players: [],
    finalLine: "",
    verdictCrest: ""
  },

  onLoad(options) {
    if (options.roomId) {
      roomStore.getResult(options.roomId).then(result => {
        this.applyResult(result)
      }).catch(() => {
        wx.showToast({ title: "读取结算失败", icon: "none" })
      })
      return
    }
    wx.redirectTo({ url: "/pages/index/index" })
  },

  applyResult(result) {
    const game = result.room.game
    const winnerName = gameUtil.factionLabel(game.winner)
    const players = result.players.map((player, index) => {
      const info = gameUtil.getRoleInfo(player.role) || {}
      return { ...player, packName: gameUtil.packLabel(info.pack), initial: player.name ? player.name.slice(0, 1) : String(player.id), revealDelay: index * 55 }
    })
    const missionLines = game.missions.map(mission => {
      const leader = players.find(player => player.id === mission.leaderId)
      const team = mission.team.map(id => `${id}号`).join("、")
      const magic = mission.magicTargetId ? `${mission.magicTargetId}号` : "无"
      return {
        round: mission.round,
        winner: mission.winner,
        crest: assets.packedAsset(mission.winner === "good" ? "crest-good.png" : "crest-evil.png"),
        title: `第${mission.round}次远征 · ${mission.winner === "good" ? "成功" : "失败"}`,
        detail: `队长 ${leader ? `${leader.id}号 ${leader.name}` : `${mission.leaderId}号`}，同行 ${team}，魔法 ${magic}，成功 ${mission.successCount} 票，失败 ${mission.failCount} 票${mission.protectedRound ? "，本轮为保护轮" : ""}。`
      }
    })
    const finalLine = this.buildFinalLine(game)
    const report = `本局由${winnerName}取得最终胜利，任务比分为正义 ${game.goodWins} 比邪恶 ${game.evilWins}。${finalLine}`
    this.setData({ game, winnerName, missionLines, players, report, finalLine,
      verdictCrest: assets.packedAsset(game.winner === "good" ? "crest-good.png" : "crest-evil.png"), hostLine: pickLine("ending", game.missions.length) })
  },

  buildFinalLine(game) {
    if (!game.final) return ""
    if (game.final.hunterTargets) {
      const targets = game.final.hunterTargets.map(id => `${id}号`).join("、")
      return `盲眼杀手选择猎杀 ${targets}，${game.final.hunterSuccess ? "猎杀成功，黑暗改写了结局。" : "猎杀失败，正义方守住了最后机会。"}`
    }
    const corrections = (game.final.corrections || []).join("；")
    return `${game.final.identifySuccess ? "正义方完成了最终指认。" : "正义方未能完整指认邪恶阵营。"}${corrections ? ` 生效修正：${corrections}。` : ""}`
  },

  newGame() {
    wx.redirectTo({ url: "/pages/index/index" })
  }
})
