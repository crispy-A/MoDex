/**
 * AI 生成参数（渲染层侧）：主进程 src/main/ai/ai-options.js 的镜像。
 *
 * 渲染层不能 require 主进程模块，因此这里保持同名同值的常量；
 * tests/qa-ai-contract.test.mjs 会同时加载两侧并逐一比对，防止漂移。
 */

export const CONTEXT_WINDOW_IDS = Object.freeze(['auto', '32k', '64k', '128k', '256k', '512k', '1m'])
export const DEFAULT_CONTEXT_WINDOW = '128k'

export const REASONING_EFFORTS = Object.freeze(['none', 'low', 'high', 'max'])
export const DEFAULT_REASONING_EFFORT = 'high'

export const MIN_OUTPUT_TOKENS = 1024
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192
export const MAX_OUTPUT_TOKENS = 393216
export const OUTPUT_TOKEN_PRESETS = Object.freeze([4096, 8192, 16384, 32768, 65536, 131072, MAX_OUTPUT_TOKENS])
