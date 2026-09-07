// 云开发 SDK 的内存替身：让 cloudfunctions/avalonGame 在本地 node 里原样跑起来。
//
// 只模拟云函数真正用到的那几条接口（doc.get/set/update、collection.add/where、
// runTransaction、getWXContext、getTempFileURL）。update 按「点路径」逐字段写入，
// 和线上一致——写错嵌套字段时线上会报同样的 "Cannot create field"。
//
// 集成测试和随机对局机共用这一份；别在各自文件里再抄一遍。
const Module = require("module")

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function createCloudMock() {
  const collections = new Map()
  let openid = "host"
  let nextId = 1
  const setMarker = Symbol("set")
  const command = { set: value => ({ [setMarker]: true, value }) }

  function records(name) {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)
  }

  function isSet(value) {
    return !!(value && value[setMarker])
  }

  function applyPath(target, path, value) {
    const parts = path.split(".")
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index]
      if (cursor[part] === undefined) cursor[part] = {}
      if (cursor[part] === null || typeof cursor[part] !== "object" || Array.isArray(cursor[part])) {
        throw new Error(`Cannot create field '${parts[index + 1]}' in element {${part}: ${cursor[part]}}`)
      }
      cursor = cursor[part]
    }
    cursor[parts[parts.length - 1]] = clone(value)
  }

  function flattenUpdate(value, prefix, output) {
    if (isSet(value)) {
      output.push([prefix, value.value])
      return
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const keys = Object.keys(value)
      if (keys.length) {
        keys.forEach(key => flattenUpdate(value[key], prefix ? `${prefix}.${key}` : key, output))
        return
      }
    }
    output.push([prefix, value])
  }

  function docApi(name, id) {
    return {
      async get() {
        const value = records(name).get(String(id))
        if (!value) throw new Error(`document ${name}/${id} not found`)
        return { data: clone(value) }
      },
      async set({ data }) {
        const normalized = {}
        Object.keys(data).forEach(key => {
          normalized[key] = isSet(data[key]) ? clone(data[key].value) : clone(data[key])
        })
        normalized._id = normalized._id || String(id)
        records(name).set(String(id), normalized)
        return { stats: { created: 1 } }
      },
      async update({ data }) {
        const current = records(name).get(String(id))
        if (!current) throw new Error(`document ${name}/${id} not found`)
        const updates = []
        Object.keys(data).forEach(key => flattenUpdate(data[key], key, updates))
        updates.forEach(([path, value]) => applyPath(current, path, value))
        records(name).set(String(id), current)
        return { stats: { updated: 1 } }
      }
    }
  }

  function collectionApi(name) {
    return {
      doc(id) { return docApi(name, id) },
      async add({ data }) {
        const id = `room-${nextId++}`
        records(name).set(id, { ...clone(data), _id: id })
        return { _id: id }
      },
      where(query) {
        return {
          limit() { return this },
          async get() {
            const data = Array.from(records(name).values()).filter(item => Object.keys(query).every(key => item[key] === query[key]))
            return { data: clone(data) }
          }
        }
      }
    }
  }

  const database = {
    command,
    collection: collectionApi,
    async runTransaction(handler) {
      return handler({ collection: collectionApi })
    }
  }

  return {
    sdk: {
      DYNAMIC_CURRENT_ENV: "test",
      init() {},
      database: () => database,
      getWXContext: () => ({ OPENID: openid }),
      // 服务端签名接口：管理员身份、不受存储权限限制，这里给个可辨认的假链接
      async getTempFileURL({ fileList }) {
        return { fileList: (fileList || []).map(id => ({ fileID: id, tempFileURL: "https://signed.example/" + id.split("/").pop() })) }
      }
    },
    setOpenid(value) { openid = value },
    get(name, id) { return records(name).get(String(id)) },
    reset() {
      collections.clear()
      openid = "host"
      nextId = 1
    }
  }
}

// 用替身顶掉 wx-server-sdk，把云函数入口加载进来。
// require 缓存会让同一进程内第二次加载拿到同一个实例，所以一个进程只该调一次。
function loadCloudFunction(cloudMock) {
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") return cloudMock.sdk
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require("../../cloudfunctions/avalonGame/index")
  } finally {
    Module._load = originalLoad
  }
}

module.exports = { createCloudMock, loadCloudFunction, clone }
