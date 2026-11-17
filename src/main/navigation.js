'use strict'

/**
 * 窗口导航策略（纯逻辑，便于单测）：
 * - allow：应用自身页面（app://bundle/）放行
 * - external：http/https 交给系统浏览器
 * - deny：其余协议（file/javascript/data 等）一律拦截
 */
function classifyNavigation(url) {
  if (typeof url !== 'string' || url.length === 0) return 'deny'
  if (url.startsWith('app://bundle/')) return 'allow'
  if (/^https?:\/\//i.test(url)) return 'external'
  return 'deny'
}

module.exports = { classifyNavigation }
