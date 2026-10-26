/**
 * 预览模块。
 * 职责：调用 markdown-it 渲染、处理链接/图片（相对路径、远程占位、锚点）、
 * 空内容占位、渲染错误降级、与编辑器的滚动比例双向同步。
 */

import { $, el, clamp, isAbsolutePath, truncate } from './util.js'
import { renderMarkdown } from './markdown.js'

/** 安全解码 URI（失败时返回原值） */
function decodeSafe(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** 去掉链接里的 query / hash，仅保留路径 */
function stripSuffix(target) {
  const value = String(target ?? '')
  const hashIndex = value.indexOf('#')
  const queryIndex = value.indexOf('?')
  let end = value.length
  if (hashIndex >= 0) end = Math.min(end, hashIndex)
  if (queryIndex >= 0) end = Math.min(end, queryIndex)
  return value.slice(0, end)
}

export function initPreview(ctx = {}) {
  const pane = $('#preview-pane')
  const article = $('#preview')
  if (!pane || !article) throw new Error('缺少 #preview-pane / #preview 元素')
  const api = window.api
  let baseDir = null
  let syncing = false

  function getScrollRatio() {
    const max = pane.scrollHeight - pane.clientHeight
    return max > 0 ? pane.scrollTop / max : 0
  }

  function applyScrollRatio(ratio, { silent = false } = {}) {
    const max = pane.scrollHeight - pane.clientHeight
    if (max <= 0) return
    if (silent) {
      syncing = true
      pane.scrollTop = clamp(Number(ratio) || 0, 0, 1) * max
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          syncing = false
        })
      })
    } else {
      pane.scrollTop = clamp(Number(ratio) || 0, 0, 1) * max
    }
  }

  function setBaseDir(dir) {
    baseDir = dir || null
  }

  function resolveLocalPath(raw) {
    const cleaned = stripSuffix(decodeSafe(String(raw ?? '').trim()))
    if (!cleaned) return null
    if (isAbsolutePath(cleaned)) return cleaned
    if (!baseDir) return null
    try {
      return api.joinPath(baseDir, cleaned.replace(/^\.\//, ''))
    } catch (error) {
      console.warn('[MoDex] 解析图片路径失败', error)
      return null
    }
  }

  function brokenImage(message) {
    return el('span', { className: 'image-broken', text: message })
  }

  function remoteImage(raw) {
    const wrap = el('span', { className: 'remote-image', title: raw })
    wrap.append(el('span', { className: 'remote-image-label', text: '远程图片（离线模式不加载）' }))
    const link = el('a', {
      className: 'remote-image-link',
      href: raw,
      text: truncate(raw, 56),
      title: raw,
    })
    wrap.append(link)
    return wrap
  }

  function processImages() {
    for (const img of article.querySelectorAll('img')) {
      const raw = String(img.getAttribute('src') ?? '').trim()
      if (!raw) {
        img.replaceWith(brokenImage('图片缺少地址'))
        continue
      }
      if (/^data:/i.test(raw)) continue
      if (/^https?:/i.test(raw)) {
        img.replaceWith(remoteImage(raw))
        continue
      }
      if (/^(app|file):/i.test(raw)) {
        img.addEventListener('error', () => img.replaceWith(brokenImage('图片无法加载')), {
          once: true,
        })
        continue
      }
      const absolute = resolveLocalPath(raw)
      if (!absolute) {
        img.replaceWith(brokenImage('图片路径无法解析（请先保存文档）'))
        continue
      }
      try {
        img.src = api.toAssetUrl(absolute)
        img.loading = 'lazy'
        img.addEventListener('error', () => img.replaceWith(brokenImage('图片无法加载')), {
          once: true,
        })
      } catch (error) {
        console.warn('[MoDex] 转换图片地址失败', error)
        img.replaceWith(brokenImage('图片无法加载'))
      }
    }
  }

  function scrollToAnchor(rawId) {
    const id = decodeSafe(String(rawId ?? ''))
    if (!id) return
    let target = null
    try {
      target = article.querySelector(`#${CSS.escape(id)}`)
    } catch {
      target = null
    }
    if (!target) {
      target = Array.from(article.querySelectorAll('h1,h2,h3,h4,h5,h6')).find(
        (heading) => heading.id === id
      )
    }
    if (!target) {
      ctx.toast?.(`未找到锚点：${id}`, 'error')
      return
    }
    const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 18
    pane.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  async function openRelativeLink(href) {
    const path = stripSuffix(decodeSafe(href))
    if (!/\.(md|markdown)$/i.test(path)) {
      ctx.toast?.('预览仅支持打开 Markdown 文档链接', 'error')
      return
    }
    const absolute = isAbsolutePath(path) ? path : resolveLocalPath(path)
    if (!absolute) {
      ctx.toast?.('当前文档尚未保存，无法解析相对路径', 'error')
      return
    }
    await ctx.openLinkedFile?.(absolute)
  }

  function onClick(event) {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    if (!anchor || !article.contains(anchor)) return
    const href = String(anchor.getAttribute('href') ?? '')
    if (!href) return
    event.preventDefault()
    if (href.startsWith('#')) {
      scrollToAnchor(href.slice(1))
      return
    }
    if (/^https?:/i.test(href)) {
      ctx.openExternal?.(href)
      return
    }
    if (/^(mailto|app|file|javascript):/i.test(href)) return
    void openRelativeLink(href)
  }

  function showPlaceholder() {
    article.innerHTML = '<p class="preview-empty">开始输入 Markdown…</p>'
  }

  function showRenderError(error) {
    const box = el('p', { className: 'preview-error' })
    box.append(
      el('strong', { text: '预览渲染失败：' }),
      document.createTextNode(error && error.message ? error.message : String(error))
    )
    article.replaceChildren(box)
  }

  function render(text) {
    const source = String(text ?? '')
    const ratio = getScrollRatio()
    if (!source.trim()) {
      showPlaceholder()
      return
    }
    let html = ''
    try {
      html = renderMarkdown(source)
    } catch (error) {
      console.error('[MoDex] Markdown 渲染失败', error)
      showRenderError(error)
      return
    }
    // innerHTML 只接受 markdown-it 输出（html:false）
    article.innerHTML = html
    processImages()
    applyScrollRatio(ratio, { silent: true })
  }

  article.addEventListener('click', onClick)
  pane.addEventListener('scroll', () => {
    if (syncing) return
    ctx.onPreviewScroll?.(getScrollRatio())
  })

  return {
    setBaseDir,
    render,
    getScrollRatio,
    setScrollRatio: (ratio) => applyScrollRatio(ratio, { silent: true }),
  }
}
