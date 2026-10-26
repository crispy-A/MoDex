'use strict'

/** API Key 加密存储单元测试（注入 stub crypto，不依赖 Electron）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createCredentialsStore, maskKey } from '../src/main/ai/credentials.js'

const fsp = fs.promises

function stubSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf8'),
    decryptString: (buffer) => {
      const text = Buffer.from(buffer).toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return text.slice(4)
    },
  }
}

async function makeStore(t, options = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-ai-cred-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  return createCredentialsStore({
    filePath: path.join(dir, 'ai', 'api-key.bin'),
    safeStorage: stubSafeStorage(options),
  })
}

test('maskKey：只保留后 4 位', () => {
  assert.equal(maskKey('sk-1234567890abcd'), '••••••••abcd')
  assert.equal(maskKey(''), '')
})

test('credentials：set/get/status/clear 全流程', async (t) => {
  const store = await makeStore(t)
  assert.deepEqual(await store.status(), { hasKey: false, maskedKey: '' })

  const result = await store.setKey('  sk-test-1234567890  ')
  assert.equal(result.hasKey, true)
  assert.equal(result.maskedKey, '••••••••7890')

  assert.equal(await store.getKey(), 'sk-test-1234567890')
  const status = await store.status()
  assert.equal(status.hasKey, true)
  assert.equal(status.maskedKey, '••••••••7890')

  await store.clear()
  assert.equal(await store.getKey(), null)
  assert.equal((await store.status()).hasKey, false)
})

test('credentials：Key 长度校验', async (t) => {
  const store = await makeStore(t)
  await assert.rejects(() => store.setKey('short'), (err) => err.code === 'INVALID_KEY')
  await assert.rejects(() => store.setKey('x'.repeat(600)), (err) => err.code === 'INVALID_KEY')
})

test('credentials：系统密钥环不可用时拒绝保存', async (t) => {
  const store = await makeStore(t, { available: false })
  await assert.rejects(() => store.setKey('sk-test-1234567890'), (err) => err.code === 'KEYSTORE_UNAVAILABLE')
  assert.equal(await store.getKey(), null)
})

test('credentials：损坏文件按未配置处理，且不抛异常', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-ai-cred-bad-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  const filePath = path.join(dir, 'api-key.bin')
  await fsp.writeFile(filePath, 'not-json', 'utf8')
  const store = createCredentialsStore({ filePath, safeStorage: stubSafeStorage() })
  assert.equal(await store.getKey(), null)
  assert.equal((await store.status()).hasKey, false)
})
