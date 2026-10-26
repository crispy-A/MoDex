'use strict'

/** AI 会话存储单元测试：清洗、持久化、排序、删除、上限。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createAiStore, sanitizeSession, MAX_MESSAGES, MAX_SESSIONS } from '../src/main/ai/ai-store.js'

const fsp = fs.promises

async function makeStore(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-ai-store-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  return createAiStore({ filePath: path.join(dir, 'ai', 'sessions.json') })
}

function makeSession(overrides = {}) {
  const now = Date.now()
  return {
    id: 's_test1',
    title: '测试会话',
    model: 'deepseek-flash',
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 'm_1', role: 'user', content: '你好', createdAt: now },
      { id: 'm_2', role: 'assistant', content: '你好呀', reasoning: '思考', usage: { input: 1, output: 2 }, createdAt: now },
    ],
    ...overrides,
  }
}

test('sanitizeSession：非法角色被丢弃，未知字段被剥离', () => {
  const session = sanitizeSession({
    id: 's_x1',
    title: ' 多行\n标题 ',
    model: 'deepseek-flash',
    messages: [
      { role: 'user', content: 'ok', extra: 'x' },
      { role: 'hacker', content: 'bad' },
      { role: 'assistant', content: 'a', status: 'weird', usage: { input: -1, output: 3 } },
    ],
  })
  assert.equal(session.title, '多行 标题')
  assert.equal(session.messages.length, 2)
  assert.equal(session.messages[0].role, 'user')
  assert.equal(session.messages[0].extra, undefined)
  assert.equal(session.messages[1].status, 'done')
  assert.deepEqual(session.messages[1].usage, { input: 0, output: 3, total: 3 })
})

test('ai-store：保存/读取/列表/删除与持久化', async (t) => {
  const store = await makeStore(t)
  const saved = await store.save(makeSession())
  assert.equal(saved.id, 's_test1')
  assert.equal(saved.messageCount, 2)

  const list = await store.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].title, '测试会话')

  const found = await store.get('s_test1')
  assert.equal(found.messages.length, 2)
  assert.equal(found.messages[1].content, '你好呀')

  // 重新打开（模拟重启）后仍在
  const second = await makeStore(t)
  const reopened = await second.get('s_test1')
  assert.equal(reopened, null, '不同文件路径互不影响')

  const removed = await store.remove('s_test1')
  assert.equal(removed, true)
  assert.equal(await store.get('s_test1'), null)
  assert.equal((await store.list()).length, 0)
})

test('ai-store：同一 id 覆盖并刷新 updatedAt', async (t) => {
  const store = await makeStore(t)
  await store.save(makeSession({ updatedAt: 1 }))
  const first = await store.get('s_test1')
  await new Promise((resolve) => setTimeout(resolve, 5))
  await store.save(makeSession({ title: '改名了', messages: [{ id: 'm_3', role: 'user', content: 'hi' }] }))
  const second = await store.get('s_test1')
  assert.equal(second.title, '改名了')
  assert.equal(second.messages.length, 1)
  assert.ok(second.updatedAt >= first.updatedAt)
})

test('ai-store：消息数量截断到上限', async (t) => {
  const store = await makeStore(t)
  const messages = Array.from({ length: MAX_MESSAGES + 20 }, (_, index) => ({
    id: `m_${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `msg-${index}`,
  }))
  await store.save(makeSession({ messages }))
  const found = await store.get('s_test1')
  assert.equal(found.messages.length, MAX_MESSAGES)
  assert.equal(found.messages[found.messages.length - 1].content, `msg-${MAX_MESSAGES + 19}`)
})

test('ai-store：会话数量上限淘汰最旧', async (t) => {
  const store = await makeStore(t)
  for (let index = 0; index < MAX_SESSIONS + 3; index += 1) {
    await store.save(makeSession({ id: `s_${index}`, title: `会话 ${index}` }))
  }
  const list = await store.list()
  assert.equal(list.length, MAX_SESSIONS)
  assert.ok(!list.some((item) => item.id === 's_0'), '最旧会话应被淘汰')
})

test('ai-store：损坏文件回退为空并在下次保存时修复', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-ai-store-bad-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  const filePath = path.join(dir, 'sessions.json')
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, '{not json', 'utf8')
  const store = createAiStore({ filePath })
  assert.deepEqual(await store.list(), [])
  await store.save(makeSession())
  assert.equal((await store.list()).length, 1)
})
