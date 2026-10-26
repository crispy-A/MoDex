'use strict'

/**
 * MoDex 主进程入口：
 * - 窗口与生命周期、单实例、窗口位置记忆
 * - 自定义 app:// 协议（渲染层用 ES Module 加载，本地图片按扩展名白名单代理）
 * - 全部 IPC（文件系统、原生对话框、设置、最近列表、Shell）
 * - 文件夹变更监听（fs.watch + 防抖通知渲染层刷新文件树）
 * - 开发/验收辅助：--screenshot 截图、--e2e 端到端脚本、--user-data 隔离数据目录
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, screen, nativeTheme } = require('electron')
const fs = require('node:fs')
const fsp = fs.promises
const path = require('node:path')

const fsService = require('./fs-service.js')
const { StateStore } = require('./state-store.js')
const { createAppMenu, showAbout, showShortcuts } = require('./menu.js')

const APP_ROOT = path.join(__dirname, '..', '..')
const RENDERER_DIR = path.join(APP_ROOT, 'src', 'renderer')
const PRELOAD_PATH = path.join(APP_ROOT, 'src', 'preload', 'preload.js')
const ASSETS_DIR = path.join(APP_ROOT, 'assets')
const ICON_PATH = path.join(ASSETS_DIR, 'icon.ico')

const APP_ID = 'com.aq.modex'
const APP_TITLE = 'MoDex'
const MAX_WATCH_DELAY = 250

// ---------------------------------------------------------------- 命令行参数

const FLAG_MAP = {
  '--root': 'root',
  '-r': 'root',
  '--open': 'open',
  '-o': 'open',
  '--screenshot': 'screenshot',
  '--e2e': 'e2e',
  '--screenshots': 'screenshots',
  '--autosave-test': 'autosaveTest',
  '--user-data': 'userData',
  '--delay': 'delayMs',
}

const cli = parseCliArgs(process.argv.slice(app.isPackaged ? 1 : 2))

function parseCliArgs(argv) {
  const result = {
    root: null,
    open: null,
    screenshot: null,
    e2e: null,
    screenshots: null,
    autosaveTest: null,
    userData: null,
    delayMs: 1200,
  }
  const queue = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    if (arg.startsWith('--') && eq > 0) {
      const key = FLAG_MAP[arg.slice(0, eq)]
      if (key) result[key] = arg.slice(eq + 1)
      continue
    }
    const key = FLAG_MAP[arg]
    if (key) {
      const value = argv[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        result[key] = value
        i += 1
      }
      continue
    }
    if (!arg.startsWith('-')) queue.push(arg)
  }
  if (typeof result.delayMs === 'string') {
    const num = Number(result.delayMs)
    result.delayMs = Number.isFinite(num) ? Math.max(0, num) : 1200
  }
  // 裸路径参数：文件 -> 打开文件；目录 -> 作为根目录
  for (const candidate of queue) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.isDirectory() && !result.root) result.root = path.resolve(candidate)
      else if (stat.isFile() && !result.open) result.open = path.resolve(candidate)
    } catch {
      // 忽略无法解析的参数
    }
  }
  for (const key of ['root', 'open', 'screenshot', 'e2e', 'screenshots', 'autosaveTest', 'userData']) {
    if (result[key]) result[key] = path.resolve(result[key])
  }
  return result
}

if (cli.userData) {
  app.setPath('userData', cli.userData)
  app.setPath('sessionData', path.join(cli.userData, 'session'))
}

// ---------------------------------------------------------------- 全局状态

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {StateStore | null} */
let store = null
let isDirty = false
let forceClose = false
let closeDialogOpen = false
let pendingCloseTimeout = null

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])
const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const CSP_HEADER =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' app: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
const IMAGE_CSP_HEADER = "default-src 'none'; style-src 'unsafe-inline'"

// ---------------------------------------------------------------- 工具函数

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isInside(parentDir, childPath) {
  const relative = path.relative(parentDir, childPath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function effectiveDark() {
  const theme = store ? store.getSettings().theme : 'system'
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return nativeTheme.shouldUseDarkColors
}

function windowBackground() {
  return effectiveDark() ? '#16181d' : '#f7f8fa'
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createMenu() {
  Menu.setApplicationMenu(createAppMenu({ getWindow: () => mainWindow }))
}

// ---------------------------------------------------------------- 自定义协议

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host === 'bundle') {
        const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '')) || 'index.html'
        const target = path.resolve(RENDERER_DIR, relative)
        if (target !== RENDERER_DIR && !isInside(RENDERER_DIR, target)) {
          return new Response('Forbidden', { status: 403 })
        }
        const data = await fsp.readFile(target)
        const ext = path.extname(target).toLowerCase()
        const headers = { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' }
        if (ext === '.html') {
          headers['content-security-policy'] = CSP_HEADER
        }
        return new Response(data, { headers })
      }

      if (url.host === 'file') {
        const absolute = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
        if (!absolute || !path.isAbsolute(absolute)) {
          return new Response('Bad path', { status: 400 })
        }
        const ext = path.extname(absolute).toLowerCase()
        if (!IMAGE_EXTENSIONS.has(ext)) {
          return new Response('Forbidden', { status: 403 })
        }
        const stat = await fsp.stat(absolute)
        if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) {
          return new Response('Forbidden', { status: 403 })
        }
        const data = await fsp.readFile(absolute)
        return new Response(data, {
          headers: {
            'content-type': MIME_TYPES[ext] || 'application/octet-stream',
            'cache-control': 'no-store',
            // 图片（尤其 SVG）不允许执行脚本或加载子资源
            'content-security-policy': IMAGE_CSP_HEADER,
          },
        })
      }

      return new Response('Not found', { status: 404 })
    } catch (err) {
      return new Response(`Not found: ${err && err.message ? err.message : 'unknown'}`, { status: 404 })
    }
  })
}

// ---------------------------------------------------------------- 文件夹监听（多根）

/** rootPath -> { watcher, timer } */
const watchers = new Map()

/** 找出变更路径所属的根（最长前缀匹配），用于把 fs 变更精确通知到对应根 */
function rootForPath(changedPath) {
  if (!changedPath || watchers.size === 0) return null
  let normalized
  try {
    normalized = path.resolve(String(changedPath))
  } catch {
    return null
  }
  let matched = null
  for (const root of watchers.keys()) {
    if (normalized === root || isInside(root, normalized)) {
      if (!matched || root.length > matched.length) matched = root
    }
  }
  return matched
}

function notifyTreeChanged(changedPath) {
  const root = rootForPath(changedPath)
  if (root) sendToRenderer('fs:tree-changed', root)
}

function stopWatchingRoot(rootPath) {
  const entry = watchers.get(rootPath)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  try {
    entry.watcher.close()
  } catch {
    /* 忽略关闭异常 */
  }
  watchers.delete(rootPath)
}

function stopAllWatchers() {
  for (const rootPath of [...watchers.keys()]) stopWatchingRoot(rootPath)
}

function startWatchingRoot(rootPath) {
  if (!rootPath || watchers.has(rootPath)) return
  try {
    const entry = { watcher: null, timer: null }
    entry.watcher = fs.watch(rootPath, { recursive: true }, () => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = null
        if (watchers.has(rootPath)) sendToRenderer('fs:tree-changed', rootPath)
      }, MAX_WATCH_DELAY)
    })
    entry.watcher.on('error', () => stopWatchingRoot(rootPath))
    watchers.set(rootPath, entry)
  } catch (err) {
    console.warn('[watch] 无法监听文件夹：', err.message)
  }
}

/** 把监听集合同步为给定的根列表（新增的启动监听，移除的停止监听） */
function syncWatchers(rootPaths) {
  const next = new Set(rootPaths)
  for (const rootPath of [...watchers.keys()]) {
    if (!next.has(rootPath)) stopWatchingRoot(rootPath)
  }
  for (const rootPath of next) startWatchingRoot(rootPath)
  return [...watchers.keys()]
}

// ---------------------------------------------------------------- 窗口

function restoreWindowState(options) {
  const saved = store ? store.getWindowState() : null
  if (!saved) return options
  const displays = screen.getAllDisplays()
  const visible =
    saved.x === null ||
    saved.y === null ||
    displays.some((display) => {
      const area = display.workArea
      return saved.x >= area.x - 40 && saved.y >= area.y - 40 && saved.x < area.x + area.width - 80 && saved.y < area.y + area.height - 80
    })
  if (visible && saved.x !== null && saved.y !== null) {
    options.x = saved.x
    options.y = saved.y
  }
  options.width = saved.width
  options.height = saved.height
  return options
}

function createWindow() {
  const options = restoreWindowState({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_TITLE,
    backgroundColor: windowBackground(),
    autoHideMenuBar: false,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  mainWindow = new BrowserWindow(options)
  const win = mainWindow

  // 隐藏系统原生菜单栏：菜单已合并进 40px 工具栏（渲染层自绘）。
  // 应用菜单对象仍然保留（Menu.setApplicationMenu），以维持原生快捷键与 role 行为。
  win.setMenuBarVisibility(false)

  win.once('ready-to-show', () => {
    if (isDirty) win.setTitle(`${APP_TITLE} · 未保存`)
    if (store && store.getWindowState() && store.getWindowState().maximized) win.maximize()
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('app://bundle/')) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {})
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] 渲染进程异常退出：', details)
  })

  win.on('resize', scheduleWindowStateSave)
  win.on('move', scheduleWindowStateSave)
  win.on('maximize', scheduleWindowStateSave)
  win.on('unmaximize', scheduleWindowStateSave)

  win.on('close', (event) => {
    if (forceClose || !isDirty) return
    event.preventDefault()
    if (closeDialogOpen) return
    closeDialogOpen = true
    // 自动保存后关闭：不再询问「保存 / 不保存 / 取消」。
    // 渲染层收到后自动保存当前文档，成功后调用 app:request-close 关闭窗口；
    // 保存失败/取消则调用 app:close-cancelled，窗口保持打开。
    sendToRenderer('app:close-requested')
    if (pendingCloseTimeout) clearTimeout(pendingCloseTimeout)
    pendingCloseTimeout = setTimeout(() => {
      pendingCloseTimeout = null
      closeDialogOpen = false
    }, 30000)
  })

  win.on('closed', () => {
    stopAllWatchers()
    if (mainWindow === win) mainWindow = null
  })

  win.loadURL('app://bundle/index.html')
  return win
}

let windowStateTimer = null
function scheduleWindowStateSave() {
  if (windowStateTimer) clearTimeout(windowStateTimer)
  windowStateTimer = setTimeout(saveWindowState, 400)
}

function saveWindowState() {
  if (!store || !mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getNormalBounds()
  store.setWindowState({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: mainWindow.isMaximized(),
  })
}

/** 等待页面加载完成（带超时） */
function waitForDidFinishLoad(win, timeoutMs = 20000) {
  if (!win.webContents.isLoading()) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    win.webContents.once('did-finish-load', finish)
    win.webContents.once('did-fail-load', finish)
  })
}

// ---------------------------------------------------------------- IPC 注册

function registerIpc() {
  // 只接受主窗口渲染进程（app://bundle/ 页面）发起的 IPC，防止其他 frame/来源调用
  const isTrustedSender = (event) => {
    try {
      if (!event || !event.sender) return false
      const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
      if (!contents || event.sender !== contents) return false
      const frame = event.senderFrame
      if (!frame || typeof frame.url !== 'string') return false
      return frame.url.startsWith('app://bundle/')
    } catch {
      return false
    }
  }

  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        console.warn(`[ipc] 拒绝非法来源调用：${channel}`)
        return fsService.fail('EACCES', '非法调用来源')
      }
      try {
        return await handler(event, ...args)
      } catch (err) {
        console.error(`[ipc] ${channel} 失败：`, err)
        return fsService.fail('UNKNOWN', err && err.message ? err.message : '操作失败')
      }
    })
  }

  ipcMain.on('app:dirty', (event, dirty) => {
    if (!isTrustedSender(event)) return
    isDirty = Boolean(dirty)
    if (!isDirty && pendingCloseTimeout) {
      clearTimeout(pendingCloseTimeout)
      pendingCloseTimeout = null
      closeDialogOpen = false
    }
  })

  ipcMain.on('app:request-close', (event) => {
    if (!isTrustedSender(event)) return
    if (pendingCloseTimeout) clearTimeout(pendingCloseTimeout)
    closeDialogOpen = false
    forceClose = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
  })

  // 渲染层在「关闭前保存」被取消或失败时回调，解除关闭确认锁，允许用户再次点关闭
  ipcMain.on('app:close-cancelled', (event) => {
    if (!isTrustedSender(event)) return
    if (pendingCloseTimeout) clearTimeout(pendingCloseTimeout)
    pendingCloseTimeout = null
    closeDialogOpen = false
  })

  handle('app:bootstrap', () => {
    const settings = store.getSettings()
    const initialRoot = cli.root || (cli.open ? path.dirname(cli.open) : null)
    return {
      settings,
      recentFiles: store.getRecentFiles(),
      recentFolders: store.getRecentFolders(),
      initial: { file: cli.open, root: initialRoot },
      paths: {
        home: app.getPath('home'),
        documents: app.getPath('documents'),
        desktop: app.getPath('desktop'),
      },
      appVersion: app.getVersion(),
    }
  })

  // 应用菜单（自绘单条导航栏）触发的原生命令：role 类动作与帮助对话框
  handle('app:menu-command', async (_event, command) => {
    if (!mainWindow || mainWindow.isDestroyed()) return fsService.fail('UNKNOWN', '窗口不可用')
    const contents = mainWindow.webContents
    switch (String(command || '')) {
      case 'undo':
        contents.undo()
        break
      case 'redo':
        contents.redo()
        break
      case 'cut':
        contents.cut()
        break
      case 'copy':
        contents.copy()
        break
      case 'paste':
        contents.paste()
        break
      case 'selectAll':
        contents.selectAll()
        break
      case 'togglefullscreen':
        mainWindow.setFullScreen(!mainWindow.isFullScreen())
        break
      case 'toggleDevTools':
        contents.toggleDevTools()
        break
      case 'help:about':
        await showAbout(mainWindow)
        break
      case 'help:shortcuts':
        await showShortcuts(mainWindow)
        break
      case 'app:quit':
        mainWindow.close()
        break
      default:
        return fsService.fail('EINVAL', `未知菜单命令：${command}`)
    }
    return { ok: true }
  })

  // ------------------------------------------------------------ 原生对话框

  handle('dialog:open-folder', async () => {
    const settings = store.getSettings()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开文件夹',
      defaultPath: settings.lastFolder || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '打开',
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const folderPath = result.filePaths[0]
    store.addRecent('folder', folderPath)
    // 监听由渲染层添加根后调用 fs:set-roots 统一建立
    return { canceled: false, path: folderPath }
  })

  handle('dialog:open-file', async () => {
    const settings = store.getSettings()
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开 Markdown 文件',
      defaultPath: settings.lastFolder || app.getPath('documents'),
      properties: ['openFile'],
      filters: [
        { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }
    const filePath = result.filePaths[0]
    const read = await fsService.readFile(filePath)
    if (!read.ok) return { canceled: false, error: read.error }
    store.addRecent('file', filePath)
    return { canceled: false, path: filePath, content: read.content, size: read.size, mtimeMs: read.mtimeMs }
  })

  handle('dialog:save-file', async (_event, suggestedPath) => {
    const settings = store.getSettings()
    let defaultPath = suggestedPath
    if (!defaultPath || !path.isAbsolute(defaultPath)) {
      defaultPath = path.join(settings.lastFolder || app.getPath('documents'), '未命名.md')
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '另存为',
      defaultPath,
      buttonLabel: '保存',
      filters: [{ name: 'Markdown 文件', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    let filePath = result.filePath
    const ext = path.extname(filePath).toLowerCase()
    if (!ext) filePath += '.md'
    else if (!fsService.isMarkdownPath(filePath)) filePath = `${filePath}.md`
    return { canceled: false, path: filePath }
  })

  handle('dialog:confirm-unsaved', async (_event, fileName) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: APP_TITLE,
      message: `“${fileName || '未命名.md'}”有未保存的修改`,
      detail: '要继续操作吗？',
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (response === 0) return 'save'
    if (response === 1) return 'discard'
    return 'cancel'
  })

  handle('dialog:confirm-delete', async (_event, displayPath) => {
    const name = path.basename(String(displayPath || ''))
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: APP_TITLE,
      message: `确定要删除“${name}”吗？`,
      detail: '文件或空文件夹会被移到系统回收站，可以从回收站恢复。',
      buttons: ['移到回收站', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return response === 0
  })

  handle('dialog:confirm-file-conflict', async (_event, fileName) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: APP_TITLE,
      message: `“${fileName || '当前文档'}”已被其他程序修改`,
      detail:
        '磁盘上的内容与编辑器中的内容不一致。\n覆盖保存会丢失外部修改；重新加载会丢弃编辑器中的未保存内容。',
      buttons: ['覆盖保存', '重新加载', '取消'],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    })
    if (response === 0) return 'overwrite'
    if (response === 1) return 'reload'
    return 'cancel'
  })

  handle('dialog:message', async (_event, opts = {}) => {
    await dialog.showMessageBox(mainWindow, {
      type: opts.type === 'error' || opts.type === 'warning' ? opts.type : 'info',
      title: APP_TITLE,
      message: String(opts.message || ''),
      detail: opts.detail ? String(opts.detail) : undefined,
      buttons: ['确定'],
      noLink: true,
    })
  })

  // ------------------------------------------------------------ 文件系统

  handle('fs:list-dir', async (_event, dirPath) => fsService.listDir(dirPath))

  handle('fs:read-file', async (_event, filePath) => {
    const result = await fsService.readFile(filePath)
    if (result.ok) store.addRecent('file', filePath)
    return result
  })

  handle('fs:write-file', async (_event, payload = {}) => {
    const result = await fsService.writeFile(payload.filePath, payload.content)
    if (result.ok) store.addRecent('file', payload.filePath)
    return result
  })

  handle('fs:create-file', async (_event, payload = {}) => {
    const result = await fsService.createFile(payload.dirPath, payload.name, payload.content || '')
    if (result.ok) {
      store.addRecent('file', result.path)
      notifyTreeChanged(result.path)
    }
    return result
  })

  handle('fs:create-folder', async (_event, payload = {}) => {
    const result = await fsService.createFolder(payload.dirPath, payload.name)
    if (result.ok) notifyTreeChanged(result.path)
    return result
  })

  handle('fs:rename', async (_event, payload = {}) => {
    const result = await fsService.rename(payload.targetPath, payload.newName)
    if (result.ok) {
      store.replaceRecentPath(payload.targetPath, result.path)
      notifyTreeChanged(payload.targetPath)
    }
    return result
  })

  handle('fs:remove', async (_event, targetPath) => {
    const result = await fsService.remove(targetPath, {
      trash: (p) => shell.trashItem(p),
    })
    if (result.ok) {
      store.removeRecentPath(targetPath)
      notifyTreeChanged(targetPath)
    }
    return result
  })

  handle('fs:path-info', async (_event, targetPath) => fsService.pathInfo(targetPath))

  handle('fs:set-roots', async (_event, rootPaths) => {
    if (!Array.isArray(rootPaths)) return fsService.fail('EINVAL', '根目录列表必须是数组')
    const normalized = []
    for (const candidate of rootPaths.slice(0, 12)) {
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      if (!path.isAbsolute(candidate)) continue
      const resolved = path.resolve(candidate)
      if (!normalized.includes(resolved)) normalized.push(resolved)
    }
    const watched = syncWatchers(normalized)
    return { ok: true, watched }
  })

  // ------------------------------------------------------------ Shell

  handle('shell:reveal', async (_event, targetPath) => {
    if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
      return fsService.fail('EINVAL', '路径必须是绝对路径')
    }
    shell.showItemInFolder(targetPath)
    return { ok: true }
  })

  handle('shell:open-external', async (_event, url) => {
    const text = String(url || '')
    if (!/^https?:\/\//i.test(text)) return fsService.fail('EINVAL', '只允许打开 http/https 链接')
    await shell.openExternal(text)
    return { ok: true }
  })

  // ------------------------------------------------------------ 设置 / 最近

  handle('settings:save', async (_event, patch) => {
    const settings = store.updateSettings(patch)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(windowBackground())
    }
    return settings
  })

  handle('recent:add', async (_event, payload = {}) => {
    store.addRecent(payload.kind === 'folder' ? 'folder' : 'file', payload.p)
    return { ok: true }
  })

  handle('recent:clear', async (_event, kind) => {
    store.clearRecent(kind === 'file' || kind === 'folder' ? kind : 'all')
    return { ok: true }
  })
}

// ---------------------------------------------------------------- 启动

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // 应用已运行时再次双击 .md / 文件夹：把目标路径转发给渲染层打开
    try {
      const secondCli = parseCliArgs(argv.slice(app.isPackaged ? 1 : 2))
      const target = secondCli.open || secondCli.root
      if (target) sendToRenderer('app:open-path', target)
    } catch (err) {
      console.warn('[second-instance] 解析命令行参数失败：', err)
    }
  })

  app.whenReady().then(async () => {
    store = new StateStore(path.join(app.getPath('userData'), 'state.json'))
    store.load()

    registerAppProtocol()
    registerIpc()
    createWindow()
    createMenu()

    // 恢复上次打开的文件夹监听（由渲染层在 bootstrap 后统一调用 fs:set-roots，这里不再预建立）

    const win = mainWindow
    if (!win) return

    if (cli.e2e) {
      await waitForDidFinishLoad(win)
      if (!win.isVisible()) {
        await Promise.race([new Promise((resolve) => win.once('show', resolve)), delay(3000)])
      }
      await delay(400)
      try {
        const { runE2E } = require('./e2e.js')
        await runE2E({ win, cli, store, paths: { appRoot: APP_ROOT, artifacts: path.join(APP_ROOT, 'artifacts') } })
      } catch (err) {
        console.error('[e2e] 执行失败：', err)
      } finally {
        forceClose = true
        app.quit()
      }
      return
    }

    if (cli.autosaveTest) {
      await waitForDidFinishLoad(win)
      if (!win.isVisible()) {
        await Promise.race([new Promise((resolve) => win.once('show', resolve)), delay(3000)])
      }
      await delay(400)
      // 超时兜底：若关闭自动保存被保存询问/异常阻塞，12s 后强制失败退出
      const failTimer = setTimeout(() => {
        console.error('[autosave-test] 超时：关闭流程未在 12s 内完成（可能弹出了保存询问）')
        forceClose = true
        app.exit(3)
      }, 12000)
      failTimer.unref?.()
      try {
        const { runAutoSaveCloseTest } = require('./e2e.js')
        await runAutoSaveCloseTest({ win, cli })
      } catch (err) {
        console.error('[autosave-test] 执行失败：', err)
        clearTimeout(failTimer)
        forceClose = true
        app.exit(3)
      }
      return
    }

    if (cli.screenshot) {
      await waitForDidFinishLoad(win)
      if (!win.isVisible()) {
        await Promise.race([new Promise((resolve) => win.once('show', resolve)), delay(3000)])
      }
      await delay(cli.delayMs)
      try {
        const image = await win.webContents.capturePage()
        await fsp.mkdir(path.dirname(cli.screenshot), { recursive: true })
        await fsp.writeFile(cli.screenshot, image.toPNG())
        console.log(`[screenshot] ${cli.screenshot}`)
      } catch (err) {
        console.error('[screenshot] 失败：', err)
      }
      forceClose = true
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    saveWindowState()
    stopAllWatchers()
  })
}
