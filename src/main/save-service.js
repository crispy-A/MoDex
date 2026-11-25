'use strict'

/**
 * 文件保存服务（主进程唯一写入口）。
 *
 * 设计要点见 docs/SAVE-SPEC.md：
 * - 乐观并发：渲染层提交 baseVersion（内容 sha256），主进程在 rename 前做迟到校验；
 * - 每路径串行：同一文件的保存排队执行，避免旧内容后落盘；
 * - 原子发布：同目录临时文件 + fsync + rename（Windows 占用/杀软退避重试）；
 * - 失败绝不改原文件；冲突返回磁盘当前 version，供渲染层选择覆盖/重载/另存。
 *
 * 纯 Node 实现（不依赖 Electron），文件系统操作可通过 io 注入便于单测。
 */
const path = require('node:path')
const fsp = require('node:fs/promises')
const fsService = require('./fs-service.js')
const { sha256Hex, UTF8_BOM } = require('./file-version.js')

const TEMP_PREFIX = '.modex-save-'
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST'])
const RENAME_MAX_ATTEMPTS = 4
const SAVE_MODES = new Set(['update', 'create', 'overwrite'])
const ENCODINGS = new Set(['utf8', 'utf8-bom'])

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeKey(filePath) {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function encodeContent(content, encoding) {
  const bytes = Buffer.from(content, 'utf8')
  return encoding === 'utf8-bom' ? Buffer.concat([UTF8_BOM, bytes]) : bytes
}

function requireAbsolutePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return fsService.fail('EINVAL', '文件路径为空')
  }
  if (!path.isAbsolute(filePath)) {
    return fsService.fail('EINVAL', `文件路径必须是绝对路径：${filePath}`)
  }
  if (filePath.includes('\u0000')) {
    return fsService.fail('EINVAL', '文件路径包含非法字符')
  }
  return null
}

function conflict(reason, current) {
  const text =
    reason === 'deleted'
      ? '文件已在磁盘上被删除'
      : '文件已在磁盘上被修改，保存已中止'
  return { ok: false, code: 'CONFLICT', reason, current: current || null, error: text }
}

/**
 * @param {{
 *   io?: Partial<typeof fsp>,
 *   now?: () => number,
 *   maxBytes?: number,
 *   hooks?: { afterTempWrite?: (info: { filePath: string, tmpPath: string }) => Promise<void>|void }
 * }} [options]
 */
function createSaveService({ io = fsp, now = Date.now, maxBytes = fsService.MAX_TEXT_BYTES, hooks = {} } = {}) {
  const call = (name, ...args) => {
    const fn = io && typeof io[name] === 'function' ? io[name] : fsp[name]
    return fn(...args)
  }

  /** 每路径串行队列：value 是永不 reject 的 tail */
  const queues = new Map()
  /** 最近一次本服务写盘记录（供外部变更监听抑制自写事件） */
  const lastWrites = new Map()

  function enqueue(key, task) {
    const previous = queues.get(key) || Promise.resolve()
    const current = previous.then(task, task)
    const tail = current.then(
      () => undefined,
      () => undefined
    )
    queues.set(key, tail)
    tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key)
    })
    return current
  }

  async function statTarget(filePath) {
    try {
      return await call('stat', filePath)
    } catch (err) {
      if (err && err.code === 'ENOENT') return null
      throw err
    }
  }

  /** 读取磁盘当前版本；不存在返回 exists:false */
  async function inspect(filePath) {
    const invalid = requireAbsolutePath(filePath)
    if (invalid) return invalid
    try {
      const stat = await call('stat', filePath)
      if (stat.isDirectory()) return fsService.fail('EISDIR', `目标是文件夹：${filePath}`)
      const buffer = await call('readFile', filePath)
      return fsService.ok({
        exists: true,
        version: {
          mtimeMs: Number(stat.mtimeMs) || 0,
          size: buffer.length,
          hash: sha256Hex(buffer),
        },
      })
    } catch (err) {
      if (err && err.code === 'ENOENT') return fsService.ok({ exists: false, version: null })
      return fsService.mapError(err, filePath)
    }
  }

  async function writeTemp(tmpPath, bytes, mode) {
    const handle = await call('open', tmpPath, 'w', mode)
    try {
      await handle.writeFile(bytes)
      // 先把数据刷到磁盘，再让 rename 发布；否则崩溃后可能看到空文件/旧内容
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  async function syncParentDir(dir) {
    try {
      const handle = await call('open', dir, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch {
      // Windows 通常不支持对目录 fsync；尽力而为
    }
  }

  async function publish(tmpPath, targetPath) {
    for (let attempt = 0; attempt < RENAME_MAX_ATTEMPTS; attempt += 1) {
      try {
        await call('rename', tmpPath, targetPath)
        return
      } catch (err) {
        const retryable = err && RENAME_RETRY_CODES.has(err.code)
        if (!retryable || attempt === RENAME_MAX_ATTEMPTS - 1) throw err
        // Windows 杀软/索引器/同步盘占用：退避后重试
        await delay(25 * 2 ** attempt + Math.floor(Math.random() * 10))
      }
    }
  }

  async function saveNow({ filePath, content, baseVersion, mode, encoding }) {
    const dir = path.dirname(filePath)
    let dirStat = null
    try {
      dirStat = await call('stat', dir)
    } catch (err) {
      return fsService.mapError(err, dir)
    }
    if (!dirStat.isDirectory()) return fsService.fail('ENOTDIR', `不是文件夹：${dir}`)

    let beforeStat = null
    try {
      beforeStat = await statTarget(filePath)
    } catch (err) {
      return fsService.mapError(err, filePath)
    }
    if (beforeStat && beforeStat.isDirectory()) return fsService.fail('EISDIR', `目标是文件夹：${filePath}`)

    if (mode === 'create' && beforeStat) {
      return fsService.fail('EEXIST', `${fsService.ERROR_TEXT.EEXIST}：${filePath}`)
    }
    if (mode === 'update') {
      if (!baseVersion || typeof baseVersion.hash !== 'string' || !baseVersion.hash) {
        return fsService.fail('EINVAL', 'update 模式需要 baseVersion')
      }
      if (!beforeStat) return conflict('deleted', null)
    }

    const bytes = encodeContent(content, encoding)
    if (bytes.length > maxBytes) return fsService.fail('TOO_LARGE', fsService.ERROR_TEXT.TOO_LARGE)

    const tmpPath = path.join(
      dir,
      `${TEMP_PREFIX}${path.basename(filePath)}-${process.pid}-${now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}.tmp`
    )

    try {
      await writeTemp(tmpPath, bytes, beforeStat ? beforeStat.mode & 0o777 : 0o666)
      if (typeof hooks.afterTempWrite === 'function') {
        await hooks.afterTempWrite({ filePath, tmpPath })
      }

      // 迟到校验：临时文件已落盘，rename 前最后一次确认磁盘仍是渲染层看到的版本。
      // 这样把「检查到发布」的窗口压到毫秒级，且冲突时原文件一个字节都不动。
      if (mode === 'update') {
        let currentBuffer = null
        try {
          currentBuffer = await call('readFile', filePath)
        } catch (err) {
          if (err && err.code === 'ENOENT') return conflict('deleted', null)
          throw err
        }
        if (sha256Hex(currentBuffer) !== baseVersion.hash) {
          const stat = await call('stat', filePath)
          return conflict('changed', {
            mtimeMs: Number(stat.mtimeMs) || 0,
            size: currentBuffer.length,
            hash: sha256Hex(currentBuffer),
          })
        }
      }

      await publish(tmpPath, filePath)
      await syncParentDir(dir)

      const after = await call('stat', filePath)
      const contentHash = sha256Hex(bytes)
      const version = {
        mtimeMs: Number(after.mtimeMs) || 0,
        size: bytes.length,
        hash: contentHash,
      }
      lastWrites.set(normalizeKey(filePath), { hash: contentHash, at: now() })
      return fsService.ok({ path: filePath, version, size: bytes.length, mtimeMs: version.mtimeMs })
    } catch (err) {
      return fsService.mapError(err, filePath)
    } finally {
      await call('rm', tmpPath, { force: true }).catch(() => {})
    }
  }

  async function save(input = {}) {
    const filePath = input.filePath
    const invalid = requireAbsolutePath(filePath)
    if (invalid) return invalid

    const content = input.content
    if (typeof content !== 'string') return fsService.fail('EINVAL', '写入内容必须是文本')
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > maxBytes) return fsService.fail('TOO_LARGE', fsService.ERROR_TEXT.TOO_LARGE)

    const mode = input.mode === undefined ? 'update' : String(input.mode)
    if (!SAVE_MODES.has(mode)) return fsService.fail('EINVAL', `未知保存模式：${mode}`)
    const encoding = input.encoding === undefined ? 'utf8' : String(input.encoding)
    if (!ENCODINGS.has(encoding)) return fsService.fail('EINVAL', `未知编码：${encoding}`)

    const baseVersion =
      input.baseVersion && typeof input.baseVersion === 'object' ? input.baseVersion : null

    return enqueue(normalizeKey(filePath), () =>
      saveNow({ filePath: path.resolve(filePath), content, baseVersion, mode, encoding })
    )
  }

  function getLastWrite(filePath) {
    const record = lastWrites.get(normalizeKey(filePath))
    return record ? { ...record } : null
  }

  function dispose() {
    queues.clear()
    lastWrites.clear()
  }

  return { save, inspect, getLastWrite, dispose }
}

module.exports = {
  TEMP_PREFIX,
  SAVE_MODES,
  ENCODINGS,
  encodeContent,
  createSaveService,
}
