/**
 * MoDex渲染层通用工具。
 * 包含：DOM 助手、toast 通知、右键菜单、拖拽改宽、剪贴板，
 * 以及可独立测试的纯函数（防抖、字数、文件名校验、路径比较等）。
 * 本模块顶层不访问 DOM，便于在 Node 环境做单元测试。
 */

import { icons } from './icons.js'

// ---------------------------------------------------------------------------
// DOM 助手
// ---------------------------------------------------------------------------

/** 查询单个元素 */
export function $(selector, root = document) {
  return root.querySelector(selector)
}

/** 查询元素数组 */
export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector))
}

/**
 * 创建元素。
 * props 支持 className / text / html（仅可信静态内容）/ dataset / style，
 * 其余属性优先走 DOM 属性，不存在时走 setAttribute。
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue
    if (key === 'className') node.className = value
    else if (key === 'text') node.textContent = String(value)
    else if (key === 'html') node.innerHTML = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else if (key === 'style') Object.assign(node.style, value)
    else if (key in node) node[key] = value
    else node.setAttribute(key, String(value))
  }
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    if (child === undefined || child === null || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/** 清空子节点 */
export function clearNode(node) {
  if (node) node.replaceChildren()
}

/** 设置 hidden 属性 */
export function setHidden(node, hidden) {
  if (node) node.hidden = Boolean(hidden)
}

// ---------------------------------------------------------------------------
// 纯函数工具
// ---------------------------------------------------------------------------

/** 防抖（带 cancel） */
export function debounce(fn, wait = 120) {
  let timer = 0
  const wrapped = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = 0
      fn(...args)
    }, wait)
  }
  wrapped.cancel = () => {
    clearTimeout(timer)
    timer = 0
  }
  return wrapped
}

/** 数值夹取 */
export function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

/** 中日韩表意文字与假名、谚文正则（用于字数统计） */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g

/**
 * 统计字数：中文字符按 1 字，其余按空白分词。
 * 纯标点 / 空白不计入。
 */
export function countWords(text) {
  const source = String(text ?? '')
  if (!source.trim()) return 0
  const cjkMatches = source.match(CJK_RE)
  const cjkCount = cjkMatches ? cjkMatches.length : 0
  const rest = source.replace(CJK_RE, ' ')
  const words = rest.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word))
  return cjkCount + words.length
}

/** Windows 保留名（含带扩展名形式） */
const RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
/** 名称中禁止出现的字符（含控制字符） */
const FORBIDDEN_NAME_RE = /[\\/:*?"<>|\u0000-\u001f]/

/**
 * 校验名称（与主进程契约一致）。
 * @returns {{ ok: boolean, name: string, error: string }}
 */
export function validateName(raw, { markdownOnly = false } = {}) {
  const name = String(raw ?? '').trim()
  if (!name) return { ok: false, name, error: '名称不能为空' }
  if (name.length > 200) return { ok: false, name, error: '名称过长（最多 200 个字符）' }
  if (name === '.' || name === '..') return { ok: false, name, error: '名称不能是 . 或 ..' }
  if (FORBIDDEN_NAME_RE.test(name)) {
    return { ok: false, name, error: '名称不能包含 \\ / : * ? " < > | 等字符' }
  }
  if (/[ .]$/.test(name)) return { ok: false, name, error: '名称不能以空格或点结尾' }
  if (RESERVED_NAME_RE.test(name)) {
    return { ok: false, name, error: '这是系统保留名称，请换一个' }
  }
  if (markdownOnly && !/\.(md|markdown)$/i.test(name)) {
    return { ok: false, name, error: 'Markdown 文件扩展名必须为 .md 或 .markdown' }
  }
  return { ok: true, name, error: '' }
}

/**
 * 新建 Markdown 文件的名称处理：缺省扩展名时补 `.md`，显式写了其它扩展名则报错。
 * @returns {{ ok: boolean, name: string, error: string }}
 */
export function resolveMarkdownName(raw) {
  const name = String(raw ?? '').trim()
  if (!name) return { ok: false, name, error: '名称不能为空' }
  const dot = name.lastIndexOf('.')
  const hasExtension = dot > 0
  if (!hasExtension) return validateName(`${name}.md`, { markdownOnly: true })
  return validateName(name, { markdownOnly: true })
}

/** 去掉扩展名的文件名（用于重命名时选中主干部分） */
export function baseNameWithoutExt(name) {
  const text = String(name ?? '')
  const dot = text.lastIndexOf('.')
  return dot > 0 ? text.slice(0, dot) : text
}

/** HTML 转义（用于 markdown-it 代码高亮等受信上下文） */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 正则元字符转义 */
export function escapeRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 是否为绝对路径（Windows 盘符、UNC 或 POSIX 根） */
export function isAbsolutePath(target) {
  const value = String(target ?? '')
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || /^\//.test(value)
}

/** 路径比较用规范化：统一反斜杠并小写（Windows 大小写不敏感） */
export function normalizeForCompare(target) {
  return String(target ?? '').replace(/\//g, '\\').toLowerCase()
}

/** child 是否与 parent 相同或位于 parent 之内 */
export function isSameOrInside(child, parent) {
  const childPath = normalizeForCompare(child)
  const parentPath = normalizeForCompare(parent)
  if (!childPath || !parentPath) return false
  if (childPath === parentPath) return true
  return childPath.startsWith(parentPath.endsWith('\\') ? parentPath : `${parentPath}\\`)
}

/** 文本截断（用于标题 / 占位提示） */
export function truncate(text, max = 64) {
  const value = String(text ?? '')
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** 读取文档字体尺寸并限制到契约范围 */
export function normalizeFontSize(size) {
  return Math.round(clamp(size, 12, 24))
}

// ---------------------------------------------------------------------------
// 剪贴板
// ---------------------------------------------------------------------------

/**
 * 复制文本：优先使用 navigator.clipboard，失败时用隐藏 textarea 兜底。
 * @returns {Promise<boolean>} 是否成功
 */
export async function copyText(text) {
  const value = String(text ?? '')
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch (error) {
    console.warn('[MoDex] clipboard.writeText 失败，尝试兜底方案', error)
  }
  try {
    const input = el('textarea', {
      value,
      readOnly: true,
      className: 'clipboard-fallback',
    })
    document.body.append(input)
    input.select()
    const ok = document.execCommand('copy')
    input.remove()
    return ok
  } catch (error) {
    console.error('[MoDex] 复制文本失败', error)
    return false
  }
}

// ---------------------------------------------------------------------------
// toast 通知
// ---------------------------------------------------------------------------

/**
 * 创建 toast 管理器。
 * @param {HTMLElement} container 右下角容器
 */
export function createToastSystem(container, { duration = 3000 } = {}) {
  function show(message, type = 'info', options = {}) {
    const text = String(message ?? '')
    if (!container) {
      console.log(`[MoDex:${type}] ${text}`)
      return () => {}
    }
    const node = el('div', {
      className: `toast toast-${type}`,
      role: 'status',
      dataset: { toastType: type },
    })
    node.append(el('span', { className: 'toast-dot' }), el('span', { className: 'toast-text', text }))
    container.append(node)
    // 下一帧再加动画类，保证过渡生效
    requestAnimationFrame(() => node.classList.add('toast-in'))
    let dismissed = false
    const dismiss = () => {
      if (dismissed) return
      dismissed = true
      clearTimeout(timer)
      node.classList.remove('toast-in')
      node.classList.add('toast-out')
      setTimeout(() => node.remove(), 200)
    }
    const timer = setTimeout(dismiss, options.duration ?? duration)
    node.addEventListener('click', dismiss)
    return dismiss
  }
  return {
    show,
    info: (message, options) => show(message, 'info', options),
    success: (message, options) => show(message, 'success', options),
    error: (message, options) => show(message, 'error', options),
  }
}

// ---------------------------------------------------------------------------
// 右键菜单
// ---------------------------------------------------------------------------

/**
 * 创建菜单管理器（右键菜单与应用菜单共用）。
 * items: Array<{ label, hint?, icon?, danger?, menuAction?, menuKey?, separator?, disabled?, hasSubmenu?, onSelect? }>
 * options: {
 *   onClose?: () => void            打开状态下被关闭时回调（用于同步按钮状态）
 *   isInside?: (target) => boolean  判定“外部点击”时额外视为菜单内部的目标（二级面板）
 *   onItemHover?: (item, row) => void       悬停菜单项（用于展开/收起二级菜单）
 *   onSubmenu?: (item, row) => void         点击带二级菜单的项（父菜单保持打开）
 * }
 */
export function createContextMenu(container, options = {}) {
  let detachOutside = null
  let opened = false

  function cleanup() {
    if (detachOutside) {
      detachOutside()
      detachOutside = null
    }
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    document.removeEventListener('scroll', close, true)
    document.removeEventListener('keydown', onDocumentKeydown, true)
    opened = false
  }

  function close() {
    if (!container) return
    const wasOpen = opened
    container.hidden = true
    cleanup()
    if (wasOpen) options.onClose?.()
  }

  function onDocumentKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  function onPointerDown(event) {
    if (!container || container.contains(event.target)) return
    if (options.isInside?.(event.target)) return
    close()
  }

  function open(x, y, items = []) {
    if (!container) return
    close()
    container.replaceChildren()
    for (const item of items) {
      if (!item) continue
      if (item.separator) {
        container.append(el('li', { className: 'ctx-sep', role: 'separator' }))
        continue
      }
      const classes = ['ctx-item']
      if (item.danger) classes.push('danger')
      if (item.disabled) classes.push('is-disabled')
      if (item.hasSubmenu) classes.push('has-submenu')
      const button = el('button', {
        type: 'button',
        className: classes.join(' '),
        role: 'menuitem',
        disabled: Boolean(item.disabled),
      })
      if (item.icon && icons[item.icon]) {
        button.append(el('span', { className: 'ctx-icon', html: icons[item.icon] }))
      }
      button.append(el('span', { className: 'ctx-label', text: item.label ?? '' }))
      if (item.hint) {
        button.append(el('span', { className: 'ctx-hint', text: String(item.hint) }))
      }
      if (item.hasSubmenu) {
        button.append(el('span', { className: 'ctx-arrow', text: '›', 'aria-hidden': 'true' }))
      }
      const row = el('li', { className: 'ctx-row' })
      if (item.menuAction) row.dataset.menuAction = item.menuAction
      if (item.menuKey) row.dataset.menuKey = item.menuKey
      row.append(button)
      row.addEventListener('mouseenter', () => options.onItemHover?.(item, row))
      // 兼容仅派发 mouseover 的自动化测试；真实指针的悬停由 mouseenter 负责
      row.addEventListener('mouseover', (event) => {
        if (event.target === row) options.onItemHover?.(item, row)
      })
      // 点击整行即可触发（按钮铺满行，事件冒泡到此处统一处理）
      row.addEventListener('click', async () => {
        if (item.hasSubmenu) {
          options.onSubmenu?.(item, row)
          return
        }
        close()
        try {
          await item.onSelect?.()
        } catch (error) {
          console.error('[MoDex] 菜单项执行失败', error)
        }
      })
      container.append(row)
    }
    // 先显示再测量，避免宽度为 0 导致定位偏移
    container.hidden = false
    container.style.left = '0px'
    container.style.top = '0px'
    const rect = container.getBoundingClientRect()
    const left = Math.max(4, Math.min(Number(x) || 0, window.innerWidth - rect.width - 6))
    const top = Math.max(4, Math.min(Number(y) || 0, window.innerHeight - rect.height - 6))
    container.style.left = `${left}px`
    container.style.top = `${top}px`
    opened = true
    setTimeout(() => {
      if (!opened) return
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('keydown', onDocumentKeydown, true)
      document.addEventListener('scroll', close, true)
      window.addEventListener('blur', close)
      window.addEventListener('resize', close)
      detachOutside = () => document.removeEventListener('pointerdown', onPointerDown, true)
    }, 0)
  }

  return {
    open,
    close,
    get isOpen() {
      return Boolean(container && !container.hidden)
    },
  }
}

// ---------------------------------------------------------------------------
// 拖拽改宽
// ---------------------------------------------------------------------------

/**
 * 给分隔条绑定拖拽行为。
 * options: { onStart?, onDrag?({ dx, dy }), onEnd? }
 */
export function makeDragResizer(handle, options = {}) {
  if (!handle) return () => {}
  let active = false

  const onPointerDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    active = true
    const startX = event.clientX
    const startY = event.clientY
    const move = (moveEvent) => {
      if (!active) return
      options.onDrag?.({
        dx: moveEvent.clientX - startX,
        dy: moveEvent.clientY - startY,
      })
    }
    const up = () => {
      if (!active) return
      active = false
      handle.classList.remove('is-dragging')
      document.body.classList.remove('is-resizing')
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
      options.onEnd?.()
    }
    handle.classList.add('is-dragging')
    document.body.classList.add('is-resizing')
    options.onStart?.()
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
  }

  handle.addEventListener('pointerdown', onPointerDown)
  return () => handle.removeEventListener('pointerdown', onPointerDown)
}
