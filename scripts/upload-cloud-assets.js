// 把 miniprogram/assets/ 下的文件上传到云存储。
//
// 为什么要走开发者工具而不是命令行：devtools 的 `cli cloud` 只有 env 和 functions
// 两个子命令，**没有 storage**。云存储上传只能在小程序上下文里调 wx.cloud.uploadFile，
// 所以这里用 automator 连上自动化端口，把上传动作 evaluate 进模拟器。
//
// 前提：开发者工具开着、自动化端口已监听。端口反复执行 `cli auto` 会把自动化服务
// 彻底卡死（见 avalon-devtools-toolchain 记忆），所以本脚本只连不开。
//
// 用法：node scripts/upload-cloud-assets.js assets/ui/floor-green.jpg assets/ui/floor-wine.jpg
//       参数是相对 miniprogram/ 的路径，同时也就是云存储上的 cloudPath。

const path = require("path")
const fs = require("fs")
const automator = require("miniprogram-automator")

const PORT = 9420
const ROOT = path.join(__dirname, "..", "miniprogram")
const CHUNK = 256 * 1024   // base64 分块大小

const targets = process.argv.slice(2)
if (!targets.length) {
  console.error("用法: node scripts/upload-cloud-assets.js <相对 miniprogram 的路径> ...")
  process.exit(1)
}

const missing = targets.filter(rel => !fs.existsSync(path.join(ROOT, rel)))
if (missing.length) {
  console.error("本地文件不存在:\n  " + missing.join("\n  "))
  process.exit(1)
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms))
  ])
}

async function main() {
  const mp = await withTimeout(automator.connect({ wsEndpoint: `ws://localhost:${PORT}` }), 15000, "connect")

  // 模拟器没实例化时 connect 照样成功，但之后每个调用都会挂死。先探一下。
  try {
    await withTimeout(mp.evaluate(() => true), 8000, "预检")
  } catch (error) {
    console.error("模拟器没起来。去开发者工具里点一次「重新编译」再重跑。")
    process.exit(1)
  }

  let failed = 0
  for (const rel of targets) {
    const abs = path.join(ROOT, rel)
    const size = (fs.statSync(abs).size / 1024).toFixed(0)
    try {
      // uploadFile 不认宿主机的绝对路径（报 createUploadTask:fail file not found），
      // 只认小程序沙箱内的路径。所以先把文件 base64 搬进 USER_DATA_PATH 再传。
      // 分块是因为整张 base64 有几百 KB，一次 evaluate 塞进去容易触到协议上限。
      const b64 = fs.readFileSync(abs).toString("base64")
      const sandbox = "upload-" + rel.replace(/[/.]/g, "_")
      for (let offset = 0; offset < b64.length; offset += CHUNK) {
        const chunk = b64.slice(offset, offset + CHUNK)
        const first = offset === 0
        await withTimeout(mp.evaluate(function (name, data, isFirst) {
          return new Promise(function (resolve, reject) {
            const fsm = wx.getFileSystemManager()
            const target = wx.env.USER_DATA_PATH + "/" + name
            const done = { success: resolve, fail: function (e) { reject(new Error(String(e && e.errMsg || e))) } }
            if (isFirst) fsm.writeFile({ filePath: target, data: data, encoding: "base64", ...done })
            else fsm.appendFile({ filePath: target, data: data, encoding: "base64", ...done })
          })
        }, sandbox, chunk, first), 30000, `写入 ${rel}`)
      }

      const result = await withTimeout(mp.evaluate(function (name, cloudPath) {
        return new Promise(function (resolve) {
          const filePath = wx.env.USER_DATA_PATH + "/" + name
          wx.cloud.uploadFile({
            cloudPath: cloudPath,
            filePath: filePath,
            success: function (res) {
              // 上传完就删掉中转文件，沙箱有配额，攒着迟早写不进去
              try { wx.getFileSystemManager().unlink({ filePath: filePath, fail: function () {} }) } catch (e) {}
              resolve({ ok: true, fileID: res.fileID })
            },
            // 云存储 reject 的是普通对象，必须在小程序侧转成字符串再传回，
            // 否则外面只会看到无信息量的 [object Object]
            fail: function (err) { resolve({ ok: false, error: String(err && err.errMsg || err) }) }
          })
        })
      }, sandbox, rel), 120000, `上传 ${rel}`)
      if (result && result.ok) console.log(`  OK   ${rel}  (${size}KB)`)
      else { failed += 1; console.log(`  FAIL ${rel}  ${result && result.error}`) }
    } catch (error) {
      failed += 1
      console.log(`  FAIL ${rel}  ${error.message}`)
    }
  }

  await mp.disconnect()
  console.log(failed ? `\n${failed} 个失败` : `\n${targets.length} 个全部上传成功`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
