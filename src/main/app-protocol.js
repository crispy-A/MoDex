'use strict'

/**
 * 自定义 app:// 协议（与 Electron 解耦、可注入文件系统，便于单测）。
 *
 * - app://bundle/<相对路径>：只允许读取 src/renderer 内的文件，HTML 附带严格 CSP
 * - app://file/<绝对路径>：只代理图片扩展名、≤30MB，响应带 default-src 'none'
 */
const fsp = require('node:fs/promises')
const path = require('node:path')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])
const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' app: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
const IMAGE_CSP_HEADER = "default-src 'none'; style-src 'unsafe-inline'"

/** childPath 是否严格位于 parentDir 内（不含自身） */
function isInside(parentDir, childPath) {
  const relative = path.relative(parentDir, childPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * @param {{
 *   rendererDir: string,
 *   readFile?: (target: string) => Promise<Buffer|Uint8Array>,
 *   stat?: (target: string) => Promise<{ isFile: () => boolean, size: number }>
 * }} options
 * @returns {(request: { url: string }) => Promise<Response>}
 */
function createAppProtocolHandler({ rendererDir, readFile = fsp.readFile, stat = fsp.stat }) {
  if (!rendererDir) throw new Error('app-protocol: 缺少 rendererDir')
  const root = path.resolve(rendererDir)

  return async function handleAppRequest(request) {
    try {
      const url = new URL(request.url)

      if (url.host === 'bundle') {
        const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html'
        const target = path.resolve(root, relative)
        if (target !== root && !isInside(root, target)) {
          return new Response('Forbidden', { status: 403 })
        }
        const data = await readFile(target)
        const ext = path.extname(target).toLowerCase()
        const headers = { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' }
        if (ext === '.html') {
          headers['content-security-policy'] = CSP_HEADER
        }
        return new Response(data, { headers })
      }

      if (url.host === 'file') {
        const absolute = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        if (!absolute || !path.isAbsolute(absolute)) {
          return new Response('Bad path', { status: 400 })
        }
        const ext = path.extname(absolute).toLowerCase()
        if (!IMAGE_EXTENSIONS.has(ext)) {
          return new Response('Forbidden', { status: 403 })
        }
        const fileStat = await stat(absolute)
        if (!fileStat.isFile() || fileStat.size > MAX_IMAGE_BYTES) {
          return new Response('Forbidden', { status: 403 })
        }
        const data = await readFile(absolute)
        return new Response(data, {
          headers: {
            'content-type': MIME_TYPES[ext] || 'application/octet-stream',
            'cache-control': 'no-store',
            // 图片（尤其 SVG）不允许执行脚本或加载子资源
            'content-security-policy': IMAGE_CSP_HEADER,
          },
        })
      }

      return new Response('Not found', { status: 404 })
    } catch (err) {
      return new Response(`Not found: ${err && err.message ? err.message : 'unknown'}`, { status: 404 })
    }
  }
}

module.exports = {
  MIME_TYPES,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  CSP_HEADER,
  IMAGE_CSP_HEADER,
  isInside,
  createAppProtocolHandler,
}
