/**
 * QA 回归用例：文件系统安全与边界（新增文件，不改动既有测试）。
 * 直接调用 src/main/fs-service.js（CommonJS，纯 Node），覆盖：
 * - 相对路径 / 路径穿越 / 非法参数拒绝
 * - 文件名校验矩阵（保留名、非法字符、超长、尾点、Markdown 扩展名）
 * - 编码边界（非 UTF-8 / NUL / BOM / >5MB）
 * - 真实文件系统边界（删除非空目录、重命名冲突、目录类型、原子写残留）
 * 运行：node --test tests/qa-fs-security.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const fsService = require('../src/main/fs-service.js')

const MAX_TEXT_BYTES = fsService.MAX_TEXT_BYTES

async function makeTempDir(prefix = 'qm-qa-fs-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('相对路径与路径穿越一律 EINVAL（主进程永不按工作目录解析）', async () => {
  const calls = [
    () => fsService.readFile('..\\..\\evil.md'),
    () => fsService.readFile('evil.md'),
    () => fsService.readFile('./relative.md'),
    () => fsService.writeFile('..\\..\\evil.md', 'x'),
    () => fsService.writeFile('evil.md', 'x'),
    () => fsService.listDir('sub'),
    () => fsService.listDir('..'),
    () => fsService.remove('doc.md'),
    () => fsService.remove('..'),
    () => fsService.rename('doc.md', 'x.md'),
    () => fsService.pathInfo('doc.md'),
    () => fsService.rename('..\\..\\a.md', 'b.md'),
  ]
  for (const [index, call] of calls.entries()) {
    const result = await call()
    assert.equal(result.ok, false, `第 ${index} 项应失败`)
    assert.equal(result.code, 'EINVAL', `第 ${index} 项应为 EINVAL，实际 ${result.code}`)
  }
})

test('路径包含 NUL 字节 → EINVAL', async () => {
  const result = await fsService.readFile('C:\\tmp\\a\u0000.md')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'EINVAL')
})

test('文件名校验矩阵：非法名称全部拒绝', () => {
  const invalid = [
    '',
    '   ',
    '.',
    '..',
    'CON',
    'con.md',
    'CON.txt',
    'PRN',
    'AUX',
    'NUL',
    'com1',
    'LPT9.md',
    'a:b',
    'a/b',
    'a\\b',
    'a?b',
    'a*b',
    'a"b',
    'a<b',
    'a>b',
    'a|b',
    '\u0001',
    'name.',
    `${'x'.repeat(200)}.md`,
  ]
  for (const name of invalid) {
    const result = fsService.validateName(name)
    assert.equal(result.ok, false, `名称 ${JSON.stringify(name)} 应被拒绝`)
    assert.equal(result.code, 'EINVAL')
  }
})

test('文件名校验矩阵：合法名称通过（含中文、空格、点、数字）', () => {
  const valid = ['a.md', '笔记.md', 'my note.md', '.hidden.md', 'a.b.c.md', '中文 空格.markdown', 'x'.repeat(196) + '.md']
  for (const name of valid) {
    const result = fsService.validateName(name)
    assert.equal(result.ok, true, `名称 ${JSON.stringify(name)} 应通过：${JSON.stringify(result)}`)
  }
})

test('名称首尾空白被裁剪；新建文件强制 .md/.markdown 扩展名', () => {
  assert.deepEqual(fsService.validateName('  空格名称.md  '), { ok: true, name: '空格名称.md' })
  for (const name of ['note.txt', 'note', 'note.md.txt', 'note.MD.bak']) {
    const result = fsService.validateName(name, { requireMarkdown: true })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'NOT_MARKDOWN')
  }
  assert.equal(fsService.validateName('note.MD', { requireMarkdown: true }).ok, true)
  assert.equal(fsService.validateName('note.markdown', { requireMarkdown: true }).ok, true)
})

test('isMarkdownPath 大小写不敏感', () => {
  assert.equal(fsService.isMarkdownPath('a.MD'), true)
  assert.equal(fsService.isMarkdownPath('a.MarkDown'), true)
  assert.equal(fsService.isMarkdownPath('a.txt'), false)
  assert.equal(fsService.isMarkdownPath('md'), false)
})

test('真实文件系统：创建/重命名/删除边界', async () => {
  const dir = await makeTempDir()
  try {
    const file = path.join(dir, 'a.md')
    const folder = path.join(dir, 'sub')
    assert.equal((await fsService.createFile(dir, 'a.md', '# a\n')).ok, true)
    assert.equal((await fsService.createFile(dir, 'a.md', '# duplicate')).code, 'EEXIST')
    assert.equal((await fsService.createFolder(dir, 'sub')).ok, true)
    assert.equal((await fsService.createFolder(dir, 'sub')).code, 'EEXIST')

    // 重命名冲突
    assert.equal((await fsService.createFile(dir, 'b.md', '# b\n')).ok, true)
    assert.equal((await fsService.rename(file, 'b.md')).code, 'EEXIST')
    // 大小写改名（Windows 大小写不敏感）可成功
    const caseRename = await fsService.rename(file, 'A.md')
    assert.equal(caseRename.ok, true)
    assert.equal(caseRename.name, 'A.md')
    // 改名不改变所在目录
    assert.equal(path.dirname(caseRename.path), dir)

    // 删除非空目录被拒绝，空目录可删除
    await fsp.writeFile(path.join(folder, 'child.md'), '# child\n', 'utf8')
    assert.equal((await fsService.remove(folder)).code, 'ENOTEMPTY')
    const emptyFolder = path.join(dir, 'empty')
    await fsp.mkdir(emptyFolder)
    assert.equal((await fsService.remove(emptyFolder)).ok, true)
    assert.equal(fs.existsSync(emptyFolder), false)

    // 目录/文件类型错误
    assert.equal((await fsService.readFile(dir)).code, 'EISDIR')
    assert.equal((await fsService.writeFile(dir, 'x')).code, 'EISDIR')
    assert.equal((await fsService.listDir(file)).code, 'ENOTDIR')

    // pathInfo 对不存在路径返回 exists:false（非错误）
    const missing = await fsService.pathInfo(path.join(dir, 'missing.md'))
    assert.equal(missing.ok, true)
    assert.equal(missing.exists, false)

    // 写入不存在的父目录 → ENOENT
    assert.equal((await fsService.writeFile(path.join(dir, 'no-dir', 'x.md'), 'x')).code, 'ENOENT')
    // 原子写：中文内容与 CRLF 原样往返，且无 .tmp 残留
    const winFile = path.join(dir, 'win.md')
    const content = '# 标题\r\n\r\n中文内容\r\n'
    assert.equal((await fsService.writeFile(winFile, content)).ok, true)
    assert.equal(await fsp.readFile(winFile, 'utf8'), content)
    const leftovers = (await fsp.readdir(dir)).filter((name) => name.includes('.qm-'))
    assert.deepEqual(leftovers, [])
    // 目录内容排序：目录在前、文件在后
    const listing = await fsService.listDir(dir)
    assert.equal(listing.ok, true)
    const firstFileIndex = listing.entries.findIndex((entry) => !entry.isDirectory)
    const lastDirIndex = listing.entries.map((entry) => entry.isDirectory).lastIndexOf(true)
    assert.ok(lastDirIndex < firstFileIndex, '目录应排在文件之前')
    assert.equal(listing.entries.find((entry) => entry.name === 'A.md').isMarkdown, true)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

test('编码边界：非 UTF-8 / NUL / BOM / >5MB', async () => {
  const dir = await makeTempDir()
  try {
    // GBK 编码的“你好”不是合法 UTF-8
    const gbk = path.join(dir, 'gbk.md')
    await fsp.writeFile(gbk, Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0x0a]))
    assert.equal((await fsService.readFile(gbk)).code, 'BAD_ENCODING')

    // 合法 UTF-8 但含 NUL 字节 → BAD_ENCODING
    const nul = path.join(dir, 'nul.md')
    await fsp.writeFile(nul, Buffer.from([0x61, 0x00, 0x62]))
    assert.equal((await fsService.readFile(nul)).code, 'BAD_ENCODING')

    // BOM 去除
    const bom = path.join(dir, 'bom.md')
    await fsp.writeFile(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文\n', 'utf8')]))
    const bomRead = await fsService.readFile(bom)
    assert.equal(bomRead.ok, true)
    assert.equal(bomRead.content, '中文\n')

    // 超过 5MB 读取被拒绝
    const big = path.join(dir, 'big.md')
    await fsp.writeFile(big, 'x'.repeat(MAX_TEXT_BYTES + 100), 'utf8')
    assert.equal((await fsService.readFile(big)).code, 'TOO_LARGE')
    // 超过 5MB 写入被拒绝
    assert.equal((await fsService.writeFile(path.join(dir, 'big2.md'), 'y'.repeat(MAX_TEXT_BYTES + 10))).code, 'TOO_LARGE')

    // 恰好 5MB 边界以内可读（用一个 1MB 文件保证性能）
    const okFile = path.join(dir, 'ok.md')
    await fsp.writeFile(okFile, 'z'.repeat(1024 * 1024), 'utf8')
    assert.equal((await fsService.readFile(okFile)).ok, true)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})
