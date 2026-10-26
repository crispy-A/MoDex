# MoDex · 预览样式选择（7 套内置样式）规格

> 用户需求：把调研出的 7 套 Markdown 预览样式都内置，**由用户选择**（不是只替换默认）。
> 范围：新增「预览样式」选择能力。不改编辑器/文件等其它功能，不新增工具栏按钮。

## 1. 数据与接口

### 1.1 Settings 新增字段

```ts
interface Settings {
  // ...既有字段
  previewStyle: 'codex' | 'github' | 'vue' | 'notion' | 'feishu' | 'tailwind' | 'serif'
}
```

- 默认 `'codex'`（现有 Codex 极简样式，保持默认观感不变）。
- `state-store.js` 清洗：非上述枚举回落 `'codex'`；随 settings 持久化到 `state.json`。
- 启动时 `bootstrap().settings.previewStyle` 生效，并写到 `#app` 的 `data-preview-style` 属性。

### 1.2 样式 ID 与名称（固定，菜单与 e2e 都依赖）

| id | 菜单名称 | 说明 |
| --- | --- | --- |
| `codex` | 当前 · Codex 极简 | 默认，现有样式（不新增覆盖 CSS，保持原样） |
| `github` | GitHub 文档风 | 系统字体、标题下划线、斑马表格、#0969da 链接 |
| `vue` | Vue 文档风 | 绿色强调、深色代码块、引用浅灰底 |
| `notion` | Notion 极简风 | 暖灰纸面、无边框标题、红色行内代码 |
| `feishu` | 飞书云文档风 | #3370ff 蓝色强调、浅灰代码块、圆角 |
| `tailwind` | Tailwind Typography | slate 灰阶、深色代码块、强对比标题 |
| `serif` | 报刊衬线风 | 宋体/Georgia、暖纸背景、橙色强调 |

### 1.3 `__qm` 测试钩子

```ts
getState(): { ...既有字段, previewStyle: 'codex'|'github'|'vue'|'notion'|'feishu'|'tailwind'|'serif' }
setPreviewStyle(id): Promise<void>   // 等价于用户从菜单选择（应用 + 持久化）
```

## 2. 菜单交互（视图 → 预览样式 ▸）

应用菜单「视图」末尾追加：

```
… 重置字号
──────
预览样式          ▸
全屏
开发者工具
```

- 悬停 / 点击「预览样式」打开右侧二级下拉面板（`#app-submenu`），列出 7 个选项：
  当前选中项左侧显示 ✓（`data-checked="true"`），其余留空；每项右侧可显示样式 id 之外的简短说明（可选）。
- 点击选项：应用样式 → 关闭两级菜单 → 持久化（`api.saveSettings({ previewStyle })`）→ toast「已切换到「GitHub 文档风」」。
- Esc / 点击外部 / 点击其它菜单：两级菜单一起关闭。
- **禁止新增工具栏按钮**；样式入口只在应用菜单里。

### 2.1 e2e 依赖的稳定选择器

- 视图菜单里的触发项：`#app-menu li[data-menu-key="preview-style"]`
- 二级面板：`#app-submenu`（`ul`，默认 `hidden`）；选项：`#app-submenu li[data-style-id="<id>"]`，选中项带 `data-checked="true"`；
- `#app` 的 `data-preview-style` 必须实时同步（`codex|github|vue|notion|feishu|tailwind|serif`）。
- 菜单按钮/选项不加 `data-action`（沿用现有应用菜单约定）。

## 3. CSS 架构

- 现有默认样式保留为「base」；7 套样式在 `styles.css` 末尾以属性作用域覆盖：

```css
#app[data-preview-style="github"] #preview-pane { ... }
#app[data-preview-style="github"] .markdown-body { ... }
#app[data-theme="dark"][data-preview-style="github"] .markdown-body { ... }
```

- `codex` 不新增覆盖（= 现有 base 样式），保证默认零变化。
- 每套样式必须同时提供**浅色与深色**两套排版；参考浅色实现：`artifacts/style-gallery.mjs` 中的 CSS 片段（已生成对比图 `docs/markdown-styles/`）。深色建议色（可微调，但需保证正文/次要文字对比度 ≥ AA）：
  - github：文字 `#e6edf3`、标题 `#f0f6fc`、链接 `#4493f8`、边框 `#30363d`、代码块 `#161b22`、行内代码 `rgba(110,118,129,.4)`
  - vue：文字 `#d4d4d4`、标题 `#e8e8e8`、链接 `#4ec9b0`、边框 `#3a3f4b`、代码块保持 `#282c34`、行内代码 `#e6a23c`/`#2a2a2a`
  - notion：文字 `#e9e9e7`、标题 `#f5f5f4`、链接继承文字、边框 `#2f2f2f`、代码块 `#202020`、行内代码 `#ff7369`/`#2f2f2f`
  - feishu：文字 `#e8e9eb`、标题 `#f2f3f5`、链接 `#6b9bff`、边框 `#3a3b3d`、代码块 `#252526`
  - tailwind：文字 `#cbd5e1`、标题 `#f8fafc`、链接 `#f8fafc`、边框 `#334155`、代码块 `#0f172a`、引用 `#94a3b8`
  - serif：暖深色纸面，文字 `#d8d1c4`、标题 `#efe8da`、链接 `#d99a5e`、边框 `#3a322a`、代码块 `#241f1a`、预览区底 `#14110e`
- 预览区背景（`#preview-pane`）：浅色下 github/notion 等为白色、serif 为暖白 `#fbf9f4`；深色下除 serif 暖黑外，其余跟随各自深色底（与 App 外壳深色协调即可）。
- 样式只影响预览区（`.markdown-body` 与 `#preview-pane` 背景），不改工具栏/侧栏/编辑器。

## 4. 启动与持久化流程

1. `bootstrap()` → settings.previewStyle；`applyPreviewStyle(style)` → `#app.dataset.previewStyle = style`；
2. 用户切换 → 应用 → `api.saveSettings({ previewStyle })`（走既有 300ms 防抖持久化即可）；
3. 重启后从 settings 恢复；`__qm.setPreviewStyle` 同样持久化并返回。

## 5. e2e 验收（Lead 维护）

- 启动默认 `#app[data-preview-style="codex"]`，`__qm.getState().previewStyle === 'codex'`；
- 打开视图菜单 → 预览样式二级面板出现 7 个选项、当前项 `data-checked="true"`；
- 依次点击 `github`、`vue`、`tailwind`、`serif`（或全部 7 个循环），每次断言：
  - `#app[data-preview-style]` 对应变化；
  - `__qm.getState().previewStyle` 与 `api.saveSettings({})` 返回一致（持久化）；
  - 预览区计算样式确有差异（如 `#preview h1` 的 border-bottom / `#preview pre` 背景色不同）；
- 深色主题下切换到 `vue`（或 `serif`）截图 `20-preview-style-dark.png`；
- 截图：`19-preview-style-github.png`（浅色，GitHub 风）、`20-preview-style-dark.png`（深色，Vue 或衬线风）；
- 最后切回 `codex`，保证后续步骤/默认观感不受影响。
- `npm test`、两阶段 `npm run smoke`、打包 exe smoke 全绿；QA 复验 §16。

## 6. 验收清单

- 7 套样式全部可选、浅/深主题都完整生效；默认 codex 与现版本视觉一致；
- 选择持久化，重启恢复；菜单两级交互（Esc/外部点击/互斥）正常；
- 无新增工具栏按钮/其它功能；编辑器、文件、自动保存等既有行为不变；
- 900×600 无横向溢出；两阶段 smoke + 打包产物全绿。

## 7. 落地与验收结果

- 实现：`#app[data-preview-style]` + `styles.css` 中 6 套覆盖（codex 无覆盖=默认零变化）× 浅/深两段；
  `#app-submenu` 二级面板；`Settings.previewStyle` 持久化（state-store 清洗默认 codex）；`__qm.setPreviewStyle`。
- 修复记录：外部点击曾只关一级菜单、二级面板残留（P1-02）。修复为：父菜单关闭时禁止单独打开二级面板、
  Esc 兜底关闭孤立二级面板、外部点击兜底关闭孤立面板（不误伤父菜单内点击）、Esc 关闭不参与 320ms 重开防抖。
- 验收：`npm test` 48/48；dev smoke **123/123 + 阶段二**；打包 exe smoke **123/123 + 阶段二**；
  QA 预览样式专项 **20/20**（7 套浅/深矩阵、仅预览区生效、深色对比度 AA、持久化重启恢复、真实鼠标外部点击关闭），
  无回归（menubar 24、audit-main 100、design 23），P0=0、P1=0（`docs/QA-REPORT.md` §16/§16.5）。
- 截图：`docs/screenshots/19-preview-style-github.png`（浅色 GitHub 风）、`20-preview-style-dark.png`（深色 Vue 风）、
  `21-preview-style-menu.png`（视图 → 预览样式二级菜单）。
