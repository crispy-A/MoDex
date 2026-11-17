import test from 'node:test'
import assert from 'node:assert/strict'

import { createLoadGuard } from '../src/renderer/js/load-guard.js'

test('load-guard：只有最后一次 begin 的令牌有效（先发起、后返回的旧请求被丢弃）', () => {
  const guard = createLoadGuard()
  const first = guard.begin()
  const second = guard.begin()

  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
})

test('load-guard：invalidate 让在途请求全部失效（新建/关闭文档）', () => {
  const guard = createLoadGuard()
  const token = guard.begin()

  guard.invalidate()

  assert.equal(guard.isCurrent(token), false)
  const next = guard.begin()
  assert.equal(guard.isCurrent(next), true)
})

test('load-guard：令牌单调递增且不重复', () => {
  const guard = createLoadGuard()
  const tokens = Array.from({ length: 5 }, () => guard.begin())

  assert.equal(new Set(tokens).size, tokens.length)
  for (let index = 1; index < tokens.length; index += 1) {
    assert.ok(tokens[index] > tokens[index - 1])
  }
})
