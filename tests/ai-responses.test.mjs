'use strict'

/** Responses 协议层单元测试：请求构造、事件/用量/错误归一化。 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildResponsesRequest,
  normalizeUsage,
  normalizeResponseEvent,
  normalizeResponseFailed,
  normalizeHttpError,
  normalizeNetworkError,
} from '../src/main/ai/responses-client.js'
import { CONTEXT_LIMIT } from '../src/main/ai/provider-registry.js'

test('buildResponsesRequest：URL/headers/body 基本结构', () => {
  const request = buildResponsesRequest({
    baseUrl: 'http://127.0.0.1:1234/',
    model: 'deepseek-flash',
    messages: [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀' },
      { role: 'user', content: '继续' },
    ],
  })
  assert.equal(request.url, 'http://127.0.0.1:1234/responses')
  assert.equal(request.headers['content-type'], 'application/json')
  assert.equal(request.headers.authorization, undefined, 'Authorization 由调用方注入')
  assert.equal(request.body.model, 'deepseek-flash')
  assert.equal(request.body.stream, true)
  assert.equal(request.body.input.length, 3)
  assert.deepEqual(request.body.input[1], { role: 'assistant', content: '你好呀' })
  assert.ok(request.body.instructions.includes('MoDex'))
  assert.equal(request.meta.truncated, false)
})

test('buildResponsesRequest：上下文进入 instructions 且超长截断', () => {
  const context = { fileName: '示例.md', content: 'A'.repeat(CONTEXT_LIMIT + 500) }
  const request = buildResponsesRequest({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', messages: [{ role: 'user', content: '总结' }], context })
  assert.ok(request.body.instructions.includes('<当前文档 name="示例.md">'))
  assert.ok(request.body.instructions.includes('A'.repeat(CONTEXT_LIMIT)))
  assert.ok(!request.body.instructions.includes('A'.repeat(CONTEXT_LIMIT + 1)))
  assert.equal(request.meta.truncated, true)
  assert.equal(request.meta.contextChars, CONTEXT_LIMIT)
})

test('buildResponsesRequest：无 context 不注入文档块', () => {
  const request = buildResponsesRequest({ baseUrl: 'https://x', model: 'm', messages: [{ role: 'user', content: 'hi' }] })
  assert.ok(!request.body.instructions.includes('<当前文档'))
  assert.equal(request.meta.truncated, false)
})

test('normalizeUsage：缺失/部分字段兜底', () => {
  assert.deepEqual(normalizeUsage(undefined), { input: 0, output: 0, total: 0 })
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 5 }), { input: 10, output: 5, total: 15 })
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 5, total_tokens: 99 }), { input: 10, output: 5, total: 99 })
})

test('normalizeResponseEvent：文本/思考增量', () => {
  assert.deepEqual(normalizeResponseEvent({ type: 'response.output_text.delta', delta: '你好' }), {
    type: 'text_delta',
    delta: '你好',
  })
  assert.deepEqual(normalizeResponseEvent({ type: 'response.reasoning_text.delta', delta: '思考' }), {
    type: 'reasoning_delta',
    delta: '思考',
  })
  assert.equal(normalizeResponseEvent({ type: 'response.output_text.delta', delta: '' }), null)
  assert.equal(normalizeResponseEvent({ type: 'response.output_text.delta' }), null)
})

test('normalizeResponseEvent：completed / incomplete / failed', () => {
  assert.deepEqual(
    normalizeResponseEvent({ type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 4 } } }),
    { type: 'completed', usage: { input: 3, output: 4, total: 7 } }
  )
  assert.deepEqual(
    normalizeResponseEvent({
      type: 'response.incomplete',
      response: { usage: { input_tokens: 1, output_tokens: 2 }, incomplete_details: { reason: 'max_output_tokens' } },
    }),
    { type: 'incomplete', usage: { input: 1, output: 2, total: 3 }, reason: 'max_output_tokens' }
  )
  const failed = normalizeResponseEvent({
    type: 'response.failed',
    response: { error: { code: 'rate_limit_exceeded', message: 'slow down' } },
  })
  assert.equal(failed.type, 'failed')
  assert.equal(failed.error.code, 'RATE_LIMIT')
  assert.equal(failed.error.retryable, true)
})

test('normalizeResponseEvent：未知事件返回 null', () => {
  assert.equal(normalizeResponseEvent({ type: 'response.created' }), null)
  assert.equal(normalizeResponseEvent({ type: 'response.output_item.added' }), null)
  assert.equal(normalizeResponseEvent(null), null)
})

test('normalizeResponseFailed：鉴权/余额/未知映射', () => {
  assert.equal(normalizeResponseFailed({ error: { code: 'invalid_api_key' } }).code, 'AUTH')
  assert.equal(normalizeResponseFailed({ error: { code: 'insufficient_quota' } }).code, 'BALANCE')
  const generic = normalizeResponseFailed({ error: { code: 'boom', message: 'x' } })
  assert.equal(generic.code, 'API_ERROR')
  assert.equal(generic.retryable, true)
})

test('normalizeHttpError：状态码映射与 detail 提取', () => {
  const auth = normalizeHttpError(401, JSON.stringify({ error: { message: 'Invalid API key' } }))
  assert.equal(auth.code, 'AUTH')
  assert.equal(auth.retryable, false)
  assert.equal(auth.status, 401)
  assert.equal(auth.detail, 'Invalid API key')

  const rate = normalizeHttpError(429, '')
  assert.equal(rate.code, 'RATE_LIMIT')
  assert.equal(rate.retryable, true)

  const balance = normalizeHttpError(402, '')
  assert.equal(balance.code, 'BALANCE')

  const invalid = normalizeHttpError(400, 'bad body')
  assert.equal(invalid.code, 'INVALID_REQUEST')
  assert.equal(invalid.detail, 'bad body')

  const server = normalizeHttpError(503, '')
  assert.equal(server.code, 'SERVER')
  assert.equal(server.retryable, true)
})

test('normalizeNetworkError：网络错误可重试', () => {
  const error = normalizeNetworkError(new Error('ECONNRESET'))
  assert.equal(error.code, 'NETWORK')
  assert.equal(error.retryable, true)
  assert.ok(error.detail.includes('ECONNRESET'))
})
