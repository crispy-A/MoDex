# MoDex · Codex 风格 UI 重设计规范

> 目标：在不新增任何功能、不改业务逻辑的前提下，把渲染层视觉与交互质感重做为 **OpenAI Codex 桌面应用**那一类气质：
> 克制的单色体系、精密的排版、发丝线分隔、低装饰、键盘优先。
> 本文件是本次重设计的唯一验收依据；与旧 `docs/RENDERER-SPEC.md` 冲突时以本文件为准（DOM/接口契约仍以 `docs/CONTRACTS.md` 与 e2e 选择器为准）。

## 0. 范围与硬约束

必须保持不变（e2e 与契约依赖）：

- 所有 `id`、`data-action`、`data-view`、`data-theme`、`data-sidebar`、`data-has-doc`、`data-has-root`、`data-path`、`data-type`、`data-expanded`、`data-menu-action`、`data-recent-path`。
- `window.api` 调用、`window.__qm` 钩子、所有既有功能与信息（欢迎页三按钮 + 最近列表 + 提示行、状态栏五项、树操作、查找栏、右键菜单）。
- 不新增按钮/菜单项/功能入口，不删除任何既有入口；不引入网络字体或位图资源。
- 不复制 Codex/OpenAI 的商标、字标或图标资产；只借鉴**视觉语言**（单色、密度、排版、层级方式）。

允许修改：`src/renderer/index.html`、`styles.css`、`src/renderer/js/**` 中的样式相关类名、内联 SVG、品牌字符串、`document.title`。

## 1. 从 Codex 抽象出的六条视觉规则

1. **单色优先**：黑白灰承担全部层级；只保留一个低饱和强调色用于焦点/选中/链接，不出现彩色图标、渐变、发光。
2. **层级靠明度差 + 1px 发丝线**，不靠阴影；阴影只给浮层（右键菜单、查找栏、toast）。
3. **精密排版**：UI 基准 12.5–13px；微标签 10.5px 大写 + 0.08em 字距；路径/状态用等宽字体；行高紧凑（树行 24px）。
4. **紧凑但不拥挤**：4 的倍数节奏（4/8/12/16/24/32）；面板内边距 12–20px；同一元素内不混用三种间距。
5. **暖白/近黑的中性色**：浅色是"纸感"暖白，深色是近黑中性（不是蓝黑），整体低饱和。
6. **微交互克制**：hover 只做 2–4% 明度浮起；激活项用左缘 2px 竖线或底部下划线；过渡 100–140ms ease-out；无弹跳、无缩放。

## 2. 设计令牌（精确值，必须落地为 CSS 变量）

```css
/* 浅色（纸感暖白，Codex light 气质） */
--bg:            #fafaf8;   /* 应用底色 */
--panel:         #ffffff;   /* 编辑/预览主表面 */
--panel-soft:    #f6f6f2;   /* 侧栏表面 */
--elevated:      #ffffff;   /* 浮层：菜单/查找栏/toast */
--text:          #1b1b19;
--muted:         #6f6f69;
--faint:         #9b9b94;
--border:        #e7e6e0;   /* 发丝线 */
--border-strong: #d8d7d0;
--hover:         #f0f0eb;
--active:        #e9e9e3;
--selection:     rgba(66, 84, 108, 0.16);
--accent:        #4a6b8a;   /* 低饱和石板蓝，仅焦点/选中/链接 */
--accent-soft:   rgba(74, 107, 138, 0.10);
--danger:        #b23c33;
--danger-soft:   rgba(178, 60, 51, 0.08);
--success:       #3f7a4f;
--code-bg:       #f5f5f1;
--scrollbar:     rgba(110, 110, 104, 0.30);
--shadow-menu:   0 8px 28px rgba(20, 20, 18, 0.12), 0 1px 3px rgba(20, 20, 18, 0.06);
--shadow-float:  0 2px 10px rgba(20, 20, 18, 0.08);

/* 深色（近黑中性，Codex dark 气质） */
--bg:            #0e0e0f;
--panel:         #141415;
--panel-soft:    #111112;
--elevated:      #1a1a1c;
--text:          #ececea;
--muted:         #8e8e88;
--faint:         #66665f;
--border:        #252527;
--border-strong: #343437;
--hover:         rgba(255, 255, 255, 0.045);
--active:        rgba(255, 255, 255, 0.075);
--selection:     rgba(150, 178, 208, 0.26);
--accent:        #8fb0cf;
--accent-soft:   rgba(143, 176, 207, 0.12);
--danger:        #d97b72;
--danger-soft:   rgba(217, 123, 114, 0.12);
--success:       #7fb288;
--code-bg:       #171718;
--scrollbar:     rgba(150, 150, 142, 0.26);
--shadow-menu:   0 10px 32px rgba(0, 0, 0, 0.55), 0 1px 3px rgba(0, 0, 0, 0.4);
--shadow-float:  0 2px 12px rgba(0, 0, 0, 0.45);
```

字体与节奏：

```css
--ui-font: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC",
           system-ui, -apple-system, sans-serif;
--mono-font: "Cascadia Code", "SF Mono", "JetBrains Mono", Consolas, monospace;
--dur: 120ms;
--ease: cubic-bezier(0.2, 0, 0, 1);
```

- UI 基础字号 12.5px（工具栏/树/按钮），正文信息 13px，微标签 10.5px。
- 圆角：小元素 5px、面板/菜单 8px、主按钮 7px。
- 焦点环：`outline: 1.5px solid var(--accent); outline-offset: 2px`，仅 `:focus-visible`。

## 3. 布局尺寸

| 区域 | 尺寸 |
| --- | --- |
| 窗口默认尺寸 | **1280×800**（16:10，贴近 Codex 桌面窗口比例；用户调整后记忆恢复），最小 900×600 |
| 工具栏 `#toolbar` | 高 **40px**，底部 1px `--border`，底色 `--bg`（与内容同色，靠发丝线分区） |
| 侧栏 `#sidebar` | 宽默认 260px（沿用设置），底色 `--panel-soft`，右侧 1px `--border` |
| 侧栏头部 | 高 30px，10.5px 大写标签，右侧 3 个 22px 图标按钮 |
| 树行 | 高 **24px**，缩进每层 12px，行左右留 6px 空白，圆角 4px |
| 文档头 `#doc-head` | 高 **32px**，底部 1px `--border`，文件名 12.5px，目录 11px 等宽 |
| 编辑区 | 底色 `--panel`，padding `18px 22px 48px`，行高 1.7 |
| 预览区 | 底色 `--panel`，正文最大宽 **680px** 居中，padding `28px 32px 64px`；分栏下 padding `24px 28px 56px` |
| 状态栏 `#statusbar` | 高 **24px**，顶部 1px `--border`，11px，等宽路径 |
| 查找栏 `#findbar` | 浮层：`position: fixed; top: 52px; right: 20px;` 高 32px，宽约 340px |
| 分隔拖拽条 | 网格列宽 6px，视觉只画中间 **1px** 发丝线；hover 变 `--accent` |

## 4. 组件规格

### 4.1 工具栏
- 左侧品牌：14px 内联 SVG 单字标记 + 文本 **MoDex**（13px / 600 / letter-spacing -0.01em）→ 品牌与按钮之间 16px 间距。
- 按钮：ghost 文本按钮，高 26px、padding 0 8px、圆角 5px、12.5px、`--muted`；hover 底部 `--hover` 且文字 `--text`；图标 14px。
- 主操作（保存）不填充色，与其它按钮一致；不在工具栏引入新按钮。
- 视图切换：三个文本 tab，12.5px、`--muted`，激活项 `--text` + 底部 **1.5px** 实线（`inset 0 -1.5px 0 var(--text)`），不使用胶囊底色。
- 右侧主题切换：14px 图标按钮，ghost。
- 工具栏按钮一律无边框、无阴影。

### 4.2 侧栏 / 文件树
- 头部标题「资源管理器」→ 10.5px、大写风格、`--faint`、letter-spacing 0.08em；操作图标 22px，默认 `--faint`，侧栏 hover 时提升到 `--muted`。
- 行：目录/文件使用 14px 单色图标；文件行文字 12.5px `--text`；目录行 12.5px `--text`。
- 激活行：`background: var(--active)` + `box-shadow: inset 2px 0 0 var(--accent)`，文字 `--text`。
- hover 行：`background: var(--hover)`，无位移/无缩放。
- MD 角标：不要实心色块；改为 9px 大写、`--faint`、1px `--border-strong` 描边、圆角 3px、padding 0 3px 的微型标签，右对齐。
- 树的展开箭头：14px chevron，默认 `--faint`，展开时旋转 90°（100ms）。
- 侧栏底部路径：10.5px 等宽、`--faint`、单行省略、顶部 1px `--border`。

### 4.3 文档头
- 文件名 12.5px / 550；目录 11px 等宽 `--faint`，单行省略；未保存点 `#doc-dirty` 改为 5px 圆点、`--accent`、带 6px 间距（不用文字圆点字符）。
- 无底线投影，仅 1px `--border` 底边。

### 4.4 编辑器
- 等宽字体，字号取设置（默认 15px），行高 1.7，`caret-color: var(--accent)`。
- 无边框、无行号、无背景纹理；编辑区与预览区之间是 1px `--border`（不是 6px 灰块）。
- 选中色 `--selection`。

### 4.5 预览排版（.markdown-body）
- 正文 13.5px / 1.75，`--text`；段落下边距 0.9em；最大宽 680px 居中。
- h1 24px/600 letter-spacing -0.02em，margin 0 0 18px；h2 18px/600，margin 30px 0 12px；h3 15px/600；h4–h6 13.5px/600、`--muted`。
- 标题不使用彩色、不使用渐变装饰；h2 可加 1px `--border` 顶边（Codex 文档风），h1 不加。
- 链接：`--text` + 1px 下划线（`text-decoration-color: var(--border-strong)`），hover 时下划线变 `--accent`、无颜色跳变。
- 行内代码：等宽 12px、`--code-bg`、1px `--border`、圆角 4px、padding 1px 4px。
- 代码块：`--code-bg`、1px `--border`、圆角 8px、padding 14px 16px；语言标签 10px 等宽大写 `--faint`，绝对定位右上 10px；不做语法高亮。
- 引用：左侧 2px `--border-strong`，文字 `--muted`，无背景色。
- 表格：只有发丝线（无斑马纹、无外框强调）；表头 10.5px 大写 `--faint`，单元格 padding 8px 12px，行底 1px `--border`。
- 任务列表复选框：accent-color `--accent`，13px；已完成项文字 `--muted`。
- hr：1px `--border`，上下 24px；图片：圆角 6px、1px `--border`、最大宽 100%。
- 列表标记 `--faint`；有序列表数字等宽。

### 4.6 状态栏
- 左：当前文件路径（11px 等宽 `--faint`，单行省略，title 全路径）；右：`行 x, y`、`x 字`、`已保存/未保存`、视图名。
- 项之间 14px 间距，可用 1px × 10px 的发丝竖线分隔（`--border`）；`未保存` 用 `--text` 强调，其余 `--faint`/`--muted`。
- 无底色差异，仅顶部 1px `--border`。

### 4.7 查找栏（浮层）
- 浮在编辑区右上（top 52px / right 20px），高 32px，圆角 8px，`--elevated` + 1px `--border-strong` + `--shadow-float`。
- 输入框无边框透明 12.5px；计数 11px 等宽 `--faint`；上一个/下一个/关闭为 22px 图标按钮（用现有图标 arrowUp/arrowDown/close，不新增按钮）。
- 打开时不做居中遮罩，不抢焦点之外的视觉。

### 4.8 欢迎页
- 居中内容宽 560px，垂直位置约窗口 12% 处；无渐变、无发光、无大色块。
- 品牌：32px 品牌标记 +「MoDex」26px/600 letter-spacing -0.02em；副标题 13px `--muted`（「轻量 · 专注的 Markdown 写作与预览」）。
- 三个按钮：主按钮实底（浅色：`--text` 底 + `--bg` 字；深色：`--text` 底 + `--bg` 字），高 32px、圆角 7px；次按钮 1px `--border-strong` 描边 + `--panel` 底，hover `--hover`。
- 最近列表：两列（文件/文件夹），列标题 10.5px 大写 `--faint`；行高 30px，文件名 12.5px、右侧目录 11px 等宽 `--faint`，hover `--hover` 圆角 5px；清空按钮为 11px 文字按钮 `--faint`。
- 底部提示行：11px 等宽 `--faint`，项间用「·」分隔。

### 4.9 Toast
- 右下角（bottom 16px / right 16px），`--elevated`、1px `--border-strong`、圆角 8px、`--shadow-menu`，最大宽 360px，12.5px。
- 左侧 2px 色条：成功 `--success`、错误 `--danger`、信息 `--accent`；无大图标。

### 4.10 右键菜单
- `--elevated`、1px `--border-strong`、圆角 8px、`--shadow-menu`，padding 4px，min-width 200px。
- 项高 28px、12.5px、图标 14px `--muted`；hover `--hover`；危险项 `--danger`（hover `--danger-soft`）；分隔线 1px `--border` + 上下 4px 间距。

### 4.11 其他
- 滚动条：10px，thumb `--scrollbar` 圆角 5px，track 透明，hover 加深；不占布局抖动。
- 拖拽条 hover/active：中间线变 `--accent`；`body.is-resizing` 时 `cursor: col-resize`。
- 所有过渡 `var(--dur) var(--ease)`；禁用 `transition: all`。
- 选中文字：`--selection`。

## 5. 品牌与文案（MoDex）

- 产品名统一为 **MoDex**（大小写固定）；不再出现「轻墨 / QingMo / 墨」。
- 品牌标记：新增一个 14px 内联 SVG「M」标记（见下），替换原「墨」文字标记；欢迎页用同款 32px。
- 窗口标题：无文档 `MoDex`；有文档 `● 文件名 — MoDex`（脏标记沿用）。
- 欢迎页标题「MoDex」，副标题保留「轻量 · 专注的 Markdown 写作与预览」。
- 启动失败文案、console 前缀 `[轻墨]` → `[MoDex]`（仅字符串，不改逻辑）。
- 品牌标记 SVG（描边版，`currentColor`，可随主题）：

```html
<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.5 12.5V4l5.5 5 5.5-5v8.5"/>
</svg>
```

- 应用菜单/关于对话框里的名字由 Lead 在 `src/main/**` 同步改为 MoDex，渲染层不用处理。

## 6. 验收清单

1. `node --check`（ESM）通过；`npm run smoke` **67/67** 通过；控制台无 error。
2. 截图人工复核（浅色分栏 / 深色分栏 / 预览模式 / 编辑模式 / 欢迎页 / 右键菜单 / 查找栏 / 最小窗口 900×600）：
   整体呈单色、发丝线、紧凑精密质感，无渐变/彩色图标/大阴影；两种主题都清晰可读。
3. 所有既有交互不变：树展开/行内新建/右键菜单、查找、视图切换、主题、快捷键、滚动同步、未保存提示。
4. 最小窗口 900×600 无横向溢出；`#app` 的 `data-*` 状态同步。
5. 不新增任何按钮或功能入口；不改动 `docs/CONTRACTS.md` 的接口。

## 7. 落地与验收结果（本轮实现）

- 实现文件：`src/renderer/styles.css`（整体重写，令牌 1:1 落地）、`index.html`（品牌 M 标记、欢迎页、`#doc-dirty` 圆点、查找栏既有按钮图标化）、`js/icons.js`（新增 `brand` M 标记）、`js/{app,tree,editor,markdown,preview,util}.js`（仅品牌字符串；`tree.js` 用 `--depth` 变量落地 12px/层缩进）。
- 取样核验（截图 `docs/screenshots/`）：浅色 `--bg #fafaf8 / --panel #ffffff / --sidebar #f6f6f2 / active #e9e9e3`，深色 `--bg #0e0e0f / --panel #141415 / 边框 #252527`，与第 2 节令牌一致；分隔均为 1px 发丝线；无渐变、无彩色图标，阴影仅浮层。
- 截图索引：`01-welcome`（欢迎页）、`03-split-light`（分栏浅色）、`04-preview-light`（预览）、`05-edit-light`（编辑）、`06-split-dark`（分栏深色）、`08-context-menu`（右键菜单）、`11-min-window`（900×600）、`12-findbar`（查找浮层）、`13-dirty`（未保存点与状态栏）。
- 有意取舍：侧栏 `border-right` 与分隔条 1px 线会形成双线，实际只由分隔条中间发丝线承担分隔；MD 角标为 9px 描边微标签；查找栏使用既有三个按钮图标化，未新增控件。
- 验收：`npm test` 43/43、`npm run smoke` 67/67（含新增查找栏/未保存态截图断言）、打包 exe smoke 67/67；独立 QA 复验见 `docs/QA-REPORT.md` §12（更名 + 设计还原审计 23/23、无回归 99/99 + 17/17）。
- 规范澄清：第 1 节「阴影只给浮层」指 `box-shadow` elevation；树激活行/视图 tab 的 `inset` 发丝线属于描边式状态标记，不受此限。

## 8. 本轮扩展：多文件夹根行 + 工具栏精简

> 交互与 DOM 细节以 `docs/MULTI-FOLDER-SPEC.md` 为准，这里只约束视觉，保持 Codex 项目列表气质。

- **侧栏标题**：`文件夹`（10.5px 大写风格、`--faint`、0.08em 字距）；右侧只有 `＋ 添加文件夹` 与 `↻ 刷新` 两个 22px ghost 图标按钮。
- **文件夹根行**（对齐 Codex 项目行）：高 **28px**、左右 6px 外边距、圆角 6px、13px/500 文字、15px 单色文件夹图标；
  hover `--hover`；激活根 `background: var(--active)` + `inset 2px 0 0 var(--accent)`；hover/激活时右侧淡入
  `＋`（在此新建文件）与 `···`（更多菜单）两个 20px ghost 图标按钮，默认 `opacity: 0`，过渡 `var(--dur)`。
- 根行之间 2px 间距；根行展开的子树沿用 24px 文件树行，不再额外着色。
- **侧栏底部**：`共 N 个文件夹`（10.5px 等宽 `--faint`，title 为当前激活根完整路径）。
- **工具栏精简**：删除新建/打开文件/添加文件夹/保存/另存为 5 个按钮；只保留品牌、侧栏开关（左）
  与视图 tabs + 主题切换（右）。左右两组之间用弹性空隙，不引入新的分隔线或按钮。
- 功能入口不减少：菜单、快捷键（Ctrl+N/O/S/Shift+S）、欢迎页三按钮、文件夹/文件右键菜单继续提供全部能力。
- 验收新增截图：多文件夹展开（浅色）、根行右键菜单、精简工具栏、空侧栏。
- 本轮验收结果：`npm test` 46/46、`npm run smoke` 83/83、打包 exe smoke 83/83；独立 QA 专项审计 18/18、无回归 100/100 + 23/23 + 17/17，P0=0、P1=0（详见 `docs/QA-REPORT.md` §13）。

## 9. 本轮扩展：单条导航栏（原生菜单合并进工具栏）

> 交互、菜单项清单与接口见 `docs/APP-MENUBAR-SPEC.md`；这里只约束视觉。

- Windows 原生菜单栏隐藏（应用菜单对象保留以维持原生快捷键/role），顶部只保留一条 40px 导航栏。
- 左组顺序：品牌（M + MoDex）→ 侧栏开关 → 应用菜单（文件 / 编辑 / 视图 / 帮助）。
- 菜单按钮：12.5px、`--muted`、高 26px、padding 0 7px、圆角 5px；hover `--hover` + `--text`；
  下拉打开时 `background: var(--active)` + `--text`。四个按钮之间 1px 间距，与品牌间隔 12px。
- 下拉 `#app-menu`：与右键菜单完全同一视觉语言（`--elevated`、1px `--border-strong`、8px 圆角、
  `--shadow-menu`、4px padding、28px 项、图标 14px）；项右侧快捷键提示 10.5px 等宽 `--faint`、margin-left 24px。
- 900×600 下菜单栏不换行、不溢出；视图 tabs 与主题切换仍在最右。
- 本轮验收结果：`npm test` 46/46、`npm run smoke` 92/92、打包 exe smoke 92/92；独立 QA 专项审计 24/24（含真实按键 Ctrl+S/Z/C/V/A、F12 回归）、无回归 100/100 + 23/23 + 17/17 + 18/18，P0=0、P1=0（详见 `docs/QA-REPORT.md` §14）。

## 10. 本轮扩展：预览样式选择（7 套内置）

> 完整交互、样式 id、深浅色要求见 `docs/PREVIEW-STYLE-SPEC.md`；这里约束菜单与视觉。

- 入口只在应用菜单：**视图 → 预览样式 ▸**（二级面板），不新增工具栏按钮。
- 二级面板 `#app-submenu` 与一级菜单同一视觉语言（`--elevated`、1px `--border-strong`、8px 圆角、`--shadow-menu`，
  28px 项、12.5px）；选项左侧 14px 勾选标记（选中 `--accent`），右侧可选样式英文 id 10.5px 等宽 `--faint`。
- 7 个选项：当前 · Codex 极简（默认）/ GitHub 文档风 / Vue 文档风 / Notion 极简风 / 飞书云文档风 /
  Tailwind Typography / 报刊衬线风。当前项有 ✓，切换后 toast「已切换预览样式：xxx」。
- 样式只作用于预览区（`.markdown-body` + `#preview-pane` 背景），通过 `#app[data-preview-style]` 切换；
  7 套×浅/深两条分支，默认 codex 不产生覆盖（与旧版视觉一致）。
- 900×600 下二级面板不溢出窗口（必要时向上翻转）；Esc / 点击外部 / 切换其它菜单时两级一起关闭。
- 本轮验收结果：`npm test` 48/48、`npm run smoke` 123/123、打包 exe smoke 123/123；独立 QA 预览样式专项 20/20（含真实鼠标外部点击 PS11、Esc 后立即重开、父菜单内点击不误关）、无回归 24/24 + 100/100 + 23/23，P0=0、P1=0（详见 `docs/QA-REPORT.md` §16/§16.5）。

## 11. 本轮扩展：AI 写作助手（右侧 dock）

> 完整契约见 `docs/AI-PANEL-SPEC.md`；设计稿见 `docs/mockups/ai-panel-*.png`。

- 布局：窗口 ≥1180px 时全高右栏（默认 360px，320–560 可拖拽，6px 拖拽条 + 1px 发丝线）；
  <1180px 覆盖预览区（`#app[data-ai-overlay="true"]`）；收起为 40px rail（图标 + 新对话 + 历史 + 展开）。
- Header 40px 与工具栏同高：AI 图标 + 「AI 写作助手」+ 模型 pill（`DeepSeek Flash ▾` / 模型菜单）+
  新对话 / 历史 / 设置 / 收起；图标 22px、`--faint`，hover 提升。
- 消息区：用户消息右对齐浅气泡；AI 消息左对齐、无气泡，正文用独立 `.ai-markdown`（13px/1.7，
  不受「预览样式」影响），代码块等宽 12px + 复制；底部 11px 灰字 usage；思考过程折叠为「已深度思考 12s ›」。
- 上下文栏：`当前文档 · 示例.md` chip + `约 247 字`；开关选中时 `--accent`，未打开文档时禁用。
- 输入区：textarea 自动增高、Enter 发送 / Shift+Enter 换行；生成中发送变「停止生成」；错误卡片左缘 danger + 重试。
- 设置弹窗：440px 居中卡片、遮罩、API Key 密码框（placeholder 为 maskedKey）、默认模型下拉、测试连接状态、
  safeStorage 安全说明；保存并验证成功 toast「AI 已就绪」。
- 默认关闭时应用与旧版视觉完全一致（工具栏仅多一个 22px AI 图标，不计入 data-action）。
- 验收：`npm test` 86/86、`npm run smoke` 141/141、打包 exe smoke、QA §17（独立复验；见 QA 报告）。

## 12. 微动效（交互流畅性）

> 目标：让显隐、切换、消息出现更顺滑；**全部 ≤200ms、纯 CSS、无第三方库**，并尊重 `prefers-reduced-motion`。

| 场景 | 动效 | 时长/曲线 |
| --- | --- | --- |
| 应用菜单 / 二级菜单 / 右键菜单 / AI 模型与历史弹层 | 透明度 + 上移 3px + 轻微缩放（`qm-pop-in`） | 120ms ease-out |
| AI 面板展开（dock） | 淡入（`qm-fade-in`） | 150ms |
| AI 面板覆盖式抽屉（<1180） | 从右滑入 22px + 淡入（`qm-panel-slide`） | 180ms |
| AI 消息出现 | 上移 4px + 淡入（`qm-msg-in`） | 140ms |
| AI 设置弹窗 | 背景淡入 + 卡片上移 6px/0.985 缩放（`qm-modal-in`） | 120/150ms |
| 查找栏 | 下滑 6px + 淡入（`qm-slide-down`） | 140ms |
| 欢迎页 / 编辑器与预览 pane（视图切换时） | 淡入 | 160/130ms |
| 侧栏显隐、AI 面板开合 | 网格列宽过渡（仅切换瞬间加 `is-layout-anim`，拖拽调宽不启用） | 190ms |
| 侧栏隐藏 | 宽度收起 + 150ms 淡出（不再瞬间 display:none） | 150ms |
| 工具栏/面板/菜单/弹窗按钮 | 按压 `scale(0.97)` | 90ms |
| AI 生成中提示行 | 轻微呼吸（opacity 0.72↔1） | 1.6s 循环 |

- `prefers-reduced-motion: reduce` 时所有 transition/animation 降为 0.01ms（已有全局规则），不做动效。
- 不改布局结构、不引入 JS 动画库；避免对高频操作（拖拽调宽、滚动、输入）加过渡。
- 验收：`node artifacts/anim-check.mjs` 6/6、QA 微动效专项 16/16（动画名/时长、布局过渡类清理、拖拽无迟滞、
  reduced-motion 降级、900×600 无溢出），e2e 141/141 + 阶段二、打包 exe 同，P0=0、P1=0（详见 `docs/QA-REPORT.md` §18）。
