/**
 * 文件保存服务单元测试：版本校验、冲突、并发串行、原子发布重试、BOM 与清理。
 * 对应设计 docs/SAVE-SPEC.md §5.2。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import saveServiceModule from '../src/main/save-service.js'

const { createSaveService } = saveServiceModule
const fsp = fs.promises
const sha = (value) => createHash('sha256').update(value).digest('hex')

async function makeDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-save-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  return dir
}

function tmpFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.startsWith('.modex-save-'))
}

test('save update：写入成功并返回内容哈希版本', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old', 'utf8')
  const service = createSaveService()

  const before = await service.inspect(file)
  assert.equal(before.ok, true)
  assert.equal(before.exists, true)
  assert.equal(before.version.hash, sha(Buffer.from('old')))

  const result = await service.save({
    filePath: file,
    content: 'new content',
    baseVersion: before.version,
  })

  assert.equal(result.ok, true)
  assert.equal(await fsp.readFile(file, 'utf8'), 'new content')
  assert.equal(result.version.hash, sha(Buffer.from('new content')))
  assert.equal(result.version.size, Buffer.byteLength('new content'))
  assert.deepEqual(tmpFiles(dir), [])
})

test('save update：磁盘已被外部修改 → CONFLICT/changed，原文件不动', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old')
  const service = createSaveService()
  const before = await service.inspect(file)

  await fsp.writeFile(file, 'external')
  const result = await service.save({
    filePath: file,
    content: 'mine',
    baseVersion: before.version,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'CONFLICT')
  assert.equal(result.reason, 'changed')
  assert.equal(result.current.hash, sha(Buffer.from('external')))
  assert.equal(await fsp.readFile(file, 'utf8'), 'external')
  assert.deepEqual(tmpFiles(dir), [])
})

test('save update：文件被外部删除 → CONFLICT/deleted', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old')
  const service = createSaveService()
  const before = await service.inspect(file)

  await fsp.rm(file)
  const result = await service.save({
    filePath: file,
    content: 'mine',
    baseVersion: before.version,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'CONFLICT')
  assert.equal(result.reason, 'deleted')
  assert.equal(result.current, null)
  assert.equal(fs.existsSync(file), false)
})

test('save update：只有 mtime 变化（内容相同）不算冲突', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'same')
  const service = createSaveService()
  const before = await service.inspect(file)

  await fsp.utimes(file, new Date(), new Date(Date.now() + 5000))
  const result = await service.save({
    filePath: file,
    content: 'same but resaved',
    baseVersion: before.version,
  })

  assert.equal(result.ok, true)
  assert.equal(await fsp.readFile(file, 'utf8'), 'same but resaved')
})

test('save update：临时文件写完后外部抢先改写 → 迟到校验仍能发现', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old')
  const service = createSaveService({
    hooks: {
      afterTempWrite: async () => {
        await fsp.writeFile(file, 'raced')
      },
    },
  })
  const before = await service.inspect(file)

  const result = await service.save({
    filePath: file,
    content: 'mine',
    baseVersion: before.version,
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'CONFLICT')
  assert.equal(result.reason, 'changed')
  assert.equal(await fsp.readFile(file, 'utf8'), 'raced')
  assert.deepEqual(tmpFiles(dir), [])
})

test('save create：新文件成功，已存在返回 EEXIST', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'new.md')
  const service = createSaveService()

  const created = await service.save({ filePath: file, content: '# new', mode: 'create' })
  assert.equal(created.ok, true)
  assert.equal(await fsp.readFile(file, 'utf8'), '# new')

  const again = await service.save({ filePath: file, content: 'x', mode: 'create' })
  assert.equal(again.ok, false)
  assert.equal(again.code, 'EEXIST')
  assert.equal(await fsp.readFile(file, 'utf8'), '# new')
})

test('save overwrite：跳过版本校验并覆盖', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old')
  const service = createSaveService()

  const result = await service.save({ filePath: file, content: 'forced', mode: 'overwrite' })
  assert.equal(result.ok, true)
  assert.equal(await fsp.readFile(file, 'utf8'), 'forced')
})

test('save：同一路径并发调用串行执行，最终为最后一次内容', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'initial')
  const service = createSaveService()
  const contents = Array.from({ length: 8 }, (_, index) => `v${index}`)

  const results = await Promise.all(
    contents.map((content) => service.save({ filePath: file, content, mode: 'overwrite' }))
  )

  assert.ok(results.every((item) => item.ok))
  assert.equal(await fsp.readFile(file, 'utf8'), contents[contents.length - 1])
  assert.deepEqual(tmpFiles(dir), [])
})

test('save：rename 遇 EPERM 会退避重试', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old')
  let attempts = 0
  const io = {
    rename: async (from, to) => {
      attempts += 1
      if (attempts < 3) {
        const error = new Error('busy')
        error.code = 'EPERM'
        throw error
      }
      return fsp.rename(from, to)
    },
  }
  const service = createSaveService({ io })
  const before = await service.inspect(file)

  const result = await service.save({
    filePath: file,
    content: 'after retry',
    baseVersion: before.version,
  })

  assert.equal(result.ok, true)
  assert.equal(attempts, 3)
  assert.equal(await fsp.readFile(file, 'utf8'), 'after retry')
  assert.deepEqual(tmpFiles(dir), [])
})

test('save：rename 一直失败 → 保留原文件并清理临时文件', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'old')
  const io = {
    rename: async () => {
      const error = new Error('always busy')
      error.code = 'EPERM'
      throw error
    },
  }
  const service = createSaveService({ io })
  const before = await service.inspect(file)

  const result = await service.save({
    filePath: file,
    content: 'never lands',
    baseVersion: before.version,
  })

  assert.equal(result.ok, false)
  assert.equal(await fsp.readFile(file, 'utf8'), 'old')
  assert.deepEqual(tmpFiles(dir), [])
})

test('save encoding：utf8-bom 写入 BOM，utf8 不写', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'bom.md')
  const service = createSaveService()

  const withBom = await service.save({
    filePath: file,
    content: '你好',
    mode: 'overwrite',
    encoding: 'utf8-bom',
  })
  assert.equal(withBom.ok, true)
  const buffer = await fsp.readFile(file)
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(buffer.subarray(3).toString('utf8'), '你好')
  assert.equal(withBom.version.size, buffer.length)

  const noBom = await service.save({
    filePath: file,
    content: '你好',
    mode: 'overwrite',
  })
  assert.equal(noBom.ok, true)
  assert.notDeepEqual([...(await fsp.readFile(file)).subarray(0, 3)], [0xef, 0xbb, 0xbf])
})

test('save：参数校验（相对路径/模式/编码/超限/baseVersion）', async (t) => {
  const dir = await makeDir(t)
  const file = path.join(dir, 'a.md')
  const service = createSaveService()

  assert.equal((await service.save({ filePath: 'relative.md', content: 'x' })).code, 'EINVAL')
  assert.equal(
    (await service.save({ filePath: file, content: 'x', mode: 'bogus' })).code,
    'EINVAL'
  )
  assert.equal(
    (await service.save({ filePath: file, content: 'x', mode: 'overwrite', encoding: 'gbk' })).code,
    'EINVAL'
  )
  await fsp.writeFile(file, 'old')
  assert.equal(
    (await service.save({ filePath: file, content: 'x', mode: 'update' })).code,
    'EINVAL'
  )

  const huge = 'a'.repeat(5 * 1024 * 1024 + 1)
  assert.equal(
    (await service.save({ filePath: file, content: huge, mode: 'overwrite' })).code,
    'TOO_LARGE'
  )
})

test('inspect：不存在返回 exists:false，目录返回 EISDIR', async (t) => {
  const dir = await makeDir(t)
  const service = createSaveService()

  const missing = await service.inspect(path.join(dir, 'missing.md'))
  assert.equal(missing.ok, true)
  assert.equal(missing.exists, false)
  assert.equal(missing.version, null)

  const isDir = await service.inspect(dir)
  assert.equal(isDir.ok, false)
  assert.equal(isDir.code, 'EISDIR')
})
