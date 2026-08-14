// 借助微信开发者工具的自动化端口跑完整一局，并逐阶段截图。
//
// 与 cloud.live.e2e.js 的区别：这里不只校验云端规则，还让模拟器真的
// 把每个阶段渲染出来，用来发现单元测试看不到的界面/流程问题。
//
// 前置条件（开发者工具需要保持打开）：
//   "/Applications/wechatwebdevtools.app/Contents/MacOS/cli" auto \
//     --project "<项目根目录>" --auto-port 9420
//
// 运行：
//   ./run-e2e.sh            （或用任意 node 直接执行本文件）
//
// 注意：本脚本会在当前云环境写入一间真实的测试房间。
//
// 已知限制（miniprogram-automator@0.12.1 与当前开发者工具版本不完全兼容）：
//   1. page.data() / page.$$() 等 WXML 检查接口会直接挂死，一律改用 evaluate；
//   2. automator 的 reLaunch/navigateTo 会让渲染通道失去响应，改用 wx 的导航接口；
//   3. 截图目前只在 pages/play/play 上稳定，首页/候场页/结果页会超时，
//      因此截图失败只记录不中断。若要升级 automator，可优先验证这一项。
//   4. 开发者工具运行期间反复执行 cli auto 会让自动化服务卡死，
//      表现为 connect 成功但所有调用超时；此时需要重启开发者工具。

const path = require("path")
const fs = require("fs")
const automator = require("miniprogram-automator")

const ENDPOINT = process.env.WECHAT_AUTOMATION_ENDPOINT || "ws://127.0.0.1:9420"
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.join(__dirname, "..", "tmp", "e2e-shots")
const PLAYER_COUNT = 8

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function log(message) {
  console.log(`[e2e] ${message}`)
}

// 自动化协议偶发无响应，所有远程调用统一加超时，避免整个脚本吊死。
function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve().then(() => promise),
    sleep(ms).then(() => { throw new Error(`${label} 超时 ${ms}ms`) })
  ])
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const mp = await withTimeout(automator.connect({ wsEndpoint: ENDPOINT }), 20000, "连接开发者工具")
  log(`已连接 ${ENDPOINT}`)

  const problems = []
  mp.on("exception", error => problems.push(`[exception] ${error.message}`))
  mp.on("console", message => {
    if (message.type !== "error") return
    const text = (message.args || []).map(String).join(" ")
    // 云函数调用失败时客户端会主动打日志，这里只收集非预期的报错
    if (/\[avalonGame\]/.test(text)) return
    problems.push(`[console.error] ${text}`)
  })

  let currentRoomId = ""
  let shotIndex = 0
  let shotFailures = 0
  let shotDisabled = false
  // 开发者工具的渲染通道用久了会整体失去响应（重启开发者工具才能恢复）。
  // 截图失败本身不影响流程校验，但反复重试会拖慢节奏，进而打乱后续阶段的时序，
  // 因此连续失败两次就整局停掉截图，只保留流程与数据校验。
  async function shot(name) {
    if (shotDisabled) return null
    shotIndex += 1
    const file = path.join(SHOT_DIR, `${String(shotIndex).padStart(2, "0")}-${name}.png`)
    try {
      await withTimeout(mp.screenshot({ path: file }), 6000, "截图")
      log(`截图 ${path.basename(file)}`)
      shotFailures = 0
      return file
    } catch (error) {
      shotFailures += 1
      log(`截图 ${name} 失败：${error.message}`)
      if (shotFailures >= 2) {
        shotDisabled = true
        problems.push("[截图不可用] 渲染通道无响应，重启开发者工具后重跑可恢复")
        log("连续截图失败，本局后续不再截图（重启开发者工具可恢复）")
      }
      return null
    }
  }

  // 在小程序上下文里直接调云函数，扮演“房主”这一个真实玩家。
  // 云函数抛错时 reject 的是普通对象，直接冒泡会变成 "Uncaught [object Object]"，
  // 因此在小程序侧先转成可读字符串再传回来。
  async function call(action, payload) {
    const outcome = await withTimeout(mp.evaluate((actionName, actionPayload) => {
      return wx.cloud.callFunction({
        name: "avalonGame",
        data: { action: actionName, ...(actionPayload || {}) }
      }).then(response => ({ ok: true, result: response.result }))
        .catch(error => ({
          ok: false,
          message: String((error && (error.errMsg || error.message)) || JSON.stringify(error) || error)
        }))
    }, action, payload || {}), 25000, `云函数 ${action}`)
    if (!outcome || !outcome.ok) throw new Error(`${action} 失败：${outcome && outcome.message}`)
    return outcome.result
  }

  // automator 自带的 reLaunch/navigateTo 会让渲染通道失去响应（截图随后全部超时），
  // 因此统一在小程序上下文里调 wx 的导航接口。
  async function go(method, url) {
    return withTimeout(mp.evaluate((name, target) => new Promise(resolve => {
      wx[name]({ url: target, complete: () => resolve(true) })
    }), method, url), 15000, `${method} ${url}`)
  }

  async function currentRoute() {
    const info = await withTimeout(mp.evaluate(() => {
      const pages = getCurrentPages()
      const page = pages[pages.length - 1]
      return { route: page.route, phase: page.data.phase || "", finalStage: page.data.finalStage || "" }
    }), 10000, "读取当前页面")
    return info
  }

  // 等待模拟器界面跟上服务端状态（页面靠轮询驱动）
  async function waitForRoute(route, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 15000)
    let last = null
    while (Date.now() < deadline) {
      last = await currentRoute()
      if (last.route === route) return last
      await sleep(500)
    }
    throw new Error(`等待页面 ${route} 超时，当前停在 ${last && last.route}`)
  }

  async function state(roomId) {
    return call("getState", { roomId })
  }

  // 幂等地推进阶段：界面自身也会在某些阶段自动推进，
  // 直接调用可能撞上「当前不能…」的合法拒绝，这里先看阶段再决定。
  async function advanceTo(targetPhase, action) {
    const before = await state(currentRoomId)
    if (before.room.phase === targetPhase) {
      log(`阶段已是 ${targetPhase}，跳过 ${action}`)
      return
    }
    await call(action, { roomId: currentRoomId })
  }

  try {
    // ---- 建房与入座 ----
    await go("reLaunch", "/pages/index/index")
    await sleep(3500)
    await shot("index")

    const created = await call("createRoom", {
      playerCount: PLAYER_COUNT,
      roleCounts: require("../miniprogram/utils/game").buildDefaultRoleCounts(PLAYER_COUNT, false),
      unknownRoles: false,
      hunterVoteVariant: false,
      tableType: "long",
      seatLayout: { top: 3, right: 1, bottom: 3, left: 1 },
      devMode: true
    })
    const roomId = created.roomId
    currentRoomId = roomId
    log(`房间已创建 code=${created.code} id=${roomId}`)

    await call("takeSeat", { roomId, seatNo: 1, name: "自动巡检" })
    await call("fillBots", { roomId })

    await go("reLaunch", `/pages/room/room?roomId=${roomId}&name=${encodeURIComponent("自动巡检")}`)
    await waitForRoute("pages/room/room")
    await sleep(3500)
    await shot("lobby")

    // ---- 开局与身份 ----
    await call("startGame", { roomId })
    await waitForRoute("pages/play/play", 20000)
    await sleep(1200)
    await shot("identity-prepare")

    await call("identityReady", { roomId })
    await call("startIdentity", { roomId })
    await sleep(4000)
    await shot("identity-reveal")

    // 服务端强制 40 秒统一阅读时长
    log("等待身份阅读时长（约 40 秒）")
    await sleep(41000)
    await call("identityRemembered", { roomId })
    // 首夜结束后 play 页自己会替房主推进到组队阶段，
    // 脚本这里可能已经晚了一步，因此只在阶段还没走到时才补推。
    await advanceTo("night", "enterNight")
    await sleep(1500)
    await shot("night")

    await advanceTo("mission", "enterMission")
    await sleep(1200)
    await shot("mission-round-1")

    // ---- 五轮远征 ----
    let current = await state(roomId)
    for (let round = 1; round <= 5; round += 1) {
      current = await state(roomId)
      const game = current.room.game
      if (current.room.status === "finished" || current.room.phase === "finale") break

      const size = game.missionPreset.sizes[game.round - 1]
      // 优先让机器人上车，队长自己也可能在车上
      const team = game.players.slice().sort((a, b) => Number(b.bot) - Number(a.bot)).slice(0, size).map(p => p.id)
      await call("startVote", { roomId, team, magicTargetId: team[0] })

      // 车上的真人（房主本人）需要自己投票，其余交给测试玩家批量投
      const me = current.private.id
      if (team.indexOf(me) >= 0) {
        const options = (await state(roomId)).private.voteOptions || ["success"]
        await call("submitVote", { roomId, value: options[0] })
      }
      const after = await state(roomId)
      if (after.room.phase === "vote") await call("submitBotVotes", { roomId })

      const resolved = await state(roomId)
      const mission = resolved.room.game.missions[resolved.room.game.missions.length - 1]
      log(`第 ${mission.round} 轮 服务端：${mission.winner === "good" ? "成功" : "失败"}（成功 ${mission.successCount} / 失败 ${mission.failCount}）`)
      await sleep(1800)
      // 同时记录界面自己的 lastMission，用来核对“服务端数据”与“界面显示”是否一致
      const shown = await withTimeout(mp.evaluate(() => {
        const pages = getCurrentPages()
        const page = pages[pages.length - 1]
        const m = page.data.lastMission || {}
        return { round: m.round, s: m.successCount, f: m.failCount, cards: (page.data.missionResultCards || []).map(c => c.label).join("") }
      }), 10000, "读取界面结算数据")
      log(`第 ${mission.round} 轮 界面：成功 ${shown.s} / 失败 ${shown.f}（第 ${shown.round} 轮，翻牌 ${shown.cards}）`)
      if (shown.s !== mission.successCount || shown.f !== mission.failCount) {
        problems.push(`[数据不一致] 第 ${mission.round} 轮 服务端 ${mission.successCount}/${mission.failCount}，界面 ${shown.s}/${shown.f}`)
      }
      await shot(`mission-${mission.round}-result`)

      if (resolved.room.phase !== "missionResult") break

      // ---- 交接皇冠与护身符 ----
      const g = resolved.room.game
      const eligible = g.players.filter(p => !p.hasLed && !p.hadAmulet)
      const nextLeader = eligible.find(p => p.bot) || eligible[0]
      if (!nextLeader) throw new Error("没有可接任的队长")
      const needAmulet = require("../miniprogram/utils/game").shouldGiveAmulet(g.playerCount, g.round)
      let amuletOwner = null
      if (needAmulet) {
        amuletOwner = eligible.find(p => p.id !== nextLeader.id && p.bot) || eligible.find(p => p.id !== nextLeader.id)
        if (!amuletOwner) throw new Error("没有可持有护身符的玩家")
      }
      await call("handoff", { roomId, nextLeaderId: nextLeader.id, amuletOwnerId: amuletOwner ? amuletOwner.id : null })

      // 护身符持有者若是房主本人，需要手动完成查验流程
      let afterHandoff = await state(roomId)
      if (afterHandoff.room.phase === "amulet") {
        const amulet = afterHandoff.room.game.amulet
        if (amulet && amulet.ownerId === afterHandoff.private.id) {
          const target = afterHandoff.room.game.players.find(p => p.id !== amulet.ownerId && !p.hadAmulet && !p.fadedAmulet)
          await call("selectAmuletTarget", { roomId, targetId: target.id })
          await sleep(1200)
          await shot(`amulet-round-${g.round}`)
          await call("completeAmulet", { roomId })
        } else {
          await sleep(1200)
          await shot(`amulet-round-${g.round}`)
        }
      }
      await sleep(1200)
      await shot(`mission-round-${(await state(roomId)).room.game.round}`)
    }

    // ---- 终局 ----
    current = await state(roomId)
    if (current.room.phase === "finale") {
      await sleep(1500)
      await shot("finale-discussion")
      await call("finishDiscussion", { roomId, force: true })
      let guard = 0
      while (guard < 12) {
        guard += 1
        current = await state(roomId)
        if (current.room.status === "finished") break
        const stage = current.room.game.final.stage
        log(`终局阶段：${stage}`)
        await sleep(1200)
        await shot(`finale-${stage}`)

        const players = current.room.game.players
        if (stage === "hunterDecision") {
          await call("hunterDecision", { roomId, hunt: true })
        } else if (stage === "hunterTargets") {
          const targets = players.filter(p => p.id !== current.private.id).slice(0, 2).map(p => p.id)
          await call("hunterTargets", { roomId, targets })
        } else if (stage === "hunterVote") {
          await call("hunterVote", { roomId, value: "success" })
        } else if (stage === "identify") {
          if (!current.private.finalSubmitted) {
            const targets = players.filter(p => p.id !== current.private.id).slice(0, 2).map(p => p.id)
            await call("finalIdentify", { roomId, targets })
          }
        } else break
      }
    }

    // ---- 结果页 ----
    await waitForRoute("pages/result/result", 20000)
    await sleep(4000)
    await shot("result")

    const final = await call("getResult", { roomId })
    log(`本局结束：${final.room.game.winner === "good" ? "正义方" : "邪恶方"}胜，比分 ${final.room.game.goodWins}:${final.room.game.evilWins}`)

    console.log("")
    console.log(JSON.stringify({
      roomId,
      roomCode: created.code,
      winner: final.room.game.winner,
      score: `${final.room.game.goodWins}:${final.room.game.evilWins}`,
      missions: final.room.game.missions.map(m => m.winner),
      screenshots: shotIndex,
      shotDir: SHOT_DIR,
      problems
    }, null, 2))

    if (problems.length) {
      console.error(`\n发现 ${problems.length} 条界面报错`)
      process.exitCode = 1
    }
  } finally {
    try { mp.disconnect() } catch (error) {}
  }
}

main().catch(error => {
  console.error("[e2e] 失败：", error && error.message || error)
  process.exitCode = 1
})
