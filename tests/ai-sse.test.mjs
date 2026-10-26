'use strict'

/** SSE 解析器单元测试：分片、多行 data、注释、CRLF、EOF flush。 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createSseParser } from '../src/main/ai/sse.js'

function collect() {
  const events = []
  const parser = createSseParser((event) => events.push(event))
  return { events, parser }
}

test('SSE：基本 event/data 与空行派发', () => {
  const { events, parser } = collect()
  parser.push('event: response.output_text.delta\ndata: {"delta":"你好"}\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'response.output_text.delta')
  assert.equal(events[0].data, '{"delta":"你好"}')
})

test('SSE：data 多行用换行拼接', () => {
  const { events, parser } = collect()
  parser.push('event: x\ndata: line1\ndata: line2\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].data, 'line1\nline2')
})

test('SSE：注释与未知字段被忽略', () => {
  const { events, parser } = collect()
  parser.push(': heartbeat\nretry: 1000\nfoo: bar\nevent: done\ndata: ok\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'done')
  assert.equal(events[0].data, 'ok')
})

test('SSE：跨 chunk 分片（行被切断）', () => {
  const { events, parser } = collect()
  parser.push('event: a\nda')
  parser.push('ta: hel')
  parser.push('lo\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'a')
  assert.equal(events[0].data, 'hello')
})

test('SSE：CRLF 行尾', () => {
  const { events, parser } = collect()
  parser.push('event: crlf\r\ndata: {"a":1}\r\n\r\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'crlf')
  assert.equal(events[0].data, '{"a":1}')
})

test('SSE：流结束时 flush 未以空行结束的事件', () => {
  const { events, parser } = collect()
  parser.push('event: tail\ndata: {"x":1}')
  assert.equal(events.length, 0)
  parser.end()
  assert.equal(events.length, 1)
  assert.equal(events[0].event, 'tail')
})

test('SSE：空 data 不派发', () => {
  const { events, parser } = collect()
  parser.push('event: empty\n\n')
  assert.equal(events.length, 0)
})

test('SSE：id 字段透传', () => {
  const { events, parser } = collect()
  parser.push('id: 42\nevent: e\ndata: d\n\n')
  assert.equal(events.length, 1)
  assert.equal(events[0].id, '42')
})
