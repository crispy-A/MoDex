/**
 * MoDex · AI 写作助手面板（渲染层 v1）
 *
 * 职责：面板三态（closed / open / rail）、模型菜单、历史会话、流式消息渲染、
 * 快捷提问、上下文开关、设置弹窗（API Key / 模型 / 连接测试）。
 *
 * 安全边界：本模块绝不接触 API Key 明文；所有网络与密钥存储都在主进程，
 * 通过 window.api.ai.* 的 IPC 白名单交互（preload 由主进程侧提供）。
 */

import { $, $$, el, clamp, copyText, makeDragResizer } from './util.js'
import { icons } from './icons.js'
import { renderMarkdown } from './markdown.js'

const FALLBACK_MODELS = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    description: '快速、通用',
    capabilities: ['reasoning', 'vision'],
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: '更强推理，支持工具 / 联网（后续开放）',
    capabilities: ['reasoning', 'tools', 'web_search'],
  },
]
const DEFAULT_MODEL = 'deepseek-flash'
const HINT_NORMAL = 'Enter 发送 · Shift+Enter 换行'
const HINT_GENERATING = '生成中 · 可随时停止'
const PANEL_MODES = ['closed', 'open', 'rail']
const OVERLAY_MAX_WIDTH = 1180
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 560
const DEFAULT_PANEL_WIDTH = 360
const TITLE_LIMIT = 24
const STREAM_RENDER_INTERVAL = 50

let MODULE_ID = 0

function genId(prefix) {
  MODULE_ID += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${MODULE_ID.toString(36)}${random}`
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now())
  try {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

function formatRelative(timestamp) {
  const time = Number(timestamp)
  if (!Number.isFinite(time) || time <= 0) return ''
  const diff = Date.now() - time
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  const date = new Date(time)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time >= startOfToday) return `今天 ${formatTime(time)}`
  if (time >= startOfToday - 24 * 60 * 60 * 1000) return '昨天'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatDuration(ms) {
  const value = Number(ms)
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`
  return `${Math.round(value / 60000)}m`
}

function humanError(error) {
  if (!error) return { code: 'UNKNOWN', message: '请求失败，请重试', retryable: true }
  if (typeof error === 'string') return { code: 'UNKNOWN', message: error, retryable: true }
  return {
    code: error.code || 'UNKNOWN',
    message: error.message || '请求失败，请重试',
    retryable: error.retryable !== false,
    status: error.status,
  }
}

/**
 * 初始化 AI 面板。
 * deps: {
 *   api, toast, persistSettings, getSettings,
 *   getDocumentContext: () => ({ fileName, content, selectionText, wordCount })
 * }
 */
export function initAiPanel(deps = {}) {
  const getSettings = () =>
    deps.getSettings?.() || {
      aiPanelMode: 'closed',
      aiPanelWidth: DEFAULT_PANEL_WIDTH,
      aiModel: DEFAULT_MODEL,
      aiIncludeContext: false,
    }
  const aiApi = deps.api?.ai || null
  const toast = deps.toast || {}

  const appEl = $('#app')
  const panel = $('#ai-panel')
  const resizer = $('#ai-resizer')
  const toggleBtn = $('#ai-toggle')
  const messagesEl = $('#ai-messages')
  const welcomeEl = $('#ai-welcome')
  const composer = $('#ai-composer')
  const sendBtn = $('#ai-send')
  const stopBtn = $('#ai-stop')
  const hintEl = $('#ai-hint')
  const modelButton = $('#ai-model-button')
  const modelLabel = $('#ai-model-label')
  const modelMenu = $('#ai-model-menu')
  const historyBtn = $('#ai-history')
  const historyPopover = $('#ai-history-popover')
  const contextToggle = $('#ai-context-toggle')
  const contextLabel = $('#ai-context-label')
  const contextMeta = $('#ai-context-meta')
  const settingsOverlay = $('#ai-settings')
  const keyInput = $('#ai-key-input')
  const keySave = $('#ai-key-save')
  const keyClear = $('#ai-key-clear')
  const modelSelect = $('#ai-model-select')
  const testConnectionBtn = $('#ai-test-connection')
  const connectionStatusEl = $('#ai-connection-status')
  const settingsStatusEl = $('#ai-settings-status')
  const settingsClose = $('#ai-settings-close')
  const sessionMini = $('#ai-session-list-mini')
  const welcomeStatus = $('#ai-welcome-status')
  const railMark = $('.ai-rail-mark')

  let aiAvailable = Boolean(aiApi)
  let models = FALLBACK_MODELS.slice()
  let hasKey = false
  let maskedKey = ''
  let providerName = 'DeepSeek'
  let defaultModelId = DEFAULT_MODEL
  let mode = 'closed'
  let panelWidth = DEFAULT_PANEL_WIDTH
  let currentSession = null
  let activeRequest = null
  let lastFailedRequest = null
  let sessions = []
  let unsubscribeEvent = null
  let modelMenuOpen = false
  let historyOpen = false
  let clearConfirmTimer = null
  let clearConfirming = false
  let pendingNewChat = false
  let pendingRestoreId = null
  let lastUsageText = ''
  let dragStartWidth = DEFAULT_PANEL_WIDTH
  let destroyed = false

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

  function currentSettings() {
    return getSettings()
  }

  function currentModel() {
    const value = currentSettings().aiModel
    return models.some((model) => model.id === value) ? value : defaultModelId
  }

  function findModel(modelId) {
    return models.find((model) => model.id === modelId) || models[0] || FALLBACK_MODELS[0]
  }

  function showToast(message, type = 'info') {
    if (typeof toast.show === 'function') toast.show(message, type)
    else if (type === 'error' && typeof toast.error === 'function') toast.error(message)
    else if (typeof toast.info === 'function') toast.info(message)
  }

  function isScrollNearBottom() {
    if (!messagesEl) return true
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 96
  }

  function scrollToBottom(force = true) {
    if (!messagesEl) return
    if (!force && !isScrollNearBottom()) return
    messagesEl.scrollTop = messagesEl.scrollHeight
  }

  function setSettingsStatus(message, state = 'info') {
    if (!settingsStatusEl) return
    settingsStatusEl.textContent = message || ''
    settingsStatusEl.hidden = !message
    if (state === 'success' || state === 'error') settingsStatusEl.dataset.state = state
    else delete settingsStatusEl.dataset.state
  }

  function setConnectionStatus(message, state = 'idle') {
    if (!connectionStatusEl) return
    connectionStatusEl.textContent = message || '未测试'
    if (state === 'testing' || state === 'success' || state === 'error') {
      connectionStatusEl.dataset.state = state
    } else {
      delete connectionStatusEl.dataset.state
    }
  }

  function setUsageHint(text) {
    lastUsageText = text || ''
    const usageEl = $('#ai-usage-hint')
    if (usageEl) usageEl.textContent = lastUsageText
  }

  // -------------------------------------------------------------------------
  // 面板布局 / 三态
  // -------------------------------------------------------------------------

  function applyPanelWidth() {
    const next = Math.round(clamp(Number(panelWidth) || DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH))
    panelWidth = next
    if (appEl) appEl.style.setProperty('--ai-panel-width', `${next}px`)
  }

  function isOverlayWidth() {
    return window.innerWidth < OVERLAY_MAX_WIDTH
  }

  function syncOverlayAttribute() {
    if (!appEl) return
    const overlay = mode === 'open' && isOverlayWidth()
    appEl.dataset.aiOverlay = overlay ? 'true' : 'false'
    if (resizer) resizer.hidden = mode !== 'open' || overlay
  }

  /** 面板开合/换态时短暂启用网格列过渡（拖拽调宽不受影响） */
  let layoutAnimTimer = null
  function animateLayout() {
    if (!appEl) return
    appEl.classList.add('is-layout-anim')
    if (layoutAnimTimer) clearTimeout(layoutAnimTimer)
    layoutAnimTimer = setTimeout(() => {
      layoutAnimTimer = null
      appEl.classList.remove('is-layout-anim')
    }, 240)
  }

  function setMode(nextMode, { persist = true, focus = false } = {}) {
    if (!PANEL_MODES.includes(nextMode)) return
    const previousMode = mode
    mode = nextMode
    if (previousMode !== nextMode) animateLayout()
    const open = nextMode === 'open'
    if (panel) {
      panel.hidden = nextMode === 'closed'
      panel.dataset.mode = nextMode
    }
    if (resizer) resizer.hidden = nextMode !== 'open'
    if (appEl) appEl.dataset.aiPanel = nextMode
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', String(open))
      toggleBtn.classList.toggle('is-active', open)
    }
    syncOverlayAttribute()
    if (open) {
      applyPanelWidth()
      refreshContext()
      if (focus) focusComposer()
      scrollToBottom(false)
    } else {
      closeModelMenu()
      closeHistory()
    }
    if (persist) deps.persistSettings?.({ aiPanelMode: nextMode })
  }

  function togglePanel() {
    if (!aiAvailable) {
      showToast('AI 功能未就绪，请更新到支持 AI 的版本', 'error')
      return
    }
    if (mode === 'open') setMode('closed')
    else setMode('open', { focus: true })
  }

  function openPanel() {
    if (!aiAvailable) {
      showToast('AI 功能未就绪，请更新到支持 AI 的版本', 'error')
      return
    }
    setMode('open', { focus: true })
  }

  function collapseToRail() {
    setMode('rail', { focus: false })
  }

  function focusComposer() {
    if (!composer) return
    try {
      composer.focus({ preventScroll: true })
    } catch {
      composer.focus()
    }
  }

  function onWindowResize() {
    if (mode === 'open') syncOverlayAttribute()
  }

  // -------------------------------------------------------------------------
  // 上下文 / 快捷提问
  // -------------------------------------------------------------------------

  function docContext() {
    try {
      return deps.getDocumentContext?.() || {}
    } catch (error) {
      console.warn('[MoDex] 读取 AI 上下文失败', error)
      return {}
    }
  }

  function refreshContext() {
    if (!contextToggle || !contextLabel) return
    const settings = currentSettings()
    const doc = docContext()
    const fileName = doc.fileName || (doc.path ? String(doc.path).split(/[\\/]/).pop() : '')
    const hasDoc = Boolean(fileName && typeof doc.content === 'string')
    const selectionText = typeof doc.selectionText === 'string' ? doc.selectionText : ''
    const wordCount = Number(doc.wordCount) || 0

    contextToggle.disabled = !hasDoc
    contextLabel.textContent = hasDoc ? `当前文档 · ${fileName}` : '未打开文档'
    const checked = Boolean(settings.aiIncludeContext) && hasDoc
    contextToggle.dataset.checked = checked ? 'true' : 'false'
    contextToggle.setAttribute('aria-pressed', String(checked))
    contextToggle.title = hasDoc
      ? checked
        ? '已启用：发送消息时附带当前文档'
        : '点击启用：发送消息时附带当前文档'
      : '未打开文档'
    if (contextMeta) {
      if (!hasDoc) contextMeta.textContent = ''
      else if (checked) contextMeta.textContent = `约 ${wordCount} 字 · 随消息发送`
      else contextMeta.textContent = `约 ${wordCount} 字`
    }

    const polishSub = $('[data-quick-polish-sub]')
    if (polishSub) {
      polishSub.textContent = selectionText
        ? `已选 ${selectionText.length} 字`
        : '先在编辑器中选中文字'
    }
    updateQuickPrompts()
    updateWelcomeStatus()
    updateComposerPlaceholder(hasDoc, selectionText)
  }

  function updateComposerPlaceholder(hasDoc, selectionText) {
    if (!composer) return
    const settings = currentSettings()
    if (!aiAvailable) composer.placeholder = 'AI 功能未就绪'
    else if (!hasKey) composer.placeholder = '配置 API Key 后开始对话'
    else if (!hasDoc) composer.placeholder = '向 AI 提问…'
    else if (selectionText) composer.placeholder = '向 AI 提问，或润色选中的文字…'
    else composer.placeholder = '向 AI 提问，或让它改写当前文档…'
    if (!settings.aiIncludeContext && hasDoc) return
  }

  function updateQuickPrompts() {
    const doc = docContext()
    const fileName = doc.fileName || ''
    const selectionText = typeof doc.selectionText === 'string' ? doc.selectionText : ''
    const canUseDoc = Boolean(fileName && aiAvailable)
    const summary = $('[data-quick-prompt="summary"]')
    const outline = $('[data-quick-prompt="outline"]')
    const polish = $('[data-quick-prompt="polish"]')
    if (summary) {
      summary.disabled = !(canUseDoc && hasKey)
      summary.title = summary.disabled ? '打开文档并配置 API Key 后可用' : '发送时附带当前文档'
    }
    if (outline) {
      outline.disabled = !(canUseDoc && hasKey)
      outline.title = outline.disabled ? '打开文档并配置 API Key 后可用' : '发送时附带当前文档'
    }
    if (polish) {
      polish.disabled = !(selectionText && aiAvailable && hasKey)
      polish.title = polish.disabled ? (selectionText ? '配置 API Key 后可用' : '先在编辑器中选中文字') : '发送时附带选中内容'
    }
  }

  function updateWelcomeStatus() {
    if (!welcomeStatus) return
    welcomeStatus.replaceChildren()
    let message = ''
    let showConfig = false
    if (!aiAvailable) {
      message = 'AI 功能未就绪：请确认应用已完整更新。'
    } else if (!hasKey) {
      message = '尚未配置 API Key。'
      showConfig = true
    } else if (!docContext().fileName) {
      message = '打开一个文档后，可让 AI 总结、润色或续写内容。'
    }
    welcomeStatus.hidden = !message
    if (!message) return
    welcomeStatus.append(document.createTextNode(message))
    if (showConfig) {
      const button = el('button', { type: 'button', text: '配置 AI 设置' })
      button.addEventListener('click', () => openSettings())
      welcomeStatus.append(button)
    }
  }

  function toggleContext() {
    const doc = docContext()
    if (!doc.fileName) {
      showToast('请先打开一个文档', 'info')
      return
    }
    const settings = currentSettings()
    const next = !settings.aiIncludeContext
    deps.persistSettings?.({ aiIncludeContext: next })
    settings.aiIncludeContext = next
    refreshContext()
  }

  function insertContextReference() {
    const doc = docContext()
    if (!composer) return
    if (!doc.fileName) {
      showToast('请先打开一个文档', 'info')
      return
    }
    const settings = currentSettings()
    if (!settings.aiIncludeContext) {
      deps.persistSettings?.({ aiIncludeContext: true })
      settings.aiIncludeContext = true
      refreshContext()
    }
    composer.focus()
  }

  // -------------------------------------------------------------------------
  // 模型
  // -------------------------------------------------------------------------

  function renderModelMenu() {
    if (!modelMenu) return
    const active = currentModel()
    modelMenu.replaceChildren()
    for (const model of models) {
      const row = el('li', { dataset: { modelId: model.id } })
      if (model.id === active) row.dataset.checked = 'true'
      const button = el('button', { type: 'button', className: 'ai-pop-row' })
      button.append(
        el('span', { className: 'ai-pop-text' }, [
          el('span', { className: 'ai-pop-title', text: model.label || model.id }),
          el('span', { className: 'ai-pop-sub', text: model.description || model.id }),
        ]),
        el('span', {
          className: 'ai-pop-check',
          text: model.id === active ? '✓' : '',
          'aria-hidden': 'true',
        })
      )
      row.append(button)
      // 整行可点，兼容 e2e 直接点击 li[data-model-id] 的情况
      row.addEventListener('click', (event) => {
        event.preventDefault()
        selectModel(model.id)
        closeModelMenu()
      })
      modelMenu.append(row)
    }
    modelMenu.append(el('li', { className: 'ai-pop-sep', role: 'separator' }))
    const settingsRow = el('li')
    const settingsButton = el('button', { type: 'button', className: 'ai-pop-row' })
    settingsButton.append(
      el('span', { className: 'ai-pop-icon', html: icons.settings }),
      el('span', { className: 'ai-pop-text' }, [el('span', { className: 'ai-pop-title', text: 'AI 设置…' })])
    )
    settingsButton.addEventListener('click', () => {
      closeModelMenu()
      openSettings()
    })
    settingsRow.append(settingsButton)
    modelMenu.append(settingsRow)
  }

  function updateModelLabel() {
    if (modelLabel) modelLabel.textContent = findModel(currentModel()).label
    if (modelButton) modelButton.title = `${findModel(currentModel()).label} · 切换模型`
  }

  function renderModelSelect() {
    if (!modelSelect) return
    modelSelect.replaceChildren()
    for (const model of models) {
      modelSelect.append(el('option', { value: model.id, text: model.label || model.id }))
    }
    modelSelect.value = currentModel()
  }

  function selectModel(modelId, { persist = true } = {}) {
    if (!models.some((model) => model.id === modelId)) return
    const settings = currentSettings()
    settings.aiModel = modelId
    if (currentSession) currentSession.model = modelId
    if (persist) deps.persistSettings?.({ aiModel: modelId })
    updateModelLabel()
    renderModelMenu()
    renderModelSelect()
  }

  function toggleModelMenu() {
    if (!modelMenu) return
    if (modelMenuOpen) {
      closeModelMenu()
      return
    }
    closeHistory()
    renderModelMenu()
    modelMenuOpen = true
    modelMenu.hidden = false
    if (modelButton) modelButton.setAttribute('aria-expanded', 'true')
  }

  function closeModelMenu() {
    if (!modelMenu || !modelMenuOpen) return
    modelMenuOpen = false
    modelMenu.hidden = true
    if (modelButton) modelButton.setAttribute('aria-expanded', 'false')
  }

  // -------------------------------------------------------------------------
  // 会话 / 历史
  // -------------------------------------------------------------------------

  function createSession(firstText) {
    const title = String(firstText || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT) || '新对话'
    return {
      id: genId('s'),
      title,
      model: currentModel(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
  }

  function sessionSnapshot() {
    if (!currentSession) return null
    const messages = currentSession.messages
      .filter((message) => message && message.status !== 'streaming')
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: String(message.content || ''),
        reasoning: String(message.reasoning || ''),
        status: message.status || 'done',
        usage: message.usage || undefined,
        error: message.error || undefined,
        durationMs: Number(message.durationMs) || undefined,
        createdAt: message.createdAt || Date.now(),
      }))
    return {
      id: currentSession.id,
      title: currentSession.title,
      model: currentSession.model || currentModel(),
      createdAt: currentSession.createdAt,
      updatedAt: Date.now(),
      messages,
    }
  }

  async function saveCurrentSession() {
    if (!aiApi || typeof aiApi.saveSession !== 'function') return
    const snapshot = sessionSnapshot()
    if (!snapshot || !snapshot.messages.length) return
    try {
      await aiApi.saveSession(snapshot)
      await refreshSessions({ silent: true })
    } catch (error) {
      console.warn('[MoDex] 保存 AI 会话失败', error)
    }
  }

  async function refreshSessions({ silent = false } = {}) {
    if (!aiApi || typeof aiApi.listSessions !== 'function') {
      renderSessionMini([])
      return
    }
    try {
      const result = await aiApi.listSessions()
      if (result && result.ok === false) throw new Error(result.error || '读取历史失败')
      sessions = Array.isArray(result?.sessions) ? result.sessions.slice(0, 200) : []
      renderSessionMini(sessions)
      if (historyOpen) renderHistory()
    } catch (error) {
      if (!silent) console.warn('[MoDex] 读取 AI 历史失败', error)
      renderSessionMini(sessions)
    }
  }

  function renderSessionMini(list) {
    if (!sessionMini) return
    const recent = (list || []).slice(0, 3)
    sessionMini.replaceChildren()
    sessionMini.hidden = recent.length === 0
    if (!recent.length) return
    sessionMini.append(el('div', { className: 'ai-session-mini-title', text: '最近对话' }))
    for (const session of recent) {
      const row = el('button', { type: 'button', className: 'ai-session-mini-row' })
      row.append(
        el('span', { html: icons.clock, 'aria-hidden': 'true' }),
        el('span', { className: 'ai-session-mini-text', text: session.title || '未命名对话' }),
        el('span', { className: 'ai-session-mini-time', text: formatRelative(session.updatedAt) })
      )
      row.addEventListener('click', () => restoreSession(session.id))
      sessionMini.append(row)
    }
  }

  function renderHistory() {
    if (!historyPopover) return
    historyPopover.replaceChildren()
    if (!sessions.length) {
      historyPopover.append(el('p', { className: 'ai-history-empty', text: '还没有历史对话' }))
      return
    }
    for (const session of sessions) {
      const row = el('li', { className: 'ai-history-row', dataset: { sessionId: session.id } })
      const main = el('button', { type: 'button', className: 'ai-history-main' })
      main.append(
        el('span', { className: 'ai-history-title', text: session.title || '未命名对话' }),
        el('span', {
          className: 'ai-history-meta',
          text: `${formatRelative(session.updatedAt)}${session.messageCount ? ` · ${session.messageCount} 条` : ''}`,
        })
      )
      const deleteBtn = el('button', {
        type: 'button',
        className: 'ai-history-delete',
        dataset: { sessionDelete: session.id },
        title: '删除对话',
        'aria-label': '删除对话',
      })
      deleteBtn.innerHTML = icons.trash
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        void deleteSession(session.id)
      })
      row.append(main, deleteBtn)
      // 整行可点（删除按钮已 stopPropagation），兼容 e2e 点击 li[data-session-id]
      row.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-session-delete]')) return
        restoreSession(session.id)
      })
      historyPopover.append(row)
    }
  }

  function openHistory() {
    if (!historyPopover) return
    if (historyOpen) {
      closeHistory()
      return
    }
    closeModelMenu()
    historyOpen = true
    historyPopover.hidden = false
    historyPopover.replaceChildren(el('p', { className: 'ai-history-empty', text: '加载中…' }))
    void refreshSessions({ silent: true }).then(() => {
      if (historyOpen) renderHistory()
    })
  }

  function closeHistory() {
    if (!historyPopover || !historyOpen) return
    historyOpen = false
    historyPopover.hidden = true
  }

  async function restoreSession(sessionId) {
    if (!aiApi || typeof aiApi.getSession !== 'function') return
    if (activeRequest) {
      showToast('请先停止当前生成', 'info')
      return
    }
    closeHistory()
    closeModelMenu()
    try {
      const result = await aiApi.getSession(sessionId)
      if (!result || result.ok === false || !result.session) throw new Error(result?.error || '会话不存在')
      currentSession = {
        id: result.session.id,
        title: result.session.title || '未命名对话',
        model: result.session.model || currentModel(),
        createdAt: result.session.createdAt || Date.now(),
        updatedAt: result.session.updatedAt || Date.now(),
        messages: Array.isArray(result.session.messages) ? result.session.messages.slice() : [],
      }
      if (currentSession.model) selectModel(currentSession.model, { persist: false })
      renderSession()
      setMode('open', { focus: true })
    } catch (error) {
      showToast(`读取对话失败：${error?.message || error}`, 'error')
    }
  }

  async function deleteSession(sessionId) {
    if (!aiApi || typeof aiApi.deleteSession !== 'function') return
    try {
      await aiApi.deleteSession(sessionId)
      sessions = sessions.filter((session) => session.id !== sessionId)
      if (currentSession?.id === sessionId) resetConversation()
      renderSessionMini(sessions)
      if (historyOpen) renderHistory()
    } catch (error) {
      showToast(`删除对话失败：${error?.message || error}`, 'error')
    }
  }

  function renderSession() {
    if (!messagesEl || !welcomeEl) return
    if (welcomeEl.parentElement !== messagesEl) messagesEl.append(welcomeEl)
    messagesEl.replaceChildren(welcomeEl)
    const messages = currentSession?.messages || []
    for (const message of messages) {
      if (message.status === 'streaming') continue
      const article = renderMessage(message)
      if (article) messagesEl.append(article)
    }
    welcomeEl.hidden = messages.length > 0
    scrollToBottom(true)
    updateWelcomeStatus()
  }

  function resetConversation() {
    currentSession = null
    lastFailedRequest = null
    pendingNewChat = false
    pendingRestoreId = null
    if (messagesEl && welcomeEl) {
      messagesEl.replaceChildren(welcomeEl)
      welcomeEl.hidden = false
    }
    refreshContext()
    refreshSessions({ silent: true })
    focusComposer()
  }

  function newChat() {
    closeModelMenu()
    closeHistory()
    if (activeRequest) {
      pendingNewChat = true
      requestStop()
      return
    }
    resetConversation()
  }

  // -------------------------------------------------------------------------
  // 消息渲染
  // -------------------------------------------------------------------------

  function buildMeta(message) {
    const meta = el('div', { className: 'ai-msg-meta' })
    if (message.role === 'user') {
      meta.textContent = formatTime(message.createdAt)
    } else {
      meta.append(
        el('span', { html: icons.ai, className: 'ai-msg-meta-icon', 'aria-hidden': 'true' }),
        el('span', { className: 'ai-msg-model', text: findModel(message.model || currentModel()).label }),
        el('span', { text: '·' }),
        el('span', { text: formatTime(message.createdAt) })
      )
    }
    return meta
  }

  function ensureReasoning(article, message) {
    if (!article || !message) return null
    const existing = article.querySelector('.ai-reasoning')
    if (!message.reasoning) {
      if (existing) existing.remove()
      return null
    }
    let details = existing
    if (!details) {
      details = el('details', { className: 'ai-reasoning', dataset: { reasoning: '' } })
      details.append(
        el('summary', { text: '已深度思考' }),
        el('div', { className: 'ai-reasoning-body' })
      )
      const body = article.querySelector('.ai-msg-body')
      if (body) article.insertBefore(details, body)
      else article.append(details)
    }
    const summary = details.querySelector('summary')
    if (summary) {
      const duration = formatDuration(message.durationMs)
      summary.textContent = duration ? `已深度思考 ${duration}` : '已深度思考'
    }
    const body = details.querySelector('.ai-reasoning-body')
    if (body) body.textContent = message.reasoning
    return details
  }

  function decorateCodeBlocks(container) {
    if (!container) return
    for (const pre of container.querySelectorAll('pre')) {
      if (pre.querySelector('.ai-code-copy')) continue
      const button = el('button', { type: 'button', className: 'ai-code-copy', title: '复制代码' })
      button.innerHTML = `${icons.copy}<span>复制</span>`
      button.addEventListener('click', async (event) => {
        event.stopPropagation()
        const code = pre.querySelector('code')
        const text = code ? code.textContent : pre.textContent
        await safeCopy(text)
      })
      pre.append(button)
    }
  }

  async function safeCopy(text) {
    try {
      await copyText(String(text ?? ''))
      showToast('已复制', 'success')
    } catch (error) {
      showToast('复制失败', 'error')
      console.warn('[MoDex] 复制失败', error)
    }
  }

  function ensureUsage(article, message) {
    let usage = article.querySelector('.ai-msg-usage')
    if (!usage) {
      usage = el('div', { className: 'ai-msg-usage' })
      article.append(usage)
    }
    usage.textContent = usageText(message)
    usage.hidden = !usage.textContent
    return usage
  }

  function usageText(message) {
    if (!message) return ''
    if (message.status === 'streaming') return ''
    if (message.status === 'cancelled') return '已停止生成'
    if (message.status === 'error') return message.error?.code ? `错误代码 ${message.error.code}` : ''
    if (message.status === 'incomplete') return message.incompleteReason ? `回答被截断：${message.incompleteReason}` : '回答被截断'
    const usage = message.usage || {}
    const parts = []
    if (usage.input) parts.push(`输入 ${Number(usage.input).toLocaleString('en-US')}`)
    if (usage.output) parts.push(`输出 ${Number(usage.output).toLocaleString('en-US')}`)
    const tokens = parts.length ? `${parts.join(' · ')} tokens` : ''
    const duration = formatDuration(message.durationMs)
    return [tokens, duration].filter(Boolean).join(' · ')
  }

  function renderErrorCard(message) {
    const error = humanError(message.error)
    const card = el('div', { className: 'ai-error-card', dataset: { errorCode: error.code } })
    const title = el('div', { className: 'ai-error-title' })
    title.innerHTML = `${icons.alert}<span>请求失败</span>`
    const description = el('p', { className: 'ai-error-message', text: error.message })
    const actions = el('div', { className: 'ai-error-actions' })
    const retry = el('button', {
      type: 'button',
      className: 'ai-error-btn',
      dataset: { retry: '' },
      text: '重试',
    })
    retry.addEventListener('click', () => retryLast())
    actions.append(retry)
    if (['AUTH', 'NO_KEY', 'BALANCE', 'INVALID_REQUEST'].includes(error.code)) {
      const openSettingsBtn = el('button', {
        type: 'button',
        className: 'ai-error-btn ai-error-link',
        dataset: { openSettings: '' },
        text: '打开 AI 设置',
      })
      openSettingsBtn.addEventListener('click', () => openSettings())
      actions.append(openSettingsBtn)
    }
    card.append(title, description, actions)
    return card
  }

  function renderMessage(message) {
    if (!message) return null
    const article = el('article', {
      className: 'ai-msg',
      dataset: { role: message.role, status: message.status || 'done', messageId: message.id },
    })
    article.append(buildMeta(message))
    if (message.role === 'assistant') ensureReasoning(article, message)
    const body = el('div', {
      className: message.role === 'assistant' ? 'ai-msg-body ai-markdown' : 'ai-msg-body',
    })
    article.append(body)

    if (message.role === 'user') {
      body.textContent = message.content
      return article
    }

    if (message.status === 'error' && message.error) {
      if (message.content) {
        body.innerHTML = renderMarkdown(message.content)
        decorateCodeBlocks(body)
      }
      article.append(renderErrorCard(message))
    } else {
      body.innerHTML = message.content ? renderMarkdown(message.content) : ''
      decorateCodeBlocks(body)
    }
    if (message.status === 'streaming') {
      body.append(el('span', { className: 'ai-stream-cursor', 'aria-hidden': 'true' }))
    }
    ensureUsage(article, message)
    const actions = el('div', { className: 'ai-msg-actions' })
    if (message.content) {
      const copy = el('button', { type: 'button', className: 'ai-msg-action', dataset: { copy: '' } })
      copy.innerHTML = `${icons.copy}<span>复制</span>`
      copy.addEventListener('click', () => safeCopy(message.content))
      actions.append(copy)
    }
    if (actions.childElementCount) article.append(actions)
    return article
  }

  function updateAssistantMessage(article, message) {
    if (!article) return
    article.dataset.status = message.status
    const body = article.querySelector('.ai-msg-body')
    if (body) {
      body.innerHTML = message.content ? renderMarkdown(message.content) : ''
      decorateCodeBlocks(body)
      if (message.status === 'streaming') {
        body.append(el('span', { className: 'ai-stream-cursor', 'aria-hidden': 'true' }))
      }
    }
    ensureReasoning(article, message)
    if (message.status === 'error' && message.error) {
      const existing = article.querySelector('.ai-error-card')
      if (existing) existing.remove()
      article.append(renderErrorCard(message))
    }
    if (message.status !== 'streaming') ensureUsage(article, message)

    let actions = article.querySelector('.ai-msg-actions')
    if (message.status !== 'streaming' && message.content) {
      if (!actions) {
        actions = el('div', { className: 'ai-msg-actions' })
      }
      if (!actions.querySelector('[data-copy]')) {
        const copy = el('button', { type: 'button', className: 'ai-msg-action', dataset: { copy: '' } })
        copy.innerHTML = `${icons.copy}<span>复制</span>`
        copy.addEventListener('click', () => safeCopy(message.content))
        actions.replaceChildren(copy)
      }
      if (!actions.isConnected) article.append(actions)
    } else if (message.status === 'streaming' && actions) {
      actions.remove()
    }
  }

  // -------------------------------------------------------------------------
  // 发送 / 流式事件
  // -------------------------------------------------------------------------

  function buildMessagesForRequest() {
    if (!currentSession) return []
    return currentSession.messages
      .filter(
        (message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          message.status !== 'streaming' &&
          message.status !== 'error' &&
          String(message.content || '').trim()
      )
      .map((message) => ({ role: message.role, content: String(message.content) }))
  }

  function buildSendContext({ forceContext = false, selectionOnly = false } = {}) {
    const doc = docContext()
    const settings = currentSettings()
    if (selectionOnly) {
      const selectionText = String(doc.selectionText || '')
      if (!selectionText.trim()) return undefined
      return {
        fileName: doc.fileName || '选中内容',
        content: selectionText,
      }
    }
    if (!forceContext && !settings.aiIncludeContext) return undefined
    if (!doc.fileName || typeof doc.content !== 'string' || !doc.content.trim()) return undefined
    return { fileName: doc.fileName, content: doc.content }
  }

  function setGenerating(generating) {
    if (sendBtn) {
      sendBtn.hidden = generating
      sendBtn.disabled = generating
    }
    if (stopBtn) {
      stopBtn.hidden = !generating
      stopBtn.disabled = false
      const label = stopBtn.querySelector('span:last-child')
      if (label) label.textContent = '停止生成'
    }
    if (hintEl) hintEl.textContent = generating ? HINT_GENERATING : HINT_NORMAL
    if (panel) panel.dataset.generating = generating ? 'true' : 'false'
    if (railMark) railMark.classList.toggle('is-generating', generating)
  }

  function resetComposer() {
    if (!composer) return
    composer.value = ''
    autosizeComposer()
  }

  function autosizeComposer() {
    if (!composer) return
    composer.style.height = 'auto'
    const next = Math.min(132, Math.max(38, composer.scrollHeight))
    composer.style.height = `${next}px`
  }

  async function sendMessage(text, options = {}) {
    const content = String(text ?? '').trim()
    if (!content) return
    if (!aiApi) {
      showToast('AI 功能未就绪，请更新到支持 AI 的版本', 'error')
      return
    }
    if (activeRequest) {
      showToast('正在生成上一条回答，请先停止', 'info')
      return
    }
    if (!hasKey) {
      showToast('请先在 AI 设置中配置 API Key', 'error')
      openSettings()
      return
    }

    if (!currentSession) currentSession = createSession(content)
    if (options.appendUser !== false) {
      const userMessage = {
        id: genId('m'),
        role: 'user',
        content,
        status: 'done',
        createdAt: Date.now(),
      }
      currentSession.messages.push(userMessage)
      currentSession.updatedAt = Date.now()
      if (welcomeEl) welcomeEl.hidden = true
      const article = renderMessage(userMessage)
      if (article) messagesEl.append(article)
      scrollToBottom(true)
    }

    const messages = buildMessagesForRequest()
    if (!messages.length) return
    const context = buildSendContext(options)
    const assistantMessage = {
      id: genId('m'),
      role: 'assistant',
      model: currentModel(),
      content: '',
      reasoning: '',
      status: 'streaming',
      createdAt: Date.now(),
      usage: null,
      error: null,
    }
    currentSession.messages.push(assistantMessage)
    currentSession.updatedAt = Date.now()
    const article = renderMessage(assistantMessage)
    if (article) messagesEl.append(article)
    if (welcomeEl) welcomeEl.hidden = true
    scrollToBottom(true)

    const requestId = genId('req')
    const request = {
      requestId,
      message: assistantMessage,
      article,
      content: '',
      reasoning: '',
      messages,
      context,
      text: content,
      forceContext: Boolean(options.forceContext),
      selectionOnly: Boolean(options.selectionOnly),
      renderTimer: null,
      renderPending: false,
      cancelTimer: null,
    }
    activeRequest = request
    lastFailedRequest = {
      text: content,
      forceContext: Boolean(options.forceContext),
      selectionOnly: Boolean(options.selectionOnly),
    }
    setGenerating(true)
    resetComposer()
    setUsageHint('')
    scrollToBottom(true)

    const payload = { requestId, model: currentModel(), messages }
    if (context) payload.context = context
    try {
      const result = await aiApi.send(payload)
      if (result && result.ok === false) {
        finishFailed(request, result.error || result)
      }
    } catch (error) {
      finishFailed(request, { code: 'NETWORK', message: error?.message || '请求失败', retryable: true })
    }
  }

  function scheduleRequestRender(request) {
    if (!request || request.renderPending) return
    request.renderPending = true
    request.renderTimer = setTimeout(() => {
      request.renderPending = false
      request.renderTimer = null
      if (activeRequest !== request) return
      updateAssistantMessage(request.article, request.message)
      scrollToBottom(false)
    }, STREAM_RENDER_INTERVAL)
  }

  function flushRequestRender(request) {
    if (!request) return
    if (request.renderTimer) {
      clearTimeout(request.renderTimer)
      request.renderTimer = null
    }
    request.renderPending = false
    updateAssistantMessage(request.article, request.message)
  }

  function finishSuccess(request, payload) {
    if (!request) return
    request.message.status = 'done'
    request.message.content = request.content
    request.message.reasoning = request.reasoning
    request.message.usage = payload?.usage || { input: 0, output: 0, total: 0 }
    request.message.durationMs =
      Number(payload?.durationMs) || Math.max(0, Date.now() - (request.message.createdAt || Date.now()))
    flushRequestRender(request)
    setUsageHint(usageText(request.message))
    finishRequest()
    void saveCurrentSession()
  }

  function finishIncomplete(request, payload) {
    if (!request) return
    request.message.status = 'incomplete'
    request.message.content = request.content
    request.message.reasoning = request.reasoning
    request.message.usage = payload?.usage || { input: 0, output: 0, total: 0 }
    request.message.incompleteReason = payload?.reason || '达到输出上限'
    request.message.durationMs =
      Number(payload?.durationMs) || Math.max(0, Date.now() - (request.message.createdAt || Date.now()))
    flushRequestRender(request)
    finishRequest()
    void saveCurrentSession()
  }

  function finishCancelled(request) {
    if (!request) return
    request.message.status = 'cancelled'
    request.message.content = request.content
    request.message.reasoning = request.reasoning
    flushRequestRender(request)
    finishRequest()
    void saveCurrentSession()
    if (pendingNewChat) {
      pendingNewChat = false
      resetConversation()
    } else if (pendingRestoreId) {
      const id = pendingRestoreId
      pendingRestoreId = null
      void restoreSession(id)
    }
  }

  function finishFailed(request, errorPayload) {
    if (!request) return
    const error = humanError(errorPayload)
    request.message.status = 'error'
    request.message.content = request.content
    request.message.reasoning = request.reasoning
    request.message.error = error
    flushRequestRender(request)
    finishRequest()
    void saveCurrentSession()
  }

  function finishRequest() {
    if (activeRequest?.cancelTimer) clearTimeout(activeRequest.cancelTimer)
    activeRequest = null
    setGenerating(false)
  }

  function handleAiEvent(payload) {
    if (!payload || typeof payload !== 'object') return
    const request = activeRequest
    if (!request || payload.requestId !== request.requestId) return
    switch (payload.type) {
      case 'started':
        break
      case 'text_delta':
        request.content += String(payload.delta || '')
        request.message.content = request.content
        scheduleRequestRender(request)
        break
      case 'reasoning_delta':
        request.reasoning += String(payload.delta || '')
        request.message.reasoning = request.reasoning
        request.message.durationMs = 0
        scheduleRequestRender(request)
        break
      case 'completed':
        finishSuccess(request, payload)
        break
      case 'incomplete':
        finishIncomplete(request, payload)
        break
      case 'cancelled':
        finishCancelled(request)
        break
      case 'failed':
        finishFailed(request, payload.error)
        break
      default:
        break
    }
  }

  async function requestStop() {
    const request = activeRequest
    if (!request || !aiApi) return
    if (request.cancelTimer) return
    if (stopBtn) {
      stopBtn.disabled = true
      const label = stopBtn.querySelector('span:last-child')
      if (label) label.textContent = '停止中…'
    }
    try {
      await aiApi.cancel(request.requestId)
    } catch (error) {
      console.warn('[MoDex] 取消 AI 请求失败', error)
    }
    // 兜底：若主进程未回 cancelled 事件，本地按已停止处理，避免按钮卡死
    request.cancelTimer = setTimeout(() => {
      if (activeRequest === request) finishCancelled(request)
    }, 2500)
  }

  function retryLast() {
    if (!lastFailedRequest || activeRequest) return
    if (!currentSession) return
    const lastMessage = currentSession.messages[currentSession.messages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.status === 'error') {
      currentSession.messages.pop()
      const article = messagesEl?.querySelector(`[data-message-id="${lastMessage.id}"]`)
      if (article) article.remove()
    }
    const request = lastFailedRequest
    lastFailedRequest = null
    void sendMessage(request.text, {
      appendUser: false,
      forceContext: request.forceContext,
      selectionOnly: request.selectionOnly,
    })
  }

  // -------------------------------------------------------------------------
  // 设置弹窗
  // -------------------------------------------------------------------------

  function updateKeyUi() {
    if (keyClear) keyClear.hidden = !hasKey
    if (keyInput) {
      keyInput.value = ''
      keyInput.placeholder = hasKey ? maskedKey || '已配置 API Key' : '尚未配置 API Key'
    }
    if (testConnectionBtn) testConnectionBtn.disabled = !aiAvailable
    refreshContext()
    updateWelcomeStatus()
  }

  function openSettings() {
    if (!settingsOverlay) return
    closeModelMenu()
    closeHistory()
    settingsOverlay.hidden = false
    updateKeyUi()
    renderModelSelect()
    setConnectionStatus('未测试')
    setSettingsStatus('')
    if (keyInput) {
      keyInput.value = ''
      try {
        keyInput.focus({ preventScroll: true })
      } catch {
        keyInput.focus()
      }
    }
  }

  function closeSettings() {
    if (!settingsOverlay) return
    settingsOverlay.hidden = true
    setSettingsStatus('')
    if (keySave) keySave.disabled = false
  }

  async function saveKeyAndVerify() {
    if (!aiApi) {
      setSettingsStatus('AI 功能未就绪', 'error')
      return
    }
    const raw = String(keyInput?.value || '').trim()
    if (!raw && !hasKey) {
      setSettingsStatus('请先输入 API Key', 'error')
      return
    }
    if (keySave) {
      keySave.disabled = true
      keySave.textContent = '验证中…'
    }
    setSettingsStatus('')
    try {
      if (raw) {
        if (typeof aiApi.setKey !== 'function') throw new Error('当前版本不支持保存密钥')
        const result = await aiApi.setKey(raw)
        if (!result || result.ok === false) throw new Error(result?.error?.message || result?.error || '保存失败')
        hasKey = Boolean(result.hasKey ?? true)
        maskedKey = result.maskedKey || maskedKey
        if (keyInput) keyInput.value = ''
        updateKeyUi()
      }
      const test = await testConnection({ silent: true })
      if (!test) throw new Error('连接测试未通过')
      setConnectionStatus(test.message, 'success')
      showToast('AI 已就绪', 'success')
      closeSettings()
    } catch (error) {
      const message = error?.message || String(error) || '保存或验证失败'
      setConnectionStatus(message, 'error')
      setSettingsStatus(message, 'error')
    } finally {
      if (keySave) {
        keySave.disabled = false
        keySave.textContent = '保存并验证'
      }
    }
  }

  async function testConnection({ silent = false } = {}) {
    if (!aiApi || typeof aiApi.testConnection !== 'function') {
      const message = '当前版本不支持连接测试'
      setConnectionStatus(message, 'error')
      return null
    }
    if (!hasKey && !(keyInput && keyInput.value.trim())) {
      const message = '请先配置 API Key'
      setConnectionStatus(message, 'error')
      if (!silent) setSettingsStatus(message, 'error')
      return null
    }
    setConnectionStatus('测试中…', 'testing')
    if (testConnectionBtn) testConnectionBtn.disabled = true
    try {
      const result = await aiApi.testConnection()
      if (!result || result.ok === false) {
        throw new Error(result?.error?.message || result?.error || '连接失败')
      }
      const latency = Number(result.latencyMs) || 0
      const message = latency ? `连接成功 · ${latency}ms` : '连接成功'
      setConnectionStatus(message, 'success')
      return { ok: true, message, latencyMs: latency }
    } catch (error) {
      const message = error?.message || '连接失败'
      setConnectionStatus(message, 'error')
      if (!silent) setSettingsStatus(message, 'error')
      return null
    } finally {
      if (testConnectionBtn) testConnectionBtn.disabled = false
    }
  }

  async function clearKey() {
    if (!aiApi || typeof aiApi.clearKey !== 'function') return
    if (!clearConfirming) {
      clearConfirming = true
      if (keyClear) keyClear.textContent = '再次点击确认'
      clearTimeout(clearConfirmTimer)
      clearConfirmTimer = setTimeout(() => {
        clearConfirming = false
        if (keyClear) keyClear.textContent = '清除密钥'
      }, 3000)
      return
    }
    clearConfirming = false
    clearTimeout(clearConfirmTimer)
    if (keyClear) keyClear.textContent = '清除密钥'
    try {
      await aiApi.clearKey()
      hasKey = false
      maskedKey = ''
      updateKeyUi()
      setConnectionStatus('未测试')
      setSettingsStatus('已清除本机保存的 API Key', 'success')
    } catch (error) {
      setSettingsStatus(`清除失败：${error?.message || error}`, 'error')
    }
  }

  // -------------------------------------------------------------------------
  // 初始化
  // -------------------------------------------------------------------------

  function bindEvents() {
    toggleBtn?.addEventListener('click', () => togglePanel())
    $('#ai-expand')?.addEventListener('click', () => openPanel())
    $('#ai-collapse')?.addEventListener('click', () => collapseToRail())
    $('#ai-new-chat')?.addEventListener('click', () => newChat())
    $('#ai-rail-new-chat')?.addEventListener('click', () => {
      setMode('open', { focus: false })
      newChat()
    })
    historyBtn?.addEventListener('click', () => openHistory())
    $('#ai-rail-history')?.addEventListener('click', () => {
      setMode('open', { focus: false })
      openHistory()
    })
    modelButton?.addEventListener('click', () => toggleModelMenu())
    $('#ai-settings-open')?.addEventListener('click', () => openSettings())
    settingsClose?.addEventListener('click', () => closeSettings())
    sendBtn?.addEventListener('click', () => {
      if (activeRequest) return
      void sendMessage(composer?.value || '')
    })
    stopBtn?.addEventListener('click', () => requestStop())
    contextToggle?.addEventListener('click', () => toggleContext())
    $('#ai-context-insert')?.addEventListener('click', () => insertContextReference())
    $('#ai-settings')?.addEventListener('click', (event) => {
      if (event.target === settingsOverlay) closeSettings()
    })
    keySave?.addEventListener('click', () => saveKeyAndVerify())
    keyClear?.addEventListener('click', () => clearKey())
    testConnectionBtn?.addEventListener('click', () => void testConnection())
    modelSelect?.addEventListener('change', () => {
      selectModel(modelSelect.value)
    })
    settingsOverlay?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSettings()
      }
    })

    composer?.addEventListener('input', () => autosizeComposer())
    composer?.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!sendBtn?.hidden) void sendMessage(composer.value)
      }
    })

    // 拖拽面板左缘调整宽度（320–560，结束持久化）
    if (resizer) {
      makeDragResizer(resizer, {
        onStart: () => {
          dragStartWidth = panelWidth
        },
        onDrag: ({ dx }) => {
          if (mode !== 'open') return
          panelWidth = Math.round(clamp(dragStartWidth - dx, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH))
          applyPanelWidth()
        },
        onEnd: () => {
          if (mode !== 'open' || !deps.persistSettings) return
          deps.persistSettings({ aiPanelWidth: panelWidth })
        },
      })
    }

    for (const quick of $$('[data-quick-prompt]')) {
      quick.addEventListener('click', () => {
        if (quick.disabled) return
        const kind = quick.dataset.quickPrompt
        if (kind === 'summary') {
          void sendMessage('总结当前文档', { forceContext: true })
        } else if (kind === 'outline') {
          void sendMessage('生成文档大纲', { forceContext: true })
        } else if (kind === 'polish') {
          const doc = docContext()
          if (!doc.selectionText) {
            showToast('请先在编辑器中选中要润色的文字', 'info')
            return
          }
          void sendMessage('润色选中内容', { forceContext: true, selectionOnly: true })
        }
      })
    }

    messagesEl?.addEventListener('click', (event) => {
      const source = event.target instanceof Element ? event.target : null
      if (!source) return
      const copyButton = source.closest('[data-copy]')
      if (copyButton) {
        const article = copyButton.closest('.ai-msg')
        const messageId = article?.dataset.messageId
        const message = currentSession?.messages.find((item) => item.id === messageId)
        if (message) void safeCopy(message.content)
        return
      }
      const retryButton = source.closest('[data-retry]')
      if (retryButton) {
        retryLast()
        return
      }
      const settingsButton = source.closest('[data-open-settings]')
      if (settingsButton) openSettings()
    })

    document.addEventListener('click', (event) => {
      const source = event.target instanceof Element ? event.target : null
      if (!source) return
      if (modelMenuOpen && !source.closest('#ai-model-menu') && !source.closest('#ai-model-button')) {
        closeModelMenu()
      }
      if (historyOpen && !source.closest('#ai-history-popover') && !source.closest('#ai-history')) {
        closeHistory()
      }
    })

    panel?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if (modelMenuOpen) {
        event.preventDefault()
        event.stopPropagation()
        closeModelMenu()
        return
      }
      if (historyOpen) {
        event.preventDefault()
        event.stopPropagation()
        closeHistory()
        return
      }
      if (activeRequest) {
        event.preventDefault()
        event.stopPropagation()
        requestStop()
        return
      }
      if (mode === 'open') {
        event.preventDefault()
        event.stopPropagation()
        setMode('closed')
      }
    })

    window.addEventListener('resize', onWindowResize)
  }

  async function loadBootstrap() {
    if (!aiApi) {
      aiAvailable = false
      setGenerating(false)
      updateKeyUi()
      updateWelcomeStatus()
      updateQuickPrompts()
      return
    }
    try {
      const info = await aiApi.bootstrap()
      if (info && info.ok !== false) {
        if (Array.isArray(info.models) && info.models.length) models = info.models.slice()
        if (info.provider?.name) providerName = info.provider.name
        if (info.defaultModel) defaultModelId = info.defaultModel
        hasKey = Boolean(info.hasKey)
        maskedKey = info.maskedKey || ''
      } else if (info?.error) {
        showToast(`读取 AI 配置失败：${info.error?.message || info.error}`, 'error')
      }
    } catch (error) {
      console.warn('[MoDex] AI bootstrap 失败', error)
      showToast(`读取 AI 配置失败：${error?.message || error}`, 'error')
    }
    aiAvailable = true
    renderModelMenu()
    renderModelSelect()
    updateModelLabel()
    updateKeyUi()
    updateWelcomeStatus()
    updateQuickPrompts()
    await refreshSessions({ silent: true })
  }

  function subscribeEvents() {
    if (!aiApi || typeof aiApi.onEvent !== 'function') return
    try {
      const unsubscribe = aiApi.onEvent((payload) => handleAiEvent(payload))
      if (typeof unsubscribe === 'function') unsubscribeEvent = unsubscribe
    } catch (error) {
      console.warn('[MoDex] 订阅 AI 事件失败', error)
    }
  }

  function initFromSettings() {
    const settings = currentSettings()
    panelWidth = clamp(Number(settings.aiPanelWidth) || DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)
    applyPanelWidth()
    const initialMode = PANEL_MODES.includes(settings.aiPanelMode) ? settings.aiPanelMode : 'closed'
    setMode(initialMode, { persist: false, focus: false })
    refreshContext()
    updateWelcomeStatus()
    updateQuickPrompts()
    renderModelSelect()
    updateModelLabel()
  }

  function destroy() {
    destroyed = true
    const request = activeRequest
    activeRequest = null
    if (request) {
      if (request.renderTimer) clearTimeout(request.renderTimer)
      if (request.cancelTimer) clearTimeout(request.cancelTimer)
      try {
        aiApi?.cancel?.(request.requestId)
      } catch {
        /* ignore */
      }
    }
    if (typeof unsubscribeEvent === 'function') {
      try {
        unsubscribeEvent()
      } catch {
        /* ignore */
      }
      unsubscribeEvent = null
    }
    window.removeEventListener('resize', onWindowResize)
    setGenerating(false)
  }

  // -------------------------------------------------------------------------
  // 启动
  // -------------------------------------------------------------------------

  bindEvents()
  initFromSettings()
  subscribeEvents()
  void loadBootstrap().then(() => {
    initFromSettings()
  })

  // 面板初始化后主动同步一次当前文档上下文
  refreshContext()

  return {
    toggle: () => togglePanel(),
    open: () => openPanel(),
    close: () => setMode('closed'),
    collapse: () => collapseToRail(),
    expand: () => openPanel(),
    refreshContext: () => refreshContext(),
    refreshSessions: () => refreshSessions({ silent: true }),
    openSettings: () => openSettings(),
    getMode: () => mode,
    get currentSession() {
      return currentSession
    },
    get generating() {
      return Boolean(activeRequest)
    },
    destroy,
  }
}
