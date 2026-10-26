'use strict'

/**
 * DeepSeek Responses API 客户端（协议层）：
 * - 纯函数：构造请求、归一化 SSE 事件/usage/错误（便于单测）
 * - streamResponses：发起流式请求、解析 SSE、把 text/reasoning 增量交给回调，返回最终状态
 * 注意：API Key 只由调用方（主进程 ai-service）注入 headers，本模块不读取/记录 Key。
 */
const { buildInstructions } = require('./provider-registry.js')
const { createSseParser } = require('./sse.js')

const FIRST_BYTE_TIMEOUT_MS = 30000
const IDLE_TIMEOUT_MS = 60000
const DEFAULT_MAX_OUTPUT_TOKENS = 2048

const STATUS_ERRORS = Object.freeze({
  400: { code: 'INVALID_REQUEST', message: '请求参数有误，请重试或更换模型', retryable: false },
  401: { code: 'AUTH', message: 'API Key 无效，请在 AI 设置中更新', retryable: false },
  402: { code: 'BALANCE', message: '账户余额不足，请前往 DeepSeek 充值', retryable: false },
  422: { code: 'INVALID_REQUEST', message: '请求参数有误，请重试或更换模型', retryable: false },
  429: { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后重试', retryable: true },
  500: { code: 'SERVER', message: '服务暂时不可用，请稍后重试', retryable: true },
  503: { code: 'SERVER', message: '服务暂时不可用，请稍后重试', retryable: true },
})

function normalizeUsage(usage) {
  const input = Number(usage && usage.input_tokens) || 0
  const output = Number(usage && usage.output_tokens) || 0
  const total = Number(usage && usage.total_tokens) || input + output
  return { input, output, total }
}

/** 构造 POST /responses 请求（不含 Authorization，Key 由调用方注入） */
function buildResponsesRequest({ baseUrl, model, messages, context = null, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS }) {
  const { instructions, truncated, contextChars } = buildInstructions(context)
  const input = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message && message.role === 'assistant' ? 'assistant' : 'user',
    content: String((message && message.content) || ''),
  }))
  return {
    url: `${String(baseUrl || '').replace(/\/+$/, '')}/responses`,
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: {
      model,
      instructions,
      input,
      stream: true,
      max_output_tokens: Math.max(1, Math.min(8192, Number(maxOutputTokens) || DEFAULT_MAX_OUTPUT_TOKENS)),
    },
    meta: { contextChars, truncated, inputMessages: input.length },
  }
}

/** 上游 response.failed 的 error 归一化 */
function normalizeResponseFailed(response) {
  const raw = (response && response.error) || {}
  const code = String(raw.code || raw.type || '')
  if (/invalid_api_key|authentication/i.test(code)) {
    return { code: 'AUTH', message: 'API Key 无效，请在 AI 设置中更新', retryable: false, detail: raw.message || '' }
  }
  if (/insufficient|balance/i.test(code)) {
    return { code: 'BALANCE', message: '账户余额不足，请前往 DeepSeek 充值', retryable: false, detail: raw.message || '' }
  }
  if (/rate_limit/i.test(code)) {
    return { code: 'RATE_LIMIT', message: '请求过于频繁，请稍后重试', retryable: true, detail: raw.message || '' }
  }
  return {
    code: 'API_ERROR',
    message: '模型返回错误，请重试',
    retryable: true,
    detail: raw.message || String(code || ''),
  }
}

/** 把上游 SSE 的 data JSON 归一化为文案层事件；未知事件返回 null */
function normalizeResponseEvent(data) {
  if (!data || typeof data !== 'object') return null
  const type = typeof data.type === 'string' ? data.type : ''
  switch (type) {
    case 'response.output_text.delta':
      if (typeof data.delta !== 'string' || data.delta.length === 0) return null
      return { type: 'text_delta', delta: data.delta }
    case 'response.reasoning_text.delta':
      if (typeof data.delta !== 'string' || data.delta.length === 0) return null
      return { type: 'reasoning_delta', delta: data.delta }
    case 'response.completed':
      return { type: 'completed', usage: normalizeUsage(data.response && data.response.usage) }
    case 'response.incomplete':
      return {
        type: 'incomplete',
        usage: normalizeUsage(data.response && data.response.usage),
        reason:
          (data.response && data.response.incomplete_details && data.response.incomplete_details.reason) ||
          'max_output_tokens',
      }
    case 'response.failed':
      return { type: 'failed', error: normalizeResponseFailed(data.response) }
    default:
      return null
  }
}

/** HTTP 非 2xx 错误归一化（body 尽量解析出 detail） */
function normalizeHttpError(status, bodyText) {
  const fallback = STATUS_ERRORS[status] || {
    code: 'SERVER',
    message: '服务暂时不可用，请稍后重试',
    retryable: true,
  }
  let detail = ''
  try {
    const parsed = JSON.parse(bodyText || '{}')
    detail =
      (parsed && parsed.error && (parsed.error.message || parsed.error.code)) ||
      (typeof parsed === 'object' && parsed && parsed.message) ||
      ''
  } catch {
    detail = String(bodyText || '').slice(0, 300)
  }
  return { ...fallback, status, detail: String(detail || '') }
}

function normalizeNetworkError(err) {
  const message = String((err && err.message) || err || '')
  return { code: 'NETWORK', message: '网络连接失败，请检查网络或代理', retryable: true, detail: message }
}

async function safeReadText(response) {
  try {
    if (typeof response.text === 'function') return await response.text()
    return ''
  } catch {
    return ''
  }
}

/**
 * 执行流式 Responses 请求。
 * @param {object} options
 * @param {string} options.url
 * @param {Record<string,string>} options.headers 已包含 Authorization
 * @param {object} options.body
 * @param {Function} options.fetchImpl (url, init) => Promise<Response>
 * @param {AbortSignal} [options.signal] 调用方取消信号
 * @param {(event: {type:'text_delta'|'reasoning_delta', delta:string}) => void} options.onEvent
 * @param {number} [options.firstByteTimeoutMs]
 * @param {number} [options.idleTimeoutMs]
 * @returns {Promise<{ok:true, durationMs:number, terminal:object|null} |
 *   {ok:false, cancelled?:true, error?:object}>}
 */
async function streamResponses({
  url,
  headers,
  body,
  fetchImpl,
  signal,
  onEvent,
  firstByteTimeoutMs = FIRST_BYTE_TIMEOUT_MS,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
}) {
  const controller = new AbortController()
  let timedOut = false
  let firstByteTimer = null
  let idleTimer = null
  const startedAt = Date.now()

  const abortFromParent = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abortFromParent, { once: true })
  }

  const clearTimers = () => {
    if (firstByteTimer) clearTimeout(firstByteTimer)
    if (idleTimer) clearTimeout(idleTimer)
    firstByteTimer = null
    idleTimer = null
  }

  const armTimeout = (ms) => {
    timedOut = true
    controller.abort()
  }
  firstByteTimer = setTimeout(() => armTimeout(firstByteTimeoutMs), firstByteTimeoutMs)
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => armTimeout(idleTimeoutMs), idleTimeoutMs)
  }

  let terminal = null

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response || !response.ok) {
      const status = response ? response.status : 0
      const text = response ? await safeReadText(response) : ''
      clearTimers()
      return { ok: false, error: normalizeHttpError(status, text) }
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      clearTimers()
      return { ok: false, error: { code: 'NETWORK', message: '响应体为空，请重试', retryable: true } }
    }

    if (firstByteTimer) {
      clearTimeout(firstByteTimer)
      firstByteTimer = null
    }
    resetIdle()

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser((sseEvent) => {
      let parsed = null
      try {
        parsed = JSON.parse(sseEvent.data)
      } catch {
        return
      }
      const normalized = normalizeResponseEvent(parsed)
      if (!normalized) return
      if (normalized.type === 'text_delta' || normalized.type === 'reasoning_delta') {
        onEvent(normalized)
      } else {
        terminal = normalized
      }
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.end()
    clearTimers()
    return { ok: true, durationMs: Date.now() - startedAt, terminal }
  } catch (err) {
    clearTimers()
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      if (timedOut) {
        return { ok: false, error: { code: 'TIMEOUT', message: '请求超时，请重试', retryable: true } }
      }
      return { ok: false, cancelled: true }
    }
    return { ok: false, error: normalizeNetworkError(err) }
  } finally {
    clearTimers()
    if (signal) signal.removeEventListener('abort', abortFromParent)
  }
}

module.exports = {
  FIRST_BYTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  STATUS_ERRORS,
  normalizeUsage,
  buildResponsesRequest,
  normalizeResponseEvent,
  normalizeResponseFailed,
  normalizeHttpError,
  normalizeNetworkError,
  streamResponses,
}
