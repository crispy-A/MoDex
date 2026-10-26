/**
 * 编辑器增强模块。
 * 职责：textarea 内容读写、Tab 缩进、列表自动续写、Markdown 快捷包裹、
 * 查找栏（计数/循环/定位）、光标行列与滚动比例同步。
 * 通过 ctx 与 app 层通信，不直接碰其它模块。
 */

import { $, clamp } from './util.js'

/** 查找匹配构建（大小写不敏感、普通子串） */
function collectMatches(value, query) {
  const matches = []
  const needle = String(query ?? '')
  if (!needle) return matches
  const haystack = String(value ?? '').toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  let from = 0
  while (from <= haystack.length) {
    const at = haystack.indexOf(lowerNeedle, from)
    if (at < 0) break
    matches.push({ start: at, end: at + needle.length })
    from = at + Math.max(1, needle.length)
  }
  return matches
}

/** 判断位置是否落在未闭合的代码围栏内 */
function insideFence(value, position) {
  const before = value.slice(0, position)
  const fences = before.match(/^ {0,3}(?:```|~~~)/gm)
  return Boolean(fences && fences.length % 2 === 1)
}

export function initEditor(ctx = {}) {
  const textarea = $('#editor')
  const findbar = $('#findbar')
  const findInput = $('#find-input')
  const findCount = $('#find-count')
  const findPrev = findbar ? findbar.querySelector('[data-find="prev"]') : null
  const findNext = findbar ? findbar.querySelector('[data-find="next"]') : null
  const findClose = findbar ? findbar.querySelector('[data-find="close"]') : null
  if (!textarea) throw new Error('缺少 #editor 元素')

  let silent = false
  let syncing = false
  const find = { matches: [], index: -1, query: '' }

  // -------------------------------------------------------------------------
  // 基础读写与光标
  // -------------------------------------------------------------------------

  function lineColumn() {
    const value = textarea.value
    const position = textarea.selectionStart
    const lineStart = value.lastIndexOf('\n', position - 1) + 1
    let line = 1
    for (let cursor = 0; cursor < lineStart; cursor += 1) {
      if (value.charCodeAt(cursor) === 10) line += 1
    }
    return { line, column: position - lineStart + 1 }
  }

  function notifyCursor() {
    const { line, column } = lineColumn()
    ctx.onCursorChange?.(line, column)
  }

  function emitInput() {
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** 在当前选区插入文本（优先 execCommand，保留原生撤销栈） */
  function insertTextAtSelection(text) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    let inserted = false
    try {
      if (typeof document.execCommand === 'function') {
        inserted = document.execCommand('insertText', false, text)
      }
    } catch (error) {
      console.warn('[MoDex] execCommand 插入失败，使用兜底方案', error)
    }
    if (!inserted) {
      textarea.setRangeText(text, start, end, 'end')
      emitInput()
    }
    updateCursorSoon()
  }

  /** 整段替换内容（用于 Tab / 反缩进），并保持选区 */
  function replaceValue(nextValue, selectionStart, selectionEnd) {
    textarea.value = nextValue
    textarea.setSelectionRange(selectionStart, selectionEnd)
    emitInput()
    updateCursorSoon()
  }

  function updateCursorSoon() {
    notifyCursor()
    requestAnimationFrame(notifyCursor)
  }

  // -------------------------------------------------------------------------
  // 快捷包裹
  // -------------------------------------------------------------------------

  function wrapSelection(prefix, suffix, placeholder) {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = textarea.value.slice(start, end) || placeholder
    insertTextAtSelection(prefix + selected + suffix)
    const innerStart = start + prefix.length
    textarea.setSelectionRange(innerStart, innerStart + selected.length)
    updateCursorSoon()
  }

  function insertLink() {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = textarea.value.slice(start, end) || '链接文字'
    const placeholder = 'url'
    insertTextAtSelection(`[${selected}](${placeholder})`)
    const urlStart = start + 1 + selected.length + 2
    textarea.setSelectionRange(urlStart, urlStart + placeholder.length)
    updateCursorSoon()
  }

  // -------------------------------------------------------------------------
  // Tab 缩进
  // -------------------------------------------------------------------------

  function handleTab(shiftKey) {
    const value = textarea.value
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selection = value.slice(start, end)
    const lineStart = value.lastIndexOf('\n', start - 1) + 1

    if (!shiftKey) {
      if (!selection.includes('\n')) {
        insertTextAtSelection('  ')
        return
      }
      const nextBreak = value.indexOf('\n', end)
      const blockEnd = nextBreak < 0 ? value.length : nextBreak
      const block = value.slice(lineStart, blockEnd)
      const lines = block.split('\n')
      const nextBlock = lines.map((line) => `  ${line}`).join('\n')
      replaceValue(
        value.slice(0, lineStart) + nextBlock + value.slice(blockEnd),
        start + 2,
        end + lines.length * 2
      )
      return
    }

    // Shift+Tab：删除缩进，使缩进回到 2 的倍数
    if (!selection.includes('\n')) {
      const indent = /^ */.exec(value.slice(lineStart))[0].length
      if (indent === 0) return
      const remove = indent % 2 === 0 ? Math.min(2, indent) : indent % 2
      replaceValue(
        value.slice(0, lineStart) + value.slice(lineStart + remove),
        Math.max(lineStart, start - remove),
        Math.max(lineStart, end - remove)
      )
      return
    }

    const nextBreak = value.indexOf('\n', end)
    const blockEnd = nextBreak < 0 ? value.length : nextBreak
    const lines = value.slice(lineStart, blockEnd).split('\n')
    let firstRemoved = 0
    let totalRemoved = 0
    const nextLines = lines.map((line, index) => {
      const indent = /^ */.exec(line)[0].length
      if (indent === 0) return line
      const remove = indent % 2 === 0 ? Math.min(2, indent) : indent % 2
      if (index === 0) firstRemoved = remove
      totalRemoved += remove
      return line.slice(remove)
    })
    replaceValue(
      value.slice(0, lineStart) + nextLines.join('\n') + value.slice(blockEnd),
      Math.max(lineStart, start - firstRemoved),
      Math.max(lineStart, end - totalRemoved)
    )
  }

  // -------------------------------------------------------------------------
  // 列表自动续写
  // -------------------------------------------------------------------------

  function detectListPrefix(line) {
    let match = /^(\s*)([-*+])\s+\[[ xX]\]\s+/.exec(line)
    if (match) {
      return {
        prefix: `${match[1]}${match[2]} [ ] `,
        content: line.slice(match[0].length),
      }
    }
    match = /^(\s*)([-*+])\s+/.exec(line)
    if (match) return { prefix: `${match[1]}${match[2]} `, content: line.slice(match[0].length) }
    match = /^(\s*)(\d+)\.\s+/.exec(line)
    if (match) {
      return {
        prefix: `${match[1]}${Number(match[2]) + 1}. `,
        content: line.slice(match[0].length),
      }
    }
    match = /^(\s*)>\s?/.exec(line)
    if (match) return { prefix: `${match[1]}> `, content: line.slice(match[0].length) }
    return null
  }

  function handleEnter(event) {
    const value = textarea.value
    const start = textarea.selectionStart
    if (start !== textarea.selectionEnd) return
    if (insideFence(value, start)) return
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const line = value.slice(lineStart, start)
    const info = detectListPrefix(line)
    if (!info) return
    event.preventDefault()
    if (!info.content.trim()) {
      // 空列表项：回车退出列表，仅保留缩进
      const indent = /^\s*/.exec(line)[0]
      replaceValue(
        value.slice(0, lineStart) + indent + value.slice(start),
        lineStart + indent.length,
        lineStart + indent.length
      )
      return
    }
    insertTextAtSelection(`\n${info.prefix}`)
  }

  // -------------------------------------------------------------------------
  // 查找栏
  // -------------------------------------------------------------------------

  function updateFindCount() {
    if (!findCount) return
    const total = find.matches.length
    findCount.textContent = total > 0 && find.index >= 0 ? `${find.index + 1}/${total}` : `0/${total}`
  }

  function scrollMatchIntoView(match) {
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24
    const before = textarea.value.slice(0, match.start)
    const line = before.split('\n').length - 1
    const target = line * lineHeight - textarea.clientHeight / 2
    const max = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
    textarea.scrollTop = clamp(target, 0, max)
  }

  function applyFindSelection({ scroll = true } = {}) {
    const match = find.matches[find.index]
    if (!match) return
    textarea.setSelectionRange(match.start, match.end)
    if (scroll) scrollMatchIntoView(match)
    updateFindCount()
  }

  function refreshFind({ select = false } = {}) {
    if (!findbar || findbar.hidden) return
    find.query = findInput ? findInput.value : ''
    find.matches = collectMatches(textarea.value, find.query)
    if (find.matches.length === 0) {
      find.index = -1
    } else if (find.index < 0) {
      const cursor = textarea.selectionStart
      const next = find.matches.findIndex((match) => match.start >= cursor)
      find.index = next >= 0 ? next : 0
    } else {
      find.index = Math.min(find.index, find.matches.length - 1)
    }
    updateFindCount()
    if (select) applyFindSelection()
  }

  function stepFind(delta) {
    refreshFind()
    if (find.matches.length === 0) return
    find.index = (find.index + delta + find.matches.length) % find.matches.length
    applyFindSelection()
  }

  function openFind() {
    if (!findbar || !findInput) return
    const hadSelection =
      textarea.selectionStart !== textarea.selectionEnd &&
      !textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).includes('\n')
    if (findbar.hidden) {
      findbar.hidden = false
      if (hadSelection) findInput.value = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
      else if (!findInput.value) findInput.value = ''
    }
    find.index = -1
    findInput.focus()
    findInput.select()
    refreshFind({ select: true })
  }

  function closeFind() {
    if (!findbar) return
    findbar.hidden = true
    find.matches = []
    find.index = -1
    updateFindCount()
    textarea.focus({ preventScroll: true })
    notifyCursor()
  }

  function bindFindBar() {
    if (!findbar) return
    findInput?.addEventListener('input', () => {
      find.index = -1
      refreshFind({ select: true })
    })
    findInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        stepFind(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        closeFind()
      }
    })
    findPrev?.addEventListener('click', () => stepFind(-1))
    findNext?.addEventListener('click', () => stepFind(1))
    findClose?.addEventListener('click', closeFind)
    // 避免点击按钮时输入框失焦导致后续 Enter 失效
    for (const button of [findPrev, findNext, findClose]) {
      button?.addEventListener('pointerdown', (event) => event.preventDefault())
    }
  }

  // -------------------------------------------------------------------------
  // 滚动同步
  // -------------------------------------------------------------------------

  function getScrollRatio() {
    const max = textarea.scrollHeight - textarea.clientHeight
    return max > 0 ? textarea.scrollTop / max : 0
  }

  function setScrollRatio(ratio) {
    if (syncing) return
    syncing = true
    const max = textarea.scrollHeight - textarea.clientHeight
    if (max > 0) textarea.scrollTop = clamp(Number(ratio) || 0, 0, 1) * max
    // 连续两帧后再解除，确保程序滚动产生的事件被忽略
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncing = false
      })
    })
  }

  // -------------------------------------------------------------------------
  // 事件绑定
  // -------------------------------------------------------------------------

  textarea.addEventListener('input', () => {
    if (silent) return
    ctx.onContentChange?.(textarea.value)
    notifyCursor()
    if (findbar && !findbar.hidden) refreshFind()
  })

  textarea.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.altKey) {
      switch (event.key.toLowerCase()) {
        case 'b':
          event.preventDefault()
          wrapSelection('**', '**', '粗体文字')
          return
        case 'i':
          event.preventDefault()
          wrapSelection('*', '*', '斜体文字')
          return
        case 'k':
          event.preventDefault()
          insertLink()
          return
        case '`':
          event.preventDefault()
          wrapSelection('`', '`', '行内代码')
          return
        default:
          break
      }
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      handleTab(event.shiftKey)
      return
    }
    if (event.key === 'Enter') {
      handleEnter(event)
      return
    }
    if (event.key === 'Escape' && findbar && !findbar.hidden) {
      event.preventDefault()
      closeFind()
    }
  })

  for (const type of ['keyup', 'mouseup', 'click', 'focus']) {
    textarea.addEventListener(type, notifyCursor)
  }

  textarea.addEventListener('scroll', () => {
    if (syncing) return
    ctx.onEditorScroll?.(getScrollRatio())
  })

  bindFindBar()

  // -------------------------------------------------------------------------
  // 对外控制器
  // -------------------------------------------------------------------------

  return {
    setContent(text) {
      silent = true
      textarea.value = String(text ?? '')
      textarea.setSelectionRange(0, 0)
      textarea.scrollTop = 0
      silent = false
      if (findbar && !findbar.hidden) closeFind()
      notifyCursor()
    },
    getContent: () => textarea.value,
    focus: () => {
      try {
        textarea.focus({ preventScroll: true })
      } catch {
        textarea.focus()
      }
    },
    openFind,
    closeFind,
    isFindOpen: () => Boolean(findbar && !findbar.hidden),
    setScrollRatio,
    getScrollRatio,
    getCursor: lineColumn,
    getFindInfo: () => ({ total: find.matches.length, index: find.index, query: find.query }),
  }
}
