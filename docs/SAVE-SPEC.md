# MoDex 文件保存方案（草案 v1）

> 状态：**P0 + P1 已实现**（`src/main/save-service.js`、`src/main/file-version.js`、`fs:save-file`、
> 渲染层单飞保存循环、冲突四选一、BOM 往返；当前文件 watcher、自写抑制、外部变更提示条与自动重载；
> 单测 140、e2e 144 全绿）；P2（草稿恢复）待实现。
> 目标是把当前「渲染层比 mtime → 另发一次 IPC 写盘」的保存链路，
> 换成可证明不会静默覆盖、不会因并发/崩溃丢内容的方案。
> 适用范围：`src/main/fs-service.js`、`src/main/main.js` 的 `fs:*` IPC、`src/preload/preload.js`、
> `src/renderer/js/app.js` 的保存流程、`docs/CONTRACTS.md`。

## 1. 结论摘要

1. **写入权收归主进程**：渲染层只提交「内容 + 我基于哪个磁盘版本改的」，由主进程做校验、串行化和原子发布。
2. **版本令牌用内容哈希**：`{ mtimeMs, size, sha256 }`，mtime/size 只做快速预判，最终以哈希为准；
   解决 FAT/网络盘 2s 时间戳粒度、`touch` 改时间不改内容、同尺寸改写等误判。
3. **每条路径一个串行队列**：同一文件的保存永不并发；连续保存合并为「保存最新内容」，避免旧快照后落盘。
4. **迟到校验 + 原子发布**：先写同目录临时文件并 `fsync`，**在 rename 前最后一次读盘比对哈希**；
   不一致就丢弃临时文件并返回冲突，原文件一个字节都不动。
5. **冲突四选一**：覆盖保存 / 重新加载 / 另存为副本 / 取消；删除、只读、占用分别有明确出口。
6. **崩溃恢复靠草稿**：脏文档定期快照到 `userData/drafts/`，启动时提示恢复；不把未保存内容只放在内存里。
7. **不做文件锁做主方案**：其它编辑器不遵守、锁会残留、网络盘不可靠；用「版本校验 + 单写者」解决同应用并发，
   外部写入用窄窗口校验 + 变更监听兜底。

## 2. 现状与问题（代码事实）

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| `src/main/fs-service.js:193` | `atomicWrite`：同目录临时文件 → `rename` | 没有 `fsync`，断电/崩溃后 rename 可能留下空文件或旧内容；rename 遇 Windows 杀软/索引器 `EPERM/EBUSY` 不重试 |
| `src/main/fs-service.js:210` | `writeFile(filePath, content)` 不知道「期望的磁盘版本」 | 无法在写盘瞬间做校验；文件被外部删除时会被静默重建 |
| `src/renderer/js/app.js:876` | `saveDocument` 先 `pathInfo` 比 mtime，再 `api.writeFile` | 检查与写入之间隔着 await，TOCTOU；两次保存可同时通过检查 |
| `src/renderer/js/app.js:889` | `Math.abs(mtime 差) > 1` 判定冲突 | mtime 粒度、`touch`、同尺寸改写都可能误判/漏判 |
| `src/renderer/js/app.js:915` | 保存完成后无条件 `savedContent = content` | 并发保存时，旧请求晚完成会覆盖新请求的已保存状态，磁盘也可能是旧内容 |
| `src/main/main.js:600` + `src/preload/preload.js:58` | `fs:write-file` 只收 `{filePath, content}` | 契约层没有版本概念，主进程无法拒绝过期写入 |
| `src/main/main.js:197` | 只监听文件夹树变化，通知 `fs:tree-changed` | 当前打开文档被外部修改时不会主动提示，只能等到保存才冲突 |
| `src/main/fs-service.js:183` | `TextDecoder` 读文本，BOM 被剥掉 | 保存后 BOM 丢失，字节级不一致 |
| 全局 | 没有草稿/恢复机制 | 崩溃、断电、强杀会丢掉未保存缓冲区 |

## 3. 行业调研

| 产品/系统 | 保存触发 | 写入/原子性 | 冲突检测 | 崩溃/恢复 |
| --- | --- | --- | --- | --- |
| **VS Code** | 显式 + 自动保存（afterDelay / onFocusChange / onWindowChange） | 文件服务写入，带文件版本标识（etag，通常 mtime+size）；热退出备份在后台持续写 | 保存时版本不一致 → 通知，提供 **Compare / Overwrite**；`files.saveConflictResolution` 可设 `askUser`/`overwriteFileOnDisk` | **Hot Exit**：未保存内容写入本地备份目录，重启/崩溃后恢复脏文件（含撤销栈等） |
| **JetBrains IDE** | 空闲自动保存、切换应用时保存 | **Safe write**：保存前备份原文件，成功才用临时文件替换；失败从备份还原 | **Sync external changes**：切回 IDE/切标签时重载外部变更，或空闲 15s 周期性重载 | 依赖 safe write 备份；本地历史 |
| **Sublime Text** | 显式保存 | `atomic_save` 默认开启：临时文件 → 替换原文件，可关闭；用系统 API 尽量保留元数据 | 无复杂冲突 UI（以文件为准） | `hot_exit` 会话恢复 |
| **Emacs** | 显式保存 | 保存前把旧内容复制为 backup 文件（`~` 或编号备份） | 保存时提示文件已变（`file-precious-flag` 等） | `auto-save` 写独立 `#file#`，`recover-file` 恢复 |
| **Vim** | 显式 `:w` | `writebackup` + `backupcopy`：先备份再写；`swapfile` 防崩溃 | `checktime`/保存时检测磁盘变化 | swap 文件恢复 |
| **Obsidian** | 自动保存（社区插件文档称默认约 2 秒，可调） | 直接写 Markdown 文件（原子性未公开承诺） | 云同步冲突通常生成冲突副本；无统一「保存冲突」对话框 | **File recovery** 核心插件：默认至少每 5 分钟保存全文快照，保留 7 天 |
| **Typora** | Windows/Linux 默认每 5 分钟自动保存；macOS 交给系统文档自动保存 | 系统/应用默认写入 | 关闭前询问（可配置） | Windows/Linux 提供「恢复未保存草稿」；macOS 用 NSDocument 版本 |
| **macOS NSDocument** | 自动保存（autosave in place） | `writeSafely` 以「最小化不一致风险」的方式写盘；安全保存 + 版本浏览 | 文件协调（NSFileCoordinator） | 自动保存 + Versions |
| **Notion / Google Docs** | 持续自动保存 | 服务端事务/版本 | 服务端合并（OT/CRDT） | 服务端版本历史 |

**可复用的结论**

- 主流桌面编辑器都把「保存」当作一次**带版本前置条件的发布**，而不是无条件覆盖；冲突时给用户明确出口（对比/覆盖/重载）。
- 原子性普遍是「临时文件 + 替换」（Sublime、JetBrains、NSDocument、`write-file-atomic`），但**只 rename 不够**：
  崩溃一致性还要求 `fsync` 文件，必要时 `fsync` 父目录；`rename` 在崩溃语义下并非绝对原子。
- 恢复能力分两层：**未保存缓冲区**（VS Code Hot Exit / Emacs auto-save / Typora 草稿）和**历史快照**
  （Obsidian File recovery / macOS Versions）。前者是数据不丢的底线，后者是「后悔药」。
- 文件锁不是主流方案：Obsidian/VS Code 都不靠锁，而靠版本检测 + 冲突提示。

## 4. 设计目标与非目标

**目标**

- 任何并发（自动保存 + Ctrl+S + 切换/关闭）下，**磁盘最终内容 = 编辑器最新内容**，状态栏不出现「假已保存」。
- 外部修改/删除后保存，**默认不静默覆盖**；用户可选择覆盖、重载、另存。
- 保存失败/崩溃/断电：**原文件不被截断**；未保存内容可从草稿恢复。
- 保留 BOM、换行符、文件权限（尽力）；Windows 杀软/索引器占用可重试。
- 改造对 UI 侵入最小，沿用现有 IPC 风格与错误信封。

**非目标（本期不做）**

- 文件锁 / 多进程写协调（其它编辑器不遵守，收益低）。
- 协同编辑 / CRDT / 云同步。
- 完整版本控制 UI（本地历史可作为后续可选）。
- 用 SQLite 取代 Markdown 明文文件（违背本地优先与互操作承诺）。

## 5. 核心设计

### 5.1 版本令牌

```ts
interface FileVersion {
  mtimeMs: number   // 仅用于快速预判/展示
  size: number
  hash: string      // sha256(raw bytes，含 BOM)
}
```

- **读文件时**：主进程返回 `version`（原始字节的 sha256）与 `hasBom`；渲染层把 `version` 记为 `doc.baseVersion`。
- **保存时**：以 `baseVersion.hash` 作为前置条件；mtime/size 不同但 hash 相同（仅 touch）→ 不算冲突。
- **为什么不用 mtime 单判**：FAT 时间戳 2s 粒度、网络盘时钟偏差、`touch`、同尺寸改写都会误判；
  5 MB 上限下 sha256 成本可接受（约几毫秒到十几毫秒）。

### 5.2 主进程 `SaveService`（新模块）

新文件：`src/main/save-service.js`（纯 Node，可注入 `fs`/`hash` 便于测试）。

```js
createSaveService({ fs = fsp, hash = sha256Hex, now = Date.now })
  .save({ filePath, content, baseVersion, mode, encoding, requestId })
  .setActiveFile(filePath | null)   // 供外部变更监听
  .dispose()
```

- **每路径串行队列**：`Map<normalizedPath, Promise>`；同一路径的保存排队执行，不同路径并行。
- **保存模式**：
  - `update`：必须提供 `baseVersion`；目标不存在 → `CONFLICT/deleted`。
  - `create`：目标已存在 → `EEXIST`（新建文件用）。
  - `overwrite`：用户已确认覆盖（另存为对话框确认后），跳过前置校验。
- **写盘步骤**（详细版）：

```text
1. 校验路径/内容/大小（沿用现有规则，≤5MB、绝对路径、UTF-8）
2. 解析父目录，确认存在且可写；读取目标 stat（update 模式必须存在）
3. bytes = encode(content, encoding)        // 'utf8' | 'utf8-bom'
4. 在同目录创建唯一临时文件（`.modex-save-<pid>-<rand>.tmp`）
5. 写入 → fsync(tmp) → close                 // 数据先落盘
6. update 模式：重新 stat + 读取 + sha256 目标文件
   - 不存在 → 丢弃 tmp，返回 CONFLICT/deleted
   - hash ≠ baseVersion.hash → 丢弃 tmp，返回 CONFLICT/changed（含当前 version）
7. rename(tmp → target)，带重试：
   EPERM / EACCES / EBUSY / EEXIST → 25/50/100/200ms + 抖动，最多 4 次
8. 尽力 fsync 父目录（Windows 不支持则忽略；POSIX 生效）
9. 重新 stat，返回新 version；记录 lastSelfWrite[path] = { hash, at }
10. 任何失败：删除 tmp，返回映射后的错误；原文件保持不变
```

- **为什么校验放在第 6 步而不是开头**：临时文件写入+fsync 是最慢的一步；把读盘比对放到 rename 前，
  能把「检查到写入」的窗口压到毫秒级，同时避免白写临时文件。
- **仍存在的理论窗口**：外部进程在「第 6 步读完」到「第 7 步 rename」之间写入，无法用普通文件 API 完全消除；
  这是所有非协作编辑器的共同边界。缓解：窗口极窄 + 外部变更监听 + 用户冲突提示；不引入文件锁。

### 5.3 渲染层：单飞保存循环

`app.js` 的 `saveDocument` 改为「同一文档同时只有一个保存在飞；期间的新内容合并到下一轮」：

```js
let saveLoop = null
let saveQueued = false

function requestSave(options) {
  if (saveLoop) { saveQueued = true; return saveLoop }
  saveLoop = runSaveLoop(options).finally(() => { saveLoop = null; if (saveQueued) { saveQueued = false; requestSave(options) } })
  return saveLoop
}

async function runSaveLoop({ silent }) {
  const doc = state.doc
  for (;;) {
    const snapshot = { content: doc.content, baseVersion: doc.baseVersion }
    const result = await api.saveFile({ filePath: doc.path, content: snapshot.content, baseVersion: snapshot.baseVersion, mode: 'update' })
    if (!result.ok) return handleSaveFailure(result, snapshot)
    if (state.doc !== doc) return true
    doc.baseVersion = result.version
    if (doc.content === snapshot.content) {
      doc.savedContent = snapshot.content
      syncDirty()
      if (!silent) toast.success('已保存')
      return true
    }
    // 保存期间又编辑了：继续保存最新内容，不把旧内容标记为已保存
  }
}
```

- 关键点：**只有 `content === snapshot.content` 时才更新 `savedContent`**，消除「旧请求晚完成 → 假已保存」。
- 关闭/切换/新建统一走 `autoSaveBeforeLeave()`，它等待 `requestSave` 完成；冲突时中止操作。
- 自动保存（`autoSave` 2s）走同一入口，不与手动保存并行。

### 5.4 冲突与失败矩阵

| 情况 | 主进程返回 | UI 出口 |
| --- | --- | --- |
| 磁盘内容变了 | `CONFLICT/changed` + 当前 `version` | 覆盖保存 / 重新加载 / 另存为副本 / 取消 |
| 磁盘文件被删 | `CONFLICT/deleted` | 重新创建 / 另存为 / 取消 |
| 目标只读/被占用 | `EACCES`/`EBUSY`/`EPERM` | 提示「文件被占用或只读」，可重试 / 另存为 |
| 磁盘满/配额 | `ENOSPC` | 保留脏状态，提示清理空间，可重试 |
| 编码/大小非法 | `BAD_ENCODING`/`TOO_LARGE` | 保留原文，提示 |
| 保存成功但期间又编辑 | `ok` + 新 `version` | 循环继续保存最新内容（不结束） |

「另存为副本」写入新路径后，**当前文档仍指向原路径**（避免用户以为原文件已更新）；提示已保存副本。

### 5.5 外部变更监听（P1）

- 主进程在 `setActiveFile(path)` 时对当前文件单独 `fs.watch(file)`（不依赖目录递归监听），150ms 防抖。
- 变更后 `stat + sha256`，若与 `lastSelfWrite` 相同 → 判为自写，忽略；否则 `webContents.send('fs:file-changed', { path, version, kind })`。
- 渲染层：
  - `hash === doc.baseVersion.hash` → 忽略；
  - 文档干净 → 自动重载（保留光标/滚动），toast「已重新加载外部修改」；
  - 文档脏 → 顶部非阻塞条：「文件已在磁盘上被修改」→ 重新加载 / 保留我的修改 / 对比（对比可后置）；
  - 删除 → 「文件已被删除」→ 重新创建 / 另存为 / 关闭文档。
- 自写抑制同时用**哈希 + 时间窗**，避免 rename 触发的 watcher 回环。

### 5.6 草稿与崩溃恢复（P2）

- 脏文档每 5s（防抖）或失焦/关闭前，写 `userData/drafts/<docId>.json`：
  `{ docId, path, fileName, content, baseVersion, savedAt, encoding }`；`docId = sha256(path)`，未命名文档用随机 id。
- 草稿写入复用 `ai-store` 的「唯一临时文件 + 串行写盘」模式。
- 启动时扫描：
  - 草稿内容 === 磁盘内容 → 静默删除；
  - 磁盘 `version === baseVersion` → 提示「恢复未保存的修改」；
  - 磁盘已变化 → 提示「恢复为副本 / 查看差异 / 丢弃」。
- 保存成功、用户明确丢弃、正常关闭后删除草稿；最多保留 20 个、单条 ≤5MB、30 天清理。

### 5.7 编码、元数据与 Windows

- **BOM**：读时记录 `hasBom`，保存时按原样写回；新文件默认无 BOM。
- **换行**：内容字符串原样保存，不做 CRLF/LF 归一化（现状保持）。
- **权限**：临时文件沿用目标 `mode`（POSIX）；Windows 上 `fs.rename` 不保证保留 ACL/创建时间，
  需要时后续可用 `ReplaceFileW`（保留 ACL、ADS、创建时间、压缩/加密属性）替换 rename；本期先记录差异。
- **命名**：临时文件必须与目标同目录、同卷，保证 rename 不跨卷；名字带唯一前缀，失败必清理。
- **重试**：Windows 杀软/索引器/同步盘常导致 `EPERM/EBUSY`，必须重试；最终失败给可操作提示。
- **只读**：写前 `access(W_OK)` 或 rename 失败时识别只读属性，提示「另存为」而不是反复重试。
- **网络盘**：`\\server\share` 上 rename/fsync 语义弱；失败时明确提示「网络位置不支持安全保存」，
  提供「另存到本地」；不做静默降级为直接覆盖写。

## 6. 契约变更（`docs/CONTRACTS.md`）

```ts
interface FileVersion { mtimeMs: number; size: number; hash: string }

// readFile 增加 version/hasBom（保留旧字段兼容）
readFile(filePath: string): Promise<Result<{
  path: string; content: string; size: number; mtimeMs: number;
  version: FileVersion; hasBom: boolean;
}>>

// 新保存接口；旧 writeFile 在迁移期保留，随后移除
saveFile(input: {
  filePath: string
  content: string
  baseVersion?: FileVersion | null
  mode?: 'update' | 'create' | 'overwrite'   // 默认 update
  encoding?: 'utf8' | 'utf8-bom'
  requestId?: string
}): Promise<
  | { ok: true; path: string; version: FileVersion; size: number; mtimeMs: number }
  | { ok: false; code: 'CONFLICT'; reason: 'changed' | 'deleted'; current: FileVersion | null; error: string }
  | { ok: false; code: ErrorCode; error: string }
>

// 当前文件监听（P1）
setActiveFile(filePath: string | null): Promise<{ ok: true }>
onFileChanged(cb: (payload: {
  path: string; version: FileVersion; kind: 'changed' | 'deleted'
}) => void): () => void

// 草稿（P2）
draft: {
  save(input): Promise<{ ok: true }>
  list(): Promise<{ ok: true; drafts: DraftSummary[] }>
  read(id): Promise<{ ok: true; draft: Draft }>
  discard(id): Promise<{ ok: true; removed: boolean }>
}
```

错误码新增：`CONFLICT`（带 `reason`）、`BUSY`（文件被占用）；复用 `EACCES/EPERM/ENOSPC/EISDIR/TOO_LARGE/BAD_ENCODING`。

## 7. 分阶段实施

### P0（必须先做，修掉竞态与静默覆盖）

1. `src/main/save-service.js`：版本哈希、三模式、每路径队列、临时文件 + fsync + 迟到校验 + rename 重试。
2. `readFile` 返回 `version/hasBom`；新增 `fs:save-file` IPC 与 preload 桥接。
3. `app.js`：`doc.baseVersion` 替换 `mtimeMs` 判定；单飞保存循环；冲突四选一；保存状态（保存中/已保存/失败）。
4. `saveDocumentAs` 走 `mode:'overwrite'|'create'`；删除文件/只读/删除后保存的出口。
5. 契约、README、单测、E2E 更新。

验收：并发保存、外部修改、外部删除、只读、BOM、失败回滚全部有自动化用例。

### P1（应做，主动感知外部变化）

6. `setActiveFile` + 文件级 watcher + 自写抑制 + `fs:file-changed`。
7. 顶部变更条：重载 / 保留 / 删除后重建；干净文档自动重载。

### P2（建议做，崩溃恢复）

8. `draft-store` + 启动恢复提示 + 清理策略。
9. 端到端：强杀进程后重启恢复。

### P3（可选）

10. `ReplaceFileW`（ACL/ADS/创建时间保留）；网络盘降级策略；本地历史/版本浏览；自动保存模式 UI。

## 8. 测试矩阵

**单元（`tests/save-service.test.mjs`）**

- 版本：同内容同哈希；内容/BOM/大小变化哈希变化。
- update：成功、过期哈希冲突、文件被删冲突、仅 mtime 变化不冲突。
- create：已存在 EEXIST；新路径成功。
- overwrite：跳过校验；成功返回新版本。
- 并发：同路径 10 次并发保存 → 串行、最终内容为最后一次；不同路径并行。
- 失败：ENOSPC/EACCES/rename EPERM 重试后成功；失败后原文件字节不变、无 tmp 残留。
- 注入：临时文件写完到 rename 之间篡改磁盘 → 必须冲突。
- BOM 往返、只读、路径校验。

**E2E**

- 打开文件 → 外部追加内容 → Ctrl+S → 冲突对话框：重载后内容为磁盘版；覆盖后磁盘为编辑器版。
- 连续两次 Ctrl+S / 自动保存 + 手动保存 → 最终磁盘为最新内容，状态「已保存」。
- 外部删除 → 保存 → 「重新创建 / 另存为」。
- 只读文件保存失败 → 另存为成功。
- 编辑中强杀应用 → 重启 → 草稿恢复 → 内容完整。
- 关闭窗口时保存进行中 → 等待完成或明确失败，不丢内容。

**手工/边界**

- 5MB 文件保存耗时；网络盘；杀软占用；BOM/CRLF 文件往返；长路径。

## 9. 取舍与风险

- **哈希成本**：≤5MB 的一次读+sha256 在保存时多几毫秒；换来正确性，值得。若未来上限提高，可改为「mtime+size 快判 + 抽样哈希」。
- **主进程单写者**：所有写盘集中到主进程，渲染层无法再直接写；这是架构收益，不是损失。
- **理论竞态窗口**：外部进程在「迟到校验」与 rename 之间写入无法完全消除；不引入文件锁是刻意取舍（其它编辑器不遵守、锁会残留）。
- **ACL 保留**：Node 原生 rename 在 Windows 上可能不保留自定义 ACL；需要时再引入 `ReplaceFileW`（可通过原生模块或后续 Electron API），本期文档标明。
- **草稿空间**：限制数量/大小/天数，避免 userData 膨胀。
- **契约迁移**：`fs:write-file` 保留一个版本周期，渲染层全部迁移后再删除，避免 e2e 一次性大改。

## 10. 参考资料

- VS Code 1.42 release notes：保存冲突 Compare/Overwrite 与 `files.saveConflictResolution` —
  https://code.visualstudio.com/updates/v1_42#_ignore-save-conflicts
- VS Code issue #156553（文件版本/覆盖边界讨论）— https://github.com/microsoft/vscode/issues/156553
- VS Code Hot Exit 备份/恢复设计 — https://github.com/microsoft/vscode/issues/16544
- JetBrains System Settings：Safe write（保存前备份）与 Sync external changes —
  https://www.jetbrains.com/help/idea/system-settings.html
- Sublime Text `atomic_save`（临时文件+替换，默认开启）—
  https://stackoverflow.com/questions/20639093/what-is-sublime-text-doing-when-i-save-a-file
- GNU Emacs：Backup Files（保存前备份旧内容）—
  https://www.gnu.org/software/emacs/manual/html_node/emacs/Backup.html
- Vim `'writebackup'` / `'backupcopy'`（写前备份、备份策略）—
  https://vimhelp.org/options.txt.html#%27writebackup%27
- Obsidian File recovery（默认 ≥5 分钟快照、保留 7 天）— https://obsidian.md/help/plugins/file-recovery
- Typora Auto Save（Windows/Linux 默认 5 分钟）与草稿恢复 — https://support.typoraio.cn/Auto-Save/
- Apple NSDocument `writeSafely`（最小化不一致写盘风险）—
  https://developer.apple.com/documentation/appkit/nsdocument/writesafely(to:oftype:for:)
- Windows `ReplaceFileW`（保留 ACL/创建时间/ADS，同卷）—
  https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew
- `write-file-atomic`（同文件写队列、默认 fsync、保留 mode/owner）—
  https://github.com/npm/write-file-atomic
- “Files are hard”（rename 崩溃语义、fsync 顺序、临时文件+rename 的边界）— https://danluu.com/file-consistency/
- Windows FAT 时间戳 2 秒粒度 — https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4e3695bd-7574-4f24-a223-b4679c065b63
