'use strict'

/**
 * 文件版本工具（纯函数，便于测试）：
 * - sha256Hex：内容哈希（原始字节，含 BOM）
 * - hasUtf8Bom / stripUtf8Bom：BOM 检测与剥离
 * - makeFileVersion：{ mtimeMs, size, hash }，用于保存时的乐观并发校验
 */
const crypto = require('node:crypto')

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function hasUtf8Bom(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM)
}

function stripUtf8Bom(buffer) {
  return hasUtf8Bom(buffer) ? buffer.subarray(3) : buffer
}

/** @param {{ mtimeMs: number }} stat @param {Buffer} buffer 原始字节 */
function makeFileVersion(stat, buffer) {
  return {
    mtimeMs: Number(stat && stat.mtimeMs) || 0,
    size: buffer ? buffer.length : 0,
    hash: sha256Hex(buffer || Buffer.alloc(0)),
  }
}

module.exports = {
  UTF8_BOM,
  sha256Hex,
  hasUtf8Bom,
  stripUtf8Bom,
  makeFileVersion,
}
