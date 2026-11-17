/**
 * 主进程安全边界回归测试：IPC 来源校验、app:// 协议、窗口导航策略。
 * 这些逻辑已抽成不依赖 Electron 的模块，可在纯 Node 下直接验证。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createTrustedSenderChecker } from '../src/main/ipc-guard.js'
import { classifyNavigation } from '../src/main/navigation.js'
import {
  createAppProtocolHandler,
  CSP_HEADER,
  IMAGE_CSP_HEADER,
  MAX_IMAGE_BYTES,
} from '../src/main/app-protocol.js'

// ---------------------------------------------------------------------------
// IPC 来源校验
// ---------------------------------------------------------------------------

function fakeWindow(webContents, destroyed = false) {
  return { webContents, isDestroyed: () => destroyed }
}

test('IPC：只接受主窗口 webContents 且 frame 位于 app://bundle/', () => {
  const sender = { id: 1 }
  const check = createTrustedSenderChecker({ getWindow: () => fakeWindow(sender) })

  assert.equal(check({ sender, senderFrame: { url: 'app://bundle/index.html' } }), true)
  assert.equal(check({ sender, senderFrame: { url: 'app://bundle/' } }), true)
})

test('IPC：拒绝其它 webContents / 子 frame / 非 bundle 协议 / 空事件', () => {
  const sender = { id: 1 }
  const check = createTrustedSenderChecker({ getWindow: () => fakeWindow(sender) })

  assert.equal(check({ sender: { id: 2 }, senderFrame: { url: 'app://bundle/index.html' } }), false)
  assert.equal(check({ sender, senderFrame: { url: 'file:///C:/index.html' } }), false)
  assert.equal(check({ sender, senderFrame: { url: 'https://evil.example/' } }), false)
  assert.equal(check({ sender, senderFrame: { url: 'app://bundleevil/index.html' } }), false)
  assert.equal(check({ sender, senderFrame: null }), false)
  assert.equal(check({ sender }), false)
  assert.equal(check(null), false)
  assert.equal(check(undefined), false)
})

test('IPC：窗口已销毁或 getWindow 抛错时一律拒绝', () => {
  const sender = { id: 1 }
  const destroyed = createTrustedSenderChecker({ getWindow: () => fakeWindow(sender, true) })
  assert.equal(destroyed({ sender, senderFrame: { url: 'app://bundle/index.html' } }), false)

  const none = createTrustedSenderChecker({ getWindow: () => null })
  assert.equal(none({ sender, senderFrame: { url: 'app://bundle/index.html' } }), false)

  const throwing = createTrustedSenderChecker({
    getWindow: () => {
      throw new Error('window gone')
    },
  })
  assert.equal(throwing({ sender, senderFrame: { url: 'app://bundle/index.html' } }), false)
})

// ---------------------------------------------------------------------------
// app:// 协议
// ---------------------------------------------------------------------------

function makeRendererFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-proto-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>MoDex</title>')
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const answer = 42')
  return dir
}

test('app://bundle：默认 index.html 且带严格 CSP', async (t) => {
  const handler = createAppProtocolHandler({ rendererDir: makeRendererFixture(t) })

  const response = await handler({ url: 'app://bundle/' })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(response.headers.get('content-security-policy'), CSP_HEADER)
  assert.match(await response.text(), /MoDex/)
})

test('app://bundle：JS 正确 MIME，未知主名 404', async (t) => {
  const handler = createAppProtocolHandler({ rendererDir: makeRendererFixture(t) })

  const js = await handler({ url: 'app://bundle/app.js' })
  assert.equal(js.status, 200)
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8')

  const missing = await handler({ url: 'app://bundle/missing.js' })
  assert.equal(missing.status, 404)

  const otherHost = await handler({ url: 'app://other/index.html' })
  assert.equal(otherHost.status, 404)
})

test('app://bundle：编码路径穿越被拒绝（403）', async (t) => {
  const handler = createAppProtocolHandler({ rendererDir: makeRendererFixture(t) })

  const traversal = await handler({ url: 'app://bundle/..%2f..%2fpackage.json' })
  assert.equal(traversal.status, 403)

  const nestedTraversal = await handler({ url: 'app://bundle/js/..%2f..%2f..%2fpackage.json' })
  assert.equal(nestedTraversal.status, 403)
})

test('app://file：图片白名单 + 绝对路径 + 30MB 限制 + 图片 CSP', async (t) => {
  const rendererDir = makeRendererFixture(t)
  const imagePath = path.join(os.tmpdir(), 'modex-fixture.png')
  const handler = createAppProtocolHandler({
    rendererDir,
    stat: async () => ({ isFile: () => true, size: 10 }),
    readFile: async () => Buffer.from('fake-image'),
  })

  const ok = await handler({ url: `app://file/${encodeURIComponent(imagePath)}` })
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.equal(ok.headers.get('content-security-policy'), IMAGE_CSP_HEADER)
  assert.equal(ok.headers.get('cache-control'), 'no-store')

  const relative = await handler({ url: 'app://file/relative.png' })
  assert.equal(relative.status, 400)

  const textFile = await handler({ url: `app://file/${encodeURIComponent(path.join(os.tmpdir(), 'a.txt'))}` })
  assert.equal(textFile.status, 403)

  const tooLarge = createAppProtocolHandler({
    rendererDir,
    stat: async () => ({ isFile: () => true, size: MAX_IMAGE_BYTES + 1 }),
    readFile: async () => Buffer.from('x'),
  })
  const big = await tooLarge({ url: `app://file/${encodeURIComponent(imagePath)}` })
  assert.equal(big.status, 403)

  const directory = createAppProtocolHandler({
    rendererDir,
    stat: async () => ({ isFile: () => false, size: 0 }),
    readFile: async () => Buffer.from('x'),
  })
  const dirResponse = await directory({ url: `app://file/${encodeURIComponent(imagePath)}` })
  assert.equal(dirResponse.status, 403)

  const statFails = createAppProtocolHandler({
    rendererDir,
    stat: async () => {
      throw new Error('ENOENT')
    },
  })
  const gone = await statFails({ url: `app://file/${encodeURIComponent(imagePath)}` })
  assert.equal(gone.status, 404)
})

test('图片 CSP 禁止一切子资源与脚本', () => {
  assert.equal(IMAGE_CSP_HEADER, "default-src 'none'; style-src 'unsafe-inline'")
  assert.match(CSP_HEADER, /script-src 'self'/)
  assert.match(CSP_HEADER, /object-src 'none'/)
  assert.match(CSP_HEADER, /frame-ancestors 'none'/)
})

// ---------------------------------------------------------------------------
// 导航策略
// ---------------------------------------------------------------------------

test('导航：bundle 放行、http(s) 交给外部浏览器、其它协议拒绝', () => {
  assert.equal(classifyNavigation('app://bundle/index.html'), 'allow')
  assert.equal(classifyNavigation('https://example.com/a'), 'external')
  assert.equal(classifyNavigation('http://example.com/a'), 'external')

  assert.equal(classifyNavigation('file:///C:/Windows/System32/drivers/etc/hosts'), 'deny')
  assert.equal(classifyNavigation('javascript:alert(1)'), 'deny')
  assert.equal(classifyNavigation('data:text/html;base64,PHNjcmlwdD4='), 'deny')
  assert.equal(classifyNavigation('app://file/C:/x.png'), 'deny')
  assert.equal(classifyNavigation(''), 'deny')
  assert.equal(classifyNavigation(null), 'deny')
  assert.equal(classifyNavigation(undefined), 'deny')
})
