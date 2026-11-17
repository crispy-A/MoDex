'use strict'

/**
 * IPC 来源校验（纯逻辑，便于单测）。
 *
 * 只接受主窗口渲染进程、且 senderFrame.url 位于 app://bundle/ 的调用；
 * 其它 frame（iframe / 子窗口 / 其它 WebContents）与非法来源一律拒绝。
 */
function createTrustedSenderChecker({ getWindow }) {
  if (typeof getWindow !== 'function') throw new Error('ipc-guard: 缺少 getWindow')
  return function isTrustedSender(event) {
    try {
      if (!event || !event.sender) return false
      const win = getWindow()
      if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false
      const contents = win.webContents
      if (!contents || event.sender !== contents) return false
      const frame = event.senderFrame
      if (!frame || typeof frame.url !== 'string') return false
      return frame.url.startsWith('app://bundle/')
    } catch {
      return false
    }
  }
}

module.exports = { createTrustedSenderChecker }
