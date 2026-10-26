/**
 * MoDex渲染层入口：启动流程、全局状态、动作单点分发、快捷键、
 * 文档生命周期（新建/打开/保存/另存/关闭/未保存确认）、设置持久化、
 * 欢迎页最近列表、可拖拽布局与 window.__qm 测试钩子。
 */

import {
  $,
  $$,
  el,
  debounce,
  clamp,
  countWords,
  createToastSystem,
  createContextMenu,
  makeDragResizer,
  copyText,
  normalizeFontSize,
  isSameOrInside,
  isAbsolutePath,
  normalizeForCompare,
} from './util.js'
import { icons } from './icons.js'
import { initEditor } from './editor.js'
import { initPreview } from './preview.js'
import { initTree } from './tree.js'

const api = typeof window !== 'undefined' ? window.api : undefined

const DEFAULT_SETTINGS = {
  theme: 'system',
  viewMode: 'split',
  previewStyle: 'codex',
  sidebarVisible: true,
  sidebarWidth: 260,
  fontSize: 15,
  autoSave: false,
  lastFolder: null,
  lastFile: null,
  openFolders: [],
  activeFolder: null,
}
const MAX_ROOTS = 12
const VIEW_NAMES = { edit: '编辑', split: '分栏', preview: '预览' }
const SPLIT_STORAGE_KEY = 'qm:splitRatio'
const DOM_ACTIONS = {
  'toggle-sidebar': 'view:toggle-sidebar',
  'new-doc': 'file:new',
  'open-file': 'file:open',
  'open-folder': 'file:open-folder',
  save: 'file:save',
  'save-as': 'file:save-as',
  'view-edit': 'view:edit',
  'view-split': 'view:split',
  'view-preview': 'view:preview',
  'theme-toggle': 'view:theme-toggle',
  'new-file': 'tree:new-file',
  'new-folder': 'tree:new-folder',
  'refresh-tree': 'tree:refresh',
}

/**
 * 预览样式（与 docs/PREVIEW-STYLE-SPEC.md 固定 id/名称一一对应）。
 * codex 为默认 base 样式，其余样式由 styles.css 中 data-preview-style 作用域覆盖。
 */
const PREVIEW_STYLE_OPTIONS = [
  { id: 'codex', label: '当前 · Codex 极简' },
  { id: 'github', label: 'GitHub 文档风' },
  { id: 'vue', label: 'Vue 文档风' },
  { id: 'notion', label: 'Notion 极简风' },
  { id: 'feishu', label: '飞书云文档风' },
  { id: 'tailwind', label: 'Tailwind Typography' },
  { id: 'serif', label: '报刊衬线风' },
]
const PREVIEW_STYLE_IDS = new Set(PREVIEW_STYLE_OPTIONS.map((option) => option.id))

/**
 * 应用菜单定义（单条导航栏，内容与原生菜单一一对应，不新增功能）。
 * action：走既有 dispatch；command：走 api.runMenuCommand 原生能力。
 */
const APP_MENU_DEFS = [
  {
    id: 'file',
    label: '文件',
    items: [
      { label: '新建文档', hint: 'Ctrl+N', action: 'file:new' },
      { label: '打开文件…', hint: 'Ctrl+O', action: 'file:open' },
      { label: '添加文件夹…', action: 'file:open-folder' },
      { separator: true },
      { label: '保存', hint: 'Ctrl+S', action: 'file:save' },
      { label: '另存为…', hint: 'Ctrl+Shift+S', action: 'file:save-as' },
      { separator: true },
      { label: '关闭文档', hint: 'Ctrl+W', action: 'file:close' },
      { separator: true },
      { label: '退出', hint: 'Alt+F4', command: 'app:quit' },
    ],
  },
  {
    id: 'edit',
    label: '编辑',
    items: [
      { label: '撤销', hint: 'Ctrl+Z', command: 'undo' },
      { label: '重做', hint: 'Ctrl+Y', command: 'redo' },
      { separator: true },
      { label: '剪切', hint: 'Ctrl+X', command: 'cut' },
      { label: '复制', hint: 'Ctrl+C', command: 'copy' },
      { label: '粘贴', hint: 'Ctrl+V', command: 'paste' },
      { label: '全选', hint: 'Ctrl+A', command: 'selectAll' },
      { separator: true },
      { label: '查找…', hint: 'Ctrl+F', action: 'edit:find' },
    ],
  },
  {
    id: 'view',
    label: '视图',
    items: [
      { label: '编辑模式', hint: 'Ctrl+1', action: 'view:edit' },
      { label: '分栏模式', hint: 'Ctrl+2', action: 'view:split' },
      { label: '预览模式', hint: 'Ctrl+3', action: 'view:preview' },
      { separator: true },
      { label: '显示/隐藏侧栏', hint: 'Ctrl+Shift+E', action: 'view:toggle-sidebar' },
      { label: '切换浅色/深色主题', hint: 'Ctrl+Shift+T', action: 'view:theme-toggle' },
      { separator: true },
      { label: '放大字号', hint: 'Ctrl+=', action: 'view:zoom-in' },
      { label: '缩小字号', hint: 'Ctrl+-', action: 'view:zoom-out' },
      { label: '重置字号', hint: 'Ctrl+0', action: 'view:zoom-reset' },
      { separator: true },
      { label: '预览样式', hasSubmenu: true, menuKey: 'preview-style' },
      { label: '全屏', command: 'togglefullscreen' },
      { label: '开发者工具', hint: 'F12', command: 'toggleDevTools' },
    ],
  },
  {
    id: 'help',
    label: '帮助',
    items: [
      { label: '键盘快捷键', command: 'help:shortcuts' },
      { label: '关于 MoDex', command: 'help:about' },
    ],
  },
]

const state = {
  settings: { ...DEFAULT_SETTINGS },
  paths: {},
  appVersion: '1.0.0',
  doc: null,
  rootFolders: [],
  activeFolder: null,
  viewMode: 'split',
  previewStyle: 'codex',
  theme: 'light',
  sidebarVisible: true,
  splitRatio: 0.5,
  wordCount: 0,
  recentFiles: [],
  recentFolders: [],
}
const ui = {}
let appEl = null
let editor = null
let preview = null
let tree = null
let toast = null
let menus = null
let appMenus = null
let appMenuOpenKind = null
let lastClosedAppMenu = { kind: '', at: 0 }
let appSubmenuOpen = false
let watchedRootsKey = ''
let pendingTreeRoots = new Set()
let lastReportedDirty = null
let autoSaveWarned = false
let lastAction = { name: '', at: 0 }
let settingsPatch = {}
let readyResolve = null
const ready = new Promise((resolve) => {
  readyResolve = resolve
})

// ---------------------------------------------------------------------------
// 模块间上下文（editor / preview / tree 通过它回传事件）
// ---------------------------------------------------------------------------

const ctx = {
  toast: (message, type = 'info') => toast?.show(message, type),
  showContextMenu: (x, y, items) => {
    closeAppMenu()
    menus?.open(x, y, items)
  },
  copyText,
  onContentChange: handleContentChange,
  onCursorChange: (line, column) => {
    if (ui.statusPos) ui.statusPos.textContent = `行 ${line}, 列 ${column}`
  },
  onEditorScroll: (ratio) => {
    if (state.viewMode === 'split') preview?.setScrollRatio(ratio)
  },
  onPreviewScroll: (ratio) => {
    if (state.viewMode === 'split') editor?.setScrollRatio(ratio)
  },
  openTreeFile: (path) => loadFilePath(path),
  openLinkedFile: (path) => loadFilePath(path),
  openExternal: async (url) => {
    try {
      const result = await api.openExternal(url)
      if (result && result.ok === false) toast?.error(result.error || '无法打开外部链接')
    } catch (error) {
      toast?.error(`无法打开链接：${error?.message || error}`)
    }
  },
  reveal: async (targetPath) => {
    try {
      await api.revealInExplorer(targetPath)
    } catch (error) {
      toast?.error(`打开资源管理器失败：${error?.message || error}`)
    }
  },
  beforeDelete: handleBeforeDelete,
  onRenamed: handleRenamed,
  onDeleted: handleDeleted,
  onRootsChange: (payload) => handleRootsChange(payload),
}

// ---------------------------------------------------------------------------
// 外观：主题 / 视图 / 侧栏 / 字号 / 分栏比例
// ---------------------------------------------------------------------------

function resolveTheme(preference) {
  if (preference === 'dark' || preference === 'light') return preference
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function applyTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light'
  state.theme = resolved
  if (appEl) appEl.dataset.theme = resolved
  if (ui.themeIcon) ui.themeIcon.innerHTML = resolved === 'dark' ? icons.sun : icons.moon
  if (ui.themeButton) {
    const label = resolved === 'dark' ? '切换到浅色主题 (Ctrl+Shift+T)' : '切换到深色主题 (Ctrl+Shift+T)'
    ui.themeButton.title = label
    ui.themeButton.setAttribute('aria-label', label)
  }
}

/** 应用预览样式（仅影响预览区，见 styles.css 末尾 7 套作用域样式） */
function applyPreviewStyle(style) {
  const next = PREVIEW_STYLE_IDS.has(style) ? style : 'codex'
  state.previewStyle = next
  state.settings.previewStyle = next
  if (appEl) appEl.dataset.previewStyle = next
  // 同步二级菜单的 ✓ 与 data-checked（菜单隐藏时也保持 DOM 状态正确）
  buildAppPreviewSubmenu()
}

/**
 * 选择预览样式：应用 + 持久化（用户菜单选择与 __qm 钩子共用）。
 * @param {string} style
 * @param {{persist?: boolean, notify?: boolean}} options
 */
function selectPreviewStyle(style, { persist = true, notify = true } = {}) {
  if (!PREVIEW_STYLE_IDS.has(style)) return false
  applyPreviewStyle(style)
  if (persist) persistSettings({ previewStyle: style })
  if (notify) {
    const option = PREVIEW_STYLE_OPTIONS.find((item) => item.id === style)
    toast?.success(`已切换到「${option ? option.label : style}」`)
  }
  return true
}

function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  persistSettings({ theme: next })
}

function applyViewMode() {
  if (appEl) appEl.dataset.view = state.viewMode
  if (ui.statusMode) ui.statusMode.textContent = VIEW_NAMES[state.viewMode] || '分栏'
}

function setViewMode(mode, { persist = true } = {}) {
  if (!VIEW_NAMES[mode]) return
  state.viewMode = mode
  applyViewMode()
  if (persist) persistSettings({ viewMode: mode })
}

function applySidebar() {
  if (appEl) appEl.dataset.sidebar = state.sidebarVisible ? 'visible' : 'hidden'
  const button = $('[data-action="toggle-sidebar"]')
  if (button) {
    button.setAttribute('aria-pressed', String(state.sidebarVisible))
    button.title = `${state.sidebarVisible ? '隐藏' : '显示'}侧栏 (Ctrl+Shift+E / Ctrl+B)`
  }
}

function setSidebarVisible(visible, { persist = true } = {}) {
  state.sidebarVisible = Boolean(visible)
  applySidebar()
  if (persist) persistSettings({ sidebarVisible: state.sidebarVisible })
}

function toggleSidebar() {
  setSidebarVisible(!state.sidebarVisible)
}

function applySidebarWidth() {
  const width = Math.round(clamp(state.settings.sidebarWidth, 180, 520))
  if (appEl) appEl.style.setProperty('--sidebar-width', `${width}px`)
}

function applySplitRatio() {
  const ratio = clamp(state.splitRatio, 0.25, 0.75)
  state.splitRatio = ratio
  if (appEl) appEl.style.setProperty('--split-left', `${(ratio * 100).toFixed(2)}%`)
}

function applyFontSize() {
  const size = normalizeFontSize(state.settings.fontSize)
  state.settings.fontSize = size
  if (appEl) appEl.style.setProperty('--editor-font-size', `${size}px`)
}

function zoomFont(delta) {
  const current = normalizeFontSize(state.settings.fontSize)
  const next = delta === 0 ? 15 : normalizeFontSize(current + delta)
  if (next === current) return
  persistSettings({ fontSize: next })
  applyFontSize()
}

function readSplitRatio() {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY)
    // 注意：Number(null) === 0，必须先判断原始值是否存在，否则首次启动会误判成 25/75
    if (raw === null || raw === '') return 0.5
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) return 0.5
    return clamp(value, 0.25, 0.75)
  } catch (error) {
    console.warn('[MoDex] 读取分栏比例失败', error)
  }
  return 0.5
}

function applySettings() {
  const settings = state.settings
  if (!['system', 'light', 'dark'].includes(settings.theme)) settings.theme = 'system'
  if (!VIEW_NAMES[settings.viewMode]) settings.viewMode = 'split'
  settings.sidebarVisible = Boolean(settings.sidebarVisible)
  settings.sidebarWidth = Math.round(clamp(settings.sidebarWidth, 180, 520))
  settings.fontSize = normalizeFontSize(settings.fontSize)
  if (!PREVIEW_STYLE_IDS.has(settings.previewStyle)) settings.previewStyle = 'codex'

  // 多根工作区：清洗已保存的文件夹列表与当前激活根
  settings.openFolders = normalizeOpenFolders(settings.openFolders)
  const active = typeof settings.activeFolder === 'string' ? settings.activeFolder : null
  settings.activeFolder =
    active && settings.openFolders.some((item) => normalizeForCompare(item) === normalizeForCompare(active))
      ? active
      : settings.openFolders[0] || null
  state.rootFolders = settings.openFolders.slice()
  state.activeFolder = settings.activeFolder

  state.viewMode = settings.viewMode
  state.sidebarVisible = settings.sidebarVisible
  state.splitRatio = readSplitRatio()
  applyTheme(resolveTheme(settings.theme))
  applyPreviewStyle(settings.previewStyle)
  applyViewMode()
  applySidebar()
  applySidebarWidth()
  applySplitRatio()
  applyFontSize()
}

/** 规范化持久化的根文件夹列表：绝对路径、去重（大小写不敏感）、最多 12 个 */
function normalizeOpenFolders(list) {
  const result = []
  if (!Array.isArray(list)) return result
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const path = raw.trim()
    if (!path || !isAbsolutePath(path)) continue
    if (result.some((item) => normalizeForCompare(item) === normalizeForCompare(path))) continue
    result.push(path)
    if (result.length >= MAX_ROOTS) break
  }
  return result
}

// ---------------------------------------------------------------------------
// 设置持久化（合并 300ms 内的修改）
// ---------------------------------------------------------------------------

const flushSettings = debounce(async () => {
  const patch = settingsPatch
  settingsPatch = {}
  if (!Object.keys(patch).length) return
  try {
    await api.saveSettings(patch)
  } catch (error) {
    toast?.error(`保存设置失败：${error?.message || error}`)
  }
}, 300)

function persistSettings(patch) {
  Object.assign(state.settings, patch)
  Object.assign(settingsPatch, patch)
  flushSettings()
}

// ---------------------------------------------------------------------------
// 文档状态
// ---------------------------------------------------------------------------

function reportDirty(dirty) {
  const value = Boolean(dirty)
  if (lastReportedDirty === value) return
  lastReportedDirty = value
  try {
    api?.setDirty?.(value)
  } catch (error) {
    console.warn('[MoDex] 同步未保存状态失败', error)
  }
}

function updateDocUi() {
  if (!appEl) return
  const doc = state.doc
  appEl.dataset.hasDoc = doc ? 'true' : 'false'
  appEl.dataset.dirty = doc && doc.dirty ? 'true' : 'false'
  syncDisabledStates()
  if (!doc) {
    if (ui.docTitle) ui.docTitle.textContent = '未命名.md'
    if (ui.docDir) {
      ui.docDir.textContent = ''
      ui.docDir.title = ''
    }
    if (ui.docDirty) ui.docDirty.hidden = true
    if (ui.statusPath) {
      ui.statusPath.textContent = '就绪'
      ui.statusPath.title = ''
    }
    if (ui.statusWords) ui.statusWords.textContent = '0 字'
    if (ui.statusSave) ui.statusSave.textContent = '已保存'
    if (ui.statusPos) ui.statusPos.textContent = '行 1, 列 1'
    document.title = 'MoDex'
    return
  }
  if (ui.docTitle) ui.docTitle.textContent = doc.fileName
  if (ui.docDir) {
    ui.docDir.textContent = doc.path ? api.dirname(doc.path) : '未保存的文档'
    ui.docDir.title = doc.path || ''
  }
  if (ui.docDirty) ui.docDirty.hidden = !doc.dirty
  document.title = `${doc.dirty ? '● ' : ''}${doc.fileName} — MoDex`
  if (ui.statusPath) {
    ui.statusPath.textContent = doc.path || doc.fileName
    ui.statusPath.title = doc.path || ''
  }
  if (ui.statusWords) ui.statusWords.textContent = `${state.wordCount} 字`
  if (ui.statusSave) ui.statusSave.textContent = doc.dirty ? '未保存' : '已保存'
}

/** 刷新按钮在无根文件夹时禁用（工具栏已精简，仅保留侧栏刷新入口） */
function syncDisabledStates() {
  const hasRoots = state.rootFolders.length > 0
  for (const button of $$('[data-action="refresh-tree"]')) {
    button.disabled = !hasRoots
  }
}

function syncDirty() {
  if (!state.doc) {
    reportDirty(false)
    updateDocUi()
    return
  }
  const dirty =
    state.doc.savedContent === null ? true : state.doc.content !== state.doc.savedContent
  state.doc.dirty = dirty
  reportDirty(dirty)
  updateDocUi()
}

const scheduleAnalysis = debounce(() => {
  if (!state.doc) return
  state.wordCount = countWords(state.doc.content)
  if (ui.statusWords) ui.statusWords.textContent = `${state.wordCount} 字`
  renderPreview()
}, 120)

const scheduleAutoSave = debounce(async () => {
  if (!state.settings.autoSave || !state.doc || !state.doc.dirty) return
  if (!state.doc.path) {
    if (!autoSaveWarned) {
      autoSaveWarned = true
      toast?.error('自动保存已开启，但未命名文档需要先手动保存')
    }
    return
  }
  await saveDocument({ silent: true })
}, 2000)

function renderPreview() {
  preview?.render(state.doc ? state.doc.content : '')
}

function handleContentChange(text) {
  if (!state.doc) return
  state.doc.content = text
  syncDirty()
  scheduleAnalysis()
  scheduleAutoSave()
}

function applyDocument({ path = null, content = '', mtimeMs = 0, markDirty = false } = {}) {
  const text = String(content ?? '')
  state.doc = {
    path: path || null,
    fileName: path ? api.basename(path) : '未命名.md',
    content: text,
    savedContent: markDirty ? null : text,
    mtimeMs: Number(mtimeMs) || 0,
    dirty: false,
  }
  state.wordCount = countWords(text)
  autoSaveWarned = false
  editor?.setContent(text)
  preview?.setBaseDir(path ? api.dirname(path) : null)
  renderPreview()
  tree?.setCurrentFile(path || null)
  syncDirty()
  if (ui.statusPos) ui.statusPos.textContent = '行 1, 列 1'
  editor?.focus()
  return true
}

function resetToWelcome() {
  state.doc = null
  state.wordCount = 0
  lastReportedDirty = null
  reportDirty(false)
  editor?.setContent('')
  preview?.setBaseDir(null)
  renderPreview()
  tree?.setCurrentFile(null)
  updateDocUi()
}

async function newDocument() {
  if (!(await autoSaveBeforeLeave())) return
  applyDocument({ path: null, content: '', markDirty: true })
}

/**
 * 离开当前文档前的自动保存（切换文件 / 新建 / 关闭文档 / 关闭窗口共用）。
 * 有 path 静默写盘（保留 mtime 冲突检测），未命名文档走另存为。
 * @returns {Promise<boolean>} true 表示可以继续离开；false 表示取消或失败，应中止操作。
 */
async function autoSaveBeforeLeave() {
  if (!state.doc || !state.doc.dirty) return true
  const doc = state.doc
  const saved = doc.path
    ? await saveDocument({ silent: true })
    : await saveDocumentAs({ silent: true })
  if (saved) {
    if (state.doc === doc) toast?.success('已自动保存')
    return true
  }
  // 冲突处理中选择「重新加载」会把文档替换为磁盘内容并清除 dirty，此时允许继续离开
  if (state.doc !== doc || !state.doc || !state.doc.dirty) return true
  return false
}

/** 删除当前文件等破坏性操作沿用原有的保存/不保存/取消确认 */
async function confirmUnsavedIfNeeded() {
  if (!state.doc || !state.doc.dirty) return true
  let choice
  try {
    choice = await api.confirmUnsaved(state.doc.fileName)
  } catch (error) {
    toast?.error(`无法确认保存状态：${error?.message || error}`)
    return false
  }
  if (choice === 'save') return saveDocument()
  return choice === 'discard'
}

// ---------------------------------------------------------------------------
// 打开文件 / 文件夹
// ---------------------------------------------------------------------------

async function loadFilePath(path, { force = false } = {}) {
  if (!path) return false
  if (!force && !(await autoSaveBeforeLeave())) return false
  let result
  try {
    result = await api.readFile(path)
  } catch (error) {
    toast?.error(`打开文件失败：${error?.message || error}`)
    return false
  }
  if (!result || !result.ok) {
    toast?.error(result?.error || `无法打开文件：${path}`)
    return false
  }
  applyDocument({ path: result.path || path, content: result.content, mtimeMs: result.mtimeMs })
  await rememberRecent('file', result.path || path)
  return true
}

async function openFileDialog() {
  if (!(await autoSaveBeforeLeave())) return
  let result
  try {
    result = await api.openFile()
  } catch (error) {
    toast?.error(`打开文件失败：${error?.message || error}`)
    return
  }
  if (!result || result.canceled) {
    editor?.focus()
    return
  }
  if (result.error) {
    toast?.error(result.error)
    return
  }
  if (!result.path) return
  if (typeof result.content === 'string') {
    applyDocument({ path: result.path, content: result.content, mtimeMs: result.mtimeMs })
    await rememberRecent('file', result.path)
  } else {
    await loadFilePath(result.path, { force: true })
  }
  editor?.focus()
}

async function openRecentFile(path) {
  if (path) await loadFilePath(path)
}

/** 处理来自外部的打开请求（应用已运行时再次双击文件/文件夹 / second-instance 转发） */
async function handleExternalOpen(targetPath) {
  if (!targetPath) return
  let info = null
  try {
    info = await api.pathInfo(targetPath)
  } catch (error) {
    console.warn('[MoDex] 读取外部打开目标失败', error)
  }
  if (info && info.ok && info.exists && info.isDirectory) {
    await openRecentFolder(targetPath)
    return
  }
  if (info && info.ok && info.exists) {
    await openRecentFile(targetPath)
    return
  }
  toast?.error(`无法打开：${targetPath}`)
}

async function openFolderDialog() {
  let result
  try {
    result = await api.openFolder()
  } catch (error) {
    toast?.error(`打开文件夹失败：${error?.message || error}`)
    return
  }
  if (!result || result.canceled || !result.path) return
  // 多根语义：打开文件夹 = 添加一个根（已存在则展开并激活）
  await openRoot(result.path)
}

async function openRecentFolder(path) {
  if (path) await openRoot(path)
}

/** 添加一个根文件夹（对话框 / 欢迎页 / 最近列表 / 外部打开） */
async function openRoot(path) {
  if (!path || !tree) return false
  let ok = false
  try {
    ok = await tree.addRoot(path)
  } catch (error) {
    toast?.error(`打开文件夹失败：${error?.message || error}`)
    return false
  }
  if (!ok) return false
  await rememberRecent('folder', path)
  if (state.doc?.path) tree.setCurrentFile(state.doc.path)
  return true
}

/** 用给定列表替换全部根（启动恢复 / __qm.openRoots） */
async function replaceRoots(paths, preferredActive = null) {
  if (!tree) return false
  let result = []
  try {
    result = await tree.setRoots(paths, preferredActive)
  } catch (error) {
    toast?.error(`打开文件夹失败：${error?.message || error}`)
    return false
  }
  if (state.doc?.path) tree.setCurrentFile(state.doc.path)
  return result
}

/** 从侧栏列表移除一个根（不删除磁盘内容；当前文档保持打开） */
function removeRoot(path) {
  return tree ? tree.removeRoot(path) : false
}

/** 文件树根变化回调：同步 app 状态、监听与持久化 */
function handleRootsChange(payload = {}) {
  const rootFolders = Array.isArray(payload.rootFolders)
    ? payload.rootFolders.slice(0, MAX_ROOTS)
    : []
  const activeFolder = payload.activeFolder || null
  state.rootFolders = rootFolders
  state.activeFolder = activeFolder
  state.settings.openFolders = rootFolders
  state.settings.activeFolder = activeFolder
  if (appEl) appEl.dataset.hasRoot = rootFolders.length > 0 ? 'true' : 'false'
  syncRootsWatcher(rootFolders)
  syncDisabledStates()
  persistSettings({
    openFolders: rootFolders,
    activeFolder,
    // 兼容既有 lastFolder（用于未命名文档的默认保存目录）
    lastFolder: activeFolder || rootFolders[0] || null,
  })
}

/** 通知主进程为全部根建立监听（兼容尚未更新的旧 preload） */
function syncRootsWatcher(rootFolders) {
  const list = Array.isArray(rootFolders) ? rootFolders.slice() : []
  const key = JSON.stringify(list)
  if (watchedRootsKey === key) return
  watchedRootsKey = key
  try {
    if (typeof api?.setRoots === 'function') {
      const promise = api.setRoots(list)
      if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => console.warn('[MoDex] 设置目录监听失败', error))
      }
      return
    }
    // 过渡兼容：旧 preload 只有 setRoot（主进程更新后走 setRoots）
    if (typeof api?.setRoot === 'function') {
      const fallback = list.length === 1 ? list[0] : null
      const promise = api.setRoot(fallback)
      if (promise && typeof promise.catch === 'function') {
        promise.catch((error) => console.warn('[MoDex] 设置目录监听失败', error))
      }
    }
  } catch (error) {
    console.warn('[MoDex] 设置目录监听失败', error)
  }
}

// ---------------------------------------------------------------------------
// 保存 / 关闭
// ---------------------------------------------------------------------------

function suggestedSavePath() {
  if (!state.doc) return null
  if (state.doc.path) return state.doc.path
  const folder =
    state.settings.lastFolder || state.activeFolder || state.rootFolders[0] || null
  if (!folder) return null
  try {
    return api.joinPath(folder, state.doc.fileName || '未命名.md')
  } catch {
    return null
  }
}

async function saveDocument({ silent = false } = {}) {
  if (!state.doc) return false
  if (!state.doc.path) return saveDocumentAs({ silent })
  const doc = state.doc
  const content = doc.content
  // 外部修改冲突检测：磁盘 mtime 与载入时记录不一致时先询问，避免静默覆盖别人改过的内容
  if (doc.path && Number(doc.mtimeMs) > 0) {
    let info = null
    try {
      info = await api.pathInfo(doc.path)
    } catch (error) {
      console.warn('[MoDex] 检查文件修改时间失败', error)
    }
    if (info && info.ok && info.exists && Math.abs(Number(info.mtimeMs) - Number(doc.mtimeMs)) > 1) {
      let choice = 'cancel'
      try {
        choice = await api.confirmFileConflict(doc.fileName)
      } catch (error) {
        toast?.error(`无法确认外部修改：${error?.message || error}`)
        return false
      }
      if (choice === 'reload') {
        await loadFilePath(doc.path, { force: true })
        return false
      }
      if (choice !== 'overwrite') return false
    }
  }
  let result
  try {
    result = await api.writeFile(doc.path, content)
  } catch (error) {
    toast?.error(`保存失败：${error?.message || error}`)
    return false
  }
  if (!result || !result.ok) {
    toast?.error(result?.error || '保存失败')
    return false
  }
  // 保存期间文档可能已被切换，只有仍是同一文档时才更新状态
  if (state.doc === doc) {
    doc.savedContent = content
    doc.mtimeMs = Number(result.mtimeMs) || doc.mtimeMs
    syncDirty()
    tree?.setCurrentFile(doc.path)
  }
  if (!silent) toast?.success('已保存')
  await rememberRecent('file', doc.path)
  return true
}

async function saveDocumentAs({ silent = false } = {}) {
  if (!state.doc) return false
  const doc = state.doc
  const content = doc.content
  let picked
  try {
    picked = await api.saveFileAs(suggestedSavePath())
  } catch (error) {
    toast?.error(`另存为失败：${error?.message || error}`)
    return false
  }
  if (!picked || picked.canceled || !picked.path) return false
  let result
  try {
    result = await api.writeFile(picked.path, content)
  } catch (error) {
    toast?.error(`保存失败：${error?.message || error}`)
    return false
  }
  if (!result || !result.ok) {
    toast?.error(result?.error || '保存失败')
    return false
  }
  const newPath = result.path || picked.path
  if (state.doc === doc) {
    doc.path = newPath
    doc.fileName = api.basename(newPath)
    doc.savedContent = content
    doc.mtimeMs = Number(result.mtimeMs) || 0
    preview?.setBaseDir(api.dirname(newPath))
    syncDirty()
    tree?.setCurrentFile(newPath)
    void tree?.refresh?.()
  }
  if (!silent) toast?.success('已保存')
  await rememberRecent('file', newPath)
  return true
}

async function closeDocument() {
  if (!state.doc) return
  if (!(await autoSaveBeforeLeave())) return
  resetToWelcome()
}

async function handleCloseRequested() {
  try {
    const canClose = await autoSaveBeforeLeave()
    if (canClose) {
      api.requestClose?.()
    } else {
      // 自动保存被取消或失败：解除主进程关闭锁，窗口保持打开
      api.cancelClose?.()
    }
  } catch (error) {
    toast?.error(`自动保存失败：${error?.message || error}`)
    api.cancelClose?.()
  }
}

// ---------------------------------------------------------------------------
// 文件树回调（删除 / 重命名 / 最近列表）
// ---------------------------------------------------------------------------

async function handleBeforeDelete(targetPath) {
  const docPath = state.doc?.path
  if (!docPath || !isSameOrInside(docPath, targetPath)) return true
  if (!state.doc?.dirty) return true
  return confirmUnsavedIfNeeded()
}

function handleRenamed(oldPath, newPath, name) {
  if (state.doc?.path && normalizeForCompare(state.doc.path) === normalizeForCompare(oldPath)) {
    state.doc.path = newPath
    state.doc.fileName = name || api.basename(newPath)
    preview?.setBaseDir(api.dirname(newPath))
    updateDocUi()
    tree?.setCurrentFile(newPath)
  }
  state.recentFiles = state.recentFiles.map((item) =>
    normalizeForCompare(item) === normalizeForCompare(oldPath) ? newPath : item
  )
  renderRecent()
}

function handleDeleted(targetPath) {
  if (state.doc?.path && isSameOrInside(state.doc.path, targetPath)) resetToWelcome()
  state.recentFiles = state.recentFiles.filter((item) => !isSameOrInside(item, targetPath))
  renderRecent()
}

async function rememberRecent(kind, targetPath) {
  if (!targetPath) return
  const key = kind === 'file' ? 'recentFiles' : 'recentFolders'
  const list = state[key].filter(
    (item) => normalizeForCompare(item) !== normalizeForCompare(targetPath)
  )
  list.unshift(targetPath)
  state[key] = list.slice(0, 10)
  renderRecent()
  try {
    await api.addRecent(kind, targetPath)
  } catch (error) {
    console.warn('[MoDex] 记录最近列表失败', error)
  }
}

async function clearRecent(kind) {
  try {
    await api.clearRecent(kind)
  } catch (error) {
    toast?.error(`清空最近记录失败：${error?.message || error}`)
    return
  }
  if (kind !== 'folder') state.recentFiles = []
  if (kind !== 'file') state.recentFolders = []
  renderRecent()
  toast?.success('已清空最近记录')
}

function safeBasename(path) {
  try {
    return api.basename(path)
  } catch {
    return path
  }
}

function safeDirname(path) {
  try {
    return api.dirname(path)
  } catch {
    return ''
  }
}

function renderRecentList(container, list, action, kind) {
  if (!container) return
  container.replaceChildren()
  if (!list.length) {
    container.append(
      el('li', {
        className: 'recent-empty',
        text: kind === 'file' ? '暂无最近文件' : '暂无最近文件夹',
      })
    )
    return
  }
  for (const targetPath of list) {
    const button = el('button', {
      type: 'button',
      className: 'recent-item',
      title: targetPath,
      dataset: { action, recentPath: targetPath },
    })
    button.append(
      el('span', {
        className: 'recent-icon',
        html: kind === 'file' ? icons.fileMd : icons.folder,
      })
    )
    const text = el('span', { className: 'recent-text' })
    text.append(
      el('span', { className: 'recent-name', text: safeBasename(targetPath) }),
      // 只显示所在目录名，避免长路径被截断成无信息片段；完整路径在 button 的 title 中
      el('span', { className: 'recent-dir', text: safeBasename(safeDirname(targetPath)) || safeDirname(targetPath) })
    )
    button.append(text)
    container.append(el('li', {}, button))
  }
}

function renderRecent() {
  renderRecentList(ui.recentFiles, state.recentFiles, 'recent-file', 'file')
  renderRecentList(ui.recentFolders, state.recentFolders, 'recent-folder', 'folder')
}

// ---------------------------------------------------------------------------
// 动作单点分发（按钮 / 菜单 / 快捷键共用）
// ---------------------------------------------------------------------------

async function dispatch(action) {
  const handler = ACTION_HANDLERS[action]
  if (!handler) return
  const now = performance.now()
  if (lastAction.name === action && now - lastAction.at < 220) return
  lastAction = { name: action, at: now }
  try {
    await handler()
  } catch (error) {
    console.error(`[MoDex] 动作执行失败：${action}`, error)
    toast?.error(`操作失败：${error?.message || action}`)
  }
}

// ---------------------------------------------------------------------------
// 应用菜单（单条导航栏：文件 / 编辑 / 视图 / 帮助）
// ---------------------------------------------------------------------------

function findAppMenuDef(kind) {
  return APP_MENU_DEFS.find((def) => def.id === kind) || null
}

function updateAppMenuButtons() {
  for (const button of $$('[data-app-menu]')) {
    const open = button.dataset.appMenu === appMenuOpenKind
    button.classList.toggle('is-open', open)
    button.setAttribute('aria-expanded', String(open))
  }
}

/** 下拉被关闭（点击项 / 外部 / Esc）时同步按钮状态；记录关闭时间用于切换判定 */
function handleAppMenuClosed() {
  closeAppSubmenu()
  if (appMenuOpenKind) {
    lastClosedAppMenu = { kind: appMenuOpenKind, at: performance.now() }
  }
  appMenuOpenKind = null
  updateAppMenuButtons()
}

function closeAppMenu() {
  appMenus?.close()
}

function buildAppMenuItems(def) {
  return def.items.map((item) => {
    if (item.separator) return { separator: true }
    return {
      label: item.label,
      hint: item.hint,
      menuKey: item.menuKey,
      hasSubmenu: Boolean(item.hasSubmenu),
      onSelect: () => {
        if (item.action) void dispatch(item.action)
        else if (item.command) void runMenuCommand(item.command)
      },
    }
  })
}

function openAppMenu(kind) {
  const def = findAppMenuDef(kind)
  const button = $(`[data-app-menu="${kind}"]`)
  if (!def || !button || !appMenus) return
  menus?.close()
  const rect = button.getBoundingClientRect()
  appMenus.open(rect.left, rect.bottom + 2, buildAppMenuItems(def))
  appMenuOpenKind = kind
  lastClosedAppMenu = { kind: '', at: 0 }
  updateAppMenuButtons()
}

function toggleAppMenu(kind) {
  if (!findAppMenuDef(kind)) return
  if (appMenuOpenKind === kind) {
    closeAppMenu()
    return
  }
  const now = performance.now()
  // 真实鼠标点击：pointerdown 已先关闭下拉，随后的 click 不应重新打开
  if (!appMenuOpenKind && lastClosedAppMenu.kind === kind && now - lastClosedAppMenu.at < 320) {
    lastClosedAppMenu = { kind: '', at: 0 }
    return
  }
  openAppMenu(kind)
}

// ---------------------------------------------------------------------------
// 视图 → 预览样式（二级面板，选择器与 e2e 约定一致）
// ---------------------------------------------------------------------------

/** 重建 #app-submenu 内容（7 套样式 + 当前选中 ✓） */
function buildAppPreviewSubmenu() {
  const submenu = $('#app-submenu')
  if (!submenu) return
  submenu.replaceChildren()
  for (const option of PREVIEW_STYLE_OPTIONS) {
    const checked = option.id === state.previewStyle
    const row = el('li', { className: 'ctx-row', dataset: { styleId: option.id } })
    if (checked) row.dataset.checked = 'true'
    const button = el('button', { type: 'button', className: 'ctx-item', role: 'menuitemradio' })
    button.setAttribute('aria-checked', String(checked))
    button.append(
      el('span', { className: 'ctx-check', text: checked ? '✓' : '', 'aria-hidden': 'true' }),
      el('span', { className: 'ctx-label', text: option.label })
    )
    row.append(button)
    submenu.append(row)
  }
}

function openAppSubmenu(triggerRow) {
  const submenu = $('#app-submenu')
  const menu = $('#app-menu')
  if (!submenu || !menu || !triggerRow) return
  // 防御：父菜单已关闭时（例如残留的隐藏菜单行被悬停），不允许单独打开二级面板
  if (!appMenuOpenKind || menu.hidden) {
    closeAppSubmenu()
    return
  }
  buildAppPreviewSubmenu()
  submenu.hidden = false
  submenu.style.left = '0px'
  submenu.style.top = '0px'
  const trigger = triggerRow.getBoundingClientRect()
  const panel = submenu.getBoundingClientRect()
  let left = trigger.right + 2
  if (left + panel.width > window.innerWidth - 6) {
    left = Math.max(6, trigger.left - panel.width - 2)
  }
  const top = Math.max(6, Math.min(trigger.top - 4, window.innerHeight - panel.height - 6))
  submenu.style.left = `${left}px`
  submenu.style.top = `${top}px`
  appSubmenuOpen = true
}

function closeAppSubmenu() {
  const submenu = $('#app-submenu')
  if (submenu) submenu.hidden = true
  appSubmenuOpen = false
}

function onAppSubmenuClick(event) {
  const source = event.target instanceof Element ? event.target : null
  const row = source?.closest('#app-submenu li[data-style-id]')
  if (!row) return
  event.preventDefault()
  const style = row.dataset.styleId
  closeAppSubmenu()
  closeAppMenu()
  selectPreviewStyle(style)
}

/** 原生 role / 窗口类命令统一走 IPC；旧 preload 下做编辑命令兜底 */
async function runMenuCommand(command) {
  try {
    if (typeof api?.runMenuCommand === 'function') {
      const result = await api.runMenuCommand(command)
      if (result && result.ok === false) toast?.error('菜单命令执行失败')
      return
    }
    const editorCommands = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      paste: 'paste',
      selectAll: 'selectAll',
    }
    if (editorCommands[command]) {
      document.execCommand(command)
      return
    }
    toast?.error('当前版本暂不支持该操作')
  } catch (error) {
    toast?.error(`菜单命令执行失败：${error?.message || error}`)
  }
}

function onDocumentClick(event) {
  const source = event.target instanceof Element ? event.target : null
  if (!source) return

  const appMenuButton = source.closest('[data-app-menu]')
  if (appMenuButton) {
    event.preventDefault()
    toggleAppMenu(appMenuButton.dataset.appMenu)
    return
  }
  // 点击下拉之外的位置关闭应用菜单（兼容合成 click 事件）；二级面板也一起关闭
  if (appMenuOpenKind && !source.closest('#app-menu') && !source.closest('#app-submenu')) {
    closeAppMenu()
  } else if (!appMenuOpenKind && appSubmenuOpen && !source.closest('#app-submenu')) {
    // 兜底：父菜单已关闭但二级面板孤立残留时，任何外部点击都应关闭它
    closeAppSubmenu()
  }

  const target = source.closest('[data-action]')
  if (!target) return
  const action = target.dataset.action
  if (action === 'recent-file' || action === 'recent-folder') {
    event.preventDefault()
    void (action === 'recent-file'
      ? openRecentFile(target.dataset.recentPath)
      : openRecentFolder(target.dataset.recentPath))
    return
  }
  if (action === 'clear-recent') {
    event.preventDefault()
    void clearRecent(target.dataset.kind || 'all')
    return
  }
  const mapped = DOM_ACTIONS[action]
  if (!mapped) return
  event.preventDefault()
  void dispatch(mapped)
}

// ---------------------------------------------------------------------------
// 全局快捷键（键盘是快捷键唯一拥有者；菜单只发 onMenuAction）
// ---------------------------------------------------------------------------

function onGlobalKeydown(event) {
  const mod = event.ctrlKey || event.metaKey
  if (!mod) {
    if (event.key === 'Escape') {
      if (appMenuOpenKind) {
        closeAppMenu()
        // Esc 关闭不参与「pointerdown 先关、click 不重开」的防抖窗口，允许立即重新打开
        lastClosedAppMenu = { kind: '', at: 0 }
        event.preventDefault()
        return
      }
      if (appSubmenuOpen) {
        closeAppSubmenu()
        event.preventDefault()
        return
      }
      if (menus?.isOpen) {
        menus.close()
        event.preventDefault()
        return
      }
      if (editor?.isFindOpen()) {
        editor.closeFind()
        event.preventDefault()
      }
    }
    return
  }
  if (event.altKey) return
  const key = event.key.toLowerCase()
  const active = document.activeElement
  const editorFocused = Boolean(active && active.id === 'editor')
  const inputLike =
    event.target instanceof Element &&
    (event.target.tagName === 'INPUT' ||
      (event.target.tagName === 'TEXTAREA' && !editorFocused) ||
      event.target.isContentEditable)

  // 查找栏 / 行内输入框内只处理 Ctrl+S / Ctrl+O / Ctrl+N / Esc
  if (inputLike) {
    if (event.key === 'Escape') {
      if (editor?.isFindOpen()) {
        editor.closeFind()
        event.preventDefault()
      }
      return
    }
    if (key === 's' && !event.shiftKey) {
      event.preventDefault()
      void dispatch('file:save')
    } else if (key === 'o' && !event.shiftKey) {
      event.preventDefault()
      void dispatch('file:open')
    } else if (key === 'n' && !event.shiftKey) {
      event.preventDefault()
      void dispatch('file:new')
    }
    return
  }

  if (event.shiftKey) {
    if (key === 's') {
      event.preventDefault()
      void dispatch('file:save-as')
      return
    }
    if (key === 't') {
      event.preventDefault()
      void dispatch('view:theme-toggle')
      return
    }
    if (key === 'e') {
      event.preventDefault()
      void dispatch('view:toggle-sidebar')
      return
    }
    return
  }

  switch (key) {
    case 'n':
      void dispatch('file:new')
      break
    case 'o':
      void dispatch('file:open')
      break
    case 's':
      void dispatch('file:save')
      break
    case 'f':
      void dispatch('edit:find')
      break
    case 'w':
      void dispatch('file:close')
      break
    case '1':
      void dispatch('view:edit')
      break
    case '2':
      void dispatch('view:split')
      break
    case '3':
      void dispatch('view:preview')
      break
    case 'b':
      // 编辑器内的 Ctrl+B 由 editor.js 处理为加粗
      if (editorFocused) return
      void dispatch('view:toggle-sidebar')
      break
    case '=':
    case '+':
      void dispatch('view:zoom-in')
      break
    case '-':
    case '_':
      void dispatch('view:zoom-out')
      break
    case '0':
      void dispatch('view:zoom-reset')
      break
    default:
      return
  }
  event.preventDefault()
}

const ACTION_HANDLERS = {
  'file:new': newDocument,
  'file:open': openFileDialog,
  'file:open-folder': openFolderDialog,
  'file:save': () => saveDocument(),
  'file:save-as': () => saveDocumentAs(),
  'file:close': closeDocument,
  'edit:find': () => {
    if (state.doc) editor?.openFind()
  },
  'view:edit': () => setViewMode('edit'),
  'view:split': () => setViewMode('split'),
  'view:preview': () => setViewMode('preview'),
  'view:toggle-sidebar': toggleSidebar,
  'view:theme-toggle': toggleTheme,
  'view:zoom-in': () => zoomFont(1),
  'view:zoom-out': () => zoomFont(-1),
  'view:zoom-reset': () => zoomFont(0),
  'tree:new-file': () => tree?.startCreate('file'),
  'tree:new-folder': () => tree?.startCreate('folder'),
  'tree:refresh': () => tree?.refresh(),
}

// ---------------------------------------------------------------------------
// 布局拖拽 / 事件绑定 / 模块初始化
// ---------------------------------------------------------------------------

function bindResizers() {
  let startWidth = state.settings.sidebarWidth
  makeDragResizer($('#sidebar-resizer'), {
    onStart: () => {
      startWidth = state.settings.sidebarWidth
    },
    onDrag: ({ dx }) => {
      state.settings.sidebarWidth = Math.round(clamp(startWidth + dx, 180, 520))
      applySidebarWidth()
    },
    onEnd: () => persistSettings({ sidebarWidth: state.settings.sidebarWidth }),
  })

  let panesWidth = 1
  let startRatio = state.splitRatio
  makeDragResizer($('#pane-resizer'), {
    onStart: () => {
      const panes = $('#panes')
      panesWidth = Math.max(1, panes ? panes.clientWidth : 1)
      startRatio = state.splitRatio
    },
    onDrag: ({ dx }) => {
      state.splitRatio = clamp(startRatio + dx / panesWidth, 0.25, 0.75)
      applySplitRatio()
    },
    onEnd: () => {
      try {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(state.splitRatio))
      } catch (error) {
        console.warn('[MoDex] 保存分栏比例失败', error)
      }
    },
  })
}

const flushTreeRefresh = debounce(() => {
  const roots = [...pendingTreeRoots]
  pendingTreeRoots.clear()
  for (const root of roots) void tree?.refresh(root)
}, 300)

function scheduleTreeRefresh(root) {
  if (!root) return
  pendingTreeRoots.add(root)
  flushTreeRefresh()
}

function bindApiEvents() {
  try {
    api.onMenuAction?.((action) => {
      if (action) void dispatch(action)
    })
  } catch (error) {
    console.warn('[MoDex] 订阅菜单事件失败', error)
  }
  try {
    api.onTreeChanged?.((root) => {
      if (!root) return
      if (
        !state.rootFolders.some(
          (item) => normalizeForCompare(item) === normalizeForCompare(root)
        )
      ) {
        return
      }
      // 主进程按根推送变化：只刷新对应根
      scheduleTreeRefresh(root)
    })
  } catch (error) {
    console.warn('[MoDex] 订阅文件树变化失败', error)
  }
  try {
    api.onCloseRequested?.(() => {
      void handleCloseRequested()
    })
  } catch (error) {
    console.warn('[MoDex] 订阅关闭请求失败', error)
  }
  try {
    api.onOpenPath?.((targetPath) => {
      void handleExternalOpen(targetPath)
    })
  } catch (error) {
    console.warn('[MoDex] 订阅外部打开请求失败', error)
  }
}

function wireEvents() {
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('keydown', onGlobalKeydown)
  $('#app-submenu')?.addEventListener('click', onAppSubmenuClick)
  bindResizers()
  bindApiEvents()
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', () => {
      if (state.settings.theme === 'system') applyTheme(resolveTheme('system'))
    })
  }
}

function initModules() {
  editor = initEditor(ctx)
  preview = initPreview(ctx)
  tree = initTree(ctx)
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

function cacheUi() {
  ui.docTitle = $('#doc-title')
  ui.docDir = $('#doc-dir')
  ui.docDirty = $('#doc-dirty')
  ui.statusPath = $('#status-path')
  ui.statusPos = $('#status-position')
  ui.statusWords = $('#status-words')
  ui.statusSave = $('#status-save')
  ui.statusMode = $('#status-mode')
  ui.themeButton = $('[data-action="theme-toggle"]')
  ui.themeIcon = $('#theme-icon')
  ui.recentFiles = $('#recent-files')
  ui.recentFolders = $('#recent-folders')
}

function fillStaticIcons() {
  for (const node of $$('[data-icon]')) {
    const name = node.dataset.icon
    if (name && icons[name]) node.innerHTML = icons[name]
  }
}

function showFatalError(error) {
  const message = error && error.message ? String(error.message) : String(error)
  let box = $('#fatal-error')
  if (!box) {
    box = el('div', { id: 'fatal-error' })
    document.body.append(box)
  }
  box.replaceChildren(
    el('h2', { text: 'MoDex 启动失败' }),
    el('p', { text: '渲染进程初始化时发生错误。请重启应用；若问题持续存在，请反馈以下信息。' }),
    el('pre', { text: message })
  )
}

async function boot() {
  appEl = $('#app')
  if (!appEl) throw new Error('缺少 #app 根元素')
  cacheUi()
  fillStaticIcons()
  toast = createToastSystem($('#toasts'))
  menus = createContextMenu($('#context-menu'))
  appMenus = createContextMenu($('#app-menu'), {
    onClose: () => handleAppMenuClosed(),
    // 二级面板属于菜单内部，点击/操作时父菜单保持打开
    isInside: (target) => Boolean(target && target.closest && target.closest('#app-submenu')),
    onItemHover: (item, row) => {
      // 悬停「预览样式」立即展开二级面板；悬停普通项收起
      if (item.hasSubmenu) openAppSubmenu(row)
      else closeAppSubmenu()
    },
    onSubmenu: (item, row) => {
      // 点击「预览样式」始终展开（悬停已展开时点击不会误关闭）
      if (item.menuKey === 'preview-style') openAppSubmenu(row)
    },
  })
  if (!api || typeof api.bootstrap !== 'function') {
    throw new Error('window.api 未注入，请确认 preload 已加载')
  }
  let info = null
  try {
    info = await api.bootstrap()
  } catch (error) {
    throw new Error(`读取启动信息失败：${error?.message || error}`)
  }
  state.paths = info?.paths || {}
  state.appVersion = info?.appVersion || api.appVersion || '1.0.0'
  state.recentFiles = Array.isArray(info?.recentFiles) ? info.recentFiles.slice(0, 10) : []
  state.recentFolders = Array.isArray(info?.recentFolders) ? info.recentFolders.slice(0, 10) : []
  Object.assign(state.settings, DEFAULT_SETTINGS, info?.settings || {})
  applySettings()
  initModules()
  wireEvents()
  renderRecent()
  updateDocUi()
  reportDirty(false)
  const initial = info?.initial || {}
  // 多根恢复：已保存的 openFolders 优先，其次命令行 initial.root
  const restoredRoots = normalizeOpenFolders(state.settings.openFolders)
  if (restoredRoots.length > 0) {
    await replaceRoots(restoredRoots, state.settings.activeFolder)
  } else if (initial.root) {
    await openRoot(initial.root)
  }
  if (initial.file) await loadFilePath(initial.file, { force: true })
  // 说明：settings.lastFolder 只用于填充最近列表与默认保存目录，不单独自动打开
}

async function start() {
  try {
    await boot()
  } catch (error) {
    console.error('[MoDex] 启动失败', error)
    showFatalError(error)
    try {
      toast?.error(`启动失败：${error?.message || error}`)
    } catch (innerError) {
      console.error('[MoDex] 显示启动错误失败', innerError)
    }
  } finally {
    readyResolve()
  }
}

// ---------------------------------------------------------------------------
// e2e 测试钩子
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.__qm = {
    ready,
    getState() {
      return {
        filePath: state.doc?.path ?? null,
        fileName: state.doc?.fileName ?? '未命名.md',
        content: state.doc?.content ?? '',
        dirty: Boolean(state.doc?.dirty),
        viewMode: state.viewMode,
        theme: state.theme,
        previewStyle: state.previewStyle,
        rootFolders: state.rootFolders.slice(),
        activeFolder: state.activeFolder,
        sidebarVisible: state.sidebarVisible,
        wordCount: state.wordCount,
        treeFileCount: tree?.getFileCount?.() ?? 0,
      }
    },
    async openPath(path) {
      // 测试钩子保持“直接打开”语义，但切换前同样执行自动保存（与真实切换入口一致）
      await loadFilePath(path)
    },
    async openRoot(path) {
      await openRoot(path)
    },
    async openRoots(paths) {
      await replaceRoots(Array.isArray(paths) ? paths : [])
    },
    async removeRoot(path) {
      removeRoot(path)
    },
    async setViewMode(mode) {
      setViewMode(mode, { persist: false })
    },
    async setTheme(theme) {
      applyTheme(theme === 'dark' ? 'dark' : 'light')
    },
    async setPreviewStyle(style) {
      selectPreviewStyle(style, { notify: false })
    },
    async save() {
      await saveDocument({ silent: true })
    },
  }
  ready.then(() => {
    document.documentElement.dataset.ready = '1'
  })
  start()
}
