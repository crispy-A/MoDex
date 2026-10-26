'use strict'

/**
 * 应用状态存储：settings + 最近打开列表 + 窗口位置，持久化到 userData/state.json。
 * 纯 Node 实现，便于单元测试；写入采用「临时文件 + 重命名」保证原子性。
 */
const fs = require('node:fs')
const path = require('node:path')

const THEMES = ['system', 'light', 'dark']
const VIEW_MODES = ['edit', 'split', 'preview']
const PREVIEW_STYLES = ['codex', 'github', 'vue', 'notion', 'feishu', 'tailwind', 'serif']
const MAX_RECENT = 10
const MAX_OPEN_FOLDERS = 12

const NUMERIC_LIMITS = {
  sidebarWidth: { min: 180, max: 520, fallback: 260 },
  fontSize: { min: 12, max: 24, fallback: 15 },
}

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  viewMode: 'split',
  sidebarVisible: true,
  sidebarWidth: 260,
  fontSize: 15,
  autoSave: false,
  lastFolder: null,
  lastFile: null,
  openFolders: Object.freeze([]),
  activeFolder: null,
  previewStyle: 'codex',
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clampNumber(value, { min, max, fallback }) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

function normalizeOptionalPath(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !path.isAbsolute(trimmed)) return null
  return path.normalize(trimmed)
}

/** 已打开文件夹列表清洗：绝对路径、去重（Windows 大小写不敏感）、上限 12、保持顺序 */
function normalizeOpenFolders(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const result = []
  for (const value of list) {
    const normalized = normalizeOptionalPath(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= MAX_OPEN_FOLDERS) break
  }
  return result
}

/** 把任意输入清洗为合法 settings（未知字段忽略，越界值回落） */
function sanitizeSettings(raw) {
  const input = isPlainObject(raw) ? raw : {}
  const openFolders = normalizeOpenFolders(input.openFolders)
  const activeCandidate = normalizeOptionalPath(input.activeFolder)
  const activeFolder =
    activeCandidate && openFolders.some((folder) => folder.toLowerCase() === activeCandidate.toLowerCase())
      ? openFolders.find((folder) => folder.toLowerCase() === activeCandidate.toLowerCase()) || null
      : null
  return {
    theme: THEMES.includes(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    viewMode: VIEW_MODES.includes(input.viewMode) ? input.viewMode : DEFAULT_SETTINGS.viewMode,
    sidebarVisible: typeof input.sidebarVisible === 'boolean' ? input.sidebarVisible : DEFAULT_SETTINGS.sidebarVisible,
    sidebarWidth: clampNumber(input.sidebarWidth, NUMERIC_LIMITS.sidebarWidth),
    fontSize: clampNumber(input.fontSize, NUMERIC_LIMITS.fontSize),
    autoSave: typeof input.autoSave === 'boolean' ? input.autoSave : DEFAULT_SETTINGS.autoSave,
    lastFolder: normalizeOptionalPath(input.lastFolder),
    lastFile: normalizeOptionalPath(input.lastFile),
    openFolders,
    activeFolder,
    previewStyle: PREVIEW_STYLES.includes(input.previewStyle) ? input.previewStyle : DEFAULT_SETTINGS.previewStyle,
  }
}

/** 合并 settings 补丁：先与基准值合并，再整体清洗 */
function applySettingsPatch(base, patch) {
  const merged = { ...sanitizeSettings(base), ...(isPlainObject(patch) ? patch : {}) }
  return sanitizeSettings(merged)
}

/** 最近列表清洗：绝对路径、去重（Windows 大小写不敏感）、上限 10 条 */
function normalizeRecentList(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const result = []
  for (const value of list) {
    const normalized = normalizeOptionalPath(value)
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length >= MAX_RECENT) break
  }
  return result
}

/** 最近列表新增一条（最近在前） */
function pushRecent(list, targetPath) {
  const normalized = normalizeOptionalPath(targetPath)
  if (!normalized) return normalizeRecentList(list)
  return normalizeRecentList([normalized, ...(Array.isArray(list) ? list : [])])
}

function defaultState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    recentFiles: [],
    recentFolders: [],
    window: null,
  }
}

function sanitizeState(raw) {
  const input = isPlainObject(raw) ? raw : {}
  const windowState = isPlainObject(input.window)
    ? {
        width: clampNumber(input.window.width, { min: 900, max: 10000, fallback: 1280 }),
        height: clampNumber(input.window.height, { min: 600, max: 10000, fallback: 800 }),
        x: Number.isInteger(input.window.x) ? input.window.x : null,
        y: Number.isInteger(input.window.y) ? input.window.y : null,
        maximized: Boolean(input.window.maximized),
      }
    : null
  return {
    settings: sanitizeSettings(input.settings),
    recentFiles: normalizeRecentList(input.recentFiles),
    recentFolders: normalizeRecentList(input.recentFolders),
    window: windowState,
  }
}

class StateStore {
  constructor(filePath) {
    this.filePath = filePath
    this.state = defaultState()
    this.loaded = false
  }

  /** 读取状态文件；不存在或损坏时回落到默认值（不抛错） */
  load() {
    try {
      const text = fs.readFileSync(this.filePath, 'utf8')
      this.state = sanitizeState(JSON.parse(text))
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.warn('[state-store] 读取状态失败，使用默认值：', err.message)
      this.state = defaultState()
    }
    this.loaded = true
    return this.state
  }

  getSettings() {
    return { ...this.state.settings }
  }

  getRecentFiles() {
    return [...this.state.recentFiles]
  }

  getRecentFolders() {
    return [...this.state.recentFolders]
  }

  getWindowState() {
    return this.state.window ? { ...this.state.window } : null
  }

  setWindowState(state) {
    if (!isPlainObject(state)) return
    this.state.window = {
      width: clampNumber(state.width, { min: 900, max: 10000, fallback: 1280 }),
      height: clampNumber(state.height, { min: 600, max: 10000, fallback: 800 }),
      x: Number.isInteger(state.x) ? state.x : null,
      y: Number.isInteger(state.y) ? state.y : null,
      maximized: Boolean(state.maximized),
    }
    this.flush()
  }

  updateSettings(patch) {
    this.state.settings = applySettingsPatch(this.state.settings, patch)
    this.flush()
    return this.getSettings()
  }

  addRecent(kind, targetPath) {
    const normalized = normalizeOptionalPath(targetPath)
    if (!normalized) return
    if (kind === 'file') {
      this.state.recentFiles = pushRecent(this.state.recentFiles, normalized)
      this.state.settings.lastFile = normalized
    } else if (kind === 'folder') {
      this.state.recentFolders = pushRecent(this.state.recentFolders, normalized)
      this.state.settings.lastFolder = normalized
    }
    this.flush()
  }

  /** 最近列表 + lastFile/lastFolder 中把旧路径替换为新路径（重命名/移动后调用） */
  replaceRecentPath(fromPath, toPath) {
    const from = normalizeOptionalPath(fromPath)
    const to = normalizeOptionalPath(toPath)
    if (!from || !to) return
    const replace = (list) => {
      const next = list.map((item) => (item.toLowerCase() === from.toLowerCase() ? to : item))
      return normalizeRecentList(next)
    }
    this.state.recentFiles = replace(this.state.recentFiles)
    this.state.recentFolders = replace(this.state.recentFolders)
    if (this.state.settings.lastFile && this.state.settings.lastFile.toLowerCase() === from.toLowerCase()) {
      this.state.settings.lastFile = to
    }
    if (this.state.settings.lastFolder && this.state.settings.lastFolder.toLowerCase() === from.toLowerCase()) {
      this.state.settings.lastFolder = to
    }
    this.flush()
  }

  removeRecentPath(targetPath) {
    const target = normalizeOptionalPath(targetPath)
    if (!target) return
    const matches = (item) => {
      const lower = item.toLowerCase()
      const base = target.toLowerCase().replace(/\\+$/, '')
      return lower === base || lower.startsWith(`${base}\\`)
    }
    this.state.recentFiles = this.state.recentFiles.filter((item) => !matches(item))
    this.state.recentFolders = this.state.recentFolders.filter((item) => !matches(item))
    if (this.state.settings.lastFile && matches(this.state.settings.lastFile)) this.state.settings.lastFile = null
    if (this.state.settings.lastFolder && matches(this.state.settings.lastFolder)) this.state.settings.lastFolder = null
    this.flush()
  }

  clearRecent(kind) {
    if (kind === 'file' || kind === 'all') this.state.recentFiles = []
    if (kind === 'folder' || kind === 'all') this.state.recentFolders = []
    this.flush()
  }

  /** 原子写盘：同目录临时文件 + 重命名 */
  flush() {
    const dir = path.dirname(this.filePath)
    const tmpPath = path.join(dir, `.state-${process.pid}-${Date.now().toString(36)}.tmp`)
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8')
      fs.renameSync(tmpPath, this.filePath)
    } catch (err) {
      try {
        fs.rmSync(tmpPath, { force: true })
      } catch {
        /* 忽略清理失败 */
      }
      console.warn('[state-store] 保存状态失败：', err.message)
    }
  }
}

module.exports = {
  StateStore,
  DEFAULT_SETTINGS,
  THEMES,
  VIEW_MODES,
  PREVIEW_STYLES,
  MAX_RECENT,
  MAX_OPEN_FOLDERS,
  NUMERIC_LIMITS,
  sanitizeSettings,
  sanitizeState,
  applySettingsPatch,
  normalizeRecentList,
  normalizeOpenFolders,
  pushRecent,
}
