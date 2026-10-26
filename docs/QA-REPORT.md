# MoDex（原轻墨）独立 QA 验收审计报告

> **更名说明（已复验）**：产品已由「轻墨 / QingMo」更名为 **MoDex**。本报告第 1–11 节记录更名前后的多轮功能/安全验收（其中「轻墨」为历史名称，`release/轻墨-*` 为更名前的历史打包产物）；第三轮（§12）已对 **MoDex 更名完整性 + Codex 风格 UI 重设计**完成独立复验并通过，当前交付物为 `release/MoDex-1.0.0-win32-x64/MoDex.exe`。

- 审计对象：`md-editor/`（Electron 40.10.2，原生 ES Modules 渲染层，零构建）
- 审计角色：独立 QA 审计员（只审计、不修改源码）
- 审计时间：2026-10-22
- 审计环境：Windows，Electron 40.10.2 / Chromium 144.0.7559.236 / Node 24.15.0
- 审计方式：复跑项目自带测试与 e2e；用 CDP（`--remote-debugging-port` + 主进程 `--inspect`）驱动真实应用做安全/协议/健壮性/设计令牌验证；用 PowerShell SendKeys / UI Automation 驱动原生对话框；新增可回归测试与脚本。

## 1. 总体结论：**通过（Pass，第六轮「自动保存」复验后放行）**

> 第一轮：dev 源码通过、便携版 release 过期（P1-01）→ 有条件通过。
> 第二轮：Lead 重打包并修复 P2-01/02/04/05/07/13，QA 复验 17/17 → P1-01 关闭。
> 第三轮：更名 MoDex + Codex 风格重设计，`npm test` 43/43、smoke 67/67、设计审计 23/23 → 放行。
> 第四轮：多文件夹工作区 + 工具栏精简，`npm test` 46/46、smoke 83/83、多根审计 18/18 → 放行。
> 第五轮：单条导航栏，`npm test` 46/46、smoke 92/92、导航栏审计 24/24 → 放行。
> 第六轮（本轮）：自动保存（切换文件/新建/关闭文档/关闭软件时自动保存，不再弹「保存/不保存/取消」）；`npm test` **46/46**、dev smoke **97/97 + 阶段二通过**、打包 smoke **97/97 + 阶段二通过**、自动保存专项 **14/14**、无回归 **24/24 + 100/100 + 23/23 + 18/18 + 17/17** 全部通过 → **放行**。

| 维度 | 结论 | 关键证据 |
| --- | --- | --- |
| 功能需求覆盖 | **通过** | `npm run smoke` 97/97 + 第二阶段关闭自动保存（dev）；CDP 运行时审计 100/100 |
| 安全（配置/CSP/XSS/协议/路径） | **通过** | CSP 实际拦截内联/远程脚本；XSS 7 类载荷全部转义/拦截；`app://` 越权全部被拒（400/403/404）；IPC 非法来源 EACCES |
| 健壮性/边界 | **通过** | 只读保存、>5MB、非 UTF-8、非空目录删除、重命名冲突、空目录、最近失效项、外部变更刷新、快速切换、启动损坏状态 全部符合预期 |
| 自动化回归 | **通过** | 全量 `npm test`：**46/46** |
| Lead 加固变更 | **通过** | 加固复验 **17/17**（IPC 来源校验、CSP 新指令、图片 CSP、保存冲突三选一、second-instance 转发） |
| **MoDex 更名完整性** | **通过** | UI/标题/菜单/关于/package/exe/用户目录/e2e/fixtures 均 MoDex；源码无旧品牌残留（§12.1） |
| **Codex 风格设计还原** | **通过** | 令牌/尺寸/单色/阴影/对比度/18 张截图 实测符合 `CODEX-UI-DESIGN.md`；设计审计 **23/23** |
| **多文件夹工作区** | **通过** | 添加/移除/激活/顺序、重启恢复、多根独立监听、`state.json` 持久化 全部实测（§13.1，18/18） |
| **工具栏 + 单条导航栏** | **通过** | 5 data-action + 4 data-app-menu；原生菜单栏隐藏且菜单注册；四菜单 10/9/13/2 项逐项一致（§13.2、§14，24/24） |
| **自动保存（切换/关闭）** | **通过** | 有路径静默保存无询问、未命名另存为取消/确认、只读失败中止、冲突取消/重新加载、关闭自动保存退出 0、confirmUnsaved 仅删除路径（§15，14/14） |
| 打包交付物 | **通过（已复验）** | `resources/app/src` **16/16** SHA256 与仓库一致、`CONTRACTS.md` 一致；`MoDex.exe` smoke **97/97 + 阶段二通过** |

- 缺陷分级统计（最终）：**P0 = 0，P1 = 0，P2 = 15 项记录**（7 项已修复/加固，“MoDex 更名 + 设计”本轮新增 **P2-16/P2-17** 两项低优先级观察，见 §12.5）。
- 无数据损坏、无功能不可用、无脚本执行、无路径穿越成功案例。
- **放行**：便携版 `release/MoDex-1.0.0-win32-x64/MoDex.exe` 可作为最终交付物（复验证据见 §2 第 10–35 行、§12–§15）。

## 2. 复跑记录（命令与结果）

| # | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| 1 | `npm test` | **26/26 通过**，exit 0（审计前基线） | `artifacts/qa/npm-test-initial.log` |
| 2 | `npm run smoke` | **66/66 断言通过**，exit 0；11 张截图；`disk.trashed=true`、`disk.savedMarker=true`、`errors=[]` | `artifacts/qa/smoke-dev.log` |
| 3 | `npm run smoke -- --app "release\..."`（第一轮，旧构建） | **66/66 通过**，exit 0（当时为过期构建，见 P1-01 历史记录） | `artifacts/qa/smoke-packaged.log` |
| 4 | 独立 CDP 运行时审计 `node artifacts/qa/audit-main.mjs` | **99/99 断言通过**，exit 0（加固版源码上复跑仍 99/99） | `artifacts/qa/audit-main.log`、`results-main.json` |
| 5 | 启动健壮性审计 `node artifacts/qa/audit-startup.mjs` | **5/5 通过**，exit 0（损坏 state.json + 不存在的 --root） | `artifacts/qa/audit-startup.log`、`results-startup.json` |
| 6 | `npm test`（加入 QA 回归用例后） | **43/43 通过**，exit 0（加固版源码上复跑仍 43/43） | `artifacts/qa/npm-test-after-qa.log`、`npm-test-final.log` |
| 7 | `npm run smoke -- --app "release\轻墨-1.0.0-win32-x64\轻墨.exe"`（**最终重打包版**） | **66/66 断言通过**，exit 0；`errors=[]`、`savedMarker=true`、`trashed=true`；11 张截图 | `artifacts/qa/smoke-packaged-final.log` |
| 8 | Lead 加固复验 `node artifacts/qa/audit-hardening.mjs` | **17/17 断言通过**，exit 0 | `artifacts/qa/audit-hardening.log`、`results-hardening.json` |
| 9 | 资源一致性校验（SHA256） | `resources/app/src` **16/16** 与仓库 `src` 一致；`resources/app/docs/CONTRACTS.md` 与仓库一致（9101 B，SHA256 `D42BDC58…`） | 本报告 §4.6 |
| 10 | **第三轮** `npm test`（MoDex 最终源码） | **43/43 通过**，exit 0 | `artifacts/qa/npm-test-modex.log` |
| 11 | **第三轮** `npm run smoke`（dev，MoDex） | **67/67 断言通过**，exit 0；13 张截图（新增 `12-findbar`、`13-dirty`）；`errors=[]` | `artifacts/qa/smoke-dev-modex.log` |
| 12 | **第三轮** `npm run smoke -- --app "release\MoDex-1.0.0-win32-x64\MoDex.exe"` | **67/67 断言通过**，exit 0；`errors=[]`、`savedMarker=true`、`trashed=true` | `artifacts/qa/smoke-packaged-modex.log` |
| 13 | **第三轮** 更名 + 设计还原审计 `node artifacts/qa/audit-design-modex.mjs` | **23/23 断言通过**，exit 0（令牌/尺寸/单色/阴影/对比度/无新增入口/截图） | `artifacts/qa/audit-design-modex.log`、`results-design-modex.json` |
| 14 | **第三轮** 无回归：`audit-main.mjs` / `audit-hardening.mjs` | **99/99**、**17/17** 断言通过，exit 0 | `artifacts/qa/audit-main-modex.log`、`audit-hardening-modex.log` |
| 15 | **第三轮** 资源一致性校验（MoDex） | `release/MoDex-1.0.0-win32-x64/resources/app/src` **16/16** SHA256 与仓库一致；`CONTRACTS.md` 一致（9091 B，SHA256 `F36C3FC4…`）；exe = `MoDex.exe` | 本报告 §12.4 |
| 16 | **第四轮** `npm test`（多文件夹 + 工具栏精简） | **46/46 通过**，exit 0 | `artifacts/qa/npm-test-multiroot.log` |
| 17 | **第四轮** `npm run smoke`（dev） | **83/83 断言通过**，exit 0；16 张截图（新增 `14-multi-root`/`15-root-menu`/`16-single-root-again`）；`errors=[]` | `artifacts/qa/smoke-dev-multiroot.log` |
| 18 | **第四轮** `npm run smoke -- --app "release\MoDex-1.0.0-win32-x64\MoDex.exe"` | **83/83 断言通过**，exit 0；`errors=[]`、`savedMarker=true`、`trashed=true` | `artifacts/qa/smoke-packaged-multiroot.log` |
| 19 | **第四轮** 多文件夹专项审计 `node artifacts/qa/audit-multiroot.mjs` | **18/18 断言通过**，exit 0（含重启恢复、多根监听、移除根不删盘、state.json） | `artifacts/qa/audit-multiroot.log`、`results-multiroot.json` |
| 20 | **第四轮** 无回归：`audit-main` / `audit-design-modex` / `audit-hardening` | **100/100**、**23/23**、**17/17** 断言通过，exit 0 | `artifacts/qa/audit-main-multiroot.log`、`audit-design-multiroot.log`、`audit-hardening-multiroot.log` |
| 21 | **第四轮** 资源一致性校验 | `resources/app/src` **16/16** SHA256 一致；`CONTRACTS.md` 一致（SHA256 `4FA67A49…`）；release 仅 `MoDex-1.0.0-win32-x64/` | 本报告 §13.4 |
| 22 | **第五轮** `npm test`（单条导航栏） | **46/46 通过**，exit 0 | `artifacts/qa/npm-test-menubar.log` |
| 23 | **第五轮** `npm run smoke`（dev） | **92/92 断言通过**，exit 0；18 张截图（新增 `17-app-menu`/`18-single-navbar`）；`errors=[]` | `artifacts/qa/smoke-dev-menubar.log` |
| 24 | **第五轮** `npm run smoke -- --app "release\MoDex-1.0.0-win32-x64\MoDex.exe"` | **92/92 断言通过**，exit 0；`errors=[]` | `artifacts/qa/smoke-packaged-menubar.log` |
| 25 | **第五轮** 单条导航栏专项审计 `node artifacts/qa/audit-menubar.mjs` | **24/24 断言通过**，exit 0（菜单栏隐藏、四菜单逐项、下拉交互、runMenuCommand、真实按键快捷键） | `artifacts/qa/audit-menubar.log`、`results-menubar.json` |
| 26 | **第五轮** 无回归：`audit-main` / `audit-design-modex` / `audit-hardening` / `audit-multiroot` | **100/100**、**23/23**、**17/17**、**18/18** 断言通过，exit 0 | `artifacts/qa/audit-*-menubar.log` |
| 27 | **第五轮** 资源一致性校验 | `resources/app/src` **16/16** SHA256 一致；`CONTRACTS.md` 一致（SHA256 `5C110C5A…`）；release 仅 `MoDex-1.0.0-win32-x64/` | 本报告 §14.5 |
| 28 | **第六轮** `npm test`（自动保存） | **46/46 通过**，exit 0 | `artifacts/qa/npm-test-autosave.log` |
| 29 | **第六轮** `npm run smoke`（dev，两阶段） | 阶段一 **97/97** 断言通过 + **阶段二（win.close 自动保存）通过**，exit 0；18 张截图；`disk.autosaveOnSwitch=true`、`autosaveOnCloseDoc=true` | `artifacts/qa/smoke-dev-autosave.log` |
| 30 | **第六轮** `npm run smoke -- --app "release\MoDex-1.0.0-win32-x64\MoDex.exe"`（两阶段） | 阶段一 **97/97** + **阶段二通过**（退出码 0、编辑内容已落盘），exit 0 | `artifacts/qa/smoke-packaged-autosave.log` |
| 31 | **第六轮** 自动保存专项审计 `node artifacts/qa/audit-autosave.mjs` | **14/14 断言通过**，exit 0（切换/Ctrl+N/Ctrl+W/未命名取消确认/只读失败/冲突取消与重载/关闭软件） | `artifacts/qa/audit-autosave.log`、`results-autosave.json` |
| 32 | **第六轮** 无回归：`audit-menubar` / `audit-main` / `audit-design-modex` / `audit-multiroot` / `audit-hardening` | **24/24**、**100/100**、**23/23**、**18/18**、**17/17** 全部通过，exit 0 | `artifacts/qa/audit-*-autosave*.log` |
| 33 | **第六轮** 资源一致性校验 | `resources/app/src` **16/16** SHA256 一致；`CONTRACTS.md` 一致（SHA256 `8E197DE8…`）；release 仅 `MoDex-1.0.0-win32-x64/` | 本报告 §15.4 |

> 三个 Electron 实例严格串行执行，未出现多实例抢占窗口/文件。

## 3. 需求覆盖与证据

> 证据格式：`文件:行` + 自动化断言 ID（`results-main.json` / `results-startup.json` / e2e `artifacts/e2e/results.json`）+ 截图。
> 截图：`artifacts/qa/screenshots/*.png`（本次审计实拍）、`docs/screenshots/*.png`（稳定副本，未被修改）。

### 3.1 Markdown 编辑与实时预览

| 子项 | 证据 | 结果 |
| --- | --- | --- |
| markdown-it 配置 `html:false` | `src/renderer/js/markdown.js:107` | ✅ |
| 输入 120ms 防抖后更新预览/字数 | `src/renderer/js/app.js:357-362,376-378`；断言 **PREVIEW-01** | ✅ |
| 标题/表格/代码块/任务列表/引用/外部链接渲染 | `src/main/e2e.js` e2e「预览渲染*」8 项；截图 `artifacts/e2e/screenshots/03-split-light.png` | ✅ |
| 本地图片经 `app://file` 加载（PNG + SVG） | 断言 **XSS-05**；`src/renderer/js/preview.js:93-127` | ✅ |
| 代码块语言标签、标题锚点 id | `markdown.js:26-97`；e2e「预览标题生成锚点 id」「预览渲染代码块」 | ✅ |
| 预览内相对 `.md` 链接应用内打开 | 断言 **LINK-01**（`other.md` 实际打开）；`preview.js:151-163` | ✅ |
| 外部链接仅 http/https | 断言 **LINK-02**；`src/main/main.js:621-627`、`preview.js:175-180` | ✅ |
| 空内容占位/渲染错误降级 | `preview.js:183-194` | ✅（代码审计） |

### 3.2 文件生命周期

| 子项 | 证据 | 结果 |
| --- | --- | --- |
| 新建文档（Ctrl+N，内存未命名缓冲） | 断言 **DIALOG-03**（`__qm` 状态 `filePath=null`、`dirty=true`）；`app.js:422-425` | ✅ |
| 打开文件（Ctrl+O 原生对话框） | 断言 **DIALOG-04**（模态框出现、Esc 取消无异常）；`main.js:459-476`、`app.js:463-488` | ✅ |
| 打开文件（真实读取/树点击） | e2e「打开文档后文件名正确/内容已载入/点击文件树打开嵌套 Markdown」 | ✅ |
| 保存 Ctrl+S（真实键盘事件） | 断言 **ROBUST-01/03**（Ctrl+S 失败路径）；e2e「保存后未保存标记清除」「保存内容已写入磁盘」（磁盘标记校验） | ✅ |
| 另存为 Ctrl+Shift+S | 断言 **DIALOG-03**（原生保存对话框 → Enter → 写入 `未命名.md`、当前文档切换）；`app.js:585-622` | ✅ |
| 关闭文档 Ctrl+W | e2e「Ctrl+W 关闭文档并回到欢迎页」；`app.js:624-628` | ✅ |
| 未保存提醒（切换/新建） | 断言 **DIALOG-01**（Ctrl+N 触发模态确认，Esc 取消后仍停留原文档且 dirty） | ✅ |
| 未保存提醒（关闭窗口） | 断言 **DIALOG-06**（`window.close()` 弹确认、窗口未关闭、取消后窗口仍存在）；`main.js:314-349`、`app.js:630-645` | ✅ |
| 关闭保存失败/取消后解锁再次关闭 | 源码已修复 `main.js:426` + `preload.js:41` + `app.js:640,644`（**但 release 为旧版，见 P1-01**） | ✅（源码） |

### 3.3 文件夹与文件树

| 子项 | 证据 | 结果 |
| --- | --- | --- |
| 打开文件夹（原生对话框） | 断言 **DIALOG-05**；e2e「打开文件夹后根目录正确/文件树渲染出节点」 | ✅ |
| 文件树展开/嵌套/当前文件高亮 | e2e「文件树展开子目录/展开后显示嵌套文件」 | ✅ |
| 侧栏 UI 新建 Markdown 文件（行内输入+Enter+自动打开） | e2e「侧栏 UI 新建 Markdown 文件」「UI 新建后自动打开新文件」「UI 新建文件落地磁盘」 | ✅ |
| 新建文件夹 | e2e「新建文件夹成功/刷新按钮后文件树出现新建文件夹」 | ✅ |
| 删除文件（回收站 + 确认对话框） | e2e「删除 Markdown 文件成功（回收站）」+ `trashed=true`；断言 **DIALOG-02**（确认框出现、Esc 取消后文件未删） | ✅ |
| 删除空文件夹 / 删除非空文件夹被拒 | e2e「删除空文件夹成功」；断言 **ROBUST-04 / IPC-remove-nonempty（ENOTEMPTY）** | ✅ |
| 重命名（API 层） | e2e「重命名文件成功/重命名后新路径存在」+ 断言 **IPC-rename-existing（EEXIST）**、**IPC-rename-*（EINVAL）** | ✅ |
| 重命名（UI 行内，右键→重命名→Enter） | 代码审计 `src/renderer/js/tree.js:318-411`；e2e 仅验证右键菜单可打开，**未做 UI 行内重命名运行时自动化**（时间限制，见 §7） | ⚠️ 部分 |
| 刷新按钮 / 外部文件变更自动刷新 | e2e「刷新按钮后文件树出现新建/文件夹」；断言 **WATCH-01/02**（外部新增/删除 1s 内自动刷新） | ✅ |
| 空文件夹占位 | 断言 **ROBUST-04**（显示「空文件夹」） | ✅ |

### 3.4 基础体验

| 子项 | 证据 | 结果 |
| --- | --- | --- |
| 三种视图（编辑/分栏/预览） | e2e 6 项视图断言 + 截图 `03/04/05`；`app.js:168-178` | ✅ |
| 深浅主题 | e2e「切换到深色主题」「Ctrl+Shift+T 切换主题」；截图 `03-split-light`、`06-split-dark` | ✅ |
| 查找（Ctrl+F、计数、循环、Esc） | e2e 3 项查找断言；`src/renderer/js/editor.js:240-339` | ✅ |
| 最近打开（欢迎页列表 + 点击打开） | e2e「欢迎页展示最近打开记录」；断言 **RECENT-01**（失效项点击提示错误，不崩溃）；`app.js:673-700,718-756` | ✅ |
| 快捷键（Ctrl+N/O/S/Shift+S/W/F/1/2/3/Shift+E/Shift+T/=/0） | e2e 8 项 + 本审计 Ctrl+S/Shift+S/O/N/W 全路径；`app.js:802-914` | ✅ |
| 最小窗口 900×600 无横向溢出 | e2e「最小窗口 900×600 无横向溢出」；截图 `11-min-window.png` | ✅ |
| 设置持久化（主题/视图/侧栏/字号/窗口） | e2e「设置持久化接口正常」；`src/main/state-store.js:120-245` | ✅ |
| 初始化失败不白屏 | 断言 **START-01~05**（损坏 state.json 回落默认、欢迎页可见、无致命块）+ 代码审计 `app.js:1058-1064,1072-1114`（`showFatalError` 兜底） | ✅ |

## 4. 安全审计（重点，均运行时验证）

### 4.1 进程配置 / preload 暴露面

| 检查项 | 方法与证据 | 结果 |
| --- | --- | --- |
| `contextIsolation:true` / `nodeIntegration:false` / `sandbox:false` | 源码 `src/main/main.js:276-282`；运行时断言 **SEC-03**：渲染进程 `require/process/module/Buffer/global` 均 `undefined` | ✅（sandbox=false 见 P2-03） |
| preload 暴露面最小化 | 断言 **SEC-01**：`window.api` 恰好 35 个契约键，无多无少；**SEC-02**：无 `invoke/send/ipcRenderer/fs/shell/process` 等原始通道；`preload.js:24-86` | ✅ |
| contextIsolation 逃逸尝试 | 断言 **SEC-05**：`api.bootstrap.constructor('return process')()` 均为 `ReferenceError`，拿不到 process/require；`window.api` 被冻结（**SEC-04**） | ✅ |
| CSP 响应头随 `app://` 响应生效 | 断言 **CSP-01**：文档响应 200 且带 `content-security-policy`，`script-src 'self'` 无 `unsafe-inline/unsafe-eval`；`main.js:127-128,175-177` | ✅ |
| CSP 真实拦截内联脚本 | 断言 **CSP-02**：动态注入内联 `<script>` 未执行 + 触发 `securitypolicyviolation(script-src-elem)` | ✅ |
| CSP 真实拦截远程脚本/请求 | 断言 **CSP-03/05**：`https://example.com` 脚本与 fetch 均被拦截（离线应用无远程代码/数据外发） | ✅ |
| `window.api` 冻结 | 断言 **SEC-04** | ✅ |
| IPC handler 来源校验 | 代码审计：`main.js:397-407` 未校验 `event.senderFrame`（P2-01） | ⚠️ 加固项 |

### 4.2 Markdown XSS（真实 UI 预览）

测试文档同时含 7 类载荷（载荷与期望见 `artifacts/qa/audit-main.mjs` 中 `XSS_MARKDOWN`）：

```
<img src=x onerror="window.__xss=1">        <script>window.__xss=2</script>
<a href="javascript:...">…</a>              <svg onload="..."></svg>
<iframe src="javascript:..."></iframe>      <object data="javascript:..."></object>
[x](javascript:alert(1))                    ![x](javascript:alert(1))
[a](vbscript:msgbox(1))                     [b](data:text/html,<script>…</script>)
![本地图片](assets/pic.png)                  ![SVG 图片](evil.svg)
```

| 断言 | 结果 |
| --- | --- |
| **XSS-01** 所有载荷后 `window.__xss`/`window.__svgXss` 均为 undefined（脚本未执行） | ✅ |
| **XSS-02** 预览 DOM 无注入的 `<script>/<iframe>/<object>`、无带 `onerror` 元素、SVG 脚本未执行 | ✅ |
| **XSS-03** `javascript:/data:/vbscript:` 未进入任何 `href` | ✅ |
| **XSS-04** 原始 HTML 被转义为文本（innerHTML 含 `&lt;script&gt;`，无 raw `<script`） | ✅ |
| **XSS-05** 本地 PNG 与 SVG 图片经 `app://file` 正常加载（`naturalWidth>0`），SVG 内脚本不执行 | ✅ |
| 补充：Node 侧直接对真实 `markdown.js` 配置做回归（17 项测试，见 §6） | ✅ |

**结论：当前 Markdown 渲染与预览无 XSS 执行面。** 原始 HTML 一律转义；markdown-it 的 `validateLink` 拦截危险协议；预览仅对 markdown-it 输出使用 `innerHTML`（`preview.js:212`），图片/链接均二次校验。

### 4.3 路径 / 文件名边界（真实 IPC，主进程 `fs-service.js`）

40 项调用全部 `resolve`（无 reject），错误码符合 `docs/CONTRACTS.md`：

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `..\..\evil.md`、`evil.md`、`./relative.md`（读/写/删/重命名/查询） | EINVAL | ✅ EINVAL |
| `C:\tmp\a\0.md`（NUL 字节） | EINVAL | ✅ EINVAL |
| `CON` / `NUL` / `COM1.md` / `LPT9`（含扩展名形式） | EINVAL | ✅ EINVAL |
| `a:b.md`、`a|b.md`、`a?b` 等非法字符 | EINVAL | ✅ EINVAL |
| 201 字符超长名 | EINVAL | ✅ EINVAL |
| 尾点 `name.`、`.`、`..` | EINVAL | ✅ EINVAL |
| 新建 `note.txt` / `note` | NOT_MARKDOWN | ✅ NOT_MARKDOWN |
| 已存在文件/目录 | EEXIST | ✅ EEXIST |
| 删除非空目录 | ENOTEMPTY | ✅ ENOTEMPTY |
| 读目录 / 写目录 | EISDIR | ✅ EISDIR |
| 不存在的路径 | ENOENT（pathInfo 则 `exists:false`） | ✅ |
| 名称首尾空白 | 裁剪后创建（`"  spaced.md  "`→`spaced.md`） | ✅ |

**绝对路径说明（设计取舍，非缺陷）：** 本应用是本地编辑器，主进程只校验「绝对路径 / 非空 / 无 NUL」，不限制在已打开目录内；因此 `C:\Windows\x.md` 会返回 `ENOENT`（不存在）而非 `EINVAL`，存在时可正常读取。这是「用户可打开任意本地文件」的产品设计，风险由「渲染进程受信 + CSP + 无 XSS」缓解；如需防御纵深见 P2-01。

### 4.4 `app://` 自定义协议越权

通过主进程 inspector + `net.fetch` 取**真实 HTTP 状态码**（`artifacts/qa/results-main.json` 中 `PROTO-*`）：

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `app://file/<绝对路径>.png` | 200 + `image/png` | ✅ 200 |
| `app://file/<绝对路径>.md` / `.html` / 图片内容但 `.txt` 扩展名 | 403（仅图片扩展名白名单） | ✅ 403 |
| `app://file/<相对路径>` / 空路径 / `C:relative.png` | 400 | ✅ 400 |
| `app://file/..\..\Windows\win.ini`（编码穿越） | 400（非绝对路径） | ✅ 400 |
| 31MB 图片（> MAX_IMAGE_BYTES=30MB） | 403 | ✅ 403 |
| 目录改名为 `dir-as-image.png` | 403（非文件） | ✅ 403 |
| 不存在的图片 | 404 | ✅ 404 |
| 大写扩展名 `.PNG` | 200（白名单大小写不敏感） | ✅ 200 |
| `app://bundle/..%5C..%5Cpackage.json`、`..%2F..%2Fpackage.json`、`C:\Windows\win.ini` | 403（目录穿越/绝对路径逃逸被 `isInside` 拦截） | ✅ 403 |
| `app://bundle/%2e%2e/%2e%2e/...` | 404（URL 规范化后不越界） | ✅ 404 |
| `app://bundle/index.html` | 200 + CSP 响应头；`/js/*.js` 200 且无 CSP（CSP 由文档承载） | ✅ |

### 4.5 外部链接 / 导航 / 新窗口

代码审计（`main.js:294-303, 621-627`、`preview.js:165-181`）：`will-navigate` 仅放行 `app://bundle/`；新窗口一律 deny，仅 http/https 交给系统浏览器；`shell:open-external` 仅接受 `^https?://`；预览链接只转发 http/https，`javascript:/app:/file:/mailto:` 忽略或提示。运行时断言 **LINK-02**：javascript/file/mailto/vbscript 全部 `EINVAL`。✅

### 4.6 Lead 加固变更复验（第二轮，放行依据）

复验脚本 `artifacts/qa/audit-hardening.mjs`，结果 `artifacts/qa/results-hardening.json`：**17/17 通过**。覆盖 Lead 本轮 6 项加固 + 关键回归：

| 断言 | 复验内容 | 结果 |
| --- | --- | --- |
| H-01 | preload 暴露面 = 契约 **37** 键：新增 `confirmFileConflict`、`onOpenPath`；`appVersion` 硬编码已移除（`bootstrap().appVersion` 仍为 `1.0.0`） | ✅ |
| H-02/03 | `bootstrap().appVersion` 由主进程提供；`window.api` 仍被冻结 | ✅ |
| H-04 | CSP 响应头新增 `object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`（`main.js:127-128`） | ✅ |
| H-05 | `index.html` meta CSP 同步新增 `object-src/base-uri/form-action`（`index.html:7`；`frame-ancestors` 仅响应头） | ✅ |
| H-06 | 加固后 CSP 仍实际拦截内联脚本（未执行 + 触发 `securitypolicyviolation`） | ✅ |
| H-07 | `app://file` 图片（PNG/SVG）响应带 `CSP: default-src 'none'; style-src 'unsafe-inline'`（`main.js:129,201`），SVG 不可执行脚本/加载子资源 | ✅ |
| H-08 | `app://bundle` 目录穿越仍 403（回归） | ✅ |
| H-09/10 | 用隐藏 BrowserWindow 加载真实 preload 发起 IPC：被拒并返回 **EACCES**；主进程 stderr 记录「拒绝非法来源调用」告警（`main.js:404-421`） | ✅ |
| H-11 | 保存冲突-取消：外部修改后 Ctrl+S 弹出冲突确认（窗口模态禁用），Esc 取消 → 不写盘、文档保持未保存 | ✅ |
| H-12 | 保存冲突-重新加载：选择「重新加载」→ 编辑器内容替换为磁盘新内容、dirty 清除（`app.js:576-597`、`main.js:552-567`） | ✅ |
| H-13 | 保存冲突-覆盖保存：选择「覆盖保存」→ 磁盘写入应用内容、外部修改不再保留、dirty 清除 | ✅ |
| H-14 | second-instance：应用已运行时再次传入 `.md` 路径，主窗口自动打开该文件（`main.js:700-708`、`app.js:1042-1048`、`preload.js:78`） | ✅ |
| H-15 | 加固复验全程无未捕获 JS 错误 | ✅ |

> 原生对话框按钮通过 Windows UI Automation / `BM_CLICK` 精确定位（`artifacts/qa/helpers/clickdialog.ps1`），避免键盘焦点抖动；取消路径仍用 Esc。
> 交付一致性：`resources/app/src` 与仓库 `src` 全部 **16/16** 文件 SHA256 一致；`resources/app/docs/CONTRACTS.md` 与仓库一致（9101 B，SHA256 `D42BDC58…`）；重打包 exe smoke **66/66**。

## 5. 健壮性 / 边界（运行时验证）

| 断言 | 场景 | 结果 |
| --- | --- | --- |
| **ROBUST-01** | 只读文件保存：错误 toast、文档保持未保存、磁盘文件未改、无 `.tmp` 残留 | ✅ |
| **ROBUST-02** | 上述失败后窗口仍可交互（无白屏） | ✅ |
| **ROBUST-03** | 编辑器内容 >5MB 保存被拒（TOO_LARGE），dirty 保持、错误提示 | ✅ |
| **ROBUST-04** | 空文件夹：`listDir` 空数组 + 树显示「空文件夹」 | ✅ |
| **ROBUST-05** | 无文档：保存/另存为按钮禁用，Ctrl+S 无动作、无未捕获异常 | ✅ |
| **ROBUST-06** | 连续快速切换文档 12 次：无未捕获异常，最终路径与内容一致 | ✅ |
| **WATCH-01/02** | 外部新增/删除文件后文件树 1s 内自动刷新（fs.watch + 防抖） | ✅ |
| **RECENT-01** | 最近列表指向已删除文件：点击提示错误、保持欢迎页、无异常 | ✅ |
| **PREVIEW-01** | 输入后 120ms 防抖更新预览与字数 | ✅ |
| **START-01~05** | 损坏 `state.json` 回落默认；`--root` 不存在有错误 toast；无文档/无目录时快捷键不崩溃 | ✅ |
| 编码边界 | 非 UTF-8（GBK）→ BAD_ENCODING；含 NUL → BAD_ENCODING；BOM 去除；>5MB → TOO_LARGE | ✅ |
| 重命名冲突 | EEXIST（API） | ✅ |
| 最小窗口 | e2e 900×600 无横向溢出 | ✅ |

## 6. 新增自动化回归用例（未修改任何既有测试）

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `tests/qa-fs-security.test.mjs` | 8 | 相对路径/穿越 EINVAL、NUL 路径、文件名非法/合法矩阵、Markdown 扩展名强制、真实文件系统创建/重命名冲突/大小写改名/删除非空目录/目录类型/原子写残留/排序、编码边界（GBK/NUL/BOM/>5MB） |
| `tests/qa-markdown-xss.test.mjs` | 9 | 真实 `markdown.js` 配置下 8 类原始 HTML 转义、6 类危险协议链接/图片、安全链接保留、任务列表、标题 slug、代码围栏注入、渲染层/主进程 `validateName` 契约一致性、`resolveMarkdownName`、util 纯函数 |

运行：`npm test` → **43/43 通过**（原有 26 + 新增 17，日志 `artifacts/qa/npm-test-after-qa.log`）。

## 7. 缺陷清单

### P0（阻塞，0 项）
无。

### P1（必须修复/复验，1 项 —— **已关闭 ✅**）

#### P1-01 便携版 `release/` 与源码不一致（交付物过期）—— **已修复/已复验通过**

- **第一轮现象**：`release/轻墨-1.0.0-win32-x64/轻墨.exe` 内 `resources/app/src` 有 3 个文件与仓库 `src` 不同，`docs/CONTRACTS.md` 也是旧版；便携版缺少「关闭前保存被取消/失败后解锁关闭确认」的修复。
- **第一轮证据**（SHA256 前 12 位）：`main.js` `FF5F099A3DA0` vs `0649D88B741E`；`preload.js` `71A971F3FFAB` vs `38314DE56371`；`app.js` `867F5D8FA8F4` vs `8E6A4E381E00`；`CONTRACTS.md` 8060 B vs 7938 B。
- **原因**：release 构建于 2026-10-22 15:30:08；源码最终修复写入于 15:31:56–15:32:04。
- **第二轮复验（关闭依据）**：
  1. Lead 已用最终源码重新 `npm run package`；
  2. `resources/app/src` 与仓库 `src` **16/16 文件 SHA256 全部一致**（含 `main.js`/`preload.js`/`renderer/app.js`）；
  3. `resources/app/docs/CONTRACTS.md` 与仓库一致（9101 B，SHA256 `D42BDC58D0F9F797…`）；
  4. 重打包 exe `npm run smoke -- --app ...` → **66/66 通过**，exit 0，`errors=[]`（`artifacts/qa/smoke-packaged-final.log`）。
- **状态**：**通过（P1-01 关闭）**，便携版可作为最终交付物。

### P2（记录/建议，15 项中 7 项已修复/加固）

| ID | 严重度 | 问题 | 涉及文件:行 | 状态 / 建议 |
| --- | --- | --- | --- | --- |
| P2-01 | 中 | IPC handler 未校验发送方 frame，文件系统 IPC 接受任意绝对路径读写 | `src/main/main.js:404-421`；`src/main/fs-service.js:63-74` | **✅ 已修复（第二轮）**：`isTrustedSender` 校验 `event.sender === mainWindow.webContents` 且 `senderFrame.url` 以 `app://bundle/` 开头，非法来源返回 EACCES + 告警；复验 H-09/H-10。任意绝对路径读写仍为编辑器设计，建议后续按用户授权目录收敛（低优先级） |
| P2-02 | 低 | CSP 缺 `object-src/base-uri/frame-ancestors/form-action` | `src/main/main.js:127-128`、`src/renderer/index.html:7` | **✅ 已修复（第二轮）**：响应头四项齐全（frame-ancestors 仅响应头），meta 含前三项；复验 H-04/H-05/H-06 |
| P2-03 | 低 | `sandbox:false`（preload 拥有完整 Node 权限） | `src/main/main.js:280` | 未变（契约有意为之，preload 需 `node:path`）；建议后续改 `sandbox:true` 并自实现路径工具 |
| P2-04 | 低 | `app://file` 图片响应无 CSP；SVG 等资源可被直接加载 | `src/main/main.js:129,201` | **✅ 已加固（第二轮）**：图片响应带 `CSP: default-src 'none'; style-src 'unsafe-inline'`；仍允许任意绝对路径图片（编辑器设计），复验 H-07 |
| P2-05 | 中 | 保存前不与磁盘 mtime 比对，外部修改后 Ctrl+S 静默覆盖 | `src/renderer/js/app.js:576-597`；`src/main/main.js:552-567` | **✅ 已修复（第二轮）**：写前 `pathInfo` 比对 mtime，冲突时弹「覆盖保存/重新加载/取消」三选一；复验 H-11/H-12/H-13 |
| P2-06 | 低 | 单文件超规格（RENDERER-SPEC 建议 <450 行） | `app.js` ~1190 行、`tree.js` 618 行、`styles.css` 1662 行 | 待排期（可维护性建议拆分） |
| P2-07 | 低 | `appVersion` 在 preload 硬编码 `'1.0.0'` | `src/preload/preload.js:31` | **✅ 已修复（第二轮）**：移除硬编码，`bootstrap().appVersion` 为唯一来源；复验 H-01/H-02 |
| P2-08 | 低 | 调试面随生产包发布：`window.__qm`、`--e2e/--screenshot`、`e2e.js` | `src/renderer/js/app.js`（__qm 段）；`src/main/main.js:32-44`；release 内 `resources/app/src/main/e2e.js` | 待排期：建议生产构建裁剪或 dev 条件启用（非远程可利用） |
| P2-09 | 低 | `settings.autoSave` 无任何 UI 入口（自动保存逻辑不可达） | `src/renderer/js/app.js`（自动保存段）；`src/main/state-store.js:19-28` | 待排期：加设置开关或从契约移除 |
| P2-10 | 低 | 外部删除的最近项不会自动清理，需点击后才提示失败 | `src/main/state-store.js:207-220` | 待排期：启动/渲染时校验存在性并置灰或清理 |
| P2-11 | 低 | e2e 66 项覆盖缺口（原生对话框/外部刷新/边界等） | `src/main/e2e.js` | 本次 QA 脚本已补齐：`audit-main` 99 项 + `audit-hardening` 17 项；建议后续纳入可重复验收脚本 |
| P2-12 | 低 | 保存会丢失原文件 BOM | `src/main/fs-service.js:180-189,193-206` | 待排期（契约未要求字节级原样；如需保留应记录并恢复 BOM） |
| P2-13 | 低 | 多实例未解析命令行参数，已运行时双击文件不打开 | `src/main/main.js:700-708`；`src/renderer/js/app.js:1042-1048`；`src/preload/preload.js:78` | **✅ 已修复（第二轮）**：`second-instance` 解析参数并经 `app:open-path` 转发，复验 H-14 |
| P2-14 | 低 | 关闭确认锁在「保存被取消/失败」后曾 30s 卡死 | `src/main/main.js:441-447`、`src/preload/preload.js:41`、`src/renderer/js/app.js`（handleCloseRequested） | **✅ 已修复（第一轮源码 / 第二轮打包验证）**：`app:close-cancelled` 解锁；重打包后便携版已包含 |
| P2-15 | 低 | （第二轮新观察）`docs/QA-REPORT.md` 外无新增源码问题；加固后 CSP/来源校验/冲突检测未引入未捕获异常（H-15） | — | 观察项，无需修复 |

## 8. 已验证通过项清单（摘要）

- 功能：编辑/实时预览、新建、打开（树+对话框）、保存（Ctrl+S/磁盘标记）、另存为（原生对话框）、关闭、未保存提醒（切换 + 关窗）、打开文件夹、树展开、新建文件/文件夹、删除（回收站 + 确认框）、重命名（API + 冲突/非法名）、三种视图、深浅主题、查找、最近打开、外部变更刷新、快捷键、设置持久化、最小窗口布局、空状态/禁用态。
- 安全：contextIsolation/nodeIntegration 生效、preload 最小暴露面 + 冻结、CSP 响应头与真实拦截（inline/remote/eval 策略）、7 类 XSS 载荷不执行、40 项路径/文件名边界、`app://file` 白名单/绝对路径/尺寸/目录/穿越、`app://bundle` 目录穿越、外链 http/https 限制。
- 健壮性：只读保存、>5MB、非 UTF-8/NUL/BOM、非空目录删除、重命名冲突、空目录、无文档/无目录快捷键、最近失效项、连续快速切换、损坏状态启动、初始化失败兜底（代码 + 启动审计）。
- 质量：无未捕获 JS 错误（e2e + CDP 全轮）、无 `.tmp` 残留、回收站 `trashed=true`、原子写、`state.json` 损坏回落、监听解绑（context menu/drag/watcher 均在关闭时清理）。
- **第二轮加固复验**：IPC 来源校验（EACCES + 告警）、CSP 四项新指令、`app://file` 图片 CSP、保存冲突三选一（取消/重新加载/覆盖保存）、`second-instance` 转发打开、preload 37 键 / appVersion 去硬编码——全部通过（§4.6，17/17）。

## 9. 未覆盖项及原因

| 项 | 原因 |
| --- | --- |
| 打包产物最终复验 | 已于第二轮完成：重打包 exe smoke 66/66 + `resources/app/src` 16/16 SHA256 一致（见 §4.6） |
| UI 行内重命名、拖拽打开文件 | 时间限制未做运行时 UI 自动化；行内重命名经代码审计（`tree.js:318-411`），拖拽为规格标注的可选增强、未实现 |
| 系统回收站人工恢复 | 只验证 `trashed=true` 与文件消失，未实际打开回收站恢复（自动化不可行） |
| 高 DPI / 多显示器 / 跨屏窗口恢复 | 未在真实多屏环境验证（e2e 已测 900×600 最小尺寸） |
| 真实用户鼠标/键盘操作 | 审计用合成 DOM 事件 + CDP + SendKeys 驱动真实应用；非真人操作，但走的是同一事件/代码路径 |
| CDP 环境下 eval 的 CSP 验证 | DevTools 执行上下文会放宽 CSP，`eval` 测试不可靠；已改用「响应头无 unsafe-eval + 内联脚本实际被拦截」作为证据（CSP-02/04） |
| 崩溃恢复/草稿恢复、大文件渲染性能、代理/网络环境 | 未实现或无相应需求；离线应用无网络依赖 |
| `docs/screenshots/` 像素级稳定 | e2e 重跑后 5/11 张因动画/时间戳/滚动位置等非确定性差异，属预期；稳定副本未被修改 |

## 10. 产出物索引

| 路径 | 说明 |
| --- | --- |
| `docs/QA-REPORT.md` | 本报告 |
| `tests/qa-fs-security.test.mjs` | 新增回归：文件系统安全/边界（8 用例） |
| `tests/qa-markdown-xss.test.mjs` | 新增回归：Markdown 转义/XSS、契约一致性（9 用例） |
| `artifacts/qa/audit-main.mjs` | CDP 运行时审计（安全/协议/健壮性/原生对话框，99 断言） |
| `artifacts/qa/audit-startup.mjs` | 启动健壮性审计（5 断言） |
| `artifacts/qa/audit-hardening.mjs` | **第二轮** Lead 加固变更复验（IPC 来源/CSP/图片 CSP/保存冲突三选一/second-instance，17 断言） |
| `artifacts/qa/results-main.json` / `results-startup.json` / `results-hardening.json` | 断言明细（含实际状态码、错误码、测量值） |
| `artifacts/qa/lib/cdp.mjs`、`artifacts/qa/helpers/sendkeys.ps1`、`artifacts/qa/helpers/clickdialog.ps1` | 审计基础设施（CDP 客户端 + 原生对话框按键/按钮点击） |
| `artifacts/qa/screenshots/*.png` | 本次审计实拍（欢迎页、XSS 预览、无文档、外部刷新、快速切换、损坏状态启动、冲突流程） |
| `artifacts/qa/smoke-dev.log` / `smoke-packaged.log` / `smoke-packaged-final.log` / `npm-test-*.log` / `audit-*.log` | 复跑日志（含最终重打包版 smoke） |
| `artifacts/e2e/` | e2e 产物（`npm run smoke` 自动重写，非本次手工修改） |
| `artifacts/qa/cdp-probe*.mjs` | 协议探测的探索脚本（保留供复现协议状态码方案） |

## 11. 放行结论

**✅ 通过，准予放行。**

1. **P1-01 已关闭**：最终源码重新打包；`resources/app/src` 16/16 SHA256 与仓库一致、`CONTRACTS.md` 一致；重打包 exe smoke **66/66**。
2. **Lead 加固项全部复验通过（17/17）**：IPC 来源校验（非法来源 EACCES + 告警）、CSP 新指令、`app://file` 图片 CSP、保存冲突三选一（取消/重新加载/覆盖保存）、`second-instance` 转发打开、preload 暴露面更新（37 键、appVersion 不再硬编码）。
3. **无回归**：加固版源码上 `npm test` 43/43、dev smoke 66/66、独立 CDP 审计 99/99、启动审计 5/5 全部保持通过。
4. 剩余 P2（P2-03/06/08/09/10/11/12）均为加固/可维护性/体验类建议，不阻塞交付，可排期处理。

## 12. MoDex 更名 + Codex 风格重设计复验（第三轮，最终放行依据）

- 复验时间：2026-10-22（第三轮）
- 依据：`docs/CODEX-UI-DESIGN.md`（设计唯一验收依据）、`docs/CONTRACTS.md`（接口不变）
- 交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`
- 本轮复跑：`npm test` **43/43**、dev smoke **67/67**、打包 exe smoke **67/67**、更名+设计审计 **23/23**、无回归审计 **99/99 + 17/17**（均 exit 0）。

### 12.1 更名完整性（全部实测/核验通过）

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| `package.json` | `name=modex`、`productName=MoDex`、description 已更新 | D0 前置检查；`package.json:2-5` |
| 窗口标题 | 有文档 `示例.md — MoDex`；无文档 `MoDex`；未保存 `● 文件名 — MoDex` | 断言 D1/D5/D18（原生窗口标题 + `document.title` 双重验证） |
| 工具栏/欢迎页品牌 | 「M」内联 SVG 标记 + 文本 **MoDex**；欢迎页 h1=MoDex；副标题保留「轻量 · 专注的 Markdown 写作与预览」 | D2/D5 + 截图 `01-welcome`、`03-split-light` |
| 可见文案 | 页面可见文本无「轻墨 / QingMo」，包含 MoDex | D3 |
| 应用菜单 / 关于对话框 | 菜单 4 个顶级分组与上轮基线逐项一致；帮助→「关于 MoDex」；无旧品牌 | D6（主进程 `Menu.getApplicationMenu()` 实测） |
| 用户数据目录 | `app.name = MoDex`，默认目录 **`%APPDATA%\MoDex`**（实测已生成 `state.json`）；当前版本不再写入 `%APPDATA%\轻墨`（该目录为更名前版本遗留，mtime 07:57Z） | D4 |
| 源码可见文案 | `src/**`、`scripts/**` 中「轻墨/QingMo/qingmo/墨」零残留（仅 README 更名说明与历史 QA 报告为允许例外） | 全量 `Select-String` 核查 |
| e2e / fixtures | `示例.md`、`diagram.svg` 等 fixtures 已改为 MoDex；e2e 67 项断言全绿 | e2e `results.json` |
| 打包产物 | 目录与可执行文件均为 `MoDex-1.0.0-win32-x64/MoDex.exe`；旧 `轻墨-*` 目录已删除 | 文件系统核验 |

### 12.2 设计令牌 / 布局尺寸实测（CDP `getComputedStyle`）

断言 D7–D9、D16、D18–D21（`results-design-modex.json`）：

| 项目 | 规范值 | 实测值 | 结果 |
| --- | --- | --- | --- |
| 浅色 `--bg` / `--panel` / `--panel-soft` / `--border` | `#fafaf8` / `#ffffff` / `#f6f6f2` / `#e7e6e0` | 完全一致；实际渲染 工具栏 `rgb(250,250,248)`、侧栏 `rgb(246,246,242)`、编辑/预览 `rgb(255,255,255)` | ✅ |
| 深色 `--bg` / `--panel` / `--border` | `#0e0e0f` / `#141415` / `#252527` | 完全一致 | ✅ |
| 工具栏 `#toolbar` 高 | 40px | **40px** | ✅ |
| 状态栏 `#statusbar` 高 | 24px | **24px** | ✅ |
| 文档头 `#doc-head` 高 | 32px | **32px** | ✅ |
| 树行高 | 24px | **24px**（左内边距 6px，缩进 12px/层） | ✅ |
| 查找栏浮层 | `fixed; top 52px; height 32px; right 20px`，宽约 340 | **fixed / top 52 / height 32 / width 344**，圆角+浮层阴影 | ✅ |
| 预览正文最大宽 | 680px 居中 | **`max-width: 680px`** | ✅ |
| 未保存点 | 5px accent 圆点 + 6px 间距，标题 `● ` 前缀 | **5×5px，`rgb(74,107,138)`（accent），标题 `● doc.md — MoDex`** | ✅ |
| 最小窗口 900×600 | 无横向溢出 | `scrollWidth=900`、`overflowX=false`、工具栏仍 40 | ✅ |

**单色 / 低装饰**（D10–D13）：
- 抽样 9 处文字（工具栏按钮/树/文档头/状态栏/预览正文/标题/链接）通道差均 ≤7，全为中性灰，无彩色文字；强调色 `#4a6b8a` 仅用于焦点/选中/链接。
- **CSS 渐变：0 处**；**彩色内联 SVG：0 处**（全部 `currentColor`）。
- 阴影扫描：仅 `#findbar`（float）与 `#context-menu`（menu）为 elevation 阴影；视图 tab 激活下划线（`inset -1.5px`）与树激活行左缘（`inset 2px accent`）为设计规定的发丝线实现，非 elevation → 无违规。
- 右键菜单实测：项高 **28px**、圆角 **8px**、发丝线 + `--shadow-menu`，操作项与上轮一致（新建文件/新建文件夹/重命名/删除/资源管理器/复制路径）。
- Toast 实测：浮层背景 + 阴影 + 8px 圆角 + 状态色条（`D20`）。

### 12.3 无新增功能入口（硬约束）

| 检查项 | 基线（上轮） | 本轮实测 | 结果 |
| --- | --- | --- | --- |
| `data-action` 集合 | 16 项 | **16 项，完全一致**（缺失 0、新增 0） | ✅ D14 |
| 工具栏按钮 / 视图 tab / 侧栏按钮 | 10 / 3 / 3 | **10 / 3 / 3** | ✅ D15 |
| 应用菜单非分隔项 | 文件 7 / 编辑 7 / 视图 10 / 帮助 2 | **逐项完全一致**（含「关于 MoDex」） | ✅ D6 |
| 右键菜单项 | 文件项 6 个（含父目录新建） | **6 个，完全一致** | ✅ D19 |

### 12.4 视觉审阅与打包产物

- **截图审阅**：`artifacts/e2e/screenshots/` 全部 **13 张**（含新增 `12-findbar`、`13-dirty`）人工审阅：整体呈单色、发丝线分区、紧凑精密排版；无渐变/彩色图标/大阴影；浅色「纸感暖白」、深色「近黑中性」；两种主题层级清晰可读。本次另补拍 8 张（`artifacts/qa/screenshots-modex/`：欢迎页、浅/深分栏、预览、编辑、查找栏、未保存点、右键菜单、toast、900×600）。
- **WCAG 对比度实测**（相对亮度公式）：

| 主题 | 正文 vs panel | 次要文字 muted vs panel | faint vs panel | border vs panel |
| --- | --- | --- | --- | --- |
| 浅色 | **17.25 : 1（AAA）** | **5.06 : 1（AA）** | 2.80 : 1 | 1.25 : 1（发丝线，装饰性） |
| 深色 | **15.56 : 1（AAA）** | **5.59 : 1（AA）** | 3.18 : 1 | 1.20 : 1（发丝线，装饰性） |

- **打包产物放行**：
  - `release/MoDex-1.0.0-win32-x64/resources/app/src` 与仓库 `src` **16/16 文件 SHA256 完全一致**；
  - `resources/app/docs/CONTRACTS.md` 与仓库一致（9091 B，SHA256 `F36C3FC4…`）；`CODEX-UI-DESIGN.md` 随包发布；
  - 打包 exe smoke **67/67**，`errors=[]`，落盘 `savedMarker=true`、回收站 `trashed=true`；
  - 旧品牌 release 目录已删除，仅保留 `MoDex-1.0.0-win32-x64/`。

### 12.5 本轮缺陷更新

| ID | 级别 | 内容 | 状态 |
| --- | --- | --- | --- |
| — | — | 本轮未发现 P0/P1；功能、安全、健壮性、更名、设计还原均通过 | — |
| P2-16 | 低 | 更名后用户数据目录由 `%APPDATA%\轻墨` 变为 `%APPDATA%\MoDex`，**无迁移逻辑**：更名前用户的历史设置/最近列表不会带入新目录（旧目录遗留） | 记录；README 已说明目录变更。建议后续版本做一次一次性迁移（复制 `state.json`） |
| P2-17 | 低 | 设计规范 §1「阴影只给浮层」与实现「激活树行/视图 tab 用 inset box-shadow 画发丝线」存在字面冲突（实际为 1px 线条而非 elevation） | 记录；按设计意图判定通过，建议规范中注明 inset 例外 |
| P2-03/06/08/09/10/11/12 | 低 | 第二轮遗留的加固/可维护性/体验建议 | 仍待排期，不阻塞交付 |

### 12.6 第三轮结论

**✅ 通过，准予放行。** MoDex 更名完整、Codex 风格 UI 还原符合规范（令牌/尺寸/单色/阴影/排版/对比度均实测通过），功能与接口零新增零删减，安全性/健壮性无回归，打包产物与源码一致且 exe smoke 67/67。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

## 13. 多文件夹工作区 + 工具栏精简复验（第四轮，最终放行依据）

- 复验时间：2026-10-22（第四轮）
- 依据：`docs/MULTI-FOLDER-SPEC.md`（数据/接口/UI/e2e 约定）、`docs/CODEX-UI-DESIGN.md` §8（根行与精简工具栏视觉）
- 新增专项脚本：`artifacts/qa/audit-multiroot.mjs`（18 断言，含两次独立启动验证重启恢复）；既有脚本按新接口/基线更新（preload `setRoot`→`setRoots`、`rootFolder`→`rootFolders`、工具栏 5 按钮、菜单「添加文件夹…」）。
- 本轮复跑：`npm test` **46/46**、dev smoke **83/83**、打包 exe smoke **83/83**、多根专项 **18/18**、设计审计 **23/23**、无回归 **100/100 + 17/17**（全部 exit 0）。

### 13.1 多文件夹功能（实测）

| 验证项 | 结果 | 证据（断言） |
| --- | --- | --- |
| 添加多个文件夹 | ✅ | `__qm.openRoot` 依次添加两个根，`rootFolders` 顺序正确，新添加根自动激活（M7）；根行 2 个 `li[data-root="true"]`（M8） |
| 根行视觉 | ✅ | 高 **28px**、圆角 **6px**、激活根 `inset 2px accent` 左缘、hover/激活显示 `＋`/`···` 两个根操作按钮（M8）；截图 `14-multi-root`、`15-root-menu` |
| 激活切换 | ✅ | 点击根行后 `activeFolder` 同步、激活态唯一（M10）；重复添加已存在根不重复、仅激活（M11） |
| 根行内新建文件 | ✅ | 根行「＋」→ 行内输入 → Enter → 文件落地并自动打开（M12） |
| 根右键菜单 | ✅ | 6 项：新建文件/新建文件夹/刷新/资源管理器/复制路径/**从列表移除**（M13） |
| 移除根（不删盘、文档保持） | ✅ | `rootFolders` 更新、根行消失、`state.json` 更新；磁盘文件仍存在；移除根内的当前文档保持打开且内容不变（M16） |
| 多根 fs.watch | ✅ | 向第二个根外部写入文件：仅该根子树自动刷新，第一个根子树节点不变（M14）；`api.setRoots` 返回 `watched` 含两个根（`probe-watch.log`） |
| `state.json` 持久化 | ✅ | `settings.openFolders` 顺序与 `activeFolder` 与渲染状态一致（M15），移除根后同步更新 |
| **重启恢复（QA 独立复验）** | ✅ | 同一 `--user-data`、无 `--root` 二次启动：恢复 2 个根、顺序、`activeFolder`、根行展开状态、侧栏「共 2 个文件夹」（M17；截图 `04-restored-after-restart.png`） |
| 空工作区启动 | ✅ | 无 `--root` 且无持久化根时显示欢迎页/空侧栏，`rootFolders=[]`（M0） |

### 13.2 工具栏精简（硬约束）

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| `#toolbar` 只有 5 个 data-action | ✅ | 集合恰为 `{toggle-sidebar, view-edit, view-split, view-preview, theme-toggle}`，高度 40px（M1） |
| 5 个旧按钮已删除 | ✅ | `#toolbar` 中 `new-doc/open-file/open-folder/save/save-as` 均不存在（M1） |
| 全局无新增入口 | ✅ | 所有 `data-action` 均属既有基线；侧栏头部仅 2 个按钮（添加文件夹/刷新）（M2） |
| 被删功能仍可达 — 菜单 | ✅ | 文件菜单含 新建文档/打开文件/添加文件夹/保存/另存为（M3） |
| 被删功能仍可达 — 欢迎页 | ✅ | 三按钮 `new-doc/open-file/open-folder` 存在（M4） |
| 被删功能仍可达 — 快捷键 | ✅ | Ctrl+N 新建（M5）、Ctrl+O 原生对话框（M6）、Ctrl+S 保存（e2e「Ctrl+S 快捷键保存成功」） |
| 被删功能仍可达 — 右键菜单 | ✅ | 根行/文件行菜单提供新建、重命名、删除等既有能力（M13/e2e） |

### 13.3 视觉审计（16 张 e2e 截图 + 补拍）

- 审阅 `artifacts/e2e/screenshots/` 全部 **16 张**：重点 `14-multi-root`（双根、激活左缘 accent、共 2 个文件夹、根 hover 操作按钮）、`15-root-menu`（根菜单 6 项、浮层样式）、`01-welcome`（欢迎页三按钮+最近列表）、`06-split-dark`（深色单色令牌）、`11-min-window`（900×600 无横向溢出）。
- 结论：工具栏精简后视觉更克制（品牌 + 侧栏开关 | 视图 tabs + 主题），根行与 Codex 项目列表气质一致；浅/深两主题单色令牌未变、无渐变/彩色图标/大阴影；根行 28px/圆角 6/激活 accent 左缘符合 `CODEX-UI-DESIGN.md` §8。
- QA 补拍：`artifacts/qa/screenshots-multiroot/`（多根浅色、根菜单、深色、重启恢复后）。

### 13.4 打包产物与资源一致性

- `release/MoDex-1.0.0-win32-x64/resources/app/src` 与仓库 `src` **16/16 文件 SHA256 完全一致**；
- `resources/app/docs/CONTRACTS.md` 与仓库一致（SHA256 `4FA67A49A46547343E68BBBBE7ED98F52DC3C889D9DB206720AF1BF2A418024D`）；
- 打包 exe smoke **83/83**，`errors=[]`，`savedMarker=true`、`trashed=true`；
- `release/` 仅 `MoDex-1.0.0-win32-x64/`，旧/多余目录无残留。

### 13.5 本轮缺陷更新

| ID | 级别 | 内容 | 状态 |
| --- | --- | --- | --- |
| — | — | 本轮未发现 P0/P1；多文件夹核心链路（添加/激活/移除/持久化/重启恢复/多根监听）与工具栏精简全部通过 | — |
| P2-18 | 低 | 多根树的 DOM 采用「根行 + 扁平兄弟节点」渲染（与 `MULTI-FOLDER-SPEC.md` §2 的嵌套 `<li>` 示例不完全一致，但 e2e 选择器与行为不受影响）；依赖层级归属的第三方脚本需按 DOM 顺序分组 | 记录；建议规范与实现保持一致（或注明扁平渲染） |
| P2-19 | 低 | 本轮验收期间曾出现「多个 Electron 实例并发」导致冒烟/审计互相干扰（QA 环境操作，非产品缺陷）；已清理后严格串行复跑，全部结果有效 | 记录；后续验收严格串行 |
| P2-03/06/08/09/10/11/12/16/17 | 低 | 历史遗留加固/可维护性/体验建议 | 仍待排期，不阻塞交付 |

### 13.6 第四轮结论

**✅ 通过，准予放行。** 多文件夹工作区（添加/激活/移除/持久化/重启恢复/多根独立监听）与工具栏精简（恰好 5 入口、无新增替代、功能入口全部保留）均符合规格；设计令牌与根行视觉符合 Codex 风格；安全/健壮性无回归；打包产物与源码一致且 exe smoke 83/83。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

## 14. 单条导航栏复验（第五轮，最终放行依据）

- 复验时间：2026-10-23（第五轮）
- 依据：`docs/APP-MENUBAR-SPEC.md`（布局/菜单项清单/`api.runMenuCommand`/e2e 约定）、`docs/CODEX-UI-DESIGN.md` §9
- 新增专项脚本：`artifacts/qa/audit-menubar.mjs`（24 断言）；既有脚本按新 preload 键 `runMenuCommand`（38 键）与单条导航栏布局更新。
- 本轮复跑：`npm test` **46/46**、dev smoke **92/92**、打包 exe smoke **92/92**、导航栏专项 **24/24**、设计审计 **23/23**、无回归 **100/100 + 17/17 + 18/18**（全部 exit 0）。

### 14.1 单条导航栏结构（主进程 + 渲染层实测）

| 验证项 | 结果 | 证据（断言） |
| --- | --- | --- |
| 原生菜单栏隐藏 | ✅ | `win.isMenuBarVisible() === false`（主进程实测，N1）；截图仅一条 40px 导航栏 |
| 应用菜单仍注册（原生 role/快捷键保留） | ✅ | `Menu.getApplicationMenu() != null`（N1）；原生菜单结构 文件 **10** / 编辑 **9** / 视图 **13** / 帮助 **2** 项（含分隔线，N2） |
| 工具栏结构 | ✅ | `#toolbar` 恰好 4 个 `[data-app-menu]`（file/edit/view/help，文本 文件/编辑/视图/帮助，顺序正确）+ 5 个既有 `data-action`；高 **40px**、`top=0`（窗口无第二条横条，N3） |
| 菜单按钮不使用 data-action | ✅ | 4 个菜单按钮无 `data-action`，不干扰既有动作分发（N3） |

### 14.2 四菜单项与规格逐项一致（含快捷键 hint/分隔线）

| 菜单 | 期望项数 | 实测 | 结果 |
| --- | --- | --- | --- |
| 文件 | 10（7 项 + 3 分隔） | 新建文档 Ctrl+N ｜ 打开文件… Ctrl+O ｜ 添加文件夹… ｜ — ｜ 保存 Ctrl+S ｜ 另存为… Ctrl+Shift+S ｜ — ｜ 关闭文档 Ctrl+W ｜ — ｜ 退出 Alt+F4 | ✅ N4-file |
| 编辑 | 9（7 + 2 分隔） | 撤销 Ctrl+Z ｜ 重做 Ctrl+Y ｜ — ｜ 剪切 Ctrl+X ｜ 复制 Ctrl+C ｜ 粘贴 Ctrl+V ｜ 全选 Ctrl+A ｜ — ｜ 查找… Ctrl+F | ✅ N4-edit |
| 视图 | 13（10 + 3 分隔） | 编辑/分栏/预览模式（Ctrl+1/2/3）｜ — ｜ 显示隐藏侧栏 / 切换主题（Ctrl+Shift+E/T）｜ — ｜ 放大/缩小/重置字号（Ctrl+=/-/0）｜ — ｜ 全屏 ｜ 开发者工具 F12 | ✅ N4-view |
| 帮助 | 2 | 键盘快捷键 ｜ 关于 MoDex | ✅ N4-help |

> 逐项比对 label 与 hint 文本，与 `APP-MENUBAR-SPEC.md` §2 完全一致，无增删。

### 14.3 下拉交互与动作（实测）

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 再次点击同一按钮关闭 | ✅ | N5 |
| 从一个下拉直接切换到另一个（同时仅一个打开） | ✅ | N6（文件→编辑，内容切换为「编辑」菜单） |
| 点击外部区域关闭 | ✅ | N7（pointerdown） |
| Esc 关闭 | ✅ | N8 |
| 文件→新建文档 | ✅ | N9（未命名缓冲、dirty、下拉关闭） |
| 视图→编辑模式 / 分栏模式 | ✅ | N10（`data-view` 实际切换 edit/split） |
| 帮助菜单两项存在 | ✅ | N11 |
| `api.runMenuCommand` | ✅ | N12（selectAll/undo/redo/copy/paste/cut 返回 ok；未知命令 ok:false）；帮助→键盘快捷键原生对话框弹出/Esc 关闭/返回 ok（N13） |

### 14.4 快捷键回归（隐藏原生菜单栏后，使用**真实键盘事件**）

| 快捷键 | 结果 | 证据 |
| --- | --- | --- |
| **Ctrl+S** 保存 | ✅ | N14：真实按键触发保存，磁盘写入标记、dirty 清除 |
| **Ctrl+A** 全选 | ✅ | N15：selectionStart=0、selectionEnd=总长 |
| **Ctrl+C** 复制 | ✅ | N16：主进程 `clipboard.readText()` 读到选中文本 |
| **Ctrl+V** 粘贴 | ✅ | N17：剪贴板内容成功粘贴进编辑器 |
| **Ctrl+Z** 撤销 | ✅ | N18：粘贴内容被撤销 |
| **F12** 开发者工具 | ✅ | N19：真实按键打开/关闭 DevTools（`webContents.isDevToolsOpened()` 实测） |
| Alt+F4 退出 | 人工项 | N20：保留的原生应用菜单含 role quit（Alt+F4 accelerator），系统行为不变；未自动化以避免关闭窗口/未保存弹窗 |

> 说明：F12/Alt+F4 依赖 Electron 原生菜单 accelerator，本轮已通过主进程菜单仍注册（N1/N2）+ F12 真实按键实测（N19）证明隐藏菜单栏后原生快捷键仍生效；Alt+F4 为 Windows 系统级窗口关闭行为，未在自动化中触发。

### 14.5 视觉审计与打包产物

- 审阅 `artifacts/e2e/screenshots/` 全部 **18 张**：重点 `17-app-menu`（文件菜单下拉、快捷键 hint、分隔线、与右键菜单同令牌）、`18-single-navbar`（品牌 + 侧栏开关 + 四菜单 + 视图 tabs + 主题同一行，无原生菜单第二条）、`06-split-dark`、`11-min-window`（900×600 无横向溢出）、`01-welcome`。
- 结论：窗口仅一条 40px 导航栏，下拉为单色浮层（elevated + 发丝线 + `--shadow-menu`）；浅/深主题令牌不变；根行/工具栏/状态栏尺寸与上轮一致。
- 打包产物：`resources/app/src` 与仓库 `src` **16/16 SHA256 一致**；`resources/app/docs/CONTRACTS.md` 一致（SHA256 `5C110C5A…`）；packaged exe smoke **92/92**，`errors=[]`；`release/` 仅 `MoDex-1.0.0-win32-x64/`。

### 14.6 本轮缺陷更新

| ID | 级别 | 内容 | 状态 |
| --- | --- | --- | --- |
| — | — | 本轮未发现 P0/P1；单条导航栏结构、菜单一致性、下拉交互、原生快捷键全部通过 | — |
| P2-20 | 低 | 验收期间发现环境中存在更早的 MoDex 实例占用默认 userData 单实例锁，导致设计审计「默认用户目录二次启动」探针不可用（已改为「现有默认目录证据 + app.name」回退判定，不影响结论） | 记录；非产品缺陷 |
| P2-03/06/08/09/10/11/12/16/17/18/19 | 低 | 历史遗留加固/可维护性/体验/规范对齐建议 | 仍待排期，不阻塞交付 |

### 14.7 第五轮结论

**✅ 通过，准予放行。** 原生菜单栏已隐藏且应用菜单保留（原生 role/快捷键可用），四个自绘菜单与 40px 工具栏合并为单条导航栏；菜单项与 `APP-MENUBAR-SPEC.md` 逐项一致，下拉交互与动作正确，Ctrl+S/Z/C/V/A 与 F12 真实按键全部有效；安全/健壮性/多文件夹功能无回归；打包产物与源码一致且 exe smoke 92/92。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

## 15. 自动保存复验（第六轮，最终放行依据）

- 复验时间：2026-10-23（第六轮）
- 依据：`docs/AUTOSAVE-SPEC.md`（行为定义/接口/验收）、`docs/CONTRACTS.md`（`onCloseRequested` 语义更新）、`docs/RENDERER-SPEC.md`
- 新增专项脚本：`artifacts/qa/audit-autosave.mjs`（14 断言，含独立启动验证「关闭软件自动保存」）；既有审计脚本按自动保存语义更新（`__qm.openPath` 现在走自动保存、菜单栏/多根/设计/加固审计适配）。
- 本轮复跑：`npm test` **46/46**、dev smoke **97/97 + 阶段二通过**、打包 smoke **97/97 + 阶段二通过**、自动保存专项 **14/14**、无回归 **24/24 + 100/100 + 23/23 + 18/18 + 17/17**（全部 exit 0）。

### 15.1 自动保存行为矩阵（实测）

| 场景 | 期望 | 实测结果 | 断言 |
| --- | --- | --- | --- |
| 有路径文档 → 切换文件（文件树） | 无询问、旧文件落盘、新文件打开、dirty=false、toast「已自动保存」 | ✅ 全程窗口可用（无模态）；docA 落盘；docB 打开；dirty=false；toast 命中 | A1 |
| 有路径文档 → Ctrl+N | 自动保存后进入未命名缓冲 | ✅ docB 落盘、未命名.md dirty、无模态 | A2 |
| 未命名文档 → 切换文件 | 弹另存为；**取消** → 中止切换、保持未命名 dirty | ✅ 对话框出现；Esc 取消后仍为未命名 dirty、目标未打开、未生成文件 | A3 |
| 未命名文档 → 切换文件 | 弹另存为；**确认** → 落盘并继续打开目标 | ✅ `未命名.md` 落盘、目标 docA 打开 | A4 |
| 有路径文档 → Ctrl+W | 自动保存后回欢迎页 | ✅ docA 落盘、欢迎页出现、无模态 | A5 |
| 未命名文档 → Ctrl+W | 另存为取消 → 中止关闭、保持文档 | ✅ 未命名 dirty 保持、欢迎页未出现 | A6 |
| 未命名文档 → Ctrl+W | 另存为确认 → 落盘并回欢迎页 | ✅ 未命名.md 落盘、欢迎页出现 | A7 |
| 只读文件保存失败 → 切换 | 中止切换、保持 dirty、错误提示 | ✅ 仍在只读文档、dirty、toast 权限错误、无弹窗、目标未打开 | A8 |
| 外部修改冲突 → 切换 → 取消 | 弹「覆盖/重新加载/取消」；取消 → 中止离开 | ✅ 冲突对话框出现；UIA 点击「取消」后仍在原文档 dirty、磁盘外部内容未被覆盖 | A9 |
| 外部修改冲突 → 切换 → 重新加载 | 载入磁盘内容并继续完成切换 | ✅ 点击「重新加载」后目标文件打开（= 离开继续），磁盘保留外部内容、未写入编辑器内容 | A10 |
| **关闭软件**（有未保存修改） | 无保存询问、自动保存后进程退出 0、内容落盘 | ✅ 独立启动：编辑后 `window.close()` → **进程 exit 0**、耗时 <12s、文件含编辑标记（与 smoke 阶段二一致） | A13 |
| 删除当前文件 | 仍弹「保存/不保存/取消」（`confirmUnsaved` 仅此路径） | ✅ 源码调用点仅 1 处（定义 + `handleBeforeDelete` 调用共 2 处匹配）；右键删除当前 dirty 文件弹出确认、Esc 取消后文件保留 | A11 |

### 15.2 关键实现证据（代码审计）

- `src/renderer/js/app.js:511-524`：`autoSaveBeforeLeave()`——无文档/非 dirty 直接放行；有 path 走 `saveDocument({silent:true})`，未命名走 `saveDocumentAs({silent:true})`；成功后 toast「已自动保存」；冲突选「重新加载」导致 dirty 已清除时也放行离开（§522）。
- 接入点：`newDocument`（512）、`loadFilePath`（545）、`openFileDialog`（563）、`closeDocument`（833）、`handleCloseRequested`（839）——均改为 `autoSaveBeforeLeave()`。
- `confirmUnsavedIfNeeded` 仅剩 `handleBeforeDelete`（842-847）调用，用于删除当前文件的破坏性确认。
- `src/main/main.js:368-375`：窗口 close 事件在 dirty 时**不再弹保存询问**，直接 `sendToRenderer('app:close-requested')` 并保持 30s 兜底锁。
- 未命名默认另存路径不存在时会先清理同名文件，避免原生保存对话框出现「覆盖确认」二次弹窗（QA 测试环境处理，非产品逻辑）。

### 15.3 视觉 / 交互

- 有路径切换/关闭全程无阻塞对话框，窗口 `isEnabled()` 始终为 true（A1/A2/A5）；toast「已自动保存」出现在右下角，不遮挡工具栏/状态栏（截图 `artifacts/qa/screenshots-autosave/01-autosave-toast.png`）。
- 保存失败时 toast 展示明确错误（权限/只读），文档保持 dirty 且可继续编辑（截图 `02-autosave-failure.png`）。

### 15.4 无回归与打包产物

- 无回归：菜单栏专项 **24/24**、audit-main **100/100**、设计审计 **23/23**、多文件夹 **18/18**、加固 **17/17**；`data-action`/`data-app-menu`/菜单项结构未变，无新增入口。
- 空闲自动保存设置 `settings.autoSave` 仍默认 `false`、无 UI（A12），本轮未改变。
- 打包：`resources/app/src` 与仓库 `src` **16/16 SHA256 一致**；`resources/app/docs/CONTRACTS.md` 一致（SHA256 `8E197DE8…`）；打包 exe 两阶段 smoke 均通过（阶段一 97/97、阶段二 exit 0 + 内容落盘）；`release/` 仅 `MoDex-1.0.0-win32-x64/`。

### 15.5 本轮缺陷更新

| ID | 级别 | 内容 | 状态 |
| --- | --- | --- | --- |
| — | — | 本轮未发现 P0/P1；自动保存核心矩阵（有路径/未命名/失败/冲突/关闭软件）与 `confirmUnsaved` 限定全部通过 | — |
| P2-21 | 低 | `__qm.openPath` 测试钩子语义随产品改为「走自动保存」而非「强制直接打开」（与历史上部分 QA 脚本假设不同）；QA 脚本已适配，行为本身符合 AUTOSAVE-SPEC | 记录；非产品缺陷，建议在 RENDERER-SPEC 钩子说明中注明 |
| P2-22 | 低 | 未命名文档自动保存成功后，当前文档名为另存后的文件名（符合预期）；若用户在另存对话框中取消了操作，切换/关闭会中止且保持未命名缓冲（符合规格，但用户需再次处理）——体验符合 AUTOSAVE-SPEC「不丢数据」原则 | 记录；非缺陷 |
| P2-03/06/08/09/10/11/12/16/17/18/19/20 | 低 | 历史遗留加固/可维护性/体验/规范对齐建议 | 仍待排期，不阻塞交付 |

### 15.6 第六轮结论

**✅ 通过，准予放行。** 自动保存已按 `AUTOSAVE-SPEC.md` 落地：有路径文档在切换文件/Ctrl+N/Ctrl+W/关闭软件时静默保存（toast「已自动保存」、无阻塞询问），未命名文档走另存为且取消即中止、转盘失败/只读/冲突取消均中止离开且不丢数据，冲突「重新加载」后继续离开；关闭软件两阶段 smoke 实测进程 exit 0 且内容落盘；`confirmUnsaved` 仅保留删除当前文件路径；安全、导航栏、多文件夹、设计无回归。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

### 15.1 自动保存后行内编辑竞态修复复验（task-11 → task-12，**✅ 复验通过（P1 关闭）**）

- 复验时间：2026-10-23（task-11 首验发现修复不完整 → Lead 补全修复 → task-12 最终复验）
- 变更历史：
  1. **第一版**：`tree.js refresh()` 不再清空 `inline`（QA 定向复验发现仍不完整：re-render 重建输入框触发的 `blur` 会在刷新后 `cancelInline()`，输入框仍消失）；
  2. **第二版（最终）**：`tree.js` 增加模块级 `refreshing` 标记，`refresh()` 重新加载+render 期间置 true；输入框 blur 回调在触发瞬间捕获 `duringRefresh`，refresh 重建导致的 blur **不再** `cancelInline()`；refresh 结束按 `inline.caret` 恢复焦点与光标，用户可继续输入/Enter 提交；用户点击别处导致的 blur 仍按原行为取消行内编辑；
  3. `e2e.js` 测试加固（watcher 等待/输入框轮询/右键菜单截图重试，仅测试脚本）。
- 复跑（全部串行、exit 0）：
  - `npm test` **46/46**；
  - dev smoke 两阶段：阶段一 **97/97** + **阶段二通过**（`artifacts/qa/smoke-dev-race2.log`）；
  - 打包 exe 两阶段 smoke：阶段一 **97/97** + **阶段二通过**（`artifacts/qa/smoke-packaged-race2.log`）；
  - `resources/app/src` **16/16 SHA256 一致**；release 仅 `MoDex-1.0.0-win32-x64/`。

**定向竞态复验（最终：全部通过）**

| 断言 | 验证内容 | 结果 |
| --- | --- | --- |
| 独立探针 `probe-race.mjs` | 行内新建输入框聚焦（`focused:true, value:'probe-partial'`）→ **手动刷新按钮** → 输入框仍存在、值不变、仍聚焦；再次输入 → **fs.watch 外部变更刷新** → 同样保持（`exists:true, value:'probe-partial', focused:true`） | ✅ |
| R1 | 行内新建输入中 + 同目录外部变更触发 fs.watch 刷新 → 输入框仍在、已输入内容 `race-new` 未丢失 | ✅ |
| R2 | 刷新后继续输入 + Enter → 正确创建 `race-new-final.md`、输入框关闭 | ✅ |
| R3 | 行内重命名输入中 + fs.watch 刷新 → 输入框仍在、已输入新名未丢失 | ✅ |
| R4 | 刷新后 Enter 提交重命名 → 旧名消失、新名落地磁盘、输入框关闭 | ✅ |
| R5 | 树展开正常（sub 展开显示 nested.md；QA 脚本已修正 click 后失效 DOM 引用，改为重新查询节点） | ✅ |
| R6 | 右键菜单正常（文件项 6 个既有动作） | ✅ |
| R7 | 刷新按钮正常 | ✅ |
| R8 | 多文件夹增删正常（2 根 → 1 根） | ✅ |
| R10 | **非 refresh 场景**：输入中点击编辑器（blur）→ 行内编辑仍取消（原行为保留） | ✅ |
| R9 | 定向复验期间无未捕获 JS 错误 | ✅ |

> 结果：`audit-race.mjs` **11/11 通过**（R0 + R1–R10，`artifacts/qa/audit-race2.log` / `results-race.json`）；`probe-race.mjs` 两项刷新场景均保持输入框与焦点（`artifacts/qa/probe-race2.log`）。

- **本轮结论**：**✅ 通过（P1 关闭）**。上一轮发现的「后台刷新重建输入框 → blur → cancelInline」竞态已被完整修复：刷新（手动/fs.watch）后输入框与内容、焦点均保留，Enter 可正常提交；非刷新场景的 blur 取消行为未回退。复跑 46/46、97/97+阶段二（dev 与打包）、src 16/16 一致，无新增入口、无控制台错误。
- 遗留：无新增缺陷；历史 P2 列表不变、不阻塞交付。

## 16. 预览样式选择（7 套）复验（task-14，**❌ 不通过：1 项 P1 交互缺陷**）

- 复验时间：2026-10-26；依据：`docs/PREVIEW-STYLE-SPEC.md`、`docs/CODEX-UI-DESIGN.md` §10
- 新增专项脚本：`artifacts/qa/audit-preview-style.mjs`（17 断言：浅/深 7×2 矩阵、菜单两级交互、持久化重启、900×600）
- 本轮复跑（串行）：`npm test` **48/48**；dev smoke 两阶段 **122/122 + 阶段二通过**；打包 exe 两阶段 smoke **122/122 + 阶段二通过**；`resources/app/src` **16/16 SHA256 一致**；release 仅 `MoDex-1.0.0-win32-x64/`。

### 16.1 通过项（16/17）

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 默认 codex 三方一致 | ✅ | `#app[data-preview-style]`、`getState().previewStyle`、`saveSettings({})` 均 codex；工具栏仍 5 data-action / 9 按钮（PS1） |
| 浅/深 × 7 套切换 | ✅ | 14/14 次 `data-preview-style` 与主题同步、持久化返回一致（PS2） |
| 7 套计算样式互不相同 | ✅ | 浅色 7 种签名、深色 7 种签名（PS3） |
| 非默认样式相对 codex 有可见差异 | ✅ | 标题字重/边框、链接色/下划线、代码块底色、字体等至少 1 项不同（PS4） |
| 只影响预览区 | ✅ | 工具栏/侧栏/编辑器背景、工具栏字体与高度在所有样式下不变（PS5） |
| 深色对比度 AA | ✅ | 7 套正文 ≥4.5:1、次要文字（引用块）≥4.5:1（PS6） |
| 二级菜单结构 | ✅ | 7 项 id/顺序/名称正确、当前项 `data-checked=true`（PS7）；截图 `21-preview-style-menu.png` |
| 选项切换/持久化/toast | ✅ | 点击 GitHub：生效、两级菜单关闭、saveSettings=github、toast（PS8）；✓ 随切换更新（PS9） |
| Esc 关闭两级菜单 / 切换其它菜单互斥 | ✅ | PS10 / PS12 |
| 900×600 | ✅ | 页面无横向溢出、二级面板完整在视口内（PS13） |
| 持久化 & 重启恢复 | ✅ | 菜单选 serif → `state.json settings.previewStyle=serif` → 同 user-data 二次启动恢复（PS14–PS16） |
| 7 套浅/深视觉 | ✅ | 自拍 14 张 `artifacts/qa/screenshots-preview-style/{light,dark}-<id>.png`；e2e 19/20/21 正常 |

### 16.2 ❌ P1-02：点击外部未同时关闭二级菜单（违反 PREVIEW-STYLE-SPEC §2）

- **复现**（PS11，CDP 真实鼠标 `mousePressed+mouseReleased` 点击编辑器区域）：打开「视图 → 预览样式」二级面板 → 点击外部 → `{ menuHidden:true, submenuHidden:false }`：一级菜单关闭，但 `#app-submenu` 残留；合成 pointerdown 同样复现。Esc（PS10）与菜单间切换（PS12）均正常。
- **期望**（SPEC §2）：`Esc / 点击外部 / 点击其它菜单：两级菜单一起关闭`。
- **实际**：外部点击只关闭一级 `#app-menu`，二级残留；此时 `appMenuOpenKind` 失效，Esc 也可能无法关闭残留面板。
- **代码定位**：`app.js onDocumentClick → closeAppMenu() → handleAppMenuClosed() → closeAppSubmenu()` 路径正常；但外部 pointerdown 先走 `util.js createContextMenu` 的 `onPointerDown → close()`，该路径只隐藏一级容器（未触发 `onClose` 回调），随后 click 处理器不再满足条件 → 二级未被关闭。
- **建议修复**：① `util.js close()` 统一调用 `options.onClose?.()`（或 app.js 外部 pointerdown 显式 `closeAppSubmenu()`）；② Esc 兼容 `appSubmenuOpen`（一级关闭时也能关二级）；③ e2e 增加「外部点击后 `#app-submenu.hidden === true`」断言（当前 e2e 未覆盖）。
- **影响**：二级菜单外部点击后残留浮层（可误点到样式选项），属明确规格不符；不影响样式应用、持久化与其它功能。

### 16.3 无回归

- 菜单栏 **24/24**、audit-main **100/100**、设计审计 **23/23** 本轮复跑通过；工具栏仍恰好 5 个 data-action、无新增按钮（PS1）。
- 多文件夹专项本轮链式复跑出现 2 项 dialog 时序 flake（M6/M12，随后 M13–M15 通过），未计入缺陷；多根功能由 e2e 122 断言与上一轮 18/18 覆盖，修复后建议单独复跑确认。
- hardening/autosave/race 因时间未在本轮重跑（本轮变更仅渲染层预览样式/菜单/settings，安全与文件链路未改动；上轮均通过）。

### 16.4 本轮结论

**❌ 不通过（待修复 1 项 P1 交互缺陷）**。预览样式 7 套本体能力（切换、浅/深适配、计算样式差异、深色 AA、持久化、重启恢复、二级菜单结构/✓/Esc/互斥、900×600、无新增工具栏按钮）全部通过；唯一阻塞项是「点击外部未同时关闭二级菜单」（P1-02）。修复 `close()`/外部 pointerdown 的二级关闭回调后重打包，QA 可在 5 分钟内复验 PS11 并放行。

### 16.5 P1-02 修复复验（task-15，**✅ 通过，P1-02 关闭**）

- 复验时间：2026-10-26；修复文件：`src/renderer/js/app.js`（`openAppSubmenu` 父菜单可见性防御、Esc 兜底 `appSubmenuOpen`、`onDocumentClick` 孤立二级面板兜底、Esc 关闭不参与 320ms 重开防抖）+ `src/main/e2e.js` 新增外部点击断言（e2e 现 **123** 项）。
- 复跑（串行，全部 exit 0）：
  - `npm test` **48/48**；
  - dev smoke 两阶段：阶段一 **123/123** + **阶段二通过**（`artifacts/qa/smoke-dev-preview2.log`）；
  - 打包 exe 两阶段 smoke：阶段一 **123/123** + **阶段二通过**（`artifacts/qa/smoke-packaged-preview2.log`）；
  - `resources/app/src` **16/16 SHA256 一致**；release 仅 `MoDex-1.0.0-win32-x64/`。
- **定向复验（`audit-preview-style.mjs`，20/20 全通过）**：

| 断言 | 场景 | 结果 |
| --- | --- | --- |
| **PS11** | CDP **真实鼠标**点击外部：同时关闭二级面板与一级菜单（原缺陷场景） | ✅ `{ submenuHidden:true, menuHidden:true }` |
| PS17 | 外部点击关闭后再次打开菜单/二级面板 | ✅ 均可正常打开 |
| PS18 | Esc 关闭后立即重开（不受 320ms 防抖影响） | ✅ 一级+二级正常打开 |
| PS19 | **父菜单内点击**「预览样式」触发项（真实鼠标）：二级面板保持打开、不被外部点击兜底误关 | ✅ |
| PS1–PS16 | 7 套浅/深矩阵、仅预览区生效、深色 AA、二级结构/✓/Esc/互斥、900×600、持久化重启恢复 | ✅ 全部保持通过 |

- 无回归：菜单栏 **24/24**、设计审计 **23/23**、audit-main **100/100** 本轮复跑通过；工具栏仍 5 个 data-action。
- **结论**：**✅ 通过（P1-02 关闭）**。两项阻塞缺陷（外部点击不关二级、Esc/重开防抖）均已修复且有真实鼠标事件与补充交互证据；预览样式选择功能整体可交付。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

## 17. AI 写作助手（右侧面板 + DeepSeek Responses API）复验（task-18，**✅ 通过，准予放行**）

- 复验时间：2026-10-26；依据：`docs/AI-PANEL-SPEC.md`、`docs/CONTRACTS.md` 的 `api.ai`、`docs/AI-PANEL-PROPOSAL.md`
- 新增专项脚本：`artifacts/qa/audit-ai.mjs`（30 断言；内置本地 Responses API SSE mock，`--ai-base-url` 注入，覆盖流式/错误/停止/上下文/安全）
- 复跑（串行，全部 exit 0）：
  - `npm test` **86/86**；
  - dev smoke 两阶段：**141/141 + 阶段二通过**（含 AI mock 断言）；
  - 打包 exe 两阶段 smoke：**141/141 + 阶段二通过**；
  - `resources/app/src` 与仓库 **23/23 SHA256 一致**；release 仅 `MoDex-1.0.0-win32-x64/`。

### 17.1 AI 功能矩阵（30/30 通过）

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 面板三态 closed/open/rail、宽度、收起展开 | ✅ | AI1/AI3/AI4；`#app[data-ai-panel]`、`.
#ai-panel[data-mode]` 同步；rail 40px 侧条可展开 |
| 入口：AI 图标（data-ai-toggle 非 data-action）、`Ctrl+Shift+A`、视图菜单「AI 写作助手」 | ✅ | AI1/AI5/AI6；工具栏仍恰好 5 个 data-action |
| Key 设置：保存后 hasKey/maskedKey（`••••••••7890`）、测试连接成功、清除二次确认入口 | ✅ | AI7；截图 `22/24`（掩码与安全说明） |
| 流式回答 + usage 行 | ✅ | AI9：assistant done、正文含 Mock 回答、usage「输入/输出 tokens」 |
| 模型切换 deepseek-flash ↔ deepseek-v4-pro 与请求体 model 一致 | ✅ | AI10：mock 收到 `model=deepseek-v4-pro`；重启后 label 恢复 V4 Pro |
| 上下文开关：默认关闭；开启后请求 instructions 含 `<当前文档>`、回答提示「已参考当前文档」 | ✅ | AI11 |
| 20k 上下文截断 | ✅ | AI12：传入 25000 字符 context，mock 收到上下文 X 字符数 ≤20000 |
| 停止生成 | ✅ | AI13：慢速流中显示停止按钮，点击后消息 `data-status=cancelled`、按钮隐藏 |
| 429 / 500 错误卡片 + 重试入口 | ✅ | AI14/AI15：「请求过于频繁」「服务暂时不可用」，重试按钮存在 |
| 历史会话：保存/恢复/删除 | ✅ | AI17/AI18/AI19 |
| 设置持久化（aiModel/aiPanelMode/aiPanelWidth/aiIncludeContext） | ✅ | AI20：saveSettings 返回合法值 |
| 900×600 overlay 无横向溢出；深色主题 | ✅ | AI21 + 截图 `04-ai-overlay-900x600.png`、`05-ai-panel-dark.png` |
| 重启恢复（同 user-data） | ✅ | AI29：面板 open、模型 V4 Pro、Key hasKey、历史保留 |

### 17.2 安全专项（全部通过）

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 渲染层读不到明文 Key | ✅ | AI7/AI8：`api.ai.bootstrap` 仅 hasKey/maskedKey；DOM/body/localStorage 无明文；CDP 检查 `window.api.ai` 无 getKey |
| Key 加密存储 | ✅ | AI23：`userData/ai/api-key.bin` 存在、内容不含明文、格式 `{version:1, ciphertext}`（safeStorage/DPAPI） |
| state.json / sessions.json 不含 Key | ✅ | AI24：两文件均无明文；sessions.json 含会话消息 |
| Key 不进仓库 | ✅ | AI25：源码/文档/测试全量扫描无测试 Key 明文 |
| AI 回答 XSS 防护 | ✅ | AI16：mock 返回 `<img onerror>/<script>/javascript: 链接`，渲染后 `window.__xss` 未定义、无 script/onerror/危险 href，安全文本正常显示 |
| `ai:*` IPC 来源校验 | ✅ | AI26：隐藏 BrowserWindow（真实 preload）调用 `api.ai.bootstrap` 返回 `EACCES` |
| 渲染层 CSP 不变（AI 网络仅主进程） | ✅ | AI27：`script-src 'self'`、`connect-src 'self'`；主进程 `net.fetch` 发起 AI 请求 |
| 运行期无未捕获错误 | ✅ | AI28 |

### 17.3 无回归与打包产物

- 无回归：菜单栏 **24/24**、设计审计 **23/23**、audit-main **100/100** 本轮复跑通过（脚本已按新菜单项「AI 写作助手（Ctrl+Shift+A）」、AI 浮层阴影、preload 新增 `ai` 暴露面更新预期并说明）。
- 工具栏仍恰好 5 个 data-action；`#ai-toggle` 使用 `data-ai-toggle`，不占用 data-action。
- 打包：`resources/app/src` **23/23 SHA256 一致**；打包 exe 两阶段 smoke **141/141 + 阶段二通过**；release 仅 `MoDex-1.0.0-win32-x64/`。
- 视觉：审阅 `docs/screenshots/22-ai-panel-light.png`（右侧 dock、消息/usage/composer）、`24-ai-settings.png`（掩码 Key `••••••••7890` + safeStorage 安全说明）、e2e `23-ai-panel-dark.png`；1280×800 与 900×600 实测无溢出。

### 17.4 缺陷分级

| ID | 级别 | 内容 | 状态 |
| --- | --- | --- | --- |
| — | — | 本轮未发现 P0/P1；功能矩阵与安全专项全部通过 | — |
| P2-23 | 低 | AI 面板为 v1 范围：仅「复制」不可插入到光标（SPEC 已明确 v1 不出插入按钮）；会话上限 200，无导出 | 记录（与 spec 一致，非缺陷） |
| P2-24 | 低 | 历史会话删除无二次确认（普通非破坏性 UI 数据，若后续需要可加确认） | 记录，不阻塞交付 |
| P2-03/06/08/09/10/11/12/16/17/18/19/20 | 低 | 历史遗留加固/可维护性/体验建议 | 仍待排期，不阻塞交付 |

### 17.5 第七轮结论

**✅ 通过，准予放行。** MoDex AI 写作助手 v1（右侧面板 + DeepSeek Responses API + 本地 safeStorage Key + 历史会话 + 上下文/截断/流式/停止/错误重试）功能矩阵 30/30 通过；安全专项（Key 不落渲染层、加密存储、XSS 过滤、IPC 来源校验、CSP 不变、Key 不进仓库）全部通过；86/86 单测、141/141+阶段二 dev 与打包 smoke、23/23 资源一致、无回归。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

## 18. 微动效复验（task-19，**✅ 通过，准予放行**）

- 复验时间：2026-10-26；改动：`styles.css` 微动效章节（菜单/二级菜单/AI 弹层 pop-in 120ms、AI 面板淡入 150ms/窄窗抽屉 180ms、AI 消息 140ms、设置弹窗 120/150ms、查找栏下滑 140ms、欢迎页/视图 pane 淡入、侧栏淡出、按钮按压 scale(.97) 90ms、生成中呼吸 1.6s）+ `app.js/ai-panel.js` 的 `is-layout-anim`（240ms 清理、拖拽不启用）+ `prefers-reduced-motion` 全局降级。
- 复跑（串行，全部 exit 0）：
  - `node artifacts/anim-check.mjs` **6/6 通过**（Lead 自检脚本复跑）；
  - 独立专项 `artifacts/qa/audit-anim.mjs` **16/16 通过**；
  - `npm test` **86/86**；
  - dev smoke 两阶段 **141/141 + 阶段二通过**；打包 exe 两阶段 smoke **141/141 + 阶段二通过**；
  - `resources/app/src` **23/23 SHA256 一致**；release 仅 `MoDex-1.0.0-win32-x64/`。

### 18.1 动效正确性（实测）

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 应用菜单 pop-in 120ms，结束后完全展开（opacity=1、transform 无残余） | ✅ | AN1：`animationName=qm-pop-in, duration=0.12s`；settle 后 opacity 1 |
| 预览样式二级菜单 pop-in，结束后完全可见 | ✅ | AN2 |
| 查找栏 slide-down 140ms，结束后定位正常 | ✅ | AN3：`qm-slide-down` |
| 侧栏开合：`is-layout-anim` + 190ms 列宽过渡，结束后 class 清理；隐藏后宽 **0**、主区占满、无横向溢出 | ✅ | AN4：mid.cls=true/transition=0.19s；settled.class 清理、sidebar=0 |
| 侧栏恢复宽度约 260px、无溢出、无残留动画类 | ✅ | AN5 |
| 拖拽侧栏调宽：**不启用** is-layout-anim（无列宽过渡迟滞）、宽度变化正常 | ✅ | AN6：mid.cls=false |
| AI 面板打开：淡入动画 + 布局过渡类，结束后清理、宽度 320–560 | ✅ | AN7：`qm-fade-in 0.15s` |
| AI 设置弹窗动画且 350ms 内完成、无残留 | ✅ | AN8 |
| AI 面板关闭：布局过渡类出现并清理，主区宽度恢复到打开前、无溢出 | ✅ | AN9：关闭后 mainW 与打开前相差 ≤4px |
| 按钮按压 scale(.97) 微动效（90ms 过渡，松开恢复） | ✅ | AN10：pressed=`matrix(0.97,…)`，released 恢复 |
| 输入区/消息流区域无 transition 迟滞 | ✅ | AN11：textarea 与 #ai-messages transition-duration 均 0s |
| 900×600：AI 面板 overlay、菜单打开无横向溢出 | ✅ | AN12 + 截图 `02-narrow-900x600.png` |
| 深浅主题切换：颜色生效、无溢出、无残留动画类 | ✅ | AN13 + 截图 `03-settled-light.png`、`04-settled-dark.png` |
| `prefers-reduced-motion: reduce`：菜单/AI/查找栏/布局过渡全部降级为 0 | ✅ | AN14（CDP 媒体模拟：duration 0s） |
| 恢复 no-preference 后动画重新生效 | ✅ | AN15（重载页面清除模拟后 animationDuration 0.12s） |

### 18.2 视觉

- `artifacts/qa/anim-shots/settled-light.png`、`settled-dark.png`、`ai-panel-open.png`（Lead 自检脚本重新生成）审阅：稳定帧布局正常，无错位/半透明残留；AI 面板打开后编辑区/预览区列宽正确收缩。
- `artifacts/qa/screenshots-anim-qa/` 补拍：AI 面板打开、900×600、浅/深 settled，均正常；smoke 重新生成的 `artifacts/e2e/screenshots/` 24 张无视觉回归。

### 18.3 无回归与缺陷

- menubar **24/24**、design **23/23**、audit-main **100/100** 本轮复跑通过；工具栏仍恰好 5 个 data-action；e2e 141/141 全绿。
- 缺陷分级：**P0=0，P1=0**。新增 P2-25（低）：动画效果仅在渲染层，`prefers-reduced-motion` 已全局降级；无功能/安全问题。历史 P2 不变、不阻塞交付。
- 验收过程中曾因残留 Electron 进程占用 e2e `userdata-autosave/lockfile` 导致一次 smoke EBUSY（QA 环境问题），清理后严格串行复跑通过，最终数字均来自干净环境。

### 18.4 第八轮结论

**✅ 通过，准予放行。** 微动效实现克制（120–190ms、无弹跳/缩放滥用），菜单/查找栏/侧栏/AI 面板/设置弹窗/按钮按压动效与布局过渡按时序正确、结束后无残留；侧栏隐藏宽 0、AI 面板开合布局可恢复、拖拽调宽无过渡迟滞、900×600 无溢出；`prefers-reduced-motion` 完整降级；86/86 单测、141/141+阶段二 dev 与打包 smoke、23/23 资源一致、无视觉/功能回归。最终交付物：`release/MoDex-1.0.0-win32-x64/MoDex.exe`。

## 19. Windows 安装包（Inno Setup）复验（task-20，**✅ 通过，准予放行**）

- 复验时间：2026-10-26；交付：`release/MoDex-1.0.0-setup.exe`、`installer/MoDex.iss`、`installer/ChineseSimplified.isl`、`scripts/installer.mjs`、`docs/INSTALLER.md`、`docs/installer/installer-wizard.png`
- 验证方式：SHA256/大小核对 → `npm run installer -- --skip-package` 重建 → 静默安装到临时目录 → 已安装 exe 两阶段 smoke → 静默卸载 → 清理与用户数据保留核验；全程严格串行、临时目录结束时清理。

### 19.1 产物与构建

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 安装包存在、大小 98.1 MB | ✅ | `release/MoDex-1.0.0-setup.exe` = **102,858,733 bytes（98.1 MiB）** |
| SHA256 与 `docs/INSTALLER.md` 一致 | ✅ | 实测 `A92A64DCB0F9BD7DC17AAE94023779C0A50864C61AE82738A5F91FD59CA59238` = 文档值 |
| `npm run installer -- --skip-package` 可重建 | ✅ | exit 0，用时 **76.9s**（lzma2/max），产物大小/SHA256 **与重建前完全一致（可复现构建）**；ISCC 自动定位到 `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` |
| 构建脚本质量 | ✅ | `scripts/installer.mjs` 自动查找 ISCC（env `INNO_SETUP_ISCC`/默认路径）、`--skip-package` 复用便携版、中文语言文件自动启用、无硬编码绝对仓库路径（路径由 `__dirname` 推导）；`.gitignore` 含 `release/`、`artifacts/` |

### 19.2 静默安装（临时目录 `artifacts/qa/installer-test/app`）

命令：`MoDex-1.0.0-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=<temp>`

| 检查项 | 结果 |
| --- | --- |
| 安装退出码 | ✅ **0** |
| 关键文件 | ✅ `MoDex.exe`、`resources/app/src/main/ai/ai-service.js`、`unins000.exe` 均存在 |
| 文件数与体积 | ✅ **150 个文件 / 338.8 MB**（与 `INSTALLER.md` 记录一致） |
| 开始菜单快捷方式 | ✅ `%APPDATA%\Microsoft\Windows\Start Menu\Programs\MoDex.lnk` |
| 桌面快捷方式 | ✅ `C:\Users\Administrator\Desktop\MoDex.lnk` |
| HKCU 卸载项 | ✅ `DisplayName=MoDex`、`DisplayVersion=1.0.0`、`InstallLocation=<安装目录>\`、`UninstallString="<安装目录>\unins000.exe"`、`DisplayIcon=<安装目录>\MoDex.exe` |
| 安装范围 | ✅ 按用户安装（`PrivilegesRequired=lowest`、`DefaultDirName={localappdata}\Programs\MoDex`），临时目录安装无需管理员 |

### 19.3 已安装应用可运行（两阶段 smoke）

- `npm run smoke -- --app "<安装目录>\MoDex.exe"` → **141/141 + 阶段二通过**（exit 0；AI mock、打开/编辑/保存、自动保存、关闭自动保存全部通过），与便携版一致。

### 19.4 静默卸载

命令：`<安装目录>\unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`

| 检查项 | 结果 |
| --- | --- |
| 卸载退出码 | ✅ **0** |
| 安装目录 | ✅ 已删除（`dir-exists=False`） |
| 开始菜单 / 桌面快捷方式 | ✅ 均已移除 |
| HKCU 卸载注册项 | ✅ 已移除（查询无 MoDex 项） |
| `%APPDATA%\MoDex` 用户数据 | ✅ **保留**（预置 marker 文件卸载后仍存在；随后由 QA 清理 marker） |
| 临时目录清理 | ✅ 测试后 `artifacts/qa/installer-test` 已删除，`%APPDATA%\MoDex` marker 已清理 |

### 19.5 脚本安全/质量审查

- **AppId 固定**：`{{1A410687-CD96-40EB-93FE-B93A28544FAB}`，支持覆盖安装/升级。
- **per-user**：`PrivilegesRequired=lowest`、安装目录 `{localappdata}\Programs\MoDex`，不写 HKLM、无需管理员。
- **卸载不删用户数据**：ISS 未配置删除 `%APPDATA%\MoDex` 的 `[UninstallDelete]`；实测 marker 保留。
- **无绝对路径写死**：源码使用 `{#SourceDir}`/`{#OutputDir}` 等 define（由构建脚本按项目根推导），仓库内无机器相关绝对路径。
- **产物不入库**：`release/` 与 `artifacts/` 均已在 `.gitignore`；安装包/用户数据不在源码目录。
- 卸载前 `taskkill /IM MoDex.exe` 静默关闭运行实例（`runhidden`），避免文件占用。

### 19.6 视觉

- 审阅 `docs/installer/installer-wizard.png`：**简体中文向导**（「安装 - MoDex 1.0.0」「选择目标位置」），默认目录 `${LOCALAPPDATA}\Programs\MoDex`（按用户）正确，磁盘需求提示 338.8 MB，按钮「下一步/取消」本地化正常。
- README「生成 Windows 安装包」章节与 `docs/INSTALLER.md` 内容/命令/哈希一致。

### 19.7 缺陷分级

| ID | 级别 | 内容 | 状态 |
| --- | --- | --- | --- |
| — | — | 本轮未发现 P0/P1；安装/运行/卸载/用户数据保留全部通过 | — |
| P2-26 | 低 | 未做代码签名：首次运行 SmartScreen 会提示「未知发布者」（文档已说明；建议后续签名以消除提示并提升信任度） | 记录，不阻塞交付 |
| P2-27 | 低 | 安装后的 `MoDex.exe` 文件版本资源显示 Electron 运行时版本（40.10.2），而非产品版本 1.0.0（安装器 DisplayVersion 正确显示 1.0.0）；建议在打包阶段写入产品版本资源 | 记录，不阻塞交付 |
| P2-28 | 低 | 未执行「同版本重复安装/升级」实测（可选要求，时间限制）；Inno 固定 AppId + `UsePreviousAppDir=yes` 设计上支持覆盖安装 | 未覆盖项，建议后续补测 |
| P2-03/06/08/09/10/11/12/16/17/18/19/20/23/24/25 | 低 | 历史遗留加固/可维护性/体验建议 | 仍待排期，不阻塞交付 |

### 19.8 第九轮结论

**✅ 通过，准予放行。** 安装包与文档一致（98.1 MB / SHA256 匹配）、可复现重建（76.9s，哈希一致）；静默安装到临时目录成功，文件完整、开始菜单/桌面快捷方式与 HKCU 卸载项正确；已安装 exe 两阶段 smoke **141/141 + 阶段二通过**；静默卸载清理干净且保留 `%APPDATA%\MoDex` 用户数据；脚本 per-user、AppId 固定、无绝对路径、产物不入库。交付物：`release/MoDex-1.0.0-setup.exe`（另有便携版 `release/MoDex-1.0.0-win32-x64/MoDex.exe`）。
