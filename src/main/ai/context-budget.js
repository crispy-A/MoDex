'use strict'

/**
 * 上下文预算（纯函数）：
 * - 把「上下文窗口 / 最大输出 token / 思考等级」换算成本次请求的输入预算
 * - 用 DeepSeek 官方 token 估算口径（中文 ≈0.6 token/字、英文等 ≈0.3 token/字符）裁剪
 *   当前文档与历史消息，避免输入超出模型上下文窗口被上游 400
 * - 数值口径见 docs/AI-PANEL-SPEC.md §3.10；模型上限以 provider-registry 字段为准
 */
const { SYSTEM_INSTRUCTIONS, MODEL_CONTEXT_WINDOW_TOKENS, MODEL_MAX_OUTPUT_TOKENS } = require('./provider-registry.js')

/** 上下文窗口预设 id → token 数；auto 表示交给模型自身的上下文上限 */
const CONTEXT_WINDOW_PRESETS = Object.freeze({
  auto: null,
  '32k': 32 * 1024,
  '64k': 64 * 1024,
  '128k': 128 * 1024,
  '256k': 256 * 1024,
  '512k': 512 * 1024,
  '1m': 1024 * 1024,
})
const CONTEXT_WINDOW_IDS = Object.freeze(Object.keys(CONTEXT_WINDOW_PRESETS))
const REASONING_EFFORTS = Object.freeze(['none', 'low', 'high', 'max'])
const DEFAULT_REASONING_EFFORT = 'high'
/** 模型字段缺失时的兜底（与 DeepSeek 官方数值一致：1M 上下文 / 384K 输出） */
const DEFAULT_MODEL_CONTEXT_TOKENS = MODEL_CONTEXT_WINDOW_TOKENS
const DEFAULT_MODEL_OUTPUT_TOKENS = MODEL_MAX_OUTPUT_TOKENS
const DEFAULT_MAX_OUTPUT_TOKENS = 8192
const MIN_OUTPUT_TOKENS = 1024
const MIN_INPUT_TOKENS = 1024
/** 输入预算预留：估算误差 + 分帧/角色等请求开销 */
const SAFETY_TOKENS = 4096
/** 当前文档最多占输入预算的比例，其余留给对话历史 */
const DOC_CONTEXT_SHARE = 0.5
const CJK_CHAR_TOKENS = 0.6
const OTHER_CHAR_TOKENS = 0.3
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g
/**
 * instructions 包裹开销预留：`\n\n<当前文档 name="…">\n…\n</当前文档>` 与角色分隔。
 * 文件名最长 120 字符（全中文时约 72 token），加上包裹标签仍远小于 128，取固定值便于严格预算。
 */
const FRAMING_TOKENS = 128
/** 非法窗口设置回落值（仅「未传」按 auto 处理，避免手改配置静默放大预算） */
const DEFAULT_CONTEXT_WINDOW_SETTING = '128k'

function positiveInt(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0
}

/** 官方估算：中文 0.6 token/字、英文等 0.3 token/字符，向上取整 */
function estimateTokens(text) {
  const value = typeof text === 'string' ? text : ''
  if (!value) return 0
  const cjk = (value.match(CJK_PATTERN) || []).length
  const other = value.length - cjk
  return Math.ceil(cjk * CJK_CHAR_TOKENS + other * OTHER_CHAR_TOKENS)
}

/** 生效上下文窗口：预设 ∩ 模型上限；未传（undefined/null）按 auto=模型上限，非法值回落默认 128k */
function resolveContextWindowTokens(setting, model) {
  const modelLimit = positiveInt(model && model.contextWindowTokens) || DEFAULT_MODEL_CONTEXT_TOKENS
  let key = 'auto'
  if (setting !== undefined && setting !== null) {
    key = Object.prototype.hasOwnProperty.call(CONTEXT_WINDOW_PRESETS, String(setting)) ? String(setting) : DEFAULT_CONTEXT_WINDOW_SETTING
  }
  const preset = CONTEXT_WINDOW_PRESETS[key] === null ? modelLimit : CONTEXT_WINDOW_PRESETS[key]
  const requested = preset === null ? modelLimit : preset
  const floor = MIN_OUTPUT_TOKENS + SAFETY_TOKENS + MIN_INPUT_TOKENS
  return Math.max(floor, Math.min(requested, modelLimit))
}

/** 生效最大输出：限制在 [1K, 官方/窗口允许上限]，并为输入保留最小额度 */
function clampMaxOutputTokens(setting, model, windowTokens) {
  const modelLimit = positiveInt(model && model.maxOutputTokens) || DEFAULT_MODEL_OUTPUT_TOKENS
  const fallback = Math.min(DEFAULT_MAX_OUTPUT_TOKENS, modelLimit)
  const numeric = Number(setting)
  let value = Number.isFinite(numeric) ? Math.round(numeric) : fallback
  value = Math.min(Math.max(value, MIN_OUTPUT_TOKENS), modelLimit)
  const windowCap = windowTokens - SAFETY_TOKENS - MIN_INPUT_TOKENS
  return windowCap >= MIN_OUTPUT_TOKENS ? Math.min(value, windowCap) : MIN_OUTPUT_TOKENS
}

/** 非法/缺失的思考等级回落到官方默认 high */
function resolveReasoningEffort(setting) {
  const value = String(setting || '')
  return REASONING_EFFORTS.includes(value) ? value : DEFAULT_REASONING_EFFORT
}

/**
 * 历史消息裁剪：从最旧开始丢弃，直到符合预算且至少保留最后一条；
 * 会话被裁后若首条是 assistant 则一并丢弃（保持以 user 起始）。
 */
function trimMessages(messages, budgetTokens) {
  const list = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || typeof message.content !== 'string') continue
    list.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })
  }
  if (list.length === 0) return { messages: [], droppedMessages: 0, messageTruncated: false }

  const tokens = list.map((message) => estimateTokens(message.content) + 4)
  let total = tokens.reduce((sum, value) => sum + value, 0)
  let start = 0
  while (total > budgetTokens && list.length - start > 1) {
    total -= tokens[start]
    start += 1
  }
  while (list.length - start > 1 && list[start].role === 'assistant') {
    total -= tokens[start]
    start += 1
  }

  let trimmed = list.slice(start)
  let messageTruncated = false
  if (trimmed.length === 1 && total > budgetTokens) {
    const last = trimmed[0]
    // 逆推字符预算：按全中文口径（0.6 token/字）取上界，并预留 4 token 角色开销
    const charBudget = Math.max(1, Math.floor(Math.max(0, budgetTokens - 4) / CJK_CHAR_TOKENS))
    if (last.content.length > charBudget) {
      trimmed = [{ ...last, content: last.content.slice(0, charBudget) }]
      messageTruncated = true
    }
  }

  return { messages: trimmed, droppedMessages: list.length - trimmed.length, messageTruncated }
}

/**
 * 计算一次请求的输入计划（不做网络调用）。
 * @param {object} options
 * @param {Array<{role:string,content:string}>} options.messages 完整历史
 * @param {{fileName?:string,content:string}|null} options.context 当前文档上下文
 * @param {{aiContextWindow?:string,aiMaxOutputTokens?:number}} [options.settings]
 * @param {{contextWindowTokens?:number,maxOutputTokens?:number}|null} [options.model] 注册表模型信息
 * @returns {{windowTokens:number,maxOutputTokens:number,availableInputTokens:number,
 *   docCharLimit:number,docChars:number,context:object|null,
 *   messages:Array<{role:string,content:string}>,droppedMessages:number,messageTruncated:boolean}}
 */
function planInput({ messages, context = null, settings = {}, model = null }) {
  const windowTokens = resolveContextWindowTokens(settings.aiContextWindow, model)
  const maxOutputTokens = clampMaxOutputTokens(settings.aiMaxOutputTokens, model, windowTokens)
  const availableInputTokens = Math.max(MIN_INPUT_TOKENS, windowTokens - maxOutputTokens - SAFETY_TOKENS)
  const systemTokens = estimateTokens(SYSTEM_INSTRUCTIONS) + FRAMING_TOKENS
  const contentBudget = Math.max(0, availableInputTokens - systemTokens)
  const docBudgetTokens = Math.floor(contentBudget * DOC_CONTEXT_SHARE)
  const docCharLimit = Math.max(0, Math.floor(docBudgetTokens / CJK_CHAR_TOKENS))
  const rawContext = context && typeof context.content === 'string' && context.content.length > 0 ? context : null
  // 预算不足以为文档留出至少 1 个字符时不注入文档块，避免 buildInstructions 回落到旧 20k 默认
  const effectiveContext = rawContext && docCharLimit > 0 ? rawContext : null
  const docChars = effectiveContext ? Math.min(effectiveContext.content.length, docCharLimit) : 0
  const docTokens = Math.ceil(docChars * CJK_CHAR_TOKENS)
  const historyBudgetTokens = Math.max(0, contentBudget - docTokens)
  const trimmed = trimMessages(messages, historyBudgetTokens)

  return {
    windowTokens,
    maxOutputTokens,
    availableInputTokens,
    docCharLimit,
    docChars,
    context: effectiveContext,
    messages: trimmed.messages,
    droppedMessages: trimmed.droppedMessages,
    messageTruncated: trimmed.messageTruncated,
  }
}

module.exports = {
  CONTEXT_WINDOW_PRESETS,
  CONTEXT_WINDOW_IDS,
  REASONING_EFFORTS,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_CONTEXT_WINDOW_SETTING,
  DEFAULT_MODEL_CONTEXT_TOKENS,
  DEFAULT_MODEL_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MIN_OUTPUT_TOKENS,
  MIN_INPUT_TOKENS,
  SAFETY_TOKENS,
  DOC_CONTEXT_SHARE,
  estimateTokens,
  resolveContextWindowTokens,
  clampMaxOutputTokens,
  resolveReasoningEffort,
  trimMessages,
  planInput,
}
