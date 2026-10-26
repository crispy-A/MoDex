'use strict'

/**
 * API Key 安全存储：
 * - 使用 Electron safeStorage（Windows DPAPI）加密后写入 userData/ai/api-key.bin
 * - 明文 Key 永远不离开主进程、不写日志；渲染层只能拿到 hasKey/maskedKey
 * - crypto 可注入（单测使用 stub，避免依赖 Electron）
 */
const fsp = require('node:fs/promises')
const path = require('node:path')

const FILE_VERSION = 1
const KEY_MIN_LENGTH = 8
const KEY_MAX_LENGTH = 512
const MASK_PREFIX = '••••••••'

function aiError(code, message, extra) {
  const error = new Error(message)
  error.code = code
  if (extra && typeof extra === 'object') Object.assign(error, extra)
  return error
}

function maskKey(key) {
  const text = String(key || '')
  if (!text) return ''
  const tail = text.slice(-4)
  return `${MASK_PREFIX}${tail}`
}

function createCredentialsStore({ filePath, safeStorage }) {
  if (!filePath) throw new Error('credentials: 缺少 filePath')
  const directory = path.dirname(filePath)

  function encryptionAvailable() {
    try {
      return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable())
    } catch {
      return false
    }
  }

  async function readCiphertext() {
    try {
      const text = await fsp.readFile(filePath, 'utf8')
      const parsed = JSON.parse(text)
      if (!parsed || parsed.version !== FILE_VERSION || typeof parsed.ciphertext !== 'string') return null
      return Buffer.from(parsed.ciphertext, 'base64')
    } catch {
      return null
    }
  }

  function decrypt(buffer) {
    if (!buffer) return null
    try {
      const text = safeStorage.decryptString(buffer)
      return typeof text === 'string' && text.trim().length > 0 ? text : null
    } catch {
      return null
    }
  }

  async function getKey() {
    if (!encryptionAvailable()) return null
    return decrypt(await readCiphertext())
  }

  async function status() {
    const key = await getKey()
    if (!key) return { hasKey: false, maskedKey: '' }
    return { hasKey: true, maskedKey: maskKey(key) }
  }

  async function setKey(rawKey) {
    if (!encryptionAvailable()) {
      throw aiError('KEYSTORE_UNAVAILABLE', '系统密钥环不可用，无法保存 API Key')
    }
    const key = String(rawKey == null ? '' : rawKey).trim()
    if (key.length < KEY_MIN_LENGTH) throw aiError('INVALID_KEY', 'API Key 格式不正确（太短）')
    if (key.length > KEY_MAX_LENGTH) throw aiError('INVALID_KEY', 'API Key 格式不正确（过长）')
    let encrypted
    try {
      encrypted = safeStorage.encryptString(key)
    } catch (err) {
      throw aiError('KEYSTORE_UNAVAILABLE', 'API Key 加密失败，请重试', { cause: err })
    }
    await fsp.mkdir(directory, { recursive: true })
    const tempPath = `${filePath}.tmp`
    const payload = JSON.stringify({ version: FILE_VERSION, ciphertext: Buffer.from(encrypted).toString('base64') })
    await fsp.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 })
    await fsp.rename(tempPath, filePath)
    return { hasKey: true, maskedKey: maskKey(key) }
  }

  async function clear() {
    try {
      await fsp.rm(filePath, { force: true })
    } catch {
      // 忽略删除失败：调用方按未配置处理
    }
    return { hasKey: false, maskedKey: '' }
  }

  return { encryptionAvailable, getKey, status, setKey, clear }
}

module.exports = {
  FILE_VERSION,
  KEY_MIN_LENGTH,
  KEY_MAX_LENGTH,
  MASK_PREFIX,
  aiError,
  maskKey,
  createCredentialsStore,
}
