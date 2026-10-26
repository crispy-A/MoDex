# MoDex · 自动保存（切换文件 / 关闭软件）规格

> 用户需求：**切换文件、关闭软件时自动保存**，不再弹出「保存 / 不保存 / 取消」询问。
> 原则：不丢数据；有路径的文档静默写盘，未命名文档走「另存为」；用户取消/失败时**中止切换或关闭**，保持当前文档。

## 1. 行为定义

### 1.1 切换文件时（包括所有会替换当前文档的入口）

| 入口 | 行为 |
| --- | --- |
| 文件树点击文件 / 最近文件 / 打开文件对话框 / 外部打开（second-instance） | 当前文档 dirty → 自动保存；成功后打开目标文件 |
| 新建文档（Ctrl+N / 菜单 / 欢迎页） | 当前文档 dirty → 自动保存；成功后进入未命名缓冲 |
| 关闭文档（Ctrl+W） | 当前文档 dirty → 自动保存；成功后回到欢迎页 |

- 当前文档**有 path**：静默 `writeFile` 写盘（复用 `saveDocument({silent:true})`，内含 mtime 冲突检测与「覆盖/重新加载/取消」确认）；
  成功后 toast「已自动保存」，再继续切换。
- 当前文档**无 path（未命名）**：调用另存为对话框写入命名后的文件；成功后继续切换。
- 保存失败（权限/磁盘/冲突选择取消等）或另存为被取消：**中止切换**，当前文档保持不变，并提示错误。
- 自动保存成功后 `dirty=false`、主进程 `setDirty(false)`、状态栏显示「已保存」。
- 删除当前文件时仍沿用原有「保存/不保存/取消」确认（破坏性操作，不自动保存后删除）。

### 1.2 关闭软件时

- 主进程不再弹「保存/不保存/取消」询问；有未保存修改时直接通知渲染层 `app:close-requested`。
- 渲染层收到后：dirty → 自动保存（规则同 1.1）→ 成功则 `requestClose()` 关闭窗口；
  失败/取消则 `cancelClose()`，窗口保持打开（用户可继续处理）。
- 无未保存修改时窗口直接关闭（原行为）。
- 退出菜单、Alt+F4、任务栏关闭走同一条 close 流程。
- 主进程保留 30s 关闭确认锁超时兜底，避免渲染层异常时永久无法关闭。

### 1.3 不做的事

- 不改变空闲自动保存设置 `settings.autoSave`（仍默认关闭，无 UI；本轮需求只要求切换/关闭时保存）。
- 不改变保存冲突检测、外部修改提示、删除确认、未保存关闭锁等既有安全机制。
- 不新增工具栏/菜单按钮。

## 2. 接口与实现点

- 渲染层 `app.js`：
  - 新增 `autoSaveBeforeLeave(): Promise<boolean>`（无文档/dirty=false 直接 true；有 path → `saveDocument({silent:true})`；
    无 path → `saveDocumentAs({silent:true})`；成功后 toast「已自动保存」）。
  - `newDocument` / `loadFilePath` / `openFileDialog` / `closeDocument` / `handleCloseRequested` 改用该函数；不再调用 `confirmUnsaved`。
  - `confirmUnsaved` 仅保留给「删除当前文件」确认路径。
- 主进程 `main.js` 窗口 `close` 事件：dirty 时不再 `dialog.showMessageBox`，直接 `sendToRenderer('app:close-requested')` + 关闭锁；其余不变。
- `docs/CONTRACTS.md`：明确 `onCloseRequested` 语义为「自动保存后关闭」，主进程不弹保存询问。
- e2e 钩子不变（`__qm.save` 等保持）。

## 3. 验收

1. e2e（新增断言）：
   - 打开示例 → 编辑（dirty）→ 切换到另一个文件：断言旧文件磁盘内容含新增标记、`dirty=false`、新文件已打开；
   - 编辑后 Ctrl+N：自动保存后进入未命名缓冲（旧文件已落盘）；
   - 编辑后 Ctrl+W：自动保存后回到欢迎页（旧文件已落盘）。
2. 关闭自动保存（独立启动验证，`scripts/smoke.mjs` 第二阶段）：
   - 启动应用 → 打开文件 → 编辑 → 触发 `win.close()`；
   - 进程正常退出（exit 0，无阻塞对话框）→ 文件内容包含编辑标记；
   - 若出现保存询问对话框或未保存，进程应在 12s 内超时并返回非 0。
3. 未命名文档关闭/切换：另存为对话框取消时中止操作（人工/QA 验证）。
4. `npm test`、`npm run smoke`（含两阶段）、打包 exe smoke 全绿；QA 复验 §15。

## 4. 落地与验收结果

- 实现：`src/renderer/js/app.js` 新增 `autoSaveBeforeLeave()` 并接入 `newDocument` / `loadFilePath` / `openFileDialog` /
  `closeDocument` / `handleCloseRequested`；`__qm.openPath` 改为真实切换语义（会先自动保存）；`confirmUnsaved` 仅剩删除当前文件路径。
  主进程 `main.js` 窗口 `close` 在 dirty 时直接发送 `app:close-requested`（不再弹保存询问）。
- e2e 新增断言：切换文件自动保存原文档、Ctrl+W 关闭文档自动保存、关闭窗口自动保存（第二阶段独立启动，进程 exit 0 且内容落盘）。
- 验收数字：`npm test` 46/46；dev smoke 第一阶段 **97/97** + 第二阶段通过；打包 exe smoke 同；
  独立 QA 自动保存专项 **14/14**、无回归（菜单栏 24、多文件夹 18、设计 23、运行时 100、加固 17），P0=0、P1=0（`docs/QA-REPORT.md` §15）。
- 实测行为矩阵：有路径切文件无询问且落盘；Ctrl+N/Ctrl+W 自动保存；关闭软件 exit 0 无询问；未命名另存取消 → 保持 dirty 且中止；
  只读保存失败 → 中止切换不丢数据；外部修改冲突取消 → 中止 / 重新加载 → 继续；删除当前文件仍弹三态确认。

## 5. 后续修复：行内编辑与后台刷新的竞态（QA §15.1）

- 问题：`fs.watch` 后台刷新会重建文件树 DOM，旧行内输入框被移除触发 `blur`，原逻辑在 `setTimeout` 里取消
  `inline`，导致用户正在输入的新建/重命名名称被吞掉。
- 修复：`tree.js` 增加 `refreshing` 标记，refresh 的「重新加载 + render」期间置 true；`blur` 回调在触发瞬间捕获
  `duringRefresh`，刷新导致的 blur 跳过取消；refresh 结束后按 `inline.caret` 恢复焦点与光标。
  用户点击别处导致的 blur（非刷新）仍取消行内编辑。
- 验证：独立探针 + `audit-race` 11/11（输入中手动刷新/fs.watch 刷新均保留内容与焦点、Enter 可提交、点击别处仍取消），
  两阶段 smoke 全绿；详细证据见 `docs/QA-REPORT.md` §15.1。
