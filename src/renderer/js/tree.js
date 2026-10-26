/**
 * 文件树模块（多根工作区，Codex 项目列表风格）。
 * 职责：多文件夹根（添加/移除/激活/展开折叠）、按需加载目录、当前文件高亮、
 * 行内新建/重命名、根级与嵌套右键菜单、删除确认、按根刷新。
 * e2e 约定：
 * - 根行：ul#tree > li.tree-item[data-root="true"][data-path][data-type="dir"]；
 * - 子节点：.tree-children 内的 li.tree-item[data-path][data-type="file"|"dir"]；
 * - 展开状态 data-expanded="true"；右键菜单项 li[data-menu-action]。
 */

import {
  $,
  el,
  validateName,
  resolveMarkdownName,
  normalizeForCompare,
  isSameOrInside,
} from './util.js'
import { icons } from './icons.js'

const MAX_ROOTS = 12

export function initTree(ctx = {}) {
  const api = window.api
  const treeEl = $('#tree')
  const treeScroll = $('#tree-scroll')
  const emptyState = $('#sidebar-empty')
  const rootLabel = $('#sidebar-root')
  if (!treeEl) throw new Error('缺少 #tree 元素')

  /** @type {Array<{ path: string }>} 根文件夹，顺序即侧栏顺序 */
  const roots = []
  const rootSet = new Set()
  let activeRoot = null

  const cache = new Map()
  const index = new Map()
  const expanded = new Set()
  const selection = { path: null, isDirectory: false }
  let currentPath = null
  let inline = null
  let committing = false
  let refreshing = false

  const norm = (value) => normalizeForCompare(value)

  // -------------------------------------------------------------------------
  // 根辅助
  // -------------------------------------------------------------------------

  function rootExists(path) {
    return Boolean(path) && rootSet.has(norm(path))
  }

  function actualRootPath(path) {
    const target = norm(path)
    const found = roots.find((root) => norm(root.path) === target)
    return found ? found.path : null
  }

  /** 返回 path 所属的最具体根（支持根之间嵌套的防御场景） */
  function rootOfPath(path) {
    if (!path) return null
    let best = null
    for (const root of roots) {
      if (!isSameOrInside(path, root.path)) continue
      if (!best || root.path.length > best.length) best = root.path
    }
    return best
  }

  function rootName(path) {
    try {
      return api.basename(path)
    } catch (error) {
      return path
    }
  }

  function normalizePaths(list) {
    const result = []
    if (!Array.isArray(list)) return result
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const path = raw.trim()
      if (!path) continue
      if (result.some((item) => norm(item) === norm(path))) continue
      result.push(path)
      if (result.length >= MAX_ROOTS) break
    }
    return result
  }

  // -------------------------------------------------------------------------
  // 数据加载
  // -------------------------------------------------------------------------

  function rebuildIndex() {
    index.clear()
    for (const entries of cache.values()) {
      for (const entry of entries) index.set(norm(entry.path), entry)
    }
  }

  function findEntry(path) {
    return index.get(norm(path)) || null
  }

  async function loadDir(dirPath) {
    const isRoot = rootExists(dirPath)
    try {
      const result = await api.listDir(dirPath)
      if (!result || !result.ok) {
        if (result?.code !== 'ENOENT') {
          ctx.toast?.(
            `${isRoot ? '读取文件夹' : '读取目录'}失败：${result?.error || '未知错误'}`,
            'error'
          )
        }
        cache.delete(dirPath)
        rebuildIndex()
        if (!isRoot) expanded.delete(dirPath)
        return false
      }
      cache.set(dirPath, Array.isArray(result.entries) ? result.entries : [])
      rebuildIndex()
      return true
    } catch (error) {
      ctx.toast?.(`读取目录失败：${error?.message || error}`, 'error')
      return false
    }
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  function emptyRow(text, depth = 0) {
    const item = el('li', { className: 'tree-empty', text })
    item.style.setProperty('--depth', String(depth))
    return item
  }

  function buildRow(entry, depth) {
    const row = el('div', { className: 'tree-row', dataset: { path: entry.path } })
    row.style.setProperty('--depth', String(depth))
    const twisty = el('span', {
      className: `tree-twisty${entry.isDirectory ? (expanded.has(entry.path) ? ' expanded' : '') : ' leaf'}`,
      html: entry.isDirectory ? icons.chevron : '',
    })
    row.append(twisty)
    const iconHtml = entry.isDirectory
      ? expanded.has(entry.path)
        ? icons.folderOpen
        : icons.folder
      : entry.isMarkdown
        ? icons.fileMd
        : icons.file
    row.append(el('span', { className: 'tree-icon', html: iconHtml }))
    row.append(el('span', { className: 'tree-label', text: entry.name, title: entry.path }))
    if (entry.isMarkdown) row.append(el('span', { className: 'tree-badge', text: 'MD' }))
    if (entry.hidden) row.classList.add('is-hidden')
    if (entry.isMarkdown) row.classList.add('is-markdown')
    if (norm(entry.path) === norm(currentPath)) row.classList.add('is-active')
    if (norm(entry.path) === norm(selection.path)) row.classList.add('is-selected')
    return row
  }

  function renderInlineRow(depth) {
    const isRename = inline.kind === 'rename'
    const row = el('div', { className: 'tree-row tree-row-inline' })
    row.style.setProperty('--depth', String(depth))
    const iconHtml = isRename
      ? icons.rename
      : inline.createKind === 'file'
        ? icons.fileMd
        : icons.folder
    row.append(el('span', { className: 'tree-icon', html: iconHtml }))
    const input = el('input', {
      className: 'tree-input',
      type: 'text',
      spellcheck: false,
      value: inline.value,
      placeholder: isRename
        ? '新名称'
        : inline.createKind === 'file'
          ? '文件名.md'
          : '文件夹名',
      'aria-label': isRename ? '重命名' : '新建名称',
    })
    input.addEventListener('input', () => {
      if (inline) {
        inline.value = input.value
        inline.caret = input.selectionStart
      }
    })
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        void commitInline(input.value)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelInline()
      }
    })
    input.addEventListener('blur', () => {
      // 仅在「后台刷新重建输入框」时保留行内编辑；用户点击别处导致的 blur 仍按原行为取消。
      const duringRefresh = refreshing
      setTimeout(() => {
        if (duringRefresh) return
        if (inline && !committing) cancelInline()
      }, 0)
    })
    if (Number.isInteger(inline.caret)) {
      try {
        input.setSelectionRange(inline.caret, inline.caret)
      } catch {
        /* 输入框尚未挂载时忽略 */
      }
    }
    row.append(input)
    const item = el('li', { className: 'tree-item tree-inline' })
    item.append(row)
    return item
  }

  function renderItem(entry, depth) {
    const item = el('li', {
      className: 'tree-item',
      role: 'treeitem',
      dataset: { path: entry.path, type: entry.isDirectory ? 'dir' : 'file' },
    })
    const row = buildRow(entry, depth)
    item.append(row)
    if (entry.isDirectory && expanded.has(entry.path)) {
      item.dataset.expanded = 'true'
      row.dataset.expanded = 'true'
      row.setAttribute('aria-expanded', 'true')
    } else if (entry.isDirectory) {
      row.setAttribute('aria-expanded', 'false')
    }
    return item
  }

  /** 在某个容器内扁平渲染子树（层级通过 --depth 缩进表现） */
  function renderFlat(container, dirPath, depth) {
    const entries = cache.get(dirPath)
    const hasInlineCreate =
      inline &&
      inline.kind === 'create' &&
      norm(inline.parentPath) === norm(dirPath)
    if (hasInlineCreate) container.append(renderInlineRow(depth))
    if (!entries) {
      container.append(emptyRow('加载中…', depth))
      return
    }
    for (const entry of entries) {
      if (
        inline &&
        inline.kind === 'rename' &&
        norm(inline.targetPath) === norm(entry.path)
      ) {
        container.append(renderInlineRow(depth))
        continue
      }
      container.append(renderItem(entry, depth))
      if (entry.isDirectory && expanded.has(entry.path)) {
        if (cache.has(entry.path)) renderFlat(container, entry.path, depth + 1)
        else container.append(emptyRow('加载中…', depth + 1))
      }
    }
    if (entries.length === 0 && !hasInlineCreate) container.append(emptyRow('空文件夹', depth))
  }

  function renderRoot(root) {
    const rootPath = root.path
    const isExpanded = expanded.has(rootPath)
    const isActiveRoot = Boolean(activeRoot) && norm(activeRoot) === norm(rootPath)
    const item = el('li', {
      className: 'tree-item root-item',
      role: 'treeitem',
      dataset: { path: rootPath, type: 'dir', root: 'true' },
    })
    if (isActiveRoot) {
      item.classList.add('is-active')
      item.dataset.active = 'true'
    }
    if (isExpanded) item.dataset.expanded = 'true'

    const row = el('div', {
      className: `tree-row root-row${isActiveRoot ? ' is-active' : ''}`,
      dataset: { path: rootPath },
    })
    row.style.setProperty('--depth', '0')
    const twisty = el('span', {
      className: `tree-twisty${isExpanded ? ' expanded' : ''}`,
      html: icons.chevron,
    })
    row.append(twisty)
    row.append(
      el('span', {
        className: 'tree-icon',
        html: isExpanded ? icons.folderOpen : icons.folder,
      })
    )
    row.append(el('span', { className: 'tree-label', text: rootName(rootPath), title: rootPath }))
    const actions = el('span', { className: 'root-actions' })
    actions.append(
      el('button', {
        type: 'button',
        text: '＋',
        title: '在此文件夹新建 Markdown',
        dataset: { rootAction: 'new-file' },
      }),
      el('button', {
        type: 'button',
        text: '···',
        title: '更多操作',
        dataset: { rootAction: 'menu' },
      })
    )
    row.append(actions)
    item.append(row)
    if (isExpanded) {
      row.setAttribute('aria-expanded', 'true')
    } else {
      row.setAttribute('aria-expanded', 'false')
    }
    return item
  }

  /**
   * 渲染全部根：根行是 ul#tree 的直接子节点，展开后的子节点紧随其后平铺为兄弟节点
   * （保留 e2e 约定 ul#tree > li.tree-item[data-path][data-type] 与根行 descendant 选择器）。
   */
  function render() {
    treeEl.replaceChildren()
    for (const root of roots) {
      treeEl.append(renderRoot(root))
      if (expanded.has(root.path)) renderFlat(treeEl, root.path, 1)
    }
  }

  /** 同步侧栏外壳（空状态 / 底部计数）并通知 app 持久化 */
  function syncRootChrome() {
    const count = roots.length
    const hasRoots = count > 0
    if (treeScroll) treeScroll.hidden = !hasRoots
    if (emptyState) emptyState.hidden = hasRoots
    if (rootLabel) {
      rootLabel.textContent = hasRoots ? `共 ${count} 个文件夹` : ''
      rootLabel.title = hasRoots ? activeRoot || roots[0].path : ''
    }
    ctx.onRootsChange?.({
      rootFolders: roots.map((root) => root.path),
      activeFolder: activeRoot,
    })
  }

  function updateActiveRows() {
    for (const row of treeEl.querySelectorAll('.tree-row[data-path]')) {
      if (row.classList.contains('root-row')) continue
      row.classList.toggle('is-active', norm(row.dataset.path) === norm(currentPath))
    }
  }

  function updateRootActiveClasses() {
    for (const row of treeEl.querySelectorAll('.root-row')) {
      const active = Boolean(activeRoot) && norm(row.dataset.path) === norm(activeRoot)
      row.classList.toggle('is-active', active)
      const item = row.closest('.root-item')
      if (item) item.classList.toggle('is-active', active)
    }
  }

  function updateSelectionClasses() {
    for (const row of treeEl.querySelectorAll('.tree-row[data-path]')) {
      row.classList.toggle(
        'is-selected',
        norm(row.dataset.path) === norm(selection.path)
      )
    }
  }

  // -------------------------------------------------------------------------
  // 根管理
  // -------------------------------------------------------------------------

  function clearExpandedState() {
    expanded.clear()
    for (const root of roots) expanded.add(root.path)
  }

  function purgeUnder(targetPath) {
    for (const dir of [...cache.keys()]) {
      if (isSameOrInside(dir, targetPath)) cache.delete(dir)
    }
    for (const dir of [...expanded]) {
      if (isSameOrInside(dir, targetPath)) expanded.delete(dir)
    }
    if (
      inline &&
      isSameOrInside(inline.parentPath || inline.targetPath || '', targetPath)
    ) {
      inline = null
    }
    if (selection.path && isSameOrInside(selection.path, targetPath)) {
      selection.path = null
      selection.isDirectory = false
    }
    rebuildIndex()
  }

  /** 用给定列表替换全部根（启动恢复 / __qm.openRoots） */
  async function setRoots(paths, preferredActive = null) {
    const list = normalizePaths(paths)
    roots.length = 0
    rootSet.clear()
    cache.clear()
    index.clear()
    expanded.clear()
    inline = null
    selection.path = null
    selection.isDirectory = false
    for (const path of list) {
      roots.push({ path })
      rootSet.add(norm(path))
      expanded.add(path)
    }
    if (preferredActive && rootExists(preferredActive)) {
      activeRoot = rootExists(preferredActive) ? actualRootPath(preferredActive) : null
    } else {
      activeRoot = roots.length > 0 ? roots[0].path : null
    }
    syncRootChrome()
    render()
    const results = await Promise.all(
      roots.map(async (root) => ({ root, ok: await loadDir(root.path) }))
    )
    const failed = results.filter((item) => !item.ok)
    if (failed.length > 0) {
      const failedSet = new Set(failed.map((item) => norm(item.root.path)))
      for (let i = roots.length - 1; i >= 0; i -= 1) {
        if (failedSet.has(norm(roots[i].path))) roots.splice(i, 1)
      }
      rootSet.clear()
      for (const root of roots) rootSet.add(norm(root.path))
      for (const key of failedSet) {
        if (activeRoot && norm(activeRoot) === key) activeRoot = null
      }
      if (!activeRoot && roots.length > 0) activeRoot = roots[0].path
      clearExpandedState()
      for (const dir of failedSet) cache.delete(dir)
      rebuildIndex()
    }
    // 根目录加载完成后重绘（首次 render 只显示加载占位）
    render()
    syncRootChrome()
    return roots.map((root) => root.path)
  }

  /** 添加一个根；已存在则展开并激活 */
  async function addRoot(path) {
    const next = typeof path === 'string' ? path.trim() : ''
    if (!next) return false
    if (rootExists(next)) {
      const actual = actualRootPath(next)
      expanded.add(actual)
      activeRoot = actual
      if (!cache.has(actual)) {
        const ok = await loadDir(actual)
        if (!ok) return false
      }
      render()
      syncRootChrome()
      return true
    }
    if (roots.length >= MAX_ROOTS) {
      ctx.toast?.(`最多同时打开 ${MAX_ROOTS} 个文件夹`, 'error')
      return false
    }
    roots.push({ path: next })
    rootSet.add(norm(next))
    expanded.add(next)
    activeRoot = next
    syncRootChrome()
    render()
    const ok = await loadDir(next)
    if (!ok) {
      const index = roots.findIndex((root) => norm(root.path) === norm(next))
      if (index >= 0) roots.splice(index, 1)
      rootSet.delete(norm(next))
      purgeUnder(next)
      cache.delete(next)
      if (activeRoot && norm(activeRoot) === norm(next)) {
        activeRoot = roots.length > 0 ? roots[0].path : null
      }
      render()
      syncRootChrome()
      return false
    }
    render()
    syncRootChrome()
    return true
  }

  /** 从列表移除根（不删除磁盘内容；当前文档保持打开） */
  function removeRoot(path) {
    const actual = actualRootPath(path)
    if (!actual) return false
    const index = roots.findIndex((root) => norm(root.path) === norm(actual))
    if (index < 0) return false
    roots.splice(index, 1)
    rootSet.delete(norm(actual))
    purgeUnder(actual)
    if (activeRoot && norm(activeRoot) === norm(actual)) {
      activeRoot = roots.length > 0 ? roots[0].path : null
    }
    if (!expanded.size && roots.length > 0) clearExpandedState()
    render()
    syncRootChrome()
    return true
  }

  function setActiveRoot(path) {
    const actual = actualRootPath(path)
    if (!actual) return false
    if (activeRoot && norm(activeRoot) === norm(actual)) return true
    activeRoot = actual
    updateRootActiveClasses()
    syncRootChrome()
    return true
  }

  async function toggleRoot(path) {
    const actual = actualRootPath(path)
    if (!actual) return
    activeRoot = actual
    if (expanded.has(actual)) {
      expanded.delete(actual)
    } else {
      expanded.add(actual)
      if (!cache.has(actual)) await loadDir(actual)
    }
    render()
    syncRootChrome()
  }

  // -------------------------------------------------------------------------
  // 展开 / 折叠与打开
  // -------------------------------------------------------------------------

  async function toggleDir(entry) {
    if (expanded.has(entry.path)) {
      expanded.delete(entry.path)
      render()
      return
    }
    expanded.add(entry.path)
    selection.path = entry.path
    selection.isDirectory = true
    render()
    if (!cache.has(entry.path)) {
      await loadDir(entry.path)
      render()
    }
  }

  function onTreeClick(event) {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    // 根行 hover 操作：＋新建文件 / ···更多
    const actionButton = target.closest('[data-root-action]')
    if (actionButton) {
      event.preventDefault()
      event.stopPropagation()
      const rootRow = actionButton.closest('.root-row')
      const rootPath = rootRow ? rootRow.dataset.path : null
      if (!rootPath) return
      if (actionButton.dataset.rootAction === 'new-file') {
        startCreateAt('file', rootPath)
      } else {
        const rect = actionButton.getBoundingClientRect()
        openRootMenuAt(rect.left, rect.bottom + 2, rootPath)
      }
      return
    }

    const row = target.closest('.tree-row')
    if (!row || !row.dataset.path) return
    if (row.classList.contains('root-row')) {
      void toggleRoot(row.dataset.path)
      return
    }
    const entry = findEntry(row.dataset.path)
    if (!entry) return
    const owner = rootOfPath(entry.path)
    if (owner && (!activeRoot || norm(activeRoot) !== norm(owner))) {
      activeRoot = owner
      updateRootActiveClasses()
      syncRootChrome()
    }
    if (entry.isDirectory) {
      void toggleDir(entry)
      return
    }
    selection.path = entry.path
    selection.isDirectory = false
    updateSelectionClasses()
    void ctx.openTreeFile?.(entry.path)
  }

  // -------------------------------------------------------------------------
  // 行内新建 / 重命名
  // -------------------------------------------------------------------------

  function focusInlineInput({ selectBase = false, caret = null } = {}) {
    requestAnimationFrame(() => {
      const input = treeEl.querySelector('.tree-input')
      if (!input) return
      input.focus()
      if (Number.isInteger(caret)) {
        input.setSelectionRange(caret, caret)
      } else if (selectBase) {
        const value = input.value
        const dot = value.lastIndexOf('.')
        input.setSelectionRange(0, dot > 0 ? dot : value.length)
      } else {
        input.select()
      }
    })
  }

  function defaultCreateDir() {
    if (selection.path && selection.isDirectory && rootOfPath(selection.path)) {
      return selection.path
    }
    return activeRoot || (roots.length > 0 ? roots[0].path : null)
  }

  async function startCreate(kind, dirOverride = null) {
    const parentPath = dirOverride || defaultCreateDir()
    if (!parentPath) {
      ctx.toast?.('请先添加文件夹', 'error')
      return
    }
    const owner = rootOfPath(parentPath)
    if (!owner) return
    activeRoot = owner
    if (norm(owner) === norm(parentPath)) expanded.add(owner)
    else if (!expanded.has(parentPath)) expanded.add(parentPath)
    if (!cache.has(parentPath)) {
      const ok = await loadDir(parentPath)
      if (!ok) return
    }
    inline = { kind: 'create', createKind: kind, parentPath, value: '' }
    updateRootActiveClasses()
    syncRootChrome()
    render()
    focusInlineInput()
  }

  function startCreateAt(kind, dirPath) {
    selection.path = dirPath
    selection.isDirectory = true
    void startCreate(kind, dirPath)
  }

  function startRename(entry) {
    inline = {
      kind: 'rename',
      targetPath: entry.path,
      value: entry.name,
    }
    render()
    focusInlineInput({ selectBase: true })
  }

  function cancelInline() {
    if (!inline) return
    inline = null
    render()
  }

  function inlineFail(message) {
    committing = false
    ctx.toast?.(message, 'error')
    requestAnimationFrame(() => {
      const input = treeEl.querySelector('.tree-input')
      if (input) {
        input.focus()
        input.select()
      }
    })
  }

  async function commitInline(rawValue) {
    if (!inline || committing) return
    committing = true
    const currentInline = inline
    try {
      if (currentInline.kind === 'create') {
        let name = String(rawValue ?? '').trim()
        if (currentInline.createKind === 'file') {
          const resolved = resolveMarkdownName(name)
          if (!resolved.ok) return inlineFail(resolved.error)
          name = resolved.name
        } else {
          const valid = validateName(name)
          if (!valid.ok) return inlineFail(valid.error)
          name = valid.name
        }
        const result =
          currentInline.createKind === 'file'
            ? await api.createFile(currentInline.parentPath, name, '')
            : await api.createFolder(currentInline.parentPath, name)
        if (!result || !result.ok) return inlineFail(result?.error || '创建失败')
        inline = null
        committing = false
        await loadDir(currentInline.parentPath)
        expanded.add(currentInline.parentPath)
        if (currentInline.createKind === 'folder') {
          expanded.add(result.path)
          await loadDir(result.path)
        }
        render()
        ctx.toast?.(
          currentInline.createKind === 'file' ? '已创建文件' : '已创建文件夹',
          'success'
        )
        if (currentInline.createKind === 'file') await ctx.openTreeFile?.(result.path)
        return
      }

      const valid = validateName(rawValue)
      if (!valid.ok) return inlineFail(valid.error)
      const target = currentInline.targetPath
      const oldEntry = findEntry(target)
      const parentPath = oldEntry ? api.dirname(oldEntry.path) : api.dirname(target)
      if (oldEntry && valid.name === oldEntry.name) {
        inline = null
        committing = false
        render()
        return
      }
      const result = await api.rename(target, valid.name)
      if (!result || !result.ok) return inlineFail(result?.error || '重命名失败')
      inline = null
      committing = false
      if (currentPath && isSameOrInside(currentPath, target)) {
        currentPath =
          norm(currentPath) === norm(target)
            ? result.path
            : `${result.path}${currentPath.slice(target.length)}`
      }
      if (cache.has(parentPath)) await loadDir(parentPath)
      render()
      ctx.onRenamed?.(target, result.path, result.name)
      ctx.toast?.('已重命名', 'success')
    } catch (error) {
      inlineFail(`操作失败：${error?.message || error}`)
    } finally {
      committing = false
    }
  }

  // -------------------------------------------------------------------------
  // 右键菜单 / 删除
  // -------------------------------------------------------------------------

  async function deleteEntry(entry) {
    const allowed = await ctx.beforeDelete?.(entry.path)
    if (allowed === false) return
    let confirmed = false
    try {
      confirmed = await api.confirmDelete(entry.path)
    } catch (error) {
      ctx.toast?.(`删除确认失败：${error?.message || error}`, 'error')
      return
    }
    if (!confirmed) return
    try {
      const result = await api.remove(entry.path)
      if (!result || !result.ok) {
        ctx.toast?.(result?.error || '删除失败', 'error')
        return
      }
      purgeUnder(entry.path)
      if (currentPath && isSameOrInside(currentPath, entry.path)) currentPath = null
      const parentPath = api.dirname(entry.path)
      if (cache.has(parentPath)) await loadDir(parentPath)
      render()
      ctx.onDeleted?.(entry.path)
      ctx.toast?.(result.trashed ? '已移入回收站' : '已删除', 'success')
    } catch (error) {
      ctx.toast?.(`删除失败：${error?.message || error}`, 'error')
    }
  }

  async function copyPath(targetPath) {
    const ok = await ctx.copyText?.(targetPath)
    ctx.toast?.(ok ? '路径已复制' : '复制失败', ok ? 'success' : 'error')
  }

  /** 根行右键菜单（8 项：6 个动作 + 2 个分隔线） */
  function rootMenuItems(rootPath) {
    return [
      {
        label: '新建文件',
        icon: 'newFile',
        menuAction: 'tree:new-file',
        onSelect: () => startCreateAt('file', rootPath),
      },
      {
        label: '新建文件夹',
        icon: 'newFolder',
        menuAction: 'tree:new-folder',
        onSelect: () => startCreateAt('folder', rootPath),
      },
      { separator: true },
      {
        label: '刷新',
        icon: 'refresh',
        menuAction: 'tree:refresh',
        onSelect: () => void refresh(rootPath),
      },
      {
        label: '在资源管理器中显示',
        icon: 'reveal',
        menuAction: 'tree:reveal',
        onSelect: () => ctx.reveal?.(rootPath),
      },
      {
        label: '复制路径',
        icon: 'copy',
        menuAction: 'tree:copy-path',
        onSelect: () => void copyPath(rootPath),
      },
      { separator: true },
      {
        label: '从列表移除',
        icon: 'close',
        menuAction: 'tree:remove-root',
        onSelect: () => removeRoot(rootPath),
      },
    ]
  }

  function openRootMenuAt(x, y, rootPath) {
    const actual = actualRootPath(rootPath)
    if (!actual) return
    activeRoot = actual
    updateRootActiveClasses()
    syncRootChrome()
    ctx.showContextMenu?.(x, y, rootMenuItems(actual))
  }

  /** 嵌套目录/文件行菜单（保持既有 6 项） */
  function showMenuAt(x, y, entry, targetDir) {
    const items = []
    if (targetDir) {
      items.push(
        {
          label: '新建文件',
          icon: 'newFile',
          menuAction: 'tree:new-file',
          onSelect: () => startCreateAt('file', targetDir),
        },
        {
          label: '新建文件夹',
          icon: 'newFolder',
          menuAction: 'tree:new-folder',
          onSelect: () => startCreateAt('folder', targetDir),
        }
      )
    }
    if (entry) {
      items.push(
        { separator: true },
        {
          label: '重命名',
          icon: 'rename',
          menuAction: 'tree:rename',
          onSelect: () => startRename(entry),
        },
        {
          label: '删除',
          icon: 'trash',
          menuAction: 'tree:delete',
          danger: true,
          onSelect: () => deleteEntry(entry),
        },
        { separator: true },
        {
          label: '在资源管理器中显示',
          icon: 'reveal',
          menuAction: 'tree:reveal',
          onSelect: () => ctx.reveal?.(entry.path),
        },
        {
          label: '复制路径',
          icon: 'copy',
          menuAction: 'tree:copy-path',
          onSelect: () => void copyPath(entry.path),
        }
      )
    }
    ctx.showContextMenu?.(x, y, items)
  }

  function onTreeContextMenu(event) {
    event.preventDefault()
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    const row = target.closest('.tree-row')

    if (row && row.classList.contains('root-row')) {
      openRootMenuAt(event.clientX, event.clientY, row.dataset.path)
      return
    }

    if (!row || !row.dataset.path) {
      // 空白区域：仅提供刷新（无选中目标）
      if (roots.length > 0) {
        ctx.showContextMenu?.(event.clientX, event.clientY, [
          {
            label: '刷新全部',
            icon: 'refresh',
            menuAction: 'tree:refresh',
            onSelect: () => void refresh(),
          },
        ])
      }
      return
    }

    const entry = findEntry(row.dataset.path)
    if (!entry) return
    // 新建目标：选中目录优先；文件行无选中目录时回到该行所属根
    const targetDir = entry.isDirectory ? entry.path : rootOfPath(entry.path) || api.dirname(entry.path)
    selection.path = entry.path
    selection.isDirectory = entry.isDirectory
    updateSelectionClasses()
    showMenuAt(event.clientX, event.clientY, entry, targetDir)
  }

  // -------------------------------------------------------------------------
  // 刷新
  // -------------------------------------------------------------------------

  async function refresh(targetRoot = null) {
    if (roots.length === 0) return
    // 注意：不要在这里清空 inline —— 后台 fs.watch 刷新可能在用户行内新建/重命名输入到一半时触发。
    // refreshing 标记让「刷新重建输入框」导致的 blur 不取消行内编辑，refresh 结束后再恢复焦点/光标。
    const inlineWasFocused = Boolean(inline && treeEl.querySelector('.tree-input:focus'))
    const inlineCaret = inline && Number.isInteger(inline.caret) ? inline.caret : null
    const targetRoots = targetRoot
      ? roots.filter((root) => norm(root.path) === norm(targetRoot))
      : roots.slice()
    if (targetRoots.length === 0) return
    const dirs = new Set()
    for (const root of targetRoots) dirs.add(root.path)
    for (const dir of expanded) {
      if (cache.has(dir) && targetRoots.some((root) => isSameOrInside(dir, root.path))) {
        dirs.add(dir)
      }
    }
    refreshing = true
    try {
      await Promise.all([...dirs].map((dir) => loadDir(dir)))
      const missing = targetRoots.filter((root) => !cache.has(root.path))
      if (missing.length > 0) {
        for (const root of missing) removeRoot(root.path)
        ctx.toast?.('部分文件夹已不可用', 'error')
        return
      }
      render()
    } finally {
      refreshing = false
    }
    // 刷新重建了输入框：若刷新前正在输入，恢复焦点与光标，用户可继续输入/回车提交
    if (inline && inlineWasFocused) focusInlineInput({ caret: inlineCaret })
  }

  function setCurrentFile(path) {
    currentPath = path || null
    if (inline) return
    updateActiveRows()
  }

  function getFileCount() {
    let count = 0
    for (const entries of cache.values()) {
      for (const entry of entries) {
        if (entry.isMarkdown && !entry.isDirectory) count += 1
      }
    }
    return count
  }

  treeEl.addEventListener('click', onTreeClick)
  treeEl.addEventListener('contextmenu', onTreeContextMenu)

  return {
    setRoots,
    addRoot,
    removeRoot,
    setActiveRoot,
    refresh,
    setCurrentFile,
    startCreate,
    getFileCount,
    getRoots: () => roots.map((root) => root.path),
    getActiveRoot: () => activeRoot,
    isRootOpen: () => roots.length > 0,
  }
}
