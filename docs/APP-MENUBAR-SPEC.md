# MoDex · 单条导航栏（原生菜单栏合并进工具栏）规格

> 用户需求：当前「系统原生菜单栏（文件 编辑 视图 帮助）+ 应用工具栏」是两条横条，希望**合并成一条**。
> 做法：隐藏 Windows 原生菜单栏，把四个菜单入口渲染进 40px 工具栏；菜单项与现有功能一一对应，**不新增功能**。

## 1. 总体结构

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ M MoDex  ▤   文件  编辑  视图  帮助        …spacer…        编辑  分栏  预览  ☾ │  40px
├───────────────────────────────────────────────────────────────────────────────┤
```

- 工具栏仍为 40px、`--bg` 底色、底部 1px `--border`。
- 左组顺序：品牌（M + MoDex）→ 侧栏开关 → 应用菜单（文件/编辑/视图/帮助 四个文本按钮）。
- 右组不变：视图 tabs（编辑/分栏/预览）+ 主题切换。
- **不再显示**原生菜单栏（`win.setMenuBarVisibility(false)`），但应用菜单对象继续保留，
  以维持原生快捷键与 `role` 行为（Ctrl+Z/X/C/V/A、F12、Alt+F4）。

## 2. 应用菜单按钮与下拉

- 四个按钮：`data-app-menu="file|edit|view|help"`，文本 12.5px、`--muted`；hover `--hover` + `--text`；
  下拉打开时按钮显示 `--text` + `background: var(--active)`。**不使用 `data-action`**（避免与既有动作分发冲突）。
- 下拉面板：复用现有 popup 视觉（`--elevated` + 1px `--border-strong` + `--shadow-menu`、8px 圆角、4px 内边距），
  项高 28px、12.5px；项右侧显示快捷键提示（10.5px 等宽 `--faint`，右对齐）；支持分隔线；
  点击项后关闭；点击外部 / Esc / 再次点击按钮关闭；同一时间只允许一个下拉打开。
- 下拉通过已有 `createContextMenu` 能力扩展：新增容器 `#app-menu`（`ul`），在 `util.js` 中支持 `hint` 字段与
  `#app-menu` 样式（与 `#context-menu` 共用令牌；CSS 选择器改为 `#context-menu, #app-menu`）。
- 菜单项内容（与原生菜单完全一致，按组排列）：

| 菜单 | 项（含快捷键提示） |
| --- | --- |
| 文件 | 新建文档 Ctrl+N ｜ 打开文件… Ctrl+O ｜ 添加文件夹… ｜ （分隔）｜ 保存 Ctrl+S ｜ 另存为… Ctrl+Shift+S ｜ （分隔）｜ 关闭文档 Ctrl+W ｜ （分隔）｜ 退出 Alt+F4 |
| 编辑 | 撤销 Ctrl+Z ｜ 重做 Ctrl+Y ｜ （分隔）｜ 剪切 Ctrl+X ｜ 复制 Ctrl+C ｜ 粘贴 Ctrl+V ｜ 全选 Ctrl+A ｜ （分隔）｜ 查找… Ctrl+F |
| 视图 | 编辑模式 Ctrl+1 ｜ 分栏模式 Ctrl+2 ｜ 预览模式 Ctrl+3 ｜ （分隔）｜ 显示/隐藏侧栏 Ctrl+Shift+E ｜ 切换浅色/深色主题 Ctrl+Shift+T ｜ （分隔）｜ 放大字号 Ctrl+= ｜ 缩小字号 Ctrl+- ｜ 重置字号 Ctrl+0 ｜ （分隔）｜ 全屏 ｜ 开发者工具 F12 |
| 帮助 | 键盘快捷键 ｜ 关于 MoDex |

- 文件/编辑/视图/帮助 中除「原生 role 类」动作外，全部走既有 `dispatch(action)`（`file:*` / `edit:find` / `view:*`）。
- 原生 role 类动作通过**新增 IPC** 完成：`api.runMenuCommand(command)`。

## 3. 新增接口

```ts
// preload / CONTRACTS
runMenuCommand(command:
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'togglefullscreen' | 'toggleDevTools'
  | 'help:about' | 'help:shortcuts'
  | 'app:quit'
): Promise<{ ok: boolean }>
```

- 主进程 `app:menu-command` handler 调用 `mainWindow.webContents.undo()/redo()/cut()/copy()/paste()/selectAll()`、
  `win.setFullScreen(!win.isFullScreen())`、`webContents.toggleDevTools()`、`showAbout(win)`、`showShortcuts(win)`；
  `app:quit` 调用 `win.close()`（复用未保存确认流程）。
- 原生菜单栏隐藏：`BrowserWindow` 创建后 `win.setMenuBarVisibility(false)`；**保留** `Menu.setApplicationMenu(...)`，
  以便原生快捷键/F12/Alt+F4 继续工作。
- 其它 `window.api` 与 `__qm` 钩子不变。

## 4. 键盘与焦点

- 全局快捷键（渲染层 keydown）逻辑不变；原生 role 快捷键由保留的应用菜单提供（不重复绑定）。
- 下拉打开时：Esc 关闭；点击其它菜单按钮切换到对应下拉；焦点保持在页面，不进入原生菜单栏。
- 焦点环样式沿用 `:focus-visible`（1.5px accent / offset 2）。

## 5. e2e 约定（Lead 维护）

- 新增断言（主进程侧）：`win.isMenuBarVisible() === false`。
- 新增断言（渲染层）：
  - `#toolbar` 中恰好 4 个 `[data-app-menu]`，顺序为 file/edit/view/help；工具栏 `data-action` 仍恰好 5 个；
  - 点击「文件」→ `#app-menu` 打开且包含「新建文档 / 保存 / 另存为 / 退出」等项，每项有快捷键提示文本；
  - 点击「视图」→「编辑模式」→ `#app` 的 `data-view` 变为 `edit`（验证下拉动作分发）；再切回分栏；
  - 「帮助」菜单包含「键盘快捷键」「关于 MoDex」两项（不点击，避免原生对话框阻塞）；
  - Esc / 点击外部关闭下拉；同一时间仅一个下拉打开。
- 截图新增：`17-app-menu.png`（文件菜单打开）、`18-single-navbar.png`（单条导航栏全貌）。

## 6. 验收

- `npm test` 全绿；`npm run smoke` 全绿（新增导航栏/菜单断言）；打包 exe smoke 全绿；
- 截图确认：**只有一条 40px 导航栏**，四个菜单与品牌、视图 tabs、主题在同一行；900×600 无横向溢出；
- 四类菜单项与既有功能逐一对应，无新增功能、无删除功能；原生快捷键（Ctrl+S/Ctrl+Z/F12）仍有效。
- QA 复验后更新 `docs/QA-REPORT.md`（§14）。
