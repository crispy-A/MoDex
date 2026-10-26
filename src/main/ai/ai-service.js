'use strict'

/**
 * AI 服务（主进程）：
 * - 注册 ai:* IPC；持有 API Key（仅主进程解密）与会话存储
 * - 发起 DeepSeek Responses 流式请求，把归一化事件通过 webContents.send('ai:event') 推给渲染层
 * - 同一时刻仅允许 1 个活跃生成；支持取消；窗口关闭时清理
 */
const path = require('node:path')
const providerRegistry = require('./provider-registry.js')
const { createCredentialsStore } = require('./credentials.js')
const { createAiStore } = require('./ai-store.js')
const { buildResponsesRequest, streamResponses, normalizeHttpError } = require('./responses-client.js')

const MAX_MESSAGES = 200
const MAX_MESSAGE_CHARS = 400000
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const TEST_TIMEOUT_MS = 5000

function ok(extra) {
  return { ok: true, ...(extra || {}) }
}

function fail(code, message, retryable = false, extra) {
  return { ok: false, error: { code, message, retryable, ...(extra || {}) } }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null
  let total = 0
  const result = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') return null
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null
    if (!role || typeof message.content !== 'string') return null
    total += message.content.length
    if (total > MAX_MESSAGE_CHARS) return null
    result.push({ role, content: message.content })
  }
  return result
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object') return null
  if (typeof context.content !== 'string' || context.content.length === 0) return null
  return {
    fileName: typeof context.fileName === 'string' ? context.fileName : '未命名文档',
    content: context.content.slice(0, 500000),
  }
}

function createAiService({
  userDataDir,
  store,
  safeStorage,
  fetchImpl,
  baseUrlOverride,
  sendToRenderer,
  firstByteTimeoutMs,
  idleTimeoutMs,
}) {
  if (!userDataDir) throw new Error('ai-service: 缺少 userDataDir')
  if (typeof fetchImpl !== 'function') throw new Error('ai-service: 缺少 fetchImpl')
  if (typeof sendToRenderer !== 'function') throw new Error('ai-service: 缺少 sendToRenderer')

  const aiDir = path.join(userDataDir, 'ai')
  const credentials = createCredentialsStore({
    filePath: path.join(aiDir, 'api-key.bin'),
    safeStorage,
  })
  const sessions = createAiStore({ filePath: path.join(aiDir, 'sessions.json') })
  const baseUrl = providerRegistry.resolveBaseUrl(baseUrlOverride)

  let active = null
  let shutdownCalled = false

  function emit(payload) {
    if (shutdownCalled) return
    try {
      sendToRenderer('ai:event', payload)
    } catch (err) {
      console.error('[ai] 推送事件失败：', err && err.message)
    }
  }

  function errorFrom(err) {
    if (err && err.code && err.message) {
      return { code: String(err.code), message: String(err.message), retryable: false }
    }
    return { code: 'UNKNOWN', message: '操作失败，请重试', retryable: true }
  }

  async function bootstrap() {
    const settings = store.getSettings()
    const status = await credentials.status()
    return ok({
      provider: { id: providerRegistry.PROVIDER.id, name: providerRegistry.PROVIDER.name },
      models: providerRegistry.listModels(),
      defaultModel: providerRegistry.DEFAULT_MODEL,
      settings: {
        model: settings.aiModel,
        panelMode: settings.aiPanelMode,
        panelWidth: settings.aiPanelWidth,
        includeContext: settings.aiIncludeContext,
      },
      hasKey: status.hasKey,
      maskedKey: status.maskedKey,
    })
  }

  async function runStream(record, request, key) {
    emit({ requestId: record.requestId, type: 'started' })
    let result
    try {
      result = await streamResponses({
        url: request.url,
        headers: { ...request.headers, authorization: `Bearer ${key}` },
        body: request.body,
        fetchImpl,
        signal: record.controller.signal,
        ...(Number(firstByteTimeoutMs) > 0 ? { firstByteTimeoutMs: Number(firstByteTimeoutMs) } : {}),
        ...(Number(idleTimeoutMs) > 0 ? { idleTimeoutMs: Number(idleTimeoutMs) } : {}),
        onEvent: (event) => {
          if (record.cancelled) return
          emit({ requestId: record.requestId, type: event.type, delta: event.delta })
        },
      })
    } catch (err) {
      result = { ok: false, error: { code: 'UNKNOWN', message: '请求失败，请重试', retryable: true } }
    }

    if (record.cancelled) {
      emit({ requestId: record.requestId, type: 'cancelled' })
      return
    }
    if (!result.ok) {
      if (result.cancelled) {
        emit({ requestId: record.requestId, type: 'cancelled' })
        return
      }
      emit({ requestId: record.requestId, type: 'failed', error: result.error || errorFrom(new Error('请求失败')) })
      return
    }

    const terminal = result.terminal
    if (terminal && terminal.type === 'failed') {
      emit({ requestId: record.requestId, type: 'failed', error: terminal.error })
      return
    }
    if (terminal && terminal.type === 'incomplete') {
      emit({
        requestId: record.requestId,
        type: 'incomplete',
        usage: terminal.usage,
        reason: terminal.reason,
        durationMs: result.durationMs,
      })
      return
    }
    emit({
      requestId: record.requestId,
      type: 'completed',
      usage: (terminal && terminal.usage) || { input: 0, output: 0, total: 0 },
      durationMs: result.durationMs,
    })
  }

  async function send(_event, payload = {}) {
    const requestId = String((payload && payload.requestId) || '')
    if (!REQUEST_ID_PATTERN.test(requestId)) return fail('EINVAL', '请求 ID 不合法')
    const model = String((payload && payload.model) || '')
    if (!providerRegistry.isKnownModel(model)) return fail('EINVAL', '未知模型')
    const messages = normalizeMessages(payload && payload.messages)
    if (!messages) return fail('EINVAL', '消息列表不合法')
    const context = normalizeContext(payload && payload.context)
    if (active) return fail('BUSY', '正在生成上一条回答，请先停止')

    const key = await credentials.getKey()
    if (!key) return fail('NO_KEY', '请先在 AI 设置中配置 API Key')

    const request = buildResponsesRequest({ baseUrl, model, messages, context })
    const record = { requestId, controller: new AbortController(), cancelled: false }
    active = record
    void runStream(record, request, key)
      .catch((err) => {
        console.error('[ai] 请求异常：', err && err.message)
        emit({ requestId, type: 'failed', error: errorFrom(err) })
      })
      .finally(() => {
        if (active === record) active = null
      })
    return ok()
  }

  function cancel(_event, payload = {}) {
    const requestId = String((payload && payload.requestId) || '')
    if (!active || active.requestId !== requestId) return ok({ cancelled: false })
    active.cancelled = true
    active.controller.abort()
    return ok({ cancelled: true })
  }

  async function setKey(_event, payload = {}) {
    try {
      const status = await credentials.setKey(payload && payload.key)
      return ok({ hasKey: status.hasKey, maskedKey: status.maskedKey })
    } catch (err) {
      return { ok: false, error: errorFrom(err) }
    }
  }

  async function clearKey() {
    try {
      await credentials.clear()
      return ok({ hasKey: false })
    } catch (err) {
      return { ok: false, error: errorFrom(err) }
    }
  }

  async function testConnection() {
    const key = await credentials.getKey()
    if (!key) return fail('NO_KEY', '请先在 AI 设置中配置 API Key')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
    const startedAt = Date.now()
    try {
      const response = await fetchImpl(`${baseUrl}/models`, {
        method: 'GET',
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response || !response.ok) {
        const status = response ? response.status : 0
        let text = ''
        try {
          text = await response.text()
        } catch {
          text = ''
        }
        return { ok: false, error: normalizeHttpError(status, text) }
      }
      return ok({ latencyMs: Date.now() - startedAt })
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
        return fail('TIMEOUT', '连接超时，请检查网络或代理', true)
      }
      return fail('NETWORK', '网络连接失败，请检查网络或代理', true)
    } finally {
      clearTimeout(timer)
    }
  }

  async function listSessions() {
    try {
      return ok({ sessions: await sessions.list() })
    } catch (err) {
      return { ok: false, error: errorFrom(err) }
    }
  }

  async function getSession(_event, payload = {}) {
    const id = String((payload && payload.id) || '')
    if (!REQUEST_ID_PATTERN.test(id)) return fail('EINVAL', '会话 ID 不合法')
    try {
      const session = await sessions.get(id)
      if (!session) return fail('ENOENT', '会话不存在')
      return ok({ session })
    } catch (err) {
      return { ok: false, error: errorFrom(err) }
    }
  }

  async function saveSession(_event, payload = {}) {
    try {
      const summary = await sessions.save(payload && payload.session)
      return ok({ session: summary })
    } catch (err) {
      return { ok: false, error: errorFrom(err) }
    }
  }

  async function deleteSession(_event, payload = {}) {
    const id = String((payload && payload.id) || '')
    if (!REQUEST_ID_PATTERN.test(id)) return fail('EINVAL', '会话 ID 不合法')
    try {
      const removed = await sessions.remove(id)
      return ok({ removed })
    } catch (err) {
      return { ok: false, error: errorFrom(err) }
    }
  }

  function registerIpc(handle) {
    handle('ai:bootstrap', bootstrap)
    handle('ai:send', send)
    handle('ai:cancel', cancel)
    handle('ai:set-key', setKey)
    handle('ai:clear-key', clearKey)
    handle('ai:test-connection', testConnection)
    handle('ai:sessions:list', listSessions)
    handle('ai:sessions:get', getSession)
    handle('ai:sessions:save', saveSession)
    handle('ai:sessions:delete', deleteSession)
  }

  function shutdown() {
    shutdownCalled = true
    if (active) {
      active.cancelled = true
      try {
        active.controller.abort()
      } catch {
        // 忽略
      }
      active = null
    }
  }

  return {
    registerIpc,
    shutdown,
    bootstrap,
    listSessions,
    getSession,
    saveSession,
    deleteSession,
    setKey,
    clearKey,
    testConnection,
    cancel,
    send,
    get baseUrl() {
      return baseUrl
    },
  }
}

module.exports = { createAiService, MAX_MESSAGES, MAX_MESSAGE_CHARS }
