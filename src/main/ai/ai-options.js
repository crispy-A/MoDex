'use strict'

/**
 * AI 生成参数的唯一事实来源（主进程侧）。
 *
 * 上下文窗口 / 最大输出 token / 思考等级的枚举、默认值与取值范围只在此定义；
 * state-store（设置清洗）、context-budget（预算换算）、渲染层 ai-options.js
 * 都必须与这里保持一致，由 tests/qa-ai-contract.test.mjs 做跨进程契约校验。
 */
const { MODEL_MAX_OUTPUT_TOKENS } = require('./provider-registry.js')

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
const DEFAULT_CONTEXT_WINDOW = '128k'

/** Responses API reasoning.effort：none 关闭思考，high 为 DeepSeek 官方默认 */
const REASONING_EFFORTS = Object.freeze(['none', 'low', 'high', 'max'])
const DEFAULT_REASONING_EFFORT = 'high'

const MIN_OUTPUT_TOKENS = 1024
const DEFAULT_MAX_OUTPUT_TOKENS = 8192
/** 单次输出上限=模型上限（DeepSeek 官方 384K） */
const MAX_OUTPUT_TOKENS = MODEL_MAX_OUTPUT_TOKENS
/** 设置面板提供的输出档位（全部 ≤ 官方上限） */
const OUTPUT_TOKEN_PRESETS = Object.freeze([4096, 8192, 16384, 32768, 65536, 131072, MAX_OUTPUT_TOKENS])

module.exports = {
  CONTEXT_WINDOW_PRESETS,
  CONTEXT_WINDOW_IDS,
  DEFAULT_CONTEXT_WINDOW,
  REASONING_EFFORTS,
  DEFAULT_REASONING_EFFORT,
  MIN_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  OUTPUT_TOKEN_PRESETS,
}
