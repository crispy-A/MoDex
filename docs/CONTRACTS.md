# MoDex 接口契约

本文档是主进程、preload、渲染进程三方共同遵守的**唯一接口事实来源**。任何一方修改接口，必须先改本文档。

- 主进程：`src/main/**`
- 预加载：`src/preload/preload.js`（已定稿，渲染层只读不改）
- 渲染进程：`src/renderer/**`
- 测试：`tests/**`

渲染进程**只能**通过 `window.api` 访问系统能力，禁止 `require`、禁止 Node API、禁止远端网络资源。

## 1. 通用约定

### 结果信封

文件系统类调用统一返回（永远 resolve，不 reject）：

```ts
type Ok<T>  = { ok: true } & T
type Err    = { ok: false, code: ErrorCode, error: string }
type Result<T> = Ok<T> | Err

type ErrorCode =
  | 'EINVAL'      // 参数不合法（路径为空、非绝对路径等）
  | 'ENOENT'      // 不存在
  | 'EEXIST'      // 同名已存在
  | 'EACCES'      // 无权限 / 被占用
  | 'EISDIR'      // 期望文件却是目录
  | 'ENOTDIR'     // 期望目录却是文件
  | 'ENOTEMPTY'   // 目录非空，不能删除
  | 'TOO_LARGE'   // 超过 5 MB 文本上限
  | 'BAD_ENCODING'// 非 UTF-8 文本
  | 'NOT_MARKDOWN'// 新建文件扩展名不是 .md / .markdown
  | 'UNKNOWN'

interface Entry {
  name: string          // 文件名（不含目录）
  path: string          // 绝对路径
  isDirectory: boolean
  isMarkdown: boolean   // .md / .markdown，大小写不敏感
  size: number          // 字节数；目录为 0
  mtimeMs: number       // 修改时间戳；目录为 0
  hidden: boolean       // 以 . 开头
}
```

`listDir` 返回的 `entries` 已排序：目录在前、文件在后，同类按名称 `localeCompare`（numeric + 中文排序）。

### 路径

- 所有路径参数/返回值均为**绝对路径**（Windows 反斜杠形式，如 `D:\notes\a.md`）。
- 名字校验（用于 createFile / createFolder / rename 的 `name`）：
  - 去空白后非空，长度 ≤ 200；
  - 不含 `\ / : * ? " < > |`，不含控制字符；
  - 不是 `.`、`..`，不以空格或 `.` 结尾；
  - 不是 Windows 保留名（`CON PRN AUX NUL COM1-9 LPT1-9`，含带扩展名形式）；
  - 新建文件扩展名必须是 `.md` 或 `.markdown`（渲染层负责在缺省时补 `.md`，主进程仍严格校验）。
- 文本读取上限 5 MB；写入内容为 UTF-8 字符串，保留原换行符（不做 CRLF/LF 归一化）。

## 2. `window.api` 完整签名

```ts
interface Bootstrap {
  settings: Settings
  recentFiles: string[]        // 最多 10 条，最近在前
  recentFolders: string[]      // 最多 10 条
  initial: { file: string | null, root: string | null }  // 来自命令行参数
  paths: { home: string, documents: string, desktop: string }
  appVersion: string
}

interface Settings {
  theme: 'system' | 'light' | 'dark'
  viewMode: 'edit' | 'split' | 'preview'
  sidebarVisible: boolean
  sidebarWidth: number          // 180–520，默认 260
  fontSize: number              // 12–24，默认 15
  autoSave: boolean             // 默认 false
  lastFolder: string | null
  lastFile: string | null
  openFolders: string[]         // 已打开的文件夹（多根工作区，绝对路径、去重、最多 12，顺序=侧栏顺序）
  activeFolder: string | null   // 最近激活的文件夹根；必须在 openFolders 中或为 null
  previewStyle: 'codex' | 'github' | 'vue' | 'notion' | 'feishu' | 'tailwind' | 'serif'   // 预览样式，默认 codex
  aiPanelMode: 'closed' | 'open' | 'rail'   // AI 面板状态，默认 closed
  aiPanelWidth: number                       // 320–560，默认 360
  aiModel: 'deepseek-flash' | 'deepseek-v4-pro'   // 默认 deepseek-flash
  aiIncludeContext: boolean                  // 发送时附带当前文档，默认 false
}

window.api = {
  platform: 'win32' | 'darwin' | 'linux'
  versions: { electron: string, chrome: string, node: string }

  // ---- 启动与窗口 ----
  bootstrap(): Promise<Bootstrap>
  setDirty(dirty: boolean): void          // 主进程据此在关闭窗口时弹保存确认
  requestClose(): void                    // 保存完成后请求真正关闭窗口
  cancelClose(): void                     // 关闭前保存被取消/失败时解除关闭确认锁，允许再次关闭

  // ---- 原生对话框（主进程弹窗） ----
  openFolder(): Promise<{ canceled: boolean, path?: string }>
  openFile(): Promise<{ canceled: boolean, path?: string, content?: string, mtimeMs?: number, size?: number, error?: string }>
  saveFileAs(suggestedPath?: string | null): Promise<{ canceled: boolean, path?: string }>
  confirmUnsaved(fileName: string): Promise<'save' | 'discard' | 'cancel'>
  confirmDelete(displayPath: string): Promise<boolean>
  confirmFileConflict(fileName: string): Promise<'overwrite' | 'reload' | 'cancel'>   // 保存前发现磁盘 mtime 变化
  messageBox(opts: { type?: 'info'|'warning'|'error', message: string, detail?: string }): Promise<void>
  runMenuCommand(command:
    | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
    | 'togglefullscreen' | 'toggleDevTools'
    | 'help:about' | 'help:shortcuts'
    | 'app:quit'
  ): Promise<{ ok: boolean }>   // 单条导航栏自绘菜单触发的原生命令

  // ---- 文件系统 ----
  listDir(dirPath: string): Promise<Result<{ path: string, entries: Entry[] }>>
  readFile(filePath: string): Promise<Result<{ path: string, content: string, size: number, mtimeMs: number }>>
  writeFile(filePath: string, content: string): Promise<Result<{ path: string, size: number, mtimeMs: number }>>
  createFile(dirPath: string, name: string, content?: string): Promise<Result<{ path: string, name: string }>>
  createFolder(dirPath: string, name: string): Promise<Result<{ path: string, name: string }>>
  rename(targetPath: string, newName: string): Promise<Result<{ path: string, name: string }>>
  remove(targetPath: string): Promise<Result<{ path: string, trashed: boolean }>>   // 文件/空目录 -> 回收站
  pathInfo(targetPath: string): Promise<Result<{
    path: string, name: string, dir: string, dirName: string,
    exists: boolean, isDirectory: boolean, isMarkdown: boolean,
    ext: string, size: number, mtimeMs: number
  }>>
  setRoots(rootPaths: string[]): Promise<{ ok: true, watched: string[] }>   // 同步多根监听集合（多文件夹工作区），返回实际监听中的根

  // ---- Shell ----
  revealInExplorer(targetPath: string): Promise<void>
  openExternal(url: string): Promise<Result<{}>>       // 仅 http/https，其余忽略

  // ---- 设置与最近列表 ----
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  addRecent(kind: 'file' | 'folder', targetPath: string): Promise<void>
  clearRecent(kind: 'file' | 'folder' | 'all'): Promise<void>

  // ---- AI 助手（DeepSeek Responses API；Key 与网络仅主进程） ----
  ai: {
    bootstrap(): Promise<AiBootstrap>
    send(payload: {
      requestId: string
      model: 'deepseek-flash' | 'deepseek-v4-pro'
      messages: Array<{ role: 'user' | 'assistant', content: string }>
      context?: { fileName: string, content: string }   // 由主进程拼进 instructions 并截断 20k 字符
    }): Promise<{ ok: true } | { ok: false, error: AiError }>
    cancel(requestId: string): Promise<{ ok: true, cancelled: boolean }>
    setKey(key: string): Promise<{ ok: true, hasKey: true, maskedKey: string } | { ok: false, error: AiError }>
    clearKey(): Promise<{ ok: true, hasKey: false }>
    testConnection(): Promise<{ ok: true, latencyMs: number } | { ok: false, error: AiError }>
    listSessions(): Promise<{ ok: true, sessions: AiSessionSummary[] }>
    getSession(id: string): Promise<{ ok: true, session: AiSession } | { ok: false, error: AiError }>
    saveSession(session: AiSession): Promise<{ ok: true } | { ok: false, error: AiError }>
    deleteSession(id: string): Promise<{ ok: true, removed: boolean }>
    onEvent(cb: (payload: AiEvent) => void): () => void
  }

  interface AiBootstrap {
    ok: true
    provider: { id: 'deepseek', name: 'DeepSeek' }
    models: Array<{ id: string, label: string, description: string, capabilities: string[] }>
    defaultModel: string
    settings: { model: string, panelMode: 'closed'|'open'|'rail', panelWidth: number, includeContext: boolean }
    hasKey: boolean
    maskedKey: string          // 形如 '••••••••abcd'；不含明文
  }

  interface AiError { code: string, message: string, retryable: boolean, status?: number, detail?: string }

  type AiEvent =
    | { requestId: string, type: 'started' }
    | { requestId: string, type: 'text_delta', delta: string }
    | { requestId: string, type: 'reasoning_delta', delta: string }
    | { requestId: string, type: 'completed', usage: { input: number, output: number, total: number }, durationMs: number }
    | { requestId: string, type: 'incomplete', usage: { input: number, output: number, total: number }, reason: string }
    | { requestId: string, type: 'cancelled' }
    | { requestId: string, type: 'failed', error: AiError }
  // AiSession / AiSessionSummary 结构见 docs/AI-PANEL-SPEC.md §3.6

  // ---- 事件（返回取消订阅函数） ----
  onMenuAction(cb: (action: MenuAction) => void): () => void
  onTreeChanged(cb: (rootPath: string) => void): () => void
  onCloseRequested(cb: () => void): () => void
  onOpenPath(cb: (targetPath: string) => void): () => void   // 应用已运行时第二实例/系统「用 MoDex 打开」转发的文件或文件夹路径

  // ---- 纯工具（同步） ----
  toAssetUrl(absPath: string): string     // 本地图片 -> 'app://file/<encoded>'，可直接放 <img src>
  dirname(p: string): string
  basename(p: string): string
  joinPath(base: string, ...parts: string[]): string
  extname(p: string): string
}

type MenuAction =
  | 'file:new' | 'file:open' | 'file:open-folder'
  | 'file:save' | 'file:save-as' | 'file:close'
  | 'edit:find'
  | 'view:edit' | 'view:split' | 'view:preview'
  | 'view:toggle-sidebar' | 'view:theme-toggle'
  | 'view:zoom-in' | 'view:zoom-out' | 'view:zoom-reset'
  | 'ai:toggle'
  | 'help:shortcuts' | 'help:about'
```

`onCloseRequested`：主进程在用户关闭窗口且文档有未保存修改（`setDirty(true)` 之后）时触发，**不再弹出保存询问**。
渲染层应自动保存当前文档（有路径静默写盘，未命名走另存为），成功后调用 `requestClose()` 关闭窗口；
保存失败/用户取消则调用 `cancelClose()`，窗口保持打开。

> 自动保存语义见 `docs/AUTOSAVE-SPEC.md`：切换文件/新建/关闭文档/关闭软件时都会自动保存；
> `confirmUnsaved` 仅保留给「删除当前文件」这一破坏性确认路径。

## 3. 按钮 → 动作（渲染层内部动作名，供 e2e 钩子与菜单共用）

`file:new` 新建文档（内存未命名缓冲）、`file:open` 打开文件、`file:open-folder` 添加文件夹（多根）、
`file:save` 保存、`file:save-as` 另存为、`file:close` 关闭当前文档、
`edit:find` 查找、`view:edit|split|preview` 切换视图、`view:toggle-sidebar` 侧栏显隐、
`view:theme-toggle` 浅色/深色切换、`view:zoom-in|out|reset` 字号。

> 工具栏精简后（见 `docs/MULTI-FOLDER-SPEC.md`），`file:new/open/open-folder/save/save-as` 只保留在应用菜单、
> 全局快捷键、欢迎页与右键菜单中；工具栏只保留 `toggle-sidebar`、三个视图入口与 `theme-toggle`。
> 原生菜单栏已隐藏并合并为单条导航栏（见 `docs/APP-MENUBAR-SPEC.md`）：四个菜单入口在渲染层自绘
> （`data-app-menu="file|edit|view|help"`），role 类动作通过 `api.runMenuCommand(command)` 调用主进程。
> `onTreeChanged(rootPath)` 在多根下携带**发生变更的那个根**；主进程按「变更路径所属根」精确通知。

## 4. 安全性约束

- 渲染进程：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（仅 preload 用 Node）。
- 页面通过自定义协议 `app://bundle/...` 加载（支持 ES Module），**不要使用 `file://`**。
- CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' app: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`。
- 所有 `ipcMain.handle/on` 通道都会校验来源：只接受主窗口 `webContents` 且 `senderFrame.url` 以 `app://bundle/` 开头的调用，其余返回 `EACCES`。
- `app://file/` 图片响应带 `CSP: default-src 'none'`，SVG 等图片内不允许执行脚本或加载子资源。
- Markdown 渲染必须 `html: false`（禁止原始 HTML），预览 `innerHTML` 只接受 markdown-it 输出。
- 预览中的链接：`http/https` → `api.openExternal`；`#锚点` → 预览内滚动；相对 `.md` 链接 → 应用内打开（解析失败则提示）。
- 预览中的图片：相对/本地路径 → `api.toAssetUrl(绝对路径)`；`http/https` 图片不自动加载（离线应用），显示为链接占位。
- 保存冲突：`saveDocument` 写盘前用 `pathInfo` 比较 `mtimeMs`，若磁盘文件已被外部修改则调用 `api.confirmFileConflict`：
  选择「覆盖保存」继续写入，「重新加载」用磁盘内容替换编辑器，「取消」不写盘。
- 应用已运行时再次「用 MoDex 打开」文件/文件夹：主进程 `second-instance` 解析参数后通过 `onOpenPath` 转发路径。
