/**
 * 文件版本工具与 readFile BOM/哈希回归。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import fileVersion from '../src/main/file-version.js'
import fsService from '../src/main/fs-service.js'

const { hasUtf8Bom, stripUtf8Bom, makeFileVersion, sha256Hex, UTF8_BOM } = fileVersion
const fsp = fs.promises
const sha = (value) => createHash('sha256').update(value).digest('hex')

test('file-version：BOM 检测与剥离', () => {
  const plain = Buffer.from('hello')
  const withBom = Buffer.concat([UTF8_BOM, plain])

  assert.equal(hasUtf8Bom(plain), false)
  assert.equal(hasUtf8Bom(withBom), true)
  assert.deepEqual(stripUtf8Bom(withBom), plain)
  assert.deepEqual(stripUtf8Bom(plain), plain)
})

test('file-version：版本包含 mtime/size/原始字节哈希', () => {
  const buffer = Buffer.concat([UTF8_BOM, Buffer.from('你好')])
  const version = makeFileVersion({ mtimeMs: 1234.5 }, buffer)

  assert.equal(version.mtimeMs, 1234.5)
  assert.equal(version.size, buffer.length)
  assert.equal(version.hash, sha(buffer))
  assert.equal(version.hash, sha256Hex(buffer))
})

test('readFile：返回 version 与 hasBom，content 不含 BOM', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-read-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  const file = path.join(dir, 'bom.md')
  const raw = Buffer.concat([UTF8_BOM, Buffer.from('第一行\n第二行\n')])
  await fsp.writeFile(file, raw)

  const result = await fsService.readFile(file)

  assert.equal(result.ok, true)
  assert.equal(result.content, '第一行\n第二行\n')
  assert.equal(result.hasBom, true)
  assert.equal(result.version.size, raw.length)
  assert.equal(result.version.hash, sha(raw))
  assert.equal(result.version.hash, sha256Hex(raw))
})
