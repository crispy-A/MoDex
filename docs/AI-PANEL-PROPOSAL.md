# MoDex AI 对话面板方案（v1，已实施）

> 状态：**v1 已实施**（渲染层 UI + 主进程 AI 服务 + e2e/单测 + 截图）；实现契约以 `docs/AI-PANEL-SPEC.md`
> 为准，验收见 `docs/QA-REPORT.md` §17。
> 目标：在保持 MoDex 现有轻量、单色、键盘优先气质的前提下，加入一个可长期扩展的 AI 写作助手。
> 第一版：窗口右侧 AI 对话面板 + DeepSeek Responses API + 两个 DeepSeek 模型（`deepseek-flash` / `deepseek-v4-pro`）。

## 1. 范围

### v1 要做

- 右侧 **AI 对话面板**：展开 / 收起 / 拖拽调宽（320–560，默认 360px），浅色与深色主题。
- **对话**：多轮上下文、流式输出、停止生成、错误提示、代码块复制、Markdown 渲染（复用现有预览渲染器）。
- **模型选择**：DeepSeek 两个模型（默认 `deepseek-flash`，可选 `deepseek-v4-pro`），模型列表配置化。
- **当前文档上下文**：可选开关，附带当前文档标题与内容（有长度上限）；选中文本可作为一次提问的上下文。
- **会话**：新对话、历史会话列表（本地保存、可删除、重启恢复）。
- **设置**：API Key 录入 / 掩码显示 / 删除、默认模型、测试连接；Key 用系统级加密存储，**绝不下发到渲染进程**。
- **入口**：工具栏右侧 AI 图标按钮、`Ctrl+Shift+A`、视图菜单项；关闭面板 `Esc`（焦点在面板内时）。

### v1 不做（为后续预留）

- 图片/文件附件（DeepSeek `deepseek-flash` 支持图片，但 v1 不做 UI）。
- 联网搜索（仅 `deepseek-v4-pro` 支持 `web_search`，留能力位）。
- 自动改写/自动插入整篇文档、Apply Patch、多文件上下文。
- 除 DeepSeek 外的其它供应商；多 Key 管理；团队共享。
- 费用看板、对话云同步、导出。

## 2. 参考图与视觉方向

用户参考图是典型 IM 布局：顶部彩色 tab、左侧会话列表、中间对话、右侧第二列表、底部图标工具行。MoDex 只借**结构模式**，不照搬视觉：

| 参考图元素 | MoDex 适配 |
| --- | --- |
| 顶部彩色 tab（消息/我的/文档…） | 不做；保留 MoDex 单条 40px 导航栏，仅在工具栏右侧加 AI 开关 |
| 左侧会话列表 | 不占独立列；收进面板 header 的「历史」弹出层（每项：标题、时间、删除） |
| 中间对话 + 发送区 | 面板主体：消息流 + 上下文 chip + 输入区 |
| 右侧「全部聊天」列表 | 删除；AI 面板不再分第二列，避免 1280 宽下三列过挤 |
| 底部图标工具行 | 精简为输入框下方一行小图标（引用当前文档、清空、发送/停止） |
| 彩色头像 / 未读红点 | 单色首字母方块、发丝线、`--accent` 唯一强调；不加红点噪音 |

视觉仍用 Codex 设计令牌：暖白 `#fafaf8` / 面板白、近黑 `#0e0e0f` / `#141415`、1px 发丝线、12.5px UI、13px/1.7 正文、单一低饱和强调色 `#4a6b8a`。AI 面板与编辑器之间用 6px 拖拽条 + 1px 发丝线，和现有分栏一致。

## 3. 界面规格

### 3.1 布局

```
┌ #toolbar 40px ──────────────────────────────────────────────── AI(icon) ┐
├──────────┬──────────────────────────────┬─────────────────────────────┤
│ #sidebar │ editor / preview             │ #ai-panel 360px             │
│ 260px    │ （现有网格，自动让出宽度）      │ header 40px                  │
│          │                              │ context bar                  │
│          │                              │ messages (scroll)            │
│          │                              │ composer + hint              │
├──────────┴──────────────────────────────┴─────────────────────────────┤
│ #statusbar 24px                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

- 面板左缘：1px `--border` + 6px 拖拽热区，hover 时线变 `--accent`。
- 窗口 ≥ 1180 时并排；窗口 < 1180（含最小 900×600）时面板改为**覆盖预览区的抽屉**（从右滑入 + 半透明遮罩不做，保留可点编辑器），保证编辑器不被压到 200px 以下。
- 收起时右侧保留 **40px 竖条**：AI 图标（生成中带脉冲点）、新对话、历史、展开箭头；点击展开。竖条不占状态栏，状态栏仍在左侧工作区下方。
- 面板状态（开/关、宽度）写入 settings，重启恢复；`Ctrl+Shift+A` 切换开合。

### 3.2 面板组成

**Header（40px）**
- 左：AI 图标 + 「AI 写作助手」12.5px；右侧依次：模型 pill「DeepSeek Flash ▾」、新对话 `＋`、历史 `🕘`、收起 `›`。
- 模型 pill 弹出模型菜单：`deepseek-flash`（默认，快）、`deepseek-v4-pro`（强，支持联网/工具，后续开放）；每项一行说明，当前项 ✓。

**上下文栏（可选显示）**
- chip：「📄 当前文档 · 示例.md」开关；打开时高亮，右侧显示估算字数 / token；文档过长提示「已截断到 20k 字符」。
- 若编辑器有选区，另出现 chip：「引用选中内容 · 128 字 ×」，仅对下一条消息生效。

**消息区**
- 欢迎空态：AI 图标 + 「开始和 AI 一起写作」+ 一句说明 + 3 个快捷提问卡片：
  - 「总结当前文档」——提炼要点、结论与待办
  - 「生成文档大纲」——根据现有内容补全结构
  - 「润色选中内容」——显示「已选 N 段 · M 字」，无选区时禁用并提示
  - 下方「最近对话」2–3 条（标题 + 相对时间），点击即恢复；更多走历史弹层。
  - 未配置 Key 时主区出现「配置 AI」引导，快捷提问卡片禁用。
- 用户消息：右对齐，浅色气泡（`--active`），最多 80% 宽；时间 hover 显示。
- AI 消息：左对齐，无气泡；顶部小字「MoDex AI · deepseek-flash」；正文 Markdown（标题/列表/引用/表格/代码块），代码块右上角「复制」；hover 显示操作：复制、插入到文档（v1.1 再启用，按钮先灰）。
- 思考中（`deepseek-v4-pro` / thinking 模式）：消息顶部可折叠行「已深度思考 12s ›」，展开显示 reasoning 纯文本；默认收起，不干扰阅读。
- 流式状态：末尾 2px 方块光标闪烁；生成中显示「停止生成」按钮；完成后底部一行 11px 灰字「输入 1.2k · 输出 356 tokens · 3.4s」。
- 错误卡片：图标 + 标题 + 一行原因 + 操作（重试 / 打开设置）；401 → 密钥无效，402 → 余额不足，429 → 请求过快，超限 → 上下文过长，网络 → 检查网络。
- 长对话滚动到底部时出现「回到底部」小按钮。

**输入区**
- textarea 自动增高 1–6 行，占位「向 AI 提问，或让它改写当前文档…」。
- 下方：左侧「引用当前文档」开关（与上下文 chip 同步）、清空；右侧发送按钮（`Enter` 发送，`Shift+Enter` 换行；生成中变「停止」）。
- 发送时禁用重复提交；失败消息保留并可重试。

**历史弹出层**
- 面板 header 下方浮层，宽 320px：列表项「标题 + 相对时间 + 删除」；顶部「搜索会话」（v1.1）；空态「还没有历史对话」。
- 新建对话时若当前对话非空，自动生成标题（取首条用户消息前 20 字）。

### 3.3 交互与键盘

| 操作 | 触发 |
| --- | --- |
| 打开/收起面板 | `Ctrl+Shift+A`；工具栏 AI 按钮；视图菜单「AI 助手」 |
| 关闭 | `Esc`（焦点在面板内时先关历史/模型菜单，再收起面板） |
| 发送 | `Enter`；`Shift+Enter` 换行 |
| 停止生成 | `Esc`（生成中，焦点在输入框）或「停止生成」按钮 |
| 新对话 | `Ctrl+Shift+N`（面板内） |
| 复制代码块 | 代码块右上角按钮 |
| 重试/编辑重发 | 失败消息按钮；用户消息 hover「编辑」重新发送（v1.1） |

### 3.4 AI 设置弹窗

- 居中卡片（宽 ~440px，`--elevated` + `--border-strong` + `--shadow-menu`），遮罩不拦截编辑器内容（可看不可点）。
- 内容：供应商「DeepSeek」（标注 `Responses API`，说明当前版本固定、接口层已为多供应商预留）；API Key 密码输入（掩码 + 显示切换 + 清空）；默认模型下拉（`DeepSeek Flash` / `deepseek-v4-pro` 显示名）；「测试连接」状态行（未测试 / 连接中 / 成功+延迟 / 失败原因）；安全说明：「Key 使用系统密钥环（Electron `safeStorage`）加密后保存在本机，不写入文档、不随文件同步、不会提交到仓库」。
- 底部：取消 / 保存并验证（保存后立即做一次轻量 `/responses` 连通性检查或 `/models` 请求）。

### 3.5 响应式与主题

- 浅/深主题跟随 `data-theme`；面板内消息正文复用 `.markdown-body` 的预览样式（可受「预览样式」影响，也可为 AI 面板固定一套基础排版，倾向后者）。
- 900×600：面板覆盖预览区，宽度 `min(360, 窗口宽-260)`，不产生横向滚动。
- 面板宽度记忆到 settings；折叠状态也记忆。

## 4. 技术架构（为复杂化 / 多模型预留）

### 4.1 进程职责

| 层 | 职责 |
| --- | --- |
| 渲染进程 | 面板 UI、消息列表、Markdown 渲染、输入/快捷键、流式增量渲染；**不接触 API Key、不发网络请求** |
| preload | 暴露 `window.api.ai*` 白名单方法；只传结构化的消息/事件，不暴露 Electron |
| 主进程 | 供应商/模型注册表、HTTP/SSE 流、API Key 加密存储、会话持久化、用量统计、错误归一化、取消与超时 |

现有安全基线保持：`connect-src 'self'` 不变（渲染层零网络）；IPC 来源校验沿用 `event.sender === mainWindow.webContents && senderFrame.url.startsWith('app://bundle/')`。

### 4.2 模块划分

```
src/main/ai/
  provider-registry.js   # 供应商 + 模型注册表（v1 仅 DeepSeek）
  responses-client.js    # Responses API 请求构造 + SSE 解析 + 错误归一化
  protocols.js           # protocol 适配器接口（responses / chat-completions 预留）
  credentials.js         # safeStorage 加密读写 API Key
  ai-store.js            # 会话持久化（JSON + 原子写）
  ai-service.js          # IPC handler、请求生命周期、取消、事件推送
src/preload/preload.js   # 新增 ai 相关白名单方法
src/renderer/js/ai-panel.js      # 面板 UI / 状态机
src/renderer/js/ai-settings.js   # API Key / 模型设置
src/renderer/styles.css          # 面板样式（新增章节）
tests/ai-*.test.mjs              # SSE 解析、序列化、错误映射、存储
```

### 4.3 供应商 / 模型注册表（核心扩展点）

```js
// 供应商配置（静态 + 可被用户配置覆盖；v1 写死 DeepSeek 一项）
{
  id: 'deepseek',
  name: 'DeepSeek',
  protocol: 'responses',             // 'responses' | 'chat-completions'（后续）
  baseUrl: 'https://api.deepseek.com',
  auth: { type: 'bearer' },          // 后续可支持 header/query/oauth
  models: [
    { id: 'deepseek-flash',  label: 'DeepSeek Flash',  capabilities: ['reasoning','vision'], default: true },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', capabilities: ['reasoning','tools','web_search'] },
  ],
  defaultModel: 'deepseek-flash',
}
```

- 协议与模型解耦：UI 只读 `capabilities` 决定展示（思考折叠、联网开关、附件按钮），加模型只改注册表。
- 后续加入 OpenAI / Anthropic / 本地 Ollama：新增 protocol 适配器 + 注册表项，UI 不用改。
- 模型列表可在设置中「从 /models 刷新」（v1.1），v1 用内置列表兜底。

### 4.4 IPC 契约（草案）

```ts
ai:bootstrap() -> { hasKey, provider, defaultModel, models, panel: {open,width} }
ai:send({ sessionId?, requestId, model, input: { messages, context? }, options? }) -> { ok }
ai:cancel({ requestId }) -> { ok }
ai:event(payload)   // 主 → 渲染推送：
  { requestId, type: 'started' | 'text_delta' | 'reasoning_delta' | 'completed' | 'incomplete' | 'failed' | 'usage',
    delta?, usage?, error?: { code, message, retryable } }
ai:sessions:list() / ai:sessions:get(id) / ai:sessions:save(session) / ai:sessions:delete(id)
ai:settings:get() -> { provider, model, hasKey, maskedKey }
ai:settings:setKey(key) / ai:settings:clearKey() / ai:settings:setModel(id)
ai:testConnection() -> { ok, latencyMs, models? , error? }
```

- `requestId` 由渲染层生成（uuid），用于事件匹配与取消；主进程并发限制 1 个活跃生成（v1）。
- 事件全部走 `webContents.send('ai:event', payload)`；会话数据由主进程写盘，渲染层只保留内存态。

### 4.5 DeepSeek Responses API 对接（v1 唯一协议）

- 端点：`POST https://api.deepseek.com/responses`，`Authorization: Bearer <key>`，`Content-Type: application/json`。
- **无状态**：服务端不保存对话；每轮发送完整历史（`input` 数组）+ `instructions`（系统提示词）。上下文缓存由服务端自动处理。
- 请求示例：

```json
{
  "model": "deepseek-flash",
  "instructions": "你是 MoDex 的写作助手……",
  "input": [
    { "role": "user", "content": "总结当前文档" },
    { "role": "assistant", "content": "……" },
    { "role": "user", "content": "再精简一点" }
  ],
  "stream": true,
  "max_output_tokens": 2048,
  "reasoning": { "effort": "medium" }
}
```

- 流式事件映射（SSE `event:` + `data:` JSON，无 `[DONE]`）：

| DeepSeek 事件 | 面板处理 |
| --- | --- |
| `response.created` | 标记 started，记录 response.id |
| `response.output_text.delta` | 追加正文增量 |
| `response.reasoning_text.delta` | 追加思考增量（折叠区） |
| `response.output_item.done` | 工具调用/消息项完成（v1 忽略 function_call） |
| `response.completed` | 完成，读取 `usage`（input/output tokens） |
| `response.incomplete` | 提示「回答被截断（达到 max_output_tokens）」 |
| `response.failed` | 错误卡片，取 response.error |

- 错误归一化：400 参数错误 / 401 密钥无效 / 402 余额不足 / 422 参数不合法 / 429 限流 / 500 服务异常 / 503 过载 / 网络超时与离线；UI 文案与重试按钮由 `error.retryable` 决定。
- v1 不做工具调用、联网、图片；但注册表已为 `deepseek-v4-pro` 标注 `tools` / `web_search`，后续打开相应 UI 即可。
- 模型清单以官方文档为准（当前 `deepseek-flash` 与 `deepseek-v4-pro`），配置化避免名字变更导致硬编码失效。

### 4.6 会话与数据模型

```json
// userData/ai/sessions.json（schema v1）
{
  "version": 1,
  "sessions": [{
    "id": "s_01J...",
    "title": "总结示例文档",
    "model": "deepseek-flash",
    "createdAt": "2026-10-26T14:50:00.000Z",
    "updatedAt": "2026-10-26T14:52:10.000Z",
    "messages": [{
      "id": "m_01", "role": "user", "content": "总结当前文档",
      "createdAt": "…", "status": "done"
    }, {
      "id": "m_02", "role": "assistant", "content": "……",
      "reasoning": "……", "usage": { "input": 1200, "output": 356 },
      "createdAt": "…", "status": "done"
    }]
  }]
}
```

- 上限：200 个会话、单会话 200 条消息、单文档上下文 20k 字符（超出截断并提示）；原子写沿用 `fs-service` 的模式。
- 位置：`app.getPath('userData')/ai/`，不进工作区文档；用户可清空历史。

### 4.7 安全与隐私

- API Key：`safeStorage.encryptString()`（Windows DPAPI）后写入 `ai/credentials.bin`；渲染层只能拿到 `hasKey`/`maskedKey`；删除即清空文件；日志/错误消息对 Key 做脱敏。
- 网络只发生在主进程；渲染层 CSP 不变（无外连）。
- 发送文档上下文前有显式开关（默认关？见开放问题），chip 可见；只发送当前活动文档，不扫描文件夹。
- 不上传文件、不收集遥测；Markdown 渲染继续禁用原始 HTML，避免 AI 输出造成 XSS。
- 打包产物不包含任何 Key；`.gitignore` 保持 `artifacts/`、`release/` 不进仓库。

### 4.8 上下文与提示词

- 默认系统提示词（可在设置中折叠编辑，v1 只读或高级项）：`你是 MoDex 的写作助手，帮助用户撰写、润色、总结与结构化 Markdown 文档；回答简洁、直接、可操作；输出 Markdown。`
- 当前文档上下文以如下形式附加（仅当开关打开）：

```text
<当前文档 name="示例.md">
...内容（最多 20k 字符，超出截断）...
</当前文档>
```

- 选中文本：作为一条 user 消息的引用块附加在问题前；发送后 chip 自动清除。
- Token 预算：请求前估算（字符数/1.8），超限先截断并提示；响应后记录 usage。

### 4.9 测试策略

- 单测：SSE 解析（分片/多事件/异常 JSON/未知事件）、历史序列化、错误映射、会话 store、Key 加密读写（mock safeStorage）。
- 集成：e2e 启动时通过 CLI/env 注入 `--ai-base-url=http://127.0.0.1:<port>`，本地 Node HTTP 服务返回固定的 Responses SSE 流水；验证流式增量、停止、失败、401/429、取消、历史持久化。**CI/验收不依赖真实 Key**。
- 手工验收：真实 DeepSeek Key 冒烟（仅本地）、深浅主题、900×600、面板拖拽/收起、重启恢复、长回答滚动。
- 回归：现有 124 项 e2e 保持全绿；新增断言单独编号。

## 5. 里程碑与工作量（估算）

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| M1 | 本方案 + 示意图确认（当前） | — |
| M2 | 主进程 AI 基础：注册表、Responses 客户端、SSE、Key 存储、会话 store、mock 测试 | 1.5–2 天 |
| M3 | 面板 UI：布局/消息流/输入/模型选择/历史/错误态/深浅主题/快捷键 | 2–2.5 天 |
| M4 | 设置弹窗 + 测试连接 + 上下文接入（当前文档/选区） | 0.5–1 天 |
| M5 | e2e/单测/QA/打包/文档 | 1–1.5 天 |

> 由 `renderer-dev` 负责渲染层，Lead 负责主进程/协议/e2e，QA 独立验收（沿用现有协作方式）。

## 6. 风险

1. **API 密钥缺失/错误**是首版最常见失败点：设置引导要清楚（401 单独文案 + 打开设置按钮）。
2. Responses API 的 SSE 事件为语义事件，需完整解析 `event:` 行并容错未知事件；上游变更时只用适配器层修改。
3. 网络（代理/防火墙）与超时：主进程用 Electron `net.fetch`（跟随系统代理），设置超时（首字节 30s、空闲 60s），超时归为可重试错误。
4. 长文档上下文导致 400/费用：默认发送前截断到 20k 字符并提示；无静默超发。
5. 窄窗口三列挤压：<1180 走覆盖抽屉；最小 900×600 已纳入 e2e。
6. 模型/接口演进：模型不硬编码于 UI，统一走注册表。

## 7. 开放问题（需要你确认）

1. **API Key 配置方式**：设置弹窗里直接粘贴 Key（推荐，v1）／支持环境变量 `DEEPSEEK_API_KEY` 兜底／两者都要？
2. **默认模型**：`deepseek-flash`（快、便宜，推荐默认）＋ `deepseek-v4-pro` 可选，是否同意？
3. **当前文档上下文默认开还是关**：默认开（方便但会发送文档内容）／默认关（每次手动勾选，更隐私）？
4. **面板入口**：工具栏右侧加一个 AI 图标按钮（推荐）＋ `Ctrl+Shift+A` ＋视图菜单，是否可接受？
5. **AI 回答的「插入到文档」**：v1 只做复制，还是同时做「插入到光标处 / 替换选中」（推荐 v1.1）？
6. 会话历史：v1 保留最近 200 个本地会话是否足够？是否需要「导出为 Markdown」？
7. **面板形态**：默认采用示意图的 **A 全高右栏（推荐）**；窄窗口自动切换 B 浮层抽屉。是否还需要 C 底部 Sheet？

## 8. 前端示意图

- [浅色 · 面板展开（欢迎态）](mockups/ai-panel-light.png)
- [深色 · 流式对话中](mockups/ai-panel-dark.png)
- [API Key 设置弹窗](mockups/ai-settings.png)
- [收起的侧边条](mockups/ai-panel-collapsed.png)（如提供）

> 示意图为静态设计稿，用于确认布局、信息层级与气质；确认后再进入实现。
