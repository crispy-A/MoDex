'use strict'

/**
 * 文件系统服务：所有磁盘读写都经过这里，负责参数校验、路径安全与统一错误码。
 * 纯 Node 实现（不依赖 electron），便于单元测试；删除操作的「回收站」能力由调用方注入。
 * 返回统一信封 { ok: true, ... } | { ok: false, code, error }，永不 reject。
 */
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')

const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_NAME_LENGTH = 200
const MARKDOWN_EXTS = new Set(['.md', '.markdown'])

// Windows 文件/文件夹名非法字符与保留名
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const TRAILING_DOT_OR_SPACE = /[. ]$/

const ERROR_TEXT = {
  EINVAL: '参数不合法',
  ENOENT: '文件或文件夹不存在',
  EEXIST: '同名文件或文件夹已存在',
  EACCES: '没有访问权限，或文件正被其他程序占用',
  EPERM: '没有访问权限，或操作被系统拒绝',
  EBUSY: '文件正被其他程序使用',
  EISDIR: '目标是一个文件夹',
  ENOTDIR: '目标不是文件夹',
  ENOTEMPTY: '文件夹不是空的，无法删除',
  ENAMETOOLONG: '名称过长',
  ENOSPC: '磁盘空间不足',
  EROFS: '磁盘为只读',
  TOO_LARGE: '文件超过 5 MB 文本上限',
  BAD_ENCODING: '文件不是有效的 UTF-8 文本',
  NOT_MARKDOWN: '新建文件必须使用 .md 或 .markdown 扩展名',
  UNKNOWN: '操作失败',
}

function fail(code, error, extra) {
  return { ok: false, code, error: error || ERROR_TEXT[code] || ERROR_TEXT.UNKNOWN, ...(extra || {}) }
}

function ok(extra) {
  return { ok: true, ...(extra || {}) }
}

/** 把 Node 错误映射为统一错误码与中文说明 */
function mapError(err, target) {
  if (err && err.code) {
    const known = Object.prototype.hasOwnProperty.call(ERROR_TEXT, err.code)
    const code = known ? err.code : 'UNKNOWN'
    const text = known ? ERROR_TEXT[err.code] : ERROR_TEXT.UNKNOWN
    return fail(code, `${text}（${target || '未知路径'}）`)
  }
  return fail('UNKNOWN', `${ERROR_TEXT.UNKNOWN}（${target || '未知路径'}）`)
}

function isMarkdownPath(targetPath) {
  return MARKDOWN_EXTS.has(path.extname(String(targetPath)).toLowerCase())
}

function requireAbsolutePath(targetPath, label = '路径') {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return fail('EINVAL', `${label}为空`)
  }
  if (!path.isAbsolute(targetPath)) {
    return fail('EINVAL', `${label}必须是绝对路径：${targetPath}`)
  }
  if (targetPath.includes('\u0000')) {
    return fail('EINVAL', `${label}包含非法字符`)
  }
  return null
}

/**
 * 校验文件/文件夹名。
 * @param {string} name 用户输入的名称（可含首尾空格，会被裁剪）
 * @param {{ requireMarkdown?: boolean }} options
 * @returns {{ ok: true, name: string } | { ok: false, code: string, error: string }}
 */
function validateName(name, options = {}) {
  if (typeof name !== 'string') return fail('EINVAL', '名称必须是文本')
  const trimmed = name.trim()
  if (!trimmed) return fail('EINVAL', '名称不能为空')
  if (trimmed.length > MAX_NAME_LENGTH) return fail('EINVAL', `名称不能超过 ${MAX_NAME_LENGTH} 个字符`)
  if (trimmed === '.' || trimmed === '..') return fail('EINVAL', '名称不能是 . 或 ..')
  if (INVALID_NAME_CHARS.test(trimmed)) return fail('EINVAL', '名称不能包含 \\ / : * ? " < > | 等字符')
  if (TRAILING_DOT_OR_SPACE.test(trimmed)) return fail('EINVAL', '名称不能以空格或点结尾')
  if (WINDOWS_RESERVED.test(trimmed)) return fail('EINVAL', `“${trimmed}” 是系统保留名称`)
  if (options.requireMarkdown && !isMarkdownPath(trimmed)) {
    return fail('NOT_MARKDOWN')
  }
  return ok({ name: trimmed })
}

/** 目标是否必须是已存在的目录；返回错误信封或 null */
async function assertDirectory(dirPath) {
  const invalid = requireAbsolutePath(dirPath, '文件夹路径')
  if (invalid) return invalid
  let stat
  try {
    stat = await fsp.stat(dirPath)
  } catch (err) {
    return mapError(err, dirPath)
  }
  if (!stat.isDirectory()) return fail('ENOTDIR', `不是文件夹：${dirPath}`)
  return null
}

/** 列出目录内容（目录在前，文件在后；同类按名称自然排序） */
async function listDir(dirPath) {
  const dirError = await assertDirectory(dirPath)
  if (dirError) return dirError

  let dirents
  try {
    dirents = await fsp.readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    return mapError(err, dirPath)
  }

  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const fullPath = path.join(dirPath, dirent.name)
      let isDirectory = dirent.isDirectory()
      let size = 0
      let mtimeMs = 0
      try {
        const stat = await fsp.stat(fullPath)
        isDirectory = stat.isDirectory()
        size = isDirectory ? 0 : stat.size
        mtimeMs = stat.mtimeMs
      } catch {
        // 断开的符号链接或权限问题：仍然展示条目，但拿不到尺寸
      }
      return {
        name: dirent.name,
        path: fullPath,
        isDirectory,
        isMarkdown: !isDirectory && isMarkdownPath(fullPath),
        size,
        mtimeMs,
        hidden: dirent.name.startsWith('.'),
      }
    })
  )

  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return collator.compare(a.name, b.name)
  })

  return ok({ path: dirPath, entries })
}

/** 读取 UTF-8 文本（保留原始换行；去掉 BOM） */
async function readFile(filePath) {
  const invalid = requireAbsolutePath(filePath, '文件路径')
  if (invalid) return invalid

  let stat
  try {
    stat = await fsp.stat(filePath)
  } catch (err) {
    return mapError(err, filePath)
  }
  if (stat.isDirectory()) return fail('EISDIR', `目标是文件夹：${filePath}`)
  if (stat.size > MAX_TEXT_BYTES) return fail('TOO_LARGE', `${ERROR_TEXT.TOO_LARGE}：${filePath}`)

  let buffer
  try {
    buffer = await fsp.readFile(filePath)
  } catch (err) {
    return mapError(err, filePath)
  }
  if (buffer.length > MAX_TEXT_BYTES) return fail('TOO_LARGE', `${ERROR_TEXT.TOO_LARGE}：${filePath}`)

  let content
  try {
    // fatal: true —— 遇到非法 UTF-8 序列直接抛错，避免保存时静默损坏内容
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return fail('BAD_ENCODING', `${ERROR_TEXT.BAD_ENCODING}：${filePath}`)
  }
  if (content.includes('\u0000')) return fail('BAD_ENCODING', `${ERROR_TEXT.BAD_ENCODING}：${filePath}`)

  return ok({ path: filePath, content, size: buffer.length, mtimeMs: stat.mtimeMs })
}

/** 原子写入：先写同目录临时文件再 rename，失败时清理临时文件 */
async function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath)
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.qm-${process.pid}-${Date.now().toString(36)}.tmp`
  )
  try {
    await fsp.writeFile(tmpPath, content, 'utf8')
    await fsp.rename(tmpPath, filePath)
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

/** 覆盖写入文本文件（目标必须是已存在的文件或其所在目录存在） */
async function writeFile(filePath, content) {
  const invalid = requireAbsolutePath(filePath, '文件路径')
  if (invalid) return invalid
  if (typeof content !== 'string') return fail('EINVAL', '写入内容必须是文本')
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) {
    return fail('TOO_LARGE', ERROR_TEXT.TOO_LARGE)
  }

  let stat = null
  try {
    stat = await fsp.stat(filePath)
  } catch (err) {
    if (err.code !== 'ENOENT') return mapError(err, filePath)
  }
  if (stat && stat.isDirectory()) return fail('EISDIR', `目标是文件夹：${filePath}`)

  const dirError = await assertDirectory(path.dirname(filePath))
  if (dirError) return dirError

  try {
    await atomicWrite(filePath, content)
    const after = await fsp.stat(filePath)
    return ok({ path: filePath, size: after.size, mtimeMs: after.mtimeMs })
  } catch (err) {
    return mapError(err, filePath)
  }
}

/** 新建 Markdown 文件（已存在则报 EEXIST） */
async function createFile(dirPath, name, content = '') {
  const dirError = await assertDirectory(dirPath)
  if (dirError) return dirError
  const nameResult = validateName(name, { requireMarkdown: true })
  if (!nameResult.ok) return nameResult
  if (typeof content !== 'string') return fail('EINVAL', '初始内容必须是文本')

  const filePath = path.join(dirPath, nameResult.name)
  try {
    await fsp.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
    const stat = await fsp.stat(filePath)
    return ok({ path: filePath, name: nameResult.name, size: stat.size, mtimeMs: stat.mtimeMs })
  } catch (err) {
    return mapError(err, filePath)
  }
}

/** 新建文件夹（已存在则报 EEXIST） */
async function createFolder(dirPath, name) {
  const dirError = await assertDirectory(dirPath)
  if (dirError) return dirError
  const nameResult = validateName(name)
  if (!nameResult.ok) return nameResult

  const folderPath = path.join(dirPath, nameResult.name)
  try {
    await fsp.mkdir(folderPath)
    return ok({ path: folderPath, name: nameResult.name })
  } catch (err) {
    return mapError(err, folderPath)
  }
}

/** 重命名文件或文件夹（支持仅大小写变化的改名） */
async function rename(targetPath, newName) {
  const invalid = requireAbsolutePath(targetPath, '路径')
  if (invalid) return invalid
  const nameResult = validateName(newName)
  if (!nameResult.ok) return nameResult

  let stat
  try {
    stat = await fsp.lstat(targetPath)
  } catch (err) {
    return mapError(err, targetPath)
  }
  if (!stat.isFile() && !stat.isDirectory() && !stat.isSymbolicLink()) {
    return fail('EINVAL', '只能重命名文件或文件夹')
  }

  const parentDir = path.dirname(targetPath)
  const nextPath = path.join(parentDir, nameResult.name)
  if (nextPath === targetPath) return ok({ path: nextPath, name: nameResult.name })

  const isCaseOnly = nextPath.toLowerCase() === targetPath.toLowerCase()
  if (!isCaseOnly) {
    try {
      await fsp.lstat(nextPath)
      return fail('EEXIST', `${ERROR_TEXT.EEXIST}：${nameResult.name}`)
    } catch (err) {
      if (err.code !== 'ENOENT') return mapError(err, nextPath)
    }
  }

  try {
    if (isCaseOnly) {
      // Windows 大小写不敏感，直接 rename 会变成空操作，用临时名中转
      const tempPath = path.join(parentDir, `.qm-rename-${process.pid}-${Date.now().toString(36)}`)
      await fsp.rename(targetPath, tempPath)
      try {
        await fsp.rename(tempPath, nextPath)
      } catch (err) {
        await fsp.rename(tempPath, targetPath).catch(() => {})
        throw err
      }
    } else {
      await fsp.rename(targetPath, nextPath)
    }
    return ok({ path: nextPath, name: nameResult.name })
  } catch (err) {
    return mapError(err, targetPath)
  }
}

/**
 * 删除文件或空文件夹。
 * @param {string} targetPath
 * @param {{ trash?: (p: string) => Promise<void> }} [options] 注入回收站实现（主进程用 shell.trashItem）
 */
async function remove(targetPath, options = {}) {
  const invalid = requireAbsolutePath(targetPath, '路径')
  if (invalid) return invalid

  let stat
  try {
    stat = await fsp.lstat(targetPath)
  } catch (err) {
    return mapError(err, targetPath)
  }

  const isDirectory = stat.isDirectory()
  if (isDirectory) {
    try {
      const children = await fsp.readdir(targetPath)
      if (children.length > 0) return fail('ENOTEMPTY', `${ERROR_TEXT.ENOTEMPTY}：${targetPath}`)
    } catch (err) {
      return mapError(err, targetPath)
    }
  }

  let trashed = false
  if (typeof options.trash === 'function') {
    try {
      await options.trash(targetPath)
      trashed = true
    } catch {
      trashed = false
    }
  }

  if (!trashed) {
    try {
      if (isDirectory) await fsp.rmdir(targetPath)
      else await fsp.rm(targetPath)
    } catch (err) {
      return mapError(err, targetPath)
    }
  }

  return ok({ path: targetPath, trashed })
}

/** 查询单个路径的信息；不存在时返回 exists:false（不是错误） */
async function pathInfo(targetPath) {
  const invalid = requireAbsolutePath(targetPath, '路径')
  if (invalid) return invalid

  const base = {
    path: targetPath,
    name: path.basename(targetPath),
    dir: path.dirname(targetPath),
    dirName: path.basename(path.dirname(targetPath)),
    ext: path.extname(targetPath),
    isMarkdown: isMarkdownPath(targetPath),
  }

  try {
    const stat = await fsp.stat(targetPath)
    return ok({
      ...base,
      exists: true,
      isDirectory: stat.isDirectory(),
      size: stat.isDirectory() ? 0 : stat.size,
      mtimeMs: stat.mtimeMs,
    })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return ok({ ...base, exists: false, isDirectory: false, size: 0, mtimeMs: 0 })
    }
    return mapError(err, targetPath)
  }
}

module.exports = {
  MAX_TEXT_BYTES,
  MAX_NAME_LENGTH,
  ERROR_TEXT,
  fail,
  ok,
  mapError,
  isMarkdownPath,
  validateName,
  listDir,
  readFile,
  writeFile,
  createFile,
  createFolder,
  rename,
  remove,
  pathInfo,
}
