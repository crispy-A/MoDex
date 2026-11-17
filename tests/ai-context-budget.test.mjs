'use strict'

/**
 * 上下文预算单元测试：官方 token 估算口径、窗口/输出限额换算、消息裁剪与默认预设。
 * 数值口径见 docs/AI-PANEL-SPEC.md §3.10（DeepSeek：上下文 1M / 输出 384K / effort 默认 high）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTEXT_WINDOW_IDS,
  REASONING_EFFORTS,
  SAFETY_TOKENS,
  estimateTokens,
  resolveContextWindowTokens,
  clampMaxOutputTokens,
  resolveReasoningEffort,
  trimMessages,
  planInput,
} from '../src/main/ai/context-budget.js'
import {
  MODEL_CONTEXT_WINDOW_TOKENS,
  MODEL_MAX_OUTPUT_TOKENS,
  getModel,
} from '../src/main/ai/provider-registry.js'
import { buildResponsesRequest } from '../src/main/ai/responses-client.js'
import {
  DEFAULT_SETTINGS,
  NUMERIC_LIMITS,
  AI_CONTEXT_WINDOWS,
  AI_REASONING_EFFORTS,
} from '../src/main/state-store.js'

const flash = getModel('deepseek-flash')

test('estimateTokens：DeepSeek 官方估算口径（中文 0.6 / 英文 0.3）', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(undefined), 0)
  assert.equal(estimateTokens('中文'), 2) // 2 * 0.6 = 1.2 → ceil 2
  assert.equal(estimateTokens('abcd'), 2) // 4 * 0.3 = 1.2 → ceil 2
  assert.equal(estimateTokens('中文abcd'), 3) // 1.2 + 1.2 = 2.4 → ceil 3
})

test('模型注册表：官方限制字段与 state-store 上限一致（防漂移）', () => {
  assert.equal(MODEL_CONTEXT_WINDOW_TOKENS, 1024 * 1024)
  assert.equal(MODEL_MAX_OUTPUT_TOKENS, 384 * 1024)
  assert.equal(flash.contextWindowTokens, MODEL_CONTEXT_WINDOW_TOKENS)
  assert.equal(flash.maxOutputTokens, MODEL_MAX_OUTPUT_TOKENS)
  assert.equal(NUMERIC_LIMITS.aiMaxOutputTokens.max, MODEL_MAX_OUTPUT_TOKENS)
  assert.equal(DEFAULT_SETTINGS.aiMaxOutputTokens, NUMERIC_LIMITS.aiMaxOutputTokens.fallback)
  assert.ok(CONTEXT_WINDOW_IDS.includes('auto'))
  assert.ok(CONTEXT_WINDOW_IDS.includes('128k'))
  assert.deepEqual(REASONING_EFFORTS, ['none', 'low', 'high', 'max'])
  // 防漂移：主进程预设枚举与 state-store 清洗白名单必须完全一致
  assert.deepEqual([...CONTEXT_WINDOW_IDS], [...AI_CONTEXT_WINDOWS])
  assert.deepEqual([...REASONING_EFFORTS], [...AI_REASONING_EFFORTS])
})

test('resolveContextWindowTokens：预设 ∩ 模型上限，未传用模型上限，非法回落默认 128k', () => {
  assert.equal(resolveContextWindowTokens('auto', flash), 1024 * 1024)
  assert.equal(resolveContextWindowTokens(undefined, flash), 1024 * 1024)
  assert.equal(resolveContextWindowTokens(null, flash), 1024 * 1024)
  assert.equal(resolveContextWindowTokens('hacked', flash), 128 * 1024)
  assert.equal(resolveContextWindowTokens('128K', flash), 128 * 1024)
  assert.equal(resolveContextWindowTokens('128k', flash), 128 * 1024)
  const small = { contextWindowTokens: 64 * 1024, maxOutputTokens: 8192 }
  assert.equal(resolveContextWindowTokens('1m', small), 64 * 1024)
  assert.equal(resolveContextWindowTokens(null, null), MODEL_CONTEXT_WINDOW_TOKENS)
})

test('clampMaxOutputTokens：[1K, 官方上限] 且为输入保留额度', () => {
  assert.equal(clampMaxOutputTokens(undefined, flash, 1024 * 1024), 8192)
  assert.equal(clampMaxOutputTokens('abc', flash, 1024 * 1024), 8192)
  assert.equal(clampMaxOutputTokens(999999, flash, 1024 * 1024), MODEL_MAX_OUTPUT_TOKENS)
  assert.equal(clampMaxOutputTokens(1, flash, 1024 * 1024), 1024)
  // 32K 窗口 + 超出窗口允许值的最大输出 → 压到窗口允许上限
  assert.equal(clampMaxOutputTokens(MODEL_MAX_OUTPUT_TOKENS, flash, 32 * 1024), 32 * 1024 - 4096 - 1024)
})

test('resolveReasoningEffort：非法值回落官方默认 high', () => {
  assert.equal(resolveReasoningEffort('none'), 'none')
  assert.equal(resolveReasoningEffort('low'), 'low')
  assert.equal(resolveReasoningEffort('max'), 'max')
  assert.equal(resolveReasoningEffort('ultra'), 'high')
  assert.equal(resolveReasoningEffort(undefined), 'high')
})

test('trimMessages：从最旧开始裁剪，保留最后一条且以 user 起始', () => {
  const messages = [
    { role: 'user', content: '一'.repeat(100) },
    { role: 'assistant', content: '二'.repeat(100) },
    { role: 'user', content: '三'.repeat(100) },
  ]
  const result = trimMessages(messages, 100)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].content[0], '三')
  assert.equal(result.droppedMessages, 2)
  assert.equal(result.messageTruncated, false)
})

test('trimMessages：仅剩一条仍超预算 → 截断内容并预留角色开销', () => {
  const result = trimMessages([{ role: 'user', content: '中'.repeat(1000) }], 60)
  assert.equal(result.messageTruncated, true)
  assert.equal(result.messages.length, 1)
  // charBudget = floor((60 - 4) / 0.6) = 93 字；估算 56 token + 4 角色开销 ≤ 60
  assert.equal(result.messages[0].content.length, 93)
  assert.ok(estimateTokens(result.messages[0].content) + 4 <= 60)
})

test('trimMessages：空数组/非法消息安全过滤', () => {
  assert.deepEqual(trimMessages([], 100), { messages: [], droppedMessages: 0, messageTruncated: false })
  const result = trimMessages([null, { role: 'user' }, 'x'], 100)
  assert.deepEqual(result.messages, [])
  assert.equal(result.droppedMessages, 0)
})

test('planInput：默认设置（128K 窗口 / 8K 输出）下短文档与短历史不裁剪', () => {
  const context = { fileName: '示例.md', content: '中'.repeat(20000) }
  const messages = [{ role: 'user', content: '你好' }]
  const plan = planInput({ messages, context, settings: { ...DEFAULT_SETTINGS }, model: flash })
  assert.equal(plan.windowTokens, 128 * 1024)
  assert.equal(plan.maxOutputTokens, 8192)
  assert.equal(plan.docChars, 20000)
  assert.ok(plan.docCharLimit >= 20000)
  assert.equal(plan.droppedMessages, 0)
  assert.equal(plan.messageTruncated, false)
})

test('planInput：32K 窗口 + 384K 输出时输出被压、文档与历史均裁剪', () => {
  const context = { fileName: 'a.md', content: '中'.repeat(40000) }
  const messages = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: '历'.repeat(200),
  }))
  const plan = planInput({
    messages,
    context,
    settings: { aiContextWindow: '32k', aiMaxOutputTokens: MODEL_MAX_OUTPUT_TOKENS },
    model: flash,
  })
  assert.equal(plan.windowTokens, 32 * 1024)
  assert.equal(plan.maxOutputTokens, 32 * 1024 - 4096 - 1024)
  assert.ok(plan.docChars < 40000, '文档应被预算裁剪')
  assert.ok(plan.droppedMessages > 0, '过长的历史应被裁剪')
  assert.equal(plan.messages[0].role, 'user', '裁剪后仍以 user 起始')
})

test('planInput：auto 窗口使用模型上限', () => {
  const plan = planInput({
    messages: [{ role: 'user', content: 'hi' }],
    context: null,
    settings: { aiContextWindow: 'auto', aiMaxOutputTokens: 8192 },
    model: flash,
  })
  assert.equal(plan.windowTokens, MODEL_CONTEXT_WINDOW_TOKENS)
  assert.equal(plan.docChars, 0)
})

test('预算不变量：任意窗口×输出档位组合都不超出所选窗口', () => {
  const outputs = [1024, 4096, 8192, 16384, 32768, 65536, 131072, MODEL_MAX_OUTPUT_TOKENS]
  const messages = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: '中'.repeat(2000),
  }))
  const context = { fileName: '长'.repeat(120) + '.md', content: '中'.repeat(500000) }
  for (const windowId of CONTEXT_WINDOW_IDS) {
    for (const output of outputs) {
      const request = buildResponsesRequest({
        baseUrl: 'https://x',
        model: 'deepseek-flash',
        messages,
        context,
        contextWindow: windowId,
        maxOutputTokens: output,
      })
      const total = request.meta.estimatedInputTokens + request.body.max_output_tokens
      assert.ok(
        total + SAFETY_TOKENS <= request.meta.windowTokens,
        `窗口 ${windowId} / 输出 ${output} 超窗：${total} + ${SAFETY_TOKENS} > ${request.meta.windowTokens}`
      )
    }
  }
})
