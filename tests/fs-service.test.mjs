'use strict'

/**
 * fs-service 单元测试：名称校验、路径安全、读写、创建、重命名、删除、错误码。
 * 运行：node --test tests/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import svc from '../src/main/fs-service.js'

const fsp = fs.promises

/** 每个测试独立临时目录 */
async function makeTempDir(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-fs-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  return dir
}

test('validateName：合法名称', () => {
  for (const name of ['笔记.md', 'a.markdown', '2024-01-01 日记.md', 'Hello World.md', 'a_b-c.md']) {
    const result = svc.validateName(name)
    assert.equal(result.ok, true, name)
    assert.equal(result.name, name)
  }
})

test('validateName：裁剪首尾空格', () => {
  const result = svc.validateName('  笔记.md  ')
  assert.equal(result.ok, true)
  assert.equal(result.name, '笔记.md')
})

test('validateName：非法名称被拒绝', () => {
  const cases = [
    ['', 'EINVAL'],
    ['   ', 'EINVAL'],
    ['.', 'EINVAL'],
    ['..', 'EINVAL'],
    ['a/b.md', 'EINVAL'],
    ['a\\b.md', 'EINVAL'],
    ['a:b.md', 'EINVAL'],
    ['a*b.md', 'EINVAL'],
    ['a?b.md', 'EINVAL'],
    ['a"b.md', 'EINVAL'],
    ['a<b.md', 'EINVAL'],
    ['a|b.md', 'EINVAL'],
    ['结尾点.md.', 'EINVAL'],
    ['CON', 'EINVAL'],
    ['con.md', 'EINVAL'],
    ['NUL.txt', 'EINVAL'],
    ['LPT9', 'EINVAL'],
    ['x'.repeat(201), 'EINVAL'],
  ]
  for (const [name, code] of cases) {
    const result = svc.validateName(name)
    assert.equal(result.ok, false, `应拒绝：${JSON.stringify(name)}`)
    assert.equal(result.code, code, `错误码：${JSON.stringify(name)}`)
  }
})

test('validateName：新建文件强制 Markdown 扩展名', () => {
  assert.equal(svc.validateName('笔记.md', { requireMarkdown: true }).ok, true)
  assert.equal(svc.validateName('笔记.MARKDOWN', { requireMarkdown: true }).ok, true)
  const rejected = svc.validateName('笔记.txt', { requireMarkdown: true })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'NOT_MARKDOWN')
  assert.equal(svc.validateName('无扩展名', { requireMarkdown: true }).code, 'NOT_MARKDOWN')
})

test('isMarkdownPath 大小写不敏感', () => {
  assert.equal(svc.isMarkdownPath('D:\\a\\b.md'), true)
  assert.equal(svc.isMarkdownPath('D:\\a\\b.MD'), true)
  assert.equal(svc.isMarkdownPath('D:\\a\\b.markdown'), true)
  assert.equal(svc.isMarkdownPath('D:\\a\\b.txt'), false)
  assert.equal(svc.isMarkdownPath('D:\\a\\b.md.txt'), false)
})

test('listDir：目录在前、文件在后并按名称自然排序', async (t) => {
  const dir = await makeTempDir(t)
  await fsp.mkdir(path.join(dir, 'z-folder'))
  await fsp.mkdir(path.join(dir, 'a-folder'))
  await fsp.writeFile(path.join(dir, 'b.md'), '# b')
  await fsp.writeFile(path.join(dir, 'a10.md'), '# a10')
  await fsp.writeFile(path.join(dir, 'a2.md'), '# a2')
  await fsp.writeFile(path.join(dir, '.hidden.md'), 'x')

  const result = await svc.listDir(dir)
  assert.equal(result.ok, true)
  const names = result.entries.map((entry) => entry.name)
  assert.deepEqual(names, ['a-folder', 'z-folder', '.hidden.md', 'a2.md', 'a10.md', 'b.md'])

  const flat = result.entries.find((entry) => entry.name === 'b.md')
  assert.equal(flat.isDirectory, false)
  assert.equal(flat.isMarkdown, true)
  assert.equal(flat.path, path.join(dir, 'b.md'))
  assert.equal(flat.size, 3)
  assert.ok(flat.mtimeMs > 0)
  assert.equal(result.entries.find((entry) => entry.name === 'a-folder').isDirectory, true)
  assert.equal(result.entries.find((entry) => entry.name === '.hidden.md').hidden, true)
})

test('listDir：目标不存在 / 不是目录', async (t) => {
  const dir = await makeTempDir(t)
  const missing = await svc.listDir(path.join(dir, 'nope'))
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'ENOENT')

  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'x')
  const notDir = await svc.listDir(file)
  assert.equal(notDir.ok, false)
  assert.equal(notDir.code, 'ENOTDIR')
})

test('readFile / writeFile：中文内容与换行符原样往返', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, '笔记.md')
  const content = '# 标题\r\n\r\n中文段落，包含 **加粗** 与 emoji 🎉\n'
  const created = await svc.createFile(dir, '笔记.md', content)
  assert.equal(created.ok, true)

  const read = await svc.readFile(file)
  assert.equal(read.ok, true)
  assert.equal(read.content, content)
  assert.equal(read.size, Buffer.byteLength(content, 'utf8'))

  const next = '改过的内容\n第二行\n'
  const written = await svc.writeFile(file, next)
  assert.equal(written.ok, true)
  assert.equal(written.size, Buffer.byteLength(next, 'utf8'))
  assert.equal((await svc.readFile(file)).content, next)

  // 原子写入不应残留临时文件
  const leftovers = (await fsp.readdir(dir)).filter((name) => name.includes('.qm-'))
  assert.deepEqual(leftovers, [])
})

test('readFile：BOM 被去除', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, 'bom.md')
  await fsp.writeFile(file, Buffer.from('\uFEFF# 标题\n', 'utf8'))
  const result = await svc.readFile(file)
  assert.equal(result.ok, true)
  assert.equal(result.content, '# 标题\n')
})

test('readFile：非 UTF-8 与二进制文件被拒绝', async (t) => {
  const dir = await makeTempDir(t)
  const badUtf8 = path.join(dir, 'bad.md')
  await fsp.writeFile(badUtf8, Buffer.from([0xff, 0xfe, 0x41, 0x42]))
  const bad = await svc.readFile(badUtf8)
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'BAD_ENCODING')

  const binary = path.join(dir, 'binary.md')
  await fsp.writeFile(binary, Buffer.from([0x41, 0x00, 0x42]))
  const bin = await svc.readFile(binary)
  assert.equal(bin.ok, false)
  assert.equal(bin.code, 'BAD_ENCODING')
})

test('readFile：超过 5 MB 被拒绝', async (t) => {
  const dir = await makeTempDir(t)
  const big = path.join(dir, 'big.md')
  await fsp.writeFile(big, 'a'.repeat(svc.MAX_TEXT_BYTES + 1))
  const result = await svc.readFile(big)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'TOO_LARGE')
})

test('readFile / writeFile：参数校验', async (t) => {
  const dir = await makeTempDir(t)
  assert.equal((await svc.readFile('relative.md')).code, 'EINVAL')
  assert.equal((await svc.readFile('')).code, 'EINVAL')
  assert.equal((await svc.readFile(path.join(dir, 'missing.md'))).code, 'ENOENT')
  assert.equal((await svc.writeFile('relative.md', 'x')).code, 'EINVAL')
  assert.equal((await svc.writeFile(path.join(dir, 'missing', 'a.md'), 'x')).code, 'ENOENT')
  assert.equal((await svc.writeFile(path.join(dir, 'a.md'), 42)).code, 'EINVAL')
  const tooBig = await svc.writeFile(path.join(dir, 'a.md'), 'a'.repeat(svc.MAX_TEXT_BYTES + 1))
  assert.equal(tooBig.code, 'TOO_LARGE')
  const asDir = await svc.writeFile(dir, 'x')
  assert.equal(asDir.code, 'EISDIR')
})

test('createFile / createFolder：成功与重复', async (t) => {
  const dir = await makeTempDir(t)
  const fileResult = await svc.createFile(dir, '新文件.md', '# hi')
  assert.equal(fileResult.ok, true)
  assert.equal(fileResult.name, '新文件.md')
  assert.ok(fs.existsSync(fileResult.path))

  const duplicate = await svc.createFile(dir, '新文件.md')
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'EEXIST')

  const folderResult = await svc.createFolder(dir, '资料')
  assert.equal(folderResult.ok, true)
  assert.equal((await fsp.stat(folderResult.path)).isDirectory(), true)

  const folderDuplicate = await svc.createFolder(dir, '资料')
  assert.equal(folderDuplicate.ok, false)
  assert.equal(folderDuplicate.code, 'EEXIST')

  assert.equal((await svc.createFile(dir, '无扩展名')).code, 'NOT_MARKDOWN')
  assert.equal((await svc.createFile(dir, 'a/b.md')).code, 'EINVAL')
  assert.equal((await svc.createFolder(dir, '..')).code, 'EINVAL')
  assert.equal((await svc.createFile(path.join(dir, '不存在'), 'a.md')).code, 'ENOENT')
})

test('rename：重命名文件、目录、大小写与冲突', async (t) => {
  const dir = await makeTempDir(t)
  await fsp.writeFile(path.join(dir, 'old.md'), '内容')
  await fsp.mkdir(path.join(dir, 'folder'))
  await fsp.writeFile(path.join(dir, 'taken.md'), 'x')

  const fileRename = await svc.rename(path.join(dir, 'old.md'), 'new.md')
  assert.equal(fileRename.ok, true)
  assert.equal(fileRename.path, path.join(dir, 'new.md'))
  assert.equal(fs.existsSync(path.join(dir, 'new.md')), true)
  assert.equal(fs.existsSync(path.join(dir, 'old.md')), false)

  const folderRename = await svc.rename(path.join(dir, 'folder'), '文档')
  assert.equal(folderRename.ok, true)
  assert.equal(fs.existsSync(path.join(dir, '文档')), true)

  const conflict = await svc.rename(path.join(dir, 'new.md'), 'taken.md')
  assert.equal(conflict.ok, false)
  assert.equal(conflict.code, 'EEXIST')

  const caseOnly = await svc.rename(path.join(dir, 'taken.md'), 'TAKEN.md')
  assert.equal(caseOnly.ok, true, JSON.stringify(caseOnly))
  const names = await fsp.readdir(dir)
  assert.ok(names.includes('TAKEN.md'), names.join(','))

  assert.equal((await svc.rename(path.join(dir, 'missing.md'), 'a.md')).code, 'ENOENT')
  assert.equal((await svc.rename(path.join(dir, 'TAKEN.md'), 'a/b.md')).code, 'EINVAL')
  assert.equal((await svc.rename('relative.md', 'a.md')).code, 'EINVAL')
})

test('remove：注入回收站时走回收站，失败时回退永久删除', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, 'a.md')
  await fsp.writeFile(file, 'x')

  const trashed = []
  const result = await svc.remove(file, {
    // 模拟回收站：把文件移动到同目录的 .trash 子目录
    trash: async (p) => {
      trashed.push(p)
      await fsp.mkdir(path.join(dir, '.trash'), { recursive: true })
      await fsp.rename(p, path.join(dir, '.trash', path.basename(p)))
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.trashed, true)
  assert.deepEqual(trashed, [file])
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.existsSync(path.join(dir, '.trash', 'a.md')), true)

  const file2 = path.join(dir, 'b.md')
  await fsp.writeFile(file2, 'x')
  const fallback = await svc.remove(file2, { trash: async () => { throw new Error('no bin') } })
  assert.equal(fallback.ok, true)
  assert.equal(fallback.trashed, false)
  assert.equal(fs.existsSync(file2), false)
})

test('remove：空目录可删除，非空目录拒绝，不存在报 ENOENT', async (t) => {
  const dir = await makeTempDir(t)
  await fsp.mkdir(path.join(dir, '空的'))
  const empty = await svc.remove(path.join(dir, '空的'), { trash: async () => {} })
  assert.equal(empty.ok, true)

  await fsp.mkdir(path.join(dir, '非空'))
  await fsp.writeFile(path.join(dir, '非空', 'a.md'), 'x')
  const notEmpty = await svc.remove(path.join(dir, '非空'), { trash: async () => {} })
  assert.equal(notEmpty.ok, false)
  assert.equal(notEmpty.code, 'ENOTEMPTY')
  assert.equal(fs.existsSync(path.join(dir, '非空')), true)

  assert.equal((await svc.remove(path.join(dir, 'missing'))).code, 'ENOENT')
  assert.equal((await svc.remove('relative')).code, 'EINVAL')
})

test('pathInfo：存在与不存在', async (t) => {
  const dir = await makeTempDir(t)
  const file = path.join(dir, '笔记.md')
  await fsp.writeFile(file, 'abc')

  const info = await svc.pathInfo(file)
  assert.equal(info.ok, true)
  assert.equal(info.exists, true)
  assert.equal(info.name, '笔记.md')
  assert.equal(info.dir, dir)
  assert.equal(info.ext, '.md')
  assert.equal(info.isMarkdown, true)
  assert.equal(info.isDirectory, false)
  assert.equal(info.size, 3)

  const missing = await svc.pathInfo(path.join(dir, 'nope.md'))
  assert.equal(missing.ok, true)
  assert.equal(missing.exists, false)
  assert.equal(missing.isMarkdown, true)
  assert.equal((await svc.pathInfo('relative.md')).code, 'EINVAL')
})

test('mapError：已知与未知错误码都返回中文说明', () => {
  assert.equal(svc.mapError({ code: 'ENOENT' }, 'D:\\a').code, 'ENOENT')
  assert.match(svc.mapError({ code: 'ENOENT' }, 'D:\\a').error, /不存在/)
  assert.equal(svc.mapError({ code: 'EWEIRD' }, 'D:\\a').code, 'UNKNOWN')
  assert.equal(svc.mapError(null, 'D:\\a').code, 'UNKNOWN')
})
