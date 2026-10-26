# MoDex 渲染层开发规格

> 视觉与样式以 `docs/CODEX-UI-DESIGN.md`（Codex 风格设计规范）为准；本文件保留 DOM 契约、交互行为与 `__qm` 钩子等非视觉约定。
> **多文件夹工作区与工具栏精简的最新约定以 `docs/MULTI-FOLDER-SPEC.md` 为准**（多根侧栏、根行 DOM、`setRoots`、
> `__qm` 的 `rootFolders/activeFolder`、工具栏只保留 5 个入口）；本文件中单根侧栏与工具栏按钮的描述已被其替代。
> **单条导航栏（原生菜单合并进工具栏）的最新约定以 `docs/APP-MENUBAR-SPEC.md` 为准**（`data-app-menu`、`#app-menu`、
> `api.runMenuCommand`、原生菜单栏隐藏）。
> **自动保存（切换文件 / 关闭软件）的最新约定以 `docs/AUTOSAVE-SPEC.md` 为准**（`autoSaveBeforeLeave`、
> 关闭流程不再询问、`confirmUnsaved` 仅用于删除当前文件）。
> **预览样式选择（7 套内置样式）的最新约定以 `docs/PREVIEW-STYLE-SPEC.md` 为准**（Settings.previewStyle、
> 视图 → 预览样式 二级菜单、`#app[data-preview-style]`、`__qm.setPreviewStyle`）。
> **AI 对话面板（右侧 dock）的最新约定以 `docs/AI-PANEL-SPEC.md` 为准**（`window.api.ai`、面板 DOM id、
> 流式事件、上下文、历史会话、设置弹窗；Key 只在主进程）。

渲染层是纯前端（ES Modules + 原生 DOM），**不使用任何构建工具、不引入额外 npm 依赖**。
唯一第三方库是 `src/renderer/vendor/markdown-it.min.js`（UMD，暴露全局 `window.markdownit`），已在仓库中。
接口只通过 `window.api`（见 `docs/CONTRACTS.md`）。

## 1. 交付文件（所有权：renderer-dev）

```
src/renderer/index.html
src/renderer/styles.css
src/renderer/js/app.js        # 启动、状态、动作分发、快捷键、未保存流程、toast、设置持久化
src/renderer/js/tree.js       # 文件树渲染、展开折叠、右键菜单、行内新建/重命名
src/renderer/js/editor.js     # textarea 编辑器增强、查找栏、光标/字数统计、滚动同步
src/renderer/js/preview.js    # markdown 渲染、链接/图片处理、滚动同步、锚点
src/renderer/js/markdown.js   # markdown-it 配置、任务列表、标题 id、代码块语言标签
src/renderer/js/util.js       # DOM 助手、debounce、路径小工具（纯函数）、格式化
src/renderer/js/icons.js      # 内联 SVG 图标字符串
```

不要修改 `index.html`、`styles.css`、`js/**` 之外的文件。**禁止**在此目录下新增 npm 依赖或构建配置。

## 2. 页面骨架与必需 DOM id

页面加载方式：`app://bundle/index.html`（自定义协议），脚本用 `<script type="module" src="js/app.js"></script>`。
markdown-it 在 module 之前以普通 `<script src="vendor/markdown-it.min.js"></script>` 引入。
**不允许内联 `<script>`、不允许内联 `on*` 事件属性**（CSP 限制），全部用 `addEventListener`。

```html
<div id="app" data-theme="light" data-view="split">
  <header id="toolbar">
    <div class="tb-group tb-brand"><span class="brand-mark"><!-- M 标记 SVG --></span><span class="brand-name">MoDex</span></div>
    <div class="tb-group">
      <button data-action="toggle-sidebar" title="显示/隐藏侧栏 (Ctrl+B)" aria-label="切换侧栏">…</button>
      <button data-action="new-doc" title="新建文档 (Ctrl+N)">新建</button>
      <button data-action="open-file" title="打开文件 (Ctrl+O)">打开文件</button>
      <button data-action="open-folder" title="打开文件夹">打开文件夹</button>
      <button data-action="save" title="保存 (Ctrl+S)">保存</button>
      <button data-action="save-as" title="另存为 (Ctrl+Shift+S)">另存为</button>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-group" id="view-switch">
      <button data-action="view-edit">编辑</button>
      <button data-action="view-split">分栏</button>
      <button data-action="view-preview">预览</button>
    </div>
    <button data-action="theme-toggle" title="切换主题">…</button>
  </header>

  <aside id="sidebar">
    <div id="sidebar-head">
      <span id="sidebar-title">资源管理器</span>
      <div class="sidebar-actions">
        <button data-action="new-file" title="新建 Markdown 文件">…</button>
        <button data-action="new-folder" title="新建文件夹">…</button>
        <button data-action="refresh-tree" title="刷新">…</button>
      </div>
    </div>
    <div id="tree-scroll"><ul id="tree" role="tree"></ul></div>
    <div id="sidebar-empty">尚未打开文件夹<br><button data-action="open-folder">打开文件夹</button></div>
    <div id="sidebar-foot"><span id="sidebar-root"></span></div>
  </aside>

  <div id="sidebar-resizer" role="separator" aria-orientation="vertical"></div>

  <main id="main">
    <div id="doc-head">
      <span id="doc-title">未命名.md</span>
      <span id="doc-dir"></span>
      <span id="doc-dirty" title="有未保存修改">●</span>
    </div>
    <div id="panes">
      <section id="editor-pane">
        <textarea id="editor" spellcheck="false" wrap="soft" aria-label="Markdown 编辑器"></textarea>
      </section>
      <div id="pane-resizer" role="separator"></div>
      <section id="preview-pane">
        <article id="preview" class="markdown-body"></article>
      </section>
    </div>
    <div id="welcome"> … 欢迎页（无打开文档时显示）… </div>
  </main>

  <div id="findbar" hidden>
    <input id="find-input" type="text" placeholder="查找…" aria-label="查找">
    <span id="find-count">0/0</span>
    <button data-find="prev">上一个</button><button data-find="next">下一个</button>
    <button data-find="close">关闭</button>
  </div>

  <footer id="statusbar">
    <span id="status-path">就绪</span>
    <span id="status-spacer"></span>
    <span id="status-position">行 1, 列 1</span>
    <span id="status-words">0 字</span>
    <span id="status-save">已保存</span>
    <span id="status-mode">分栏</span>
  </footer>

  <div id="toasts" aria-live="polite"></div>
  <ul id="context-menu" hidden></ul>
</div>
```

要求：
- `#welcome` 无文档时铺满编辑区，含品牌区、三个主按钮（新建文档/打开文件/打开文件夹）和「最近打开」列表（文件/文件夹，带清空按钮）。
- **e2e 会用到的稳定选择器（必须遵守）**：
  - 文件树节点：`ul#tree > li.tree-item[data-path][data-type="file"|"dir"]`，每行包裹 `.tree-row`；展开状态加 `data-expanded="true"`。
  - 右键菜单项：`#context-menu li[data-menu-action]`，菜单打开时移除 `hidden` 属性。
  - 欢迎页最近项：`#welcome [data-recent-path]`。
  - 视图切换后 `#app` 的 `data-view` 必须同步为 `edit|split|preview`，主题切换后 `#app` 的 `data-theme` 必须同步为 `light|dark`。
  - 隐藏一个面板用 `display:none`（e2e 断言 `getComputedStyle(...).display === 'none'`）。
- 布局：`#app` 为 grid（工具栏行 / 主区 / 状态栏行），主区内 `sidebar | resizer | main`，`#panes` 在 split 下为 `1fr auto 1fr`，edit 模式隐藏 preview，preview 模式隐藏 editor。
- 侧栏可拖拽改宽（180–520px），分栏可拖拽调比例（25%–75%），尺寸持久化到 settings（`sidebarWidth` 已有，分栏比例可放 localStorage）。
- 所有按钮用 `data-action` 统一委托（`app.js` 里一个 click listener）。

## 3. 视觉设计（截图会被人工验收）

- 浅色：背景 `#f7f8fa`、面板 `#ffffff`、正文 `#24292f`、次要 `#6b7280`、边框 `#e5e7eb`、强调色 `#2f6feb`。
- 深色：背景 `#16181d`、面板 `#1f232b`、正文 `#e6e8eb`、次要 `#9aa1ab`、边框 `#2c313a`、强调色 `#6ea8fe`。
- 用 CSS 变量实现两套主题（`#app[data-theme="dark"]` 覆盖），`system` 用 `prefers-color-scheme` 解析后写到 data-theme。
- 工具栏 44px 高、状态栏 26px，按钮 hover/active/focus-visible 状态完整，禁用态（无文档时保存按钮）半透明。
- 编辑器：等宽字体 `"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace`，行高 1.65，字号来自 settings.fontSize，右侧留白，选中底色使用强调色 18% 透明。
- 预览排版要精致：标题层级、行内代码底色、代码块圆角+语言标签、表格斑马纹、引用左侧色条、任务列表复选框、hr、图片最大宽度 100%、链接强调色、段落间距 0.9em。
- 空状态、加载态、错误 toast（右下角、3 秒消失、可堆叠，success/error 两种颜色）。
- 窗口最小 900×600 时不出现横向滚动条；各面板独立滚动。
- 无外部字体/图片资源（离线可用），图标全部内联 SVG。

## 4. 交互行为

### 文档生命周期
- 启动：`api.bootstrap()` → 应用 settings（主题/视图/字号/侧栏）、最近列表；若 `initial.root` 打开文件树；若 `initial.file` 读取并打开；`initial.root` 为空但 settings.lastFolder 存在时**不自动打开**（避免打扰），仅填入最近列表。
- 新建文档：内存缓冲，`path=null`、`name=未命名.md`、内容为空模板（`# 未命名\n\n` 可选空），标记 dirty 但尚未写盘；首次保存走 `saveFileAs`。
- 打开文件：`api.openFile()` 或点击树节点 → 有未保存修改时先 `confirmUnsaved`；成功则显示内容并重置 dirty。
- 保存：有 path → `api.writeFile`；无 path → `saveFileAs` 后再写。成功后更新 mtime、dirty=false、toast「已保存」、`api.setDirty(false)`、`api.addRecent('file', path)`。
- 另存为：`saveFileAs(当前 path 或 最近目录/未命名.md)` → 写盘 → 当前文档切换到新路径。
- 关闭文档（菜单 `file:close`）：未保存确认后清空编辑区并显示欢迎页。
- 未保存状态：内容变化即 dirty=true；`api.setDirty(true/false)` 同步主进程；标题变 `● 文件名 — MoDex`。
- 窗口关闭：`api.onCloseRequested` 回调里执行保存（走保存流程），保存成功或用户取消后分别 `api.requestClose()` 或什么都不做。
- 自动保存：settings.autoSave 为 true 时，输入停止 2s 后自动保存（无 path 则跳过并提示一次）。

### 文件树
- 数据：`api.listDir(dir)` 递归按需展开（点击目录时仅加载该层，缓存展开状态）。
- 行渲染：缩进按层级 14px，目录有 ▸/▾ 箭头，`.md` 文件显示 md 角标；当前打开文件高亮。
- 新建文件/文件夹：侧栏工具栏按钮 → 若选中目录则建在其中，否则建在根目录；行内输入框（Enter 确认 / Esc 取消 / 失焦取消），创建成功自动刷新并打开新文件（新建文件时）。
- 右键菜单：新建文件、新建文件夹、重命名、删除、在资源管理器中显示、复制路径（`navigator.clipboard` 不可用时用隐藏 input 兜底）。
- 重命名：行内编辑，扩展名可改；成功刷新并同步当前文档路径。
- 删除：`api.confirmDelete` → `api.remove`（回收站）；若删的是当前文档，先确认未保存，然后回到欢迎页；失败 toast 显示 `error`。
- 刷新：重新加载已展开节点；`api.onTreeChanged(root)` 事件后 300ms 防抖刷新。
- 拖放：把 .md/.markdown 文件拖到窗口空白处打开（额外加分，可后置）。

### 编辑器
- 输入 → 120ms 防抖更新预览 + 字数统计。
- Tab 插入 2 空格；Shift+Tab 减少到 2 的倍数；Enter 自动续写列表前缀（`- ` `* ` `+ ` `1. ` `> `、任务列表 `- [ ] `）与有序列表递增；代码块内 Enter 不续写。
- 快捷键（textarea 聚焦时）：Ctrl+B `**选区**`、Ctrl+I `*选区*`、Ctrl+K `[选区](url)`、Ctrl+` 行内代码、Ctrl+F 查找栏、Esc 关闭查找栏。
- 查找：输入即时统计 `n/m`，Enter/下一个、Shift+Enter/上一个，循环；命中用 `setSelectionRange` 选中并滚动到可见（按行高估算 scrollTop）。不实现替换。
- 状态栏：`行 x, 列 y`、字数（中文字符按 1 字，英文按空白分词）、`已保存/未保存`、当前视图名。
- 滚动同步（split 模式）：按比例双向同步，用 `isProgrammatic` 标志防止回环；preview 模式不同步。
- 字号：Ctrl+= / Ctrl+- / Ctrl+0 调整并持久化。
- 点击「打开文件」/「新建文档」时 tab 焦点回到编辑器。

### 预览
- `markdown.js`：`window.markdownit({ html:false, linkify:true, typographer:false, breaks:false, highlight: 可选 })`；
  任务列表 `- [ ] / - [x]` 渲染成 `<input type="checkbox" disabled>`，代码围栏加 `data-lang` 标签；标题生成 slug id（中文保留）。
- `preview.js`：`preview.innerHTML = md.render(text)`；空内容显示占位提示「开始输入 Markdown…」。
- 链接点击拦截：外部 http(s) → `api.openExternal`；`#id` → 容器内滚动；相对/绝对 `.md` 路径 → 应用内打开（`api.joinPath(当前目录, href)` 后 `readFile`）。
- 图片：`src` 为 http(s)/data 时保持原样（但 http 图片因 CSP 会失败，改为加 `data-remote` 显示占位「远程图片」），本地/相对路径 → `api.toAssetUrl(绝对路径)`；解析 base 为当前文档目录。
- 预览区滚轮/滚动不同步到编辑器以外的情况要安全（无报错）。

### 键盘（全局）
**快捷键的唯一拥有者是渲染层**：主进程菜单项只用于展示提示（`registerAccelerator:false`），不会抢占按键；点击菜单时主进程会发 `onMenuAction`，渲染层必须让菜单动作与键盘动作走**同一个 dispatch 函数**（单点分发，避免重复逻辑）。

渲染层 `window.addEventListener('keydown')` 负责：
- Ctrl+N 新建、Ctrl+O 打开、Ctrl+S 保存、Ctrl+Shift+S 另存为、Ctrl+F 查找、Ctrl+W 关闭文档
- Ctrl+1 编辑、Ctrl+2 分栏、Ctrl+3 预览
- Ctrl+Shift+E 侧栏显隐、Ctrl+Shift+T 主题切换、Ctrl+= / Ctrl+- / Ctrl+0 字号
- Ctrl+B：焦点在 `#editor` 内 → 加粗；否则 → 侧栏显隐（注意 preventDefault）
- Esc：优先关闭查找栏/右键菜单
- 在输入框（查找栏、行内重命名等）内时，只处理 Ctrl+S / Ctrl+O / Ctrl+N / Esc，避免误触
- `onMenuAction` 的 `help:*` 由主进程自己弹窗，渲染层可忽略

## 5. `window.__qm` 测试钩子（e2e 必需）

```js
window.__qm = {
  ready: Promise<void>,                  // 初始化完成后 resolve
  getState(): {                                 // 供断言
    filePath: string|null, fileName: string, content: string, dirty: boolean,
    viewMode: 'edit'|'split'|'preview', theme: 'light'|'dark',
    rootFolders: string[], activeFolder: string|null, sidebarVisible: boolean,
    wordCount: number, treeFileCount: number       // treeFileCount 为所有根合计
    previewStyle: 'codex'|'github'|'vue'|'notion'|'feishu'|'tailwind'|'serif'
  },
  async openPath(path: string): Promise<void>        // 走真实打开语义：当前文档 dirty 时会先自动保存（见 AUTOSAVE-SPEC）
  async openRoot(path: string): Promise<void>        // 添加一个文件夹根（已存在则展开并激活）
  async openRoots(paths: string[]): Promise<void>    // 用给定列表替换当前根
  async removeRoot(path: string): Promise<void>      // 移除一个根（不删除磁盘内容）
  setViewMode(mode): Promise<void>
  setTheme(theme: 'light'|'dark'): Promise<void>     // 只改 DOM，不持久化
  async save(): Promise<void>
  async setPreviewStyle(style: 'codex'|'github'|'vue'|'notion'|'feishu'|'tailwind'|'serif'): Promise<void>  // 应用并持久化预览样式
}
```
`app.js` 末尾设置 `window.__qm`，并在 `ready` resolve 之后再触发 `document.documentElement.dataset.ready='1'`。

## 6. AI 对话面板（v1）

完整契约见 `docs/AI-PANEL-SPEC.md`，这里只列渲染层要点：

- 入口：工具栏 `#ai-toggle`（`data-ai-toggle`，不计入 data-action）、`Ctrl+Shift+A`、视图菜单「AI 写作助手」。
- 三态：`closed` / `open`（360px dock，≥1180px）/ `rail`（40px 侧条）；<1180px 为覆盖预览区的 overlay。
- 面板结构、必需 id/data 见 spec §4.1；消息状态 `data-status="streaming|done|error|cancelled"`。
- 流式渲染：`api.ai.onEvent` → `text_delta` 追加渲染（节流）、`reasoning_delta` 折叠区、`completed` 写 usage、
  `failed` 错误卡片（带重试）、`cancelled` 标记停止；发送时 `requestId` 用 `crypto.randomUUID()`。
- 上下文：`aiIncludeContext` 默认 false；快捷提问 summary/outline 自动携带当前文档、polish 使用选区；
  文档内容通过 `ai:send({ context: { fileName, content } })` 交给主进程，渲染层不直接调网络。
- 历史：主进程持久化；渲染层每轮结束保存，新对话/历史恢复/删除走 `api.ai.*`。
- 安全：`api.ai` 不返回明文 Key；只显示 maskedKey；assistant 内容一律 `renderMarkdown`（禁原始 HTML）。

## 7. 健壮性要求

- 所有 `window.api` 调用 try/catch；`ok:false` 时 `toast(res.error, 'error')`，不要让 Promise 未捕获。
- 初始化异常时在页面显示错误块（含 message），不得白屏。
- 不使用 `document.write`、`eval`、`new Function`；不拼接不可信 HTML（预览一律走 markdown-it）。
- 代码注释用中文，文件头写模块用途；函数保持单一职责，单文件建议 < 450 行。
- 兼容 Node/Electron 40（Chromium 142）：可用 `structuredClone`、`Array.at`、`CSS :has` 等现代特性。
