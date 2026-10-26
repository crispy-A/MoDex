'use strict'

/**
 * state-store 单元测试：默认值、清洗、设置更新、最近列表、窗口状态与持久化。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  StateStore,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  sanitizeState,
  applySettingsPatch,
  normalizeRecentList,
  normalizeOpenFolders,
  pushRecent,
  MAX_RECENT,
  MAX_OPEN_FOLDERS,
  PREVIEW_STYLES,
  AI_MODELS,
  AI_PANEL_MODES,
} from '../src/main/state-store.js'

const fsp = fs.promises

async function makeTempFile(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'modex-state-'))
  t.after(async () => {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  return path.join(dir, 'state.json')
}

test('sanitizeSettings：非法值回落默认值', () => {
  const result = sanitizeSettings({
    theme: 'neon',
    viewMode: 'hologram',
    sidebarVisible: 'yes',
    sidebarWidth: 9999,
    fontSize: 2,
    autoSave: 1,
    lastFolder: 'relative/path',
    lastFile: 'C:\\notes\\a.md',
    unknown: 'ignore me',
  })
  assert.equal(result.theme, DEFAULT_SETTINGS.theme)
  assert.equal(result.viewMode, DEFAULT_SETTINGS.viewMode)
  assert.equal(result.sidebarVisible, DEFAULT_SETTINGS.sidebarVisible)
  assert.equal(result.sidebarWidth, 520)
  assert.equal(result.fontSize, 12)
  assert.equal(result.autoSave, DEFAULT_SETTINGS.autoSave)
  assert.equal(result.lastFolder, null)
  assert.equal(result.lastFile, 'C:\\notes\\a.md')
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'unknown'), false)
})

test('applySettingsPatch：浅合并后再清洗', () => {
  const base = sanitizeSettings({ theme: 'light', fontSize: 18 })
  const updated = applySettingsPatch(base, { theme: 'dark', fontSize: 100, sidebarWidth: 300 })
  assert.equal(updated.theme, 'dark')
  assert.equal(updated.fontSize, 24)
  assert.equal(updated.sidebarWidth, 300)
  assert.equal(updated.viewMode, base.viewMode)

  const kept = applySettingsPatch(updated, {})
  assert.deepEqual(kept, updated)
})

test('normalizeRecentList / pushRecent：去重、大小写、上限', () => {
  const list = normalizeRecentList([
    'D:\\notes\\a.md',
    'd:\\NOTES\\A.MD',
    'relative.md',
    '',
    null,
    'D:\\notes\\b.md',
  ])
  assert.deepEqual(list, ['D:\\notes\\a.md', 'D:\\notes\\b.md'])

  let recent = []
  for (let i = 0; i < MAX_RECENT + 5; i += 1) {
    recent = pushRecent(recent, `D:\\notes\\${i}.md`)
  }
  assert.equal(recent.length, MAX_RECENT)
  assert.equal(recent[0], `D:\\notes\\${MAX_RECENT + 4}.md`)

  const moved = pushRecent(recent, recent[MAX_RECENT - 1])
  assert.equal(moved[0], recent[MAX_RECENT - 1])
  assert.equal(moved.length, MAX_RECENT)
})

test('normalizeOpenFolders：去重、大小写、绝对路径、上限与顺序', () => {
  const list = normalizeOpenFolders([
    'D:\\notes',
    'd:\\NOTES',
    'relative',
    '',
    null,
    'D:\\docs',
    'E:\\work',
  ])
  assert.deepEqual(list, ['D:\\notes', 'D:\\docs', 'E:\\work'])

  const many = []
  for (let i = 0; i < MAX_OPEN_FOLDERS + 5; i += 1) many.push(`D:\\folder-${i}`)
  const capped = normalizeOpenFolders(many)
  assert.equal(capped.length, MAX_OPEN_FOLDERS)
  assert.equal(capped[0], 'D:\\folder-0')
  assert.equal(capped[MAX_OPEN_FOLDERS - 1], `D:\\folder-${MAX_OPEN_FOLDERS - 1}`)
})

test('sanitizeSettings：openFolders 与 activeFolder 归一', () => {
  const settings = sanitizeSettings({
    openFolders: ['D:\\notes', 'd:\\NOTES', 'D:\\docs'],
    activeFolder: 'd:\\docs',
  })
  assert.deepEqual(settings.openFolders, ['D:\\notes', 'D:\\docs'])
  assert.equal(settings.activeFolder, 'D:\\docs')

  const noActive = sanitizeSettings({ openFolders: ['D:\\notes'], activeFolder: 'D:\\other' })
  assert.equal(noActive.activeFolder, null)

  const empty = sanitizeSettings({})
  assert.deepEqual(empty.openFolders, [])
  assert.equal(empty.activeFolder, null)
})

test('StateStore：已打开文件夹与激活根持久化', async (t) => {
  const file = await makeTempFile(t)
  const store = new StateStore(file)
  store.load()
  store.updateSettings({ openFolders: ['D:\\notes', 'D:\\docs'], activeFolder: 'D:\\docs' })
  const reloaded = new StateStore(file)
  reloaded.load()
  assert.deepEqual(reloaded.getSettings().openFolders, ['D:\\notes', 'D:\\docs'])
  assert.equal(reloaded.getSettings().activeFolder, 'D:\\docs')

  reloaded.updateSettings({ openFolders: ['D:\\notes'] })
  assert.equal(reloaded.getSettings().activeFolder, null)
})

test('sanitizeSettings：previewStyle 枚举校验与默认值', () => {
  assert.equal(sanitizeSettings({}).previewStyle, 'codex')
  for (const style of PREVIEW_STYLES) {
    assert.equal(sanitizeSettings({ previewStyle: style }).previewStyle, style)
  }
  assert.equal(sanitizeSettings({ previewStyle: 'unknown' }).previewStyle, 'codex')
  assert.equal(sanitizeSettings({ previewStyle: 42 }).previewStyle, 'codex')
  assert.deepEqual(PREVIEW_STYLES, ['codex', 'github', 'vue', 'notion', 'feishu', 'tailwind', 'serif'])
})

test('StateStore：预览样式持久化与非法值回落', async (t) => {
  const file = await makeTempFile(t)
  const store = new StateStore(file)
  store.load()
  assert.equal(store.getSettings().previewStyle, 'codex')

  store.updateSettings({ previewStyle: 'serif' })
  assert.equal(store.getSettings().previewStyle, 'serif')
  const reloaded = new StateStore(file)
  reloaded.load()
  assert.equal(reloaded.getSettings().previewStyle, 'serif')

  reloaded.updateSettings({ previewStyle: 'not-a-style' })
  assert.equal(reloaded.getSettings().previewStyle, 'codex')
})

test('sanitizeSettings：AI 面板字段默认值、枚举与宽度 clamp', () => {
  const defaults = sanitizeSettings({})
  assert.equal(defaults.aiPanelMode, 'closed')
  assert.equal(defaults.aiPanelWidth, 360)
  assert.equal(defaults.aiModel, 'deepseek-flash')
  assert.equal(defaults.aiIncludeContext, false)

  for (const mode of AI_PANEL_MODES) {
    assert.equal(sanitizeSettings({ aiPanelMode: mode }).aiPanelMode, mode)
  }
  for (const model of AI_MODELS) {
    assert.equal(sanitizeSettings({ aiModel: model }).aiModel, model)
  }
  assert.equal(sanitizeSettings({ aiPanelMode: 'hacked' }).aiPanelMode, 'closed')
  assert.equal(sanitizeSettings({ aiModel: 'gpt-x' }).aiModel, 'deepseek-flash')
  assert.equal(sanitizeSettings({ aiIncludeContext: 'true' }).aiIncludeContext, false)
  assert.equal(sanitizeSettings({ aiPanelWidth: 9999 }).aiPanelWidth, 560)
  assert.equal(sanitizeSettings({ aiPanelWidth: 1 }).aiPanelWidth, 320)
  assert.equal(sanitizeSettings({ aiPanelWidth: 400 }).aiPanelWidth, 400)
})

test('StateStore：AI 设置持久化', async (t) => {
  const file = await makeTempFile(t)
  const store = new StateStore(file)
  store.load()
  store.updateSettings({ aiPanelMode: 'open', aiPanelWidth: 420, aiModel: 'deepseek-v4-pro', aiIncludeContext: true })
  const reloaded = new StateStore(file)
  reloaded.load()
  const settings = reloaded.getSettings()
  assert.equal(settings.aiPanelMode, 'open')
  assert.equal(settings.aiPanelWidth, 420)
  assert.equal(settings.aiModel, 'deepseek-v4-pro')
  assert.equal(settings.aiIncludeContext, true)
})

test('StateStore：首次加载使用默认值，更新后持久化', async (t) => {
  const file = await makeTempFile(t)
  const store = new StateStore(file)
  store.load()
  assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS)
  assert.deepEqual(store.getRecentFiles(), [])

  store.updateSettings({ theme: 'dark', fontSize: 17 })
  store.addRecent('file', 'D:\\notes\\a.md')
  store.addRecent('folder', 'D:\\notes')

  const reloaded = new StateStore(file)
  reloaded.load()
  assert.equal(reloaded.getSettings().theme, 'dark')
  assert.equal(reloaded.getSettings().fontSize, 17)
  assert.equal(reloaded.getSettings().lastFile, 'D:\\notes\\a.md')
  assert.deepEqual(reloaded.getRecentFiles(), ['D:\\notes\\a.md'])
  assert.deepEqual(reloaded.getRecentFolders(), ['D:\\notes'])

  reloaded.clearRecent('file')
  assert.deepEqual(reloaded.getRecentFiles(), [])
  assert.deepEqual(reloaded.getRecentFolders(), ['D:\\notes'])

  const third = new StateStore(file)
  third.load()
  assert.deepEqual(third.getRecentFiles(), [])
})

test('StateStore：损坏的状态文件回落默认值', async (t) => {
  const file = await makeTempFile(t)
  await fsp.writeFile(file, '{ this is not json', 'utf8')
  const store = new StateStore(file)
  store.load()
  assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS)
})

test('StateStore：窗口状态清洗与持久化', async (t) => {
  const file = await makeTempFile(t)
  const store = new StateStore(file)
  store.load()
  store.setWindowState({ width: 1400, height: 900, x: 120, y: 80, maximized: true })

  const reloaded = new StateStore(file)
  reloaded.load()
  assert.deepEqual(reloaded.getWindowState(), { width: 1400, height: 900, x: 120, y: 80, maximized: true })

  reloaded.setWindowState({ width: 100, height: 100 })
  assert.deepEqual(reloaded.getWindowState(), { width: 900, height: 600, x: null, y: null, maximized: false })
})

test('StateStore：重命名后替换最近路径，删除后移除', async (t) => {
  const file = await makeTempFile(t)
  const store = new StateStore(file)
  store.load()
  store.addRecent('file', 'D:\\notes\\a.md')
  store.addRecent('folder', 'D:\\notes')
  store.replaceRecentPath('D:\\notes\\a.md', 'D:\\notes\\b.md')
  assert.deepEqual(store.getRecentFiles(), ['D:\\notes\\b.md'])
  assert.equal(store.getSettings().lastFile, 'D:\\notes\\b.md')

  store.removeRecentPath('D:\\notes')
  assert.deepEqual(store.getRecentFolders(), [])
  // 删除文件夹时，其下所有最近文件一并从列表移除
  assert.deepEqual(store.getRecentFiles(), [])
})

test('sanitizeState：窗口与最近列表结构清洗', () => {
  const state = sanitizeState({
    settings: { theme: 'dark' },
    recentFiles: ['D:\\a.md'],
    recentFolders: [],
    window: { width: 1200, height: 700, x: 10, y: 20, maximized: 'yes' },
  })
  assert.equal(state.settings.theme, 'dark')
  assert.deepEqual(state.recentFiles, ['D:\\a.md'])
  assert.deepEqual(state.window, { width: 1200, height: 700, x: 10, y: 20, maximized: true })

  const empty = sanitizeState(null)
  assert.deepEqual(empty.settings, DEFAULT_SETTINGS)
  assert.deepEqual(empty.recentFiles, [])
  assert.equal(empty.window, null)
})
