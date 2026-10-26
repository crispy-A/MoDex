'use strict'

/**
 * AI 会话持久化（userData/ai/sessions.json）：
 * - 原子写（临时文件 + rename）
 * - 严格清洗（id/role/status/长度/数量上限），未知字段丢弃
 * - 最多 200 个会话（按 updatedAt 淘汰最旧），单会话最多 200 条消息
 */
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const SCHEMA_VERSION = 1
const MAX_SESSIONS = 200
const MAX_MESSAGES = 200
const MAX_CONTENT_CHARS = 200000
const MAX_REASONING_CHARS = 100000
const MAX_TITLE_CHARS = 120
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ROLES = ['user', 'assistant']
const STATUSES = ['done', 'error', 'cancelled']

function aiError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function safeId(value, prefix) {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : makeId(prefix)
}

function safeTitle(value) {
  const text = String(value == null ? '' : value)
    .replace(/[\r\n]+/g, ' ')
    .trim()
  if (!text) return '新对话'
  return text.slice(0, MAX_TITLE_CHARS)
}

function safeTimestamp(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : Date.now()
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const input = Math.max(0, Math.round(Number(usage.input) || 0))
  const output = Math.max(0, Math.round(Number(usage.output) || 0))
  const total = Math.max(0, Math.round(Number(usage.total) || input + output))
  return { input, output, total }
}

function sanitizeError(error) {
  if (!error || typeof error !== 'object') return null
  return {
    code: String(error.code || 'UNKNOWN').slice(0, 64),
    message: String(error.message || '').slice(0, 500),
  }
}

function sanitizeMessage(raw) {
  if (!raw || typeof raw !== 'object') return null
  const role = ROLES.includes(raw.role) ? raw.role : null
  if (!role) return null
  const content = String(raw.content == null ? '' : raw.content).slice(0, MAX_CONTENT_CHARS)
  const reasoning =
    typeof raw.reasoning === 'string' && raw.reasoning ? raw.reasoning.slice(0, MAX_REASONING_CHARS) : ''
  const status = STATUSES.includes(raw.status) ? raw.status : 'done'
  const usage = sanitizeUsage(raw.usage)
  const error = sanitizeError(raw.error)
  const model = typeof raw.model === 'string' && raw.model ? raw.model.slice(0, 64) : undefined
  const durationMs = Number.isFinite(Number(raw.durationMs)) && Number(raw.durationMs) >= 0 ? Math.round(Number(raw.durationMs)) : undefined
  const message = {
    id: safeId(raw.id, 'm'),
    role,
    content,
    reasoning,
    status,
    usage,
    error,
    createdAt: safeTimestamp(raw.createdAt),
  }
  if (model) message.model = model
  if (durationMs !== undefined) message.durationMs = durationMs
  return message
}

function sanitizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map(sanitizeMessage)
    .filter(Boolean)
    .slice(-MAX_MESSAGES)
  return {
    id: safeId(raw.id, 's'),
    title: safeTitle(raw.title),
    model: String(raw.model || 'deepseek-flash').slice(0, 64),
    createdAt: safeTimestamp(raw.createdAt),
    updatedAt: safeTimestamp(raw.updatedAt),
    messages,
  }
}

function summarize(session) {
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    messageCount: session.messages.length,
    updatedAt: session.updatedAt,
  }
}

function createAiStore({ filePath }) {
  if (!filePath) throw new Error('ai-store: 缺少 filePath')
  const directory = path.dirname(filePath)
  let loaded = false
  let sessions = []

  async function load() {
    if (loaded) return sessions
    loaded = true
    try {
      const text = await fsp.readFile(filePath, 'utf8')
      const parsed = JSON.parse(text)
      const list = parsed && Array.isArray(parsed.sessions) ? parsed.sessions : []
      sessions = list.map(sanitizeSession).filter(Boolean)
      sessions.sort((a, b) => b.updatedAt - a.updatedAt)
      if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(0, MAX_SESSIONS)
    } catch {
      sessions = []
    }
    return sessions
  }

  async function persist() {
    await fsp.mkdir(directory, { recursive: true })
    const payload = JSON.stringify({ version: SCHEMA_VERSION, sessions })
    const tempPath = `${filePath}.tmp`
    await fsp.writeFile(tempPath, payload, 'utf8')
    // Windows 下目标文件偶发被扫描/占用会导致 rename EPERM，重试并在必要时先删除目标
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await fsp.rename(tempPath, filePath)
        return
      } catch (err) {
        const retryable = err && (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EEXIST')
        if (!retryable || attempt === 3) throw err
        await fsp.rm(filePath, { force: true }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
      }
    }
  }

  async function list() {
    await load()
    return sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarize)
  }

  async function get(id) {
    await load()
    const found = sessions.find((session) => session.id === id)
    return found ? JSON.parse(JSON.stringify(found)) : null
  }

  async function save(rawSession) {
    await load()
    const session = sanitizeSession(rawSession)
    if (!session) throw aiError('EINVAL', '会话数据不合法')
    session.updatedAt = Date.now()
    const index = sessions.findIndex((item) => item.id === session.id)
    if (index >= 0) sessions[index] = session
    else sessions.push(session)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    if (sessions.length > MAX_SESSIONS) sessions = sessions.slice(0, MAX_SESSIONS)
    await persist()
    return summarize(session)
  }

  async function remove(id) {
    await load()
    const before = sessions.length
    sessions = sessions.filter((session) => session.id !== id)
    if (sessions.length === before) return false
    await persist()
    return true
  }

  return { load, list, get, save, remove }
}

module.exports = {
  SCHEMA_VERSION,
  MAX_SESSIONS,
  MAX_MESSAGES,
  MAX_CONTENT_CHARS,
  MAX_TITLE_CHARS,
  sanitizeSession,
  sanitizeMessage,
  createAiStore,
}
