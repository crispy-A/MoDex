'use strict'

/**
 * AI 供应商 / 模型注册表。
 * v1 只有 DeepSeek（Responses API）；后续新增供应商只改这里 + protocol 适配器，UI 不用动。
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const CONTEXT_LIMIT = 20000
const SYSTEM_INSTRUCTIONS =
  '你是 MoDex 的写作助手，帮助用户撰写、润色、总结与结构化 Markdown 文档；回答简洁、直接、可操作；输出 Markdown。'

const PROVIDER = Object.freeze({
  id: 'deepseek',
  name: 'DeepSeek',
  protocol: 'responses',
  baseUrl: DEFAULT_BASE_URL,
  auth: 'bearer',
})

const MODELS = Object.freeze([
  Object.freeze({
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    description: '快速、通用',
    capabilities: Object.freeze(['reasoning', 'vision']),
  }),
  Object.freeze({
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: '更强推理，支持工具/联网（后续开放）',
    capabilities: Object.freeze(['reasoning', 'tools', 'web_search']),
  }),
])

const MODEL_IDS = Object.freeze(MODELS.map((model) => model.id))
const DEFAULT_MODEL = 'deepseek-flash'

/** 解析生效的 baseUrl：CLI 覆盖 > 环境变量（测试/开发） > 官方地址 */
function resolveBaseUrl(baseUrlOverride) {
  const cliValue = typeof baseUrlOverride === 'string' ? baseUrlOverride.trim() : ''
  if (cliValue) return cliValue.replace(/\/+$/, '')
  const envValue = typeof process.env.MODEX_AI_BASE_URL === 'string' ? process.env.MODEX_AI_BASE_URL.trim() : ''
  if (envValue) return envValue.replace(/\/+$/, '')
  return DEFAULT_BASE_URL
}

function isKnownModel(modelId) {
  return MODEL_IDS.includes(modelId)
}

function getModel(modelId) {
  return MODELS.find((model) => model.id === modelId) || null
}

function listModels() {
  return MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
    capabilities: [...model.capabilities],
  }))
}

/** 防注入：当前文档名去掉引号/尖括号/换行 */
function sanitizeContextName(name) {
  return String(name || '未命名文档')
    .replace(/[<>"\r\n]/g, ' ')
    .slice(0, 120)
}

/**
 * 构造 instructions：基础系统提示 + 可选当前文档上下文（超过 20k 字符截断）。
 * @param {{fileName?: string, content?: string}|null} context
 * @returns {{instructions: string, truncated: boolean, contextChars: number}}
 */
function buildInstructions(context) {
  if (!context || typeof context.content !== 'string' || context.content.length === 0) {
    return { instructions: SYSTEM_INSTRUCTIONS, truncated: false, contextChars: 0 }
  }
  const raw = context.content
  const truncated = raw.length > CONTEXT_LIMIT
  const clipped = truncated ? raw.slice(0, CONTEXT_LIMIT) : raw
  const instructions =
    `${SYSTEM_INSTRUCTIONS}\n\n<当前文档 name="${sanitizeContextName(context.fileName)}">\n` +
    `${clipped}\n</当前文档>`
  return { instructions, truncated, contextChars: clipped.length }
}

module.exports = {
  DEFAULT_BASE_URL,
  CONTEXT_LIMIT,
  SYSTEM_INSTRUCTIONS,
  PROVIDER,
  MODELS,
  MODEL_IDS,
  DEFAULT_MODEL,
  resolveBaseUrl,
  isKnownModel,
  getModel,
  listModels,
  buildInstructions,
}
