'use strict'

/** AI 主进程服务单元测试：密钥、流式事件、错误、取消、并发与会话。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createAiService } from '../src/main/ai/ai-service.js'
import { DEFAULT_SETTINGS } from '../src/main/state-store.js'

const fsp = fs.promises
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function stubSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buffer) => Buffer.from(buffer).toString('utf8').slice(4),
  }
}

async function makeService(t, fetchImpl, extra = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-ai-service-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  const settings = { ...DEFAULT_SETTINGS }
  const store = {
    getSettings: () => ({ ...settings }),
    updateSettings: (patch) => Object.assign(settings, patch),
  }
  const events = []
  const service = createAiService({
    userDataDir: dir,
    store,
    safeStorage: stubSafeStorage(),
    fetchImpl,
    baseUrlOverride: 'http://mock.local',
    sendToRenderer: (channel, payload) => events.push({ channel, payload }),
    ...extra,
  })
  return { service, events, dir }
}

function sseText(deltas, { usage = { input_tokens: 12, output_tokens: 34 }, model = 'deepseek-flash' } = {}) {
  const lines = [
    'event: response.created\ndata: {"type":"response.created"}\n\n',
    ...deltas.map(
      (delta) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`
    ),
    `event: response.completed\ndata: ${JSON.stringify({
      type: 'response.completed',
      response: { model, usage },
    })}\n\n`,
  ]
  return lines.join('')
}

function sseResponse(text) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  )
}

function waitForEvent(events, matcher, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const found = events.find(matcher)
      if (found) {
        clearInterval(timer)
        resolve(found.payload)
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer)
        resolve(null)
      }
    }, 20)
  })
}

test('ai-service：未配置 Key 时 send 返回 NO_KEY', async (t) => {
  const { service } = await makeService(t, () => Promise.reject(new Error('should not fetch')))
  const result = await service.send(null, { requestId: 'r1', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'NO_KEY')
})

test('ai-service：流式回答事件与 completed usage', async (t) => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'http://mock.local/responses')
    return sseResponse(sseText(['你好', '，MoDex']))
  }
  const { service, events } = await makeService(t, fetchImpl)
  const saved = await service.setKey(null, { key: 'sk-test-1234567890' })
  assert.equal(saved.ok, true)
  assert.equal(saved.maskedKey, '••••••••7890')

  const result = await service.send(null, {
    requestId: 'r1',
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '你好' }],
  })
  assert.equal(result.ok, true)

  const completed = await waitForEvent(events, (item) => item.payload.requestId === 'r1' && item.payload.type === 'completed')
  assert.ok(completed, '应收到 completed 事件')
  assert.deepEqual(completed.usage, { input: 12, output: 34, total: 46 })

  const deltas = events
    .filter((item) => item.payload.requestId === 'r1' && item.payload.type === 'text_delta')
    .map((item) => item.payload.delta)
  assert.deepEqual(deltas, ['你好', '，MoDex'])
  assert.ok(events.some((item) => item.payload.type === 'started'))
  assert.equal(events[0].channel, 'ai:event')
})

test('ai-service：HTTP 429 映射为 RATE_LIMIT', async (t) => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })
  const { service, events } = await makeService(t, fetchImpl)
  await service.setKey(null, { key: 'sk-test-1234567890' })
  await service.send(null, { requestId: 'r2', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  const failed = await waitForEvent(events, (item) => item.payload.requestId === 'r2' && item.payload.type === 'failed')
  assert.ok(failed)
  assert.equal(failed.error.code, 'RATE_LIMIT')
  assert.equal(failed.error.retryable, true)
})

test('ai-service：并发请求返回 BUSY，取消后恢复正常', async (t) => {
  let release
  const hanging = new Promise((resolve) => {
    release = resolve
  })
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/responses')) {
      const signal = init.signal
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          const timer = setInterval(() => {
            try {
              controller.enqueue(
                encoder.encode(
                  'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"x"}\n\n'
                )
              )
            } catch {
              clearInterval(timer)
            }
          }, 25)
          const onAbort = () => {
            clearInterval(timer)
            try {
              controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            } catch {
              /* ignore */
            }
          }
          signal.addEventListener('abort', onAbort, { once: true })
        },
      })
      release()
      return new Response(stream, { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }
  const { service, events } = await makeService(t, fetchImpl)
  await service.setKey(null, { key: 'sk-test-1234567890' })
  const first = await service.send(null, { requestId: 'slow1', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(first.ok, true)
  await hanging

  const second = await service.send(null, { requestId: 'r3', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(second.ok, false)
  assert.equal(second.error.code, 'BUSY')

  const cancelled = await service.cancel(null, { requestId: 'slow1' })
  assert.equal(cancelled.cancelled, true)
  const cancelledEvent = await waitForEvent(events, (item) => item.payload.requestId === 'slow1' && item.payload.type === 'cancelled')
  assert.ok(cancelledEvent)
})

test('ai-service：testConnection 成功与无 Key', async (t) => {
  let requests = 0
  const fetchImpl = async (url) => {
    requests += 1
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
    return sseResponse(sseText(['ok']))
  }
  const { service } = await makeService(t, fetchImpl)
  const noKey = await service.testConnection()
  assert.equal(noKey.ok, false)
  assert.equal(noKey.error.code, 'NO_KEY')
  await service.setKey(null, { key: 'sk-test-1234567890' })
  const connected = await service.testConnection()
  assert.equal(connected.ok, true)
  assert.equal(typeof connected.latencyMs, 'number')
  assert.ok(requests >= 1)
})

test('ai-service：会话保存/读取/删除', async (t) => {
  const { service } = await makeService(t, () => Promise.reject(new Error('no fetch')))
  const session = {
    id: 's_roundtrip',
    title: '会话标题',
    model: 'deepseek-flash',
    messages: [{ id: 'm_1', role: 'user', content: '你好' }],
  }
  const saved = await service.saveSession(null, { session })
  assert.equal(saved.ok, true)
  const list = await service.listSessions()
  assert.equal(list.sessions.length, 1)
  assert.equal(list.sessions[0].id, 's_roundtrip')
  const got = await service.getSession(null, { id: 's_roundtrip' })
  assert.equal(got.session.messages[0].content, '你好')
  const deleted = await service.deleteSession(null, { id: 's_roundtrip' })
  assert.equal(deleted.removed, true)
  assert.equal((await service.listSessions()).sessions.length, 0)
})

test('ai-service：首字节超时映射 TIMEOUT', async (t) => {
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      )
    })
  const { service, events } = await makeService(t, fetchImpl, { firstByteTimeoutMs: 120, idleTimeoutMs: 5000 })
  await service.setKey(null, { key: 'sk-test-1234567890' })
  await service.send(null, { requestId: 'slow-timeout', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  const failed = await waitForEvent(
    events,
    (item) => item.payload.requestId === 'slow-timeout' && item.payload.type === 'failed',
    6000
  )
  assert.ok(failed)
  assert.equal(failed.error.code, 'TIMEOUT')
  assert.equal(failed.error.retryable, true)
})
