# MoDex · 多文件夹工作区 + 工具栏精简 规格（本轮新增）

> 用户需求：
> 1. 支持同时打开多个文件夹，侧栏像 Codex 的项目列表一样展示多个文件夹（可展开、可切换、可移除）。
> 2. 删除工具栏上的 5 个操作按钮：新建 / 打开文件 / 打开文件夹 / 保存 / 另存为（功能保留在菜单、快捷键、欢迎页、右键菜单中，不新增替代按钮）。
>
> 视觉仍遵循 `docs/CODEX-UI-DESIGN.md` 的单色语言；本文档补充本轮新增的接口、状态与 UI 约定。

## 1. 数据与接口变更

### 1.1 Settings（持久化）

```ts
interface Settings {
  // ...既有字段不变
  openFolders: string[]        // 已打开的文件夹（绝对路径，去重，最多 12 个，顺序=侧栏顺序）；默认 []
  activeFolder: string | null  // 最近激活的文件夹根；默认 null
}
```

- `state-store.js` 增加对应清洗：绝对路径、去重（Windows 大小写不敏感）、上限 12；`activeFolder` 必须也在 `openFolders` 中或为 null。
- 每次添加/移除/激活文件夹都 `api.saveSettings({ openFolders, activeFolder })`（既有 300ms 防抖持久化即可）。

### 1.2 `window.api` 变更

```ts
// 删除：setRoot(rootPath: string | null): Promise<{ ok: boolean }>
// 新增：
setRoots(rootPaths: string[]): Promise<{ ok: true, watched: string[] }>
```

- 主进程为每个根建立独立递归 `fs.watch`（Map 管理，移除的根停止监听），变化时 `onTreeChanged(rootPath)` 只带该根。
- 任一文件操作（create/rename/remove 等）成功后，主进程按「变更路径所属根」发送 `fs:tree-changed`；`dialog:open-folder` 不再自行监听（由渲染层加根后调用 `setRoots`）。

### 1.3 `__qm` 测试钩子（e2e 依赖）

```ts
getState(): {
  // ...既有字段，删除 rootFolder
  rootFolders: string[]       // 当前打开的文件夹，顺序=侧栏顺序
  activeFolder: string | null
  treeFileCount: number       // 所有根的文件总数（可见节点）
}
openRoot(path: string): Promise<void>       // 添加一个根（已存在则展开并激活）
openRoots(paths: string[]): Promise<void>   // 用给定列表替换当前根
removeRoot(path: string): Promise<void>     // 移除一个根（不删除磁盘内容）
```

- 其余 `__qm` 钩子（`openPath`、`save`、`setViewMode`、`setTheme`、`ready`）签名不变。

## 2. 侧栏 UI（Codex 项目列表风格）

```html
<aside id="sidebar">
  <div id="sidebar-head">
    <span id="sidebar-title">文件夹</span>
    <div class="sidebar-actions">
      <button data-action="open-folder" title="添加文件夹">＋</button>
      <button data-action="refresh-tree" title="刷新全部">↻</button>
    </div>
  </div>
  <div id="tree-scroll"><ul id="tree" role="tree"></ul></div>
  <div id="sidebar-empty">尚未打开文件夹<br><button data-action="open-folder">添加文件夹</button></div>
  <div id="sidebar-foot"><span id="sidebar-root"></span></div>
</aside>
```

- 删除头部原有的「新建文件 / 新建文件夹」按钮（这两个能力改由文件夹行右键菜单提供）。
- 树结构（保留既有 e2e 选择器；**根行额外加 `data-root="true"`**）：
  采用「根行 + 平铺兄弟节点」渲染：`ul#tree` 直接子节点依次是各根行；根展开后，其子节点（目录/文件）
  作为 `#tree` 的后续兄弟节点平铺输出，通过 `--depth` 缩进表达层级。这样既满足
  `ul#tree > li.tree-item[data-path][data-type]` 的 e2e 断言，也保证原有展开/折叠与选择器行为不变。
  （实现取舍说明见 `docs/QA-REPORT.md` P2-18。）

```html
<ul id="tree">
  <!-- 根 1 -->
  <li class="tree-item root-item" data-path="D:\notes" data-type="dir" data-root="true" data-expanded="true">
    <div class="tree-row root-row" data-path="D:\notes">
      <span class="tree-twisty expanded">…</span>
      <span class="tree-icon">…</span>
      <span class="tree-label">notes</span>
      <span class="root-actions">
        <button data-root-action="new-file" title="在此文件夹新建 Markdown">＋</button>
        <button data-root-action="menu" title="更多操作">···</button>
      </span>
    </div>
  </li>
  <!-- 根 1 展开后的子节点：平铺为 #tree 的直接子节点，缩进按 depth -->
  <li class="tree-item" data-path="D:\notes\a.md" data-type="file">…</li>
  <li class="tree-item" data-path="D:\notes\sub" data-type="dir" data-expanded="true">…</li>
  <!-- 根 2 -->
  <li class="tree-item root-item" data-path="D:\docs" data-type="dir" data-root="true">…</li>
</ul>
```

- 根行：高 28px、左右 6px 边距、圆角 6px、13px 文字、文件夹图标 15px；hover 底色 `--hover`；激活根 `background: var(--active)` + 左缘 2px `--accent`（与文件激活行一致）。
- 根行 hover/激活时显示右侧 `.root-actions`（默认 opacity 0）：`＋` 直接对根发起行内新建文件；`···` 打开根上下文菜单。按钮 20px、单色图标、不新增菜单项到工具栏。
- 展开/折叠：启动时所有已打开文件夹默认展开；点击根行切换展开并设为 `activeFolder`；展开箭头旋转沿用现有动画。
- 子节点样式沿用现有 24px 文件树行；缩进 depth 从根行的下一层开始为 1。
- 文件夹数量为 0：显示 `#sidebar-empty`；数量 >0 隐藏。
- 侧栏底部 `#sidebar-foot`：显示 `共 N 个文件夹`（10.5px 等宽 `--faint`），title 为 activeFolder 完整路径。
- 根行上下文菜单（右键或 `···`）：
  1. 新建文件（`tree:new-file`，建在该根）
  2. 新建文件夹（`tree:new-folder`）
  3. 分隔线
  4. 刷新（`tree:refresh`，刷新该根）
  5. 在资源管理器中显示（`tree:reveal`）
  6. 复制路径（`tree:copy-path`）
  7. 分隔线
  8. 从列表移除（`tree:remove-root`，**不删除磁盘文件**；label 用「从列表移除」）
- 嵌套目录/文件行右键菜单保持既有 6 项不变；「新建文件/文件夹」按选中目录（无选中时按该行所属根）创建。
- 移除根后：若当前文档在该根内，文档保持打开（只从侧栏移除）；从 `openFolders` 删除并 `setRoots(剩余)`。
- 打开文件夹（对话框/欢迎页/最近文件夹）语义改为 **添加根**：已存在则展开并激活，不重复添加。
- `#sidebar-foot` 与 `#doc-dir` 的路径显示规则不变。

## 3. 工具栏精简

删除 `#toolbar` 中的以下 5 个按钮（连同其图标/标签）：

- `[data-action="new-doc"]` 新建
- `[data-action="open-file"]` 打开文件
- `[data-action="open-folder"]` 打开文件夹
- `[data-action="save"]` 保存
- `[data-action="save-as"]` 另存为

保留：品牌（M + MoDex）、`[data-action="toggle-sidebar"]`、视图 tabs（`view-edit/split/preview`）、`[data-action="theme-toggle"]`。
工具栏布局改为：品牌 + 侧栏开关 | 弹性空隙 | 视图 tabs + 主题切换，保持 40px 高、底部发丝线。

功能入口保留：应用菜单（文件/编辑/视图/帮助）、全局快捷键（Ctrl+N/O/S/Shift+S 等）、欢迎页三按钮、右键菜单。**不得新增其它工具栏按钮替代。**

## 4. 启动与持久化流程

1. `bootstrap()` → settings；
2. 若 `settings.openFolders` 非空 → `openRoots(openFolders)`；否则若 `initial.root` 存在 → `openRoot(initial.root)`；
3. 打开根后调用 `api.setRoots(当前根列表)` 建立监听；
4. 打开 CLI 指定的 `initial.file`（若存在）；
5. 每次根列表/激活根变化：更新 `state`、渲染树、`api.setRoots`、`saveSettings`。

## 5. e2e 约定（Lead 维护）

- 断言 `getState().rootFolders` 数组；根行选择器 `#tree li.tree-item[data-root="true"]`。
- 工具栏断言：`#toolbar [data-action="save"]` 等 5 个按钮必须不存在；`#toolbar` 的 data-action 集合必须恰好是 5 个（toggle-sidebar、view-edit、view-split、view-preview、theme-toggle）。
- 保存路径改由 Ctrl+S 键盘触发（不再依赖工具栏按钮）。
- 多根场景：e2e 会添加第二个工作区根、校验根行数量/激活切换/跨根文件打开/移除根。
- 右键菜单项动作名保持 `tree:new-file`、`tree:new-folder`、`tree:refresh`、`tree:reveal`、`tree:copy-path`，新增 `tree:remove-root`。

## 6. 验收

- `npm test` 全绿（state-store 新增 openFolders 用例）；
- `npm run smoke` 全绿（新增多根与工具栏精简断言，数量以实际为准）；
- 打包 exe smoke 全绿；QA 复验通过；
- 截图：多文件夹展开（浅色/深色）、根行 hover 操作、空侧栏、精简工具栏。
