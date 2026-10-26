# MoDex AI 对话面板 v1 · 实现契约

> 本文件是 **实现阶段唯一接口依据**（用户已确认按 `docs/AI-PANEL-PROPOSAL.md` 的建议实施）。
> 约定：主进程/安全/协议由 Lead 实现；渲染层 UI 由 `renderer-dev` 实现；QA 独立验收。
> 写作用域：Lead → `src/main/**`、`src/preload/preload.js`、`scripts/smoke.mjs`、`tests/**`、docs；
> `renderer-dev` → `src/renderer/**`；双方都不要动对方目录。

## 1. v1 决策（已确认）

1. API Key：设置弹窗粘贴，`safeStorage` 加密存本机；不读环境变量（v1）。
2. 模型：`deepseek-flash`（默认）/ `deepseek-v4-pro`，注册表驱动。
3. 文档上下文：**默认关**；面板里有可见开关；3 个快捷提问中「总结当前文档 / 生成文档大纲」自动附带当前文档，「润色选中内容」自动附带选区。
4. 入口：工具栏右侧 AI 图标（`data-ai-toggle`，**不算 data-action**）、`Ctrl+Shift+A`、视图菜单「AI 写作助手」。
5. 插入到文档：v1 只做复制；「插入到光标」按钮暂不出现（留 v1.1）。
6. 历史：最近 200 个本地会话；不做导出。
7. 形态：A 全高右栏（窗口 ≥ 1180px）；< 1180px 自动覆盖预览区的抽屉；收起为 40px 侧条（rail）。

## 2. Settings 新增字段（state-store.js）

```js
aiPanelMode: 'closed' | 'open' | 'rail'   // 默认 'closed'
aiPanelWidth: number                       // 默认 360，clamp 320..560
aiModel: 'deepseek-flash' | 'deepseek-v4-pro'  // 默认 'deepseek-flash'
aiIncludeContext: boolean                  // 默认 false（文档上下文开关）
```

- 清洗规则：非法值回落默认；`aiPanelWidth` clamp。
- `state-store.js` 导出 `AI_MODELS` 常量（与 provider 注册表一致，供测试与渲染层默认值参考）。
- 渲染层 `DEFAULT_SETTINGS` 同步这 4 个字段（由 `renderer-dev` 改）。

## 3. 主进程 AI 层

### 3.1 文件

```
src/main/ai/sse.js              # SSE 解析（纯函数，可单测）
src/main/ai/responses-client.js # 构造 Responses 请求 / 归一化事件 / 归一化错误（纯函数 + fetch 执行）
src/main/ai/provider-registry.js# DeepSeek 注册表（models/capabilities/prompt）
src/main/ai/credentials.js      # safeStorage 加解密（可注入 crypto 便于单测）
src/main/ai/ai-store.js         # 会话持久化（原子写、上限）
src/main/ai/ai-service.js       # IPC 注册、请求生命周期、事件推送、取消
```

### 3.2 Provider 注册表

```js
PROVIDER = {
  id: 'deepseek',
  name: 'DeepSeek',
  protocol: 'responses',
  baseUrl: 'https://api.deepseek.com',   // cli --ai-base-url 或 env MODEX_AI_BASE_URL 可覆盖（仅测试/开发）
  auth: 'bearer',
  models: [
    { id: 'deepseek-flash',  label: 'DeepSeek Flash',  description: '快速、通用', capabilities: ['reasoning','vision'] },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: '更强推理，支持工具/联网（后续开放）', capabilities: ['reasoning','tools','web_search'] },
  ],
  defaultModel: 'deepseek-flash',
}
SYSTEM_INSTRUCTIONS = '你是 MoDex 的写作助手，帮助用户撰写、润色、总结与结构化 Markdown 文档；回答简洁、直接、可操作；输出 Markdown。'
CONTEXT_LIMIT = 20000   // 当前文档上下文字符上限（超出截断并在 UI 提示）
```

### 3.3 Responses API 请求

```
POST {baseUrl}/responses
Authorization: Bearer <key>
Content-Type: application/json

{
  model,
  instructions: SYSTEM_INSTRUCTIONS (+ 文档上下文块),
  input: messages.map(({ role, content }) => ({ role, content })),   // 完整历史，stateless
  stream: true,
  max_output_tokens: 2048
}
```

- 文档上下文追加在 instructions 末尾：

```
<当前文档 name="示例.md">
...最多 20000 字符...
</当前文档>
```

- 请求丢弃 `reasoning` 字段（v1 不展示/不设置 effort，保留后续扩展）。

### 3.4 SSE 解析与事件归一化

- 解析 `text/event-stream`：按行处理 `event: <type>`、`data: <json>`，空行派发；`data:` 多行用 `\n` 拼接；`:` 注释忽略；兼容 `\r\n`；流结束 flush；坏 JSON 忽略该事件并继续。
- 归一化事件（主 → 渲染）：

| 上游事件 | 归一化 type | 字段 |
| --- | --- | --- |
| `response.output_text.delta` | `text_delta` | `delta` |
| `response.reasoning_text.delta` | `reasoning_delta` | `delta` |
| `response.completed` | `completed` | `usage:{input,output,total}`、`durationMs` |
| `response.incomplete` | `incomplete` | `usage`、`reason`（`incomplete_details.reason`） |
| `response.failed` | `failed` | `error:{code,message,retryable,status}` |
| `response.created` / 其它 | 忽略（首个事件只用于标记 started） |

- 另发送：`started`（请求真正开始）、`cancelled`（用户取消）、`failed`（HTTP/网络/超时）。
- 事件 payload 统一：`{ requestId, type, ... }`；`usage` 缺失时按 0 处理。

### 3.5 错误归一化（code / message / retryable）

| 场景 | code | message（UI 直接展示） | retryable |
| --- | --- | --- | --- |
| 未配置 Key | `NO_KEY` | 请先在 AI 设置中配置 API Key | false |
| HTTP 400/422 | `INVALID_REQUEST` | 请求参数有误，请重试或更换模型 | false |
| HTTP 401 | `AUTH` | API Key 无效，请在 AI 设置中更新 | false |
| HTTP 402 | `BALANCE` | 账户余额不足，请前往 DeepSeek 充值 | false |
| HTTP 429 | `RATE_LIMIT` | 请求过于频繁，请稍后重试 | true |
| HTTP 500/503 | `SERVER` | 服务暂时不可用，请稍后重试 | true |
| 网络失败 | `NETWORK` | 网络连接失败，请检查网络或代理 | true |
| 超时（首字节 30s / 静默 60s） | `TIMEOUT` | 请求超时，请重试 | true |
| 已有一个生成中 | `BUSY` | 正在生成上一条回答，请先停止 | false |
| 其他 | `UNKNOWN` | 请求失败，请重试 | true |

### 3.6 会话存储（ai-store.js）

- 位置：`app.getPath('userData')/ai/sessions.json`，原子写（写临时文件 + rename）。
- schema：

```json
{
  "version": 1,
  "sessions": [{
    "id": "s_<uuid>",
    "title": "总结示例文档",
    "model": "deepseek-flash",
    "createdAt": 1761470000000,
    "updatedAt": 1761470060000,
    "messages": [{
      "id": "m_<uuid>", "role": "user|assistant", "content": "…",
      "reasoning": "…", "status": "done|error|cancelled",
      "usage": { "input": 1200, "output": 356, "total": 1556 },
      "error": { "code": "RATE_LIMIT", "message": "…" },
      "createdAt": 1761470000000
    }]
  }]
}
```

- 限制：最多 200 个会话（按 `updatedAt` 淘汰最旧）；单会话最多 200 条消息；单条内容最多 200000 字符（截断）；`id` 必须匹配 `^[A-Za-z0-9_-]{1,64}$`，title ≤ 120 字符。
- 排序：`list()` 返回摘要（id/title/model/messageCount/updatedAt），按 updatedAt 倒序。

### 3.7 API Key 存储（credentials.js）

- 文件：`userData/ai/api-key.bin`，内容 `{"version":1,"ciphertext":"<base64>"}`；`safeStorage.encryptString/decryptString`。
- `setKey(raw)`：trim、长度 8–512，写文件，返回 `{hasKey:true, maskedKey}`；`getKey()` 仅主进程内部使用；`clear()` 删除文件。
- `maskedKey`：`••••••••` + 明文 Key 后 4 位（如 `••••••••abcd`）；解密失败按未配置处理并清除。
- `hasKey()` 不返回明文；日志绝不打印 Key。

### 3.8 IPC 契约（主进程实现，preload 透传）

渲染 → 主（`ipcMain.handle`，全部走 `isTrustedSender` 校验）：

| channel | 入参 | 返回 |
| --- | --- | --- |
| `ai:bootstrap` | — | `{ ok, provider:{id,name}, models:[{id,label,description,capabilities}], defaultModel, settings:{model,panelMode,panelWidth,includeContext}, hasKey, maskedKey }` |
| `ai:send` | `{ requestId, model, messages:[{role,content}] }` | `{ ok:true }` 或 `{ ok:false, error }`；开始后事件流推送 |
| `ai:cancel` | `{ requestId }` | `{ ok:true, cancelled:boolean }` |
| `ai:set-key` | `{ key }` | `{ ok:true, hasKey:true, maskedKey }` 或 `{ ok:false, error }` |
| `ai:clear-key` | — | `{ ok:true, hasKey:false }` |
| `ai:test-connection` | — | `{ ok:true, latencyMs }` 或 `{ ok:false, error }`（GET `{baseUrl}/models`，5s 超时） |
| `ai:sessions:list` | — | `{ ok:true, sessions:[{id,title,model,messageCount,updatedAt}] }` |
| `ai:sessions:get` | `{ id }` | `{ ok:true, session }` 或 `{ ok:false, error }` |
| `ai:sessions:save` | `{ session }` | `{ ok:true }` |
| `ai:sessions:delete` | `{ id }` | `{ ok:true }` |

主 → 渲染（`webContents.send('ai:event', payload)`）：

```ts
{ requestId, type:'started' }
{ requestId, type:'text_delta', delta:string }
{ requestId, type:'reasoning_delta', delta:string }
{ requestId, type:'completed', usage:{input,output,total}, durationMs:number }
{ requestId, type:'incomplete', usage, reason:string }
{ requestId, type:'cancelled' }
{ requestId, type:'failed', error:{code,message,retryable,status?} }
```

- `ai:send` 校验：`requestId` 字符串、`model` 在注册表内、`messages` 数组 1–200 条且每条 role ∈ user/assistant/system?（v1 只接受 user/assistant，system 由主进程加）、content 字符串、总字符 ≤ 400000；无 Key 直接返回 `NO_KEY`。
- 并发：同一时刻只允许 1 个活跃请求，其余返回 `BUSY`。
- 窗口关闭 / 应用退出：取消活跃请求，丢弃事件。
- 超时与取消使用 `AbortController`；取消 → `cancelled` 事件，不视为错误。
- CLI：新增 `--ai-base-url=<url>`（测试/开发覆盖，默认官方地址）；支持 `MODEX_AI_BASE_URL` 环境变量（优先级低于 CLI）。`scripts/smoke.mjs` 用它指向本地 mock server。

### 3.9 preload 增量

```js
ai: {
  bootstrap: () => invoke('ai:bootstrap'),
  send: (payload) => invoke('ai:send', payload),
  cancel: (requestId) => invoke('ai:cancel', { requestId }),
  setKey: (key) => invoke('ai:set-key', { key }),
  clearKey: () => invoke('ai:clear-key'),
  testConnection: () => invoke('ai:test-connection'),
  listSessions: () => invoke('ai:sessions:list'),
  getSession: (id) => invoke('ai:sessions:get', { id }),
  saveSession: (session) => invoke('ai:sessions:save', { session }),
  deleteSession: (id) => invoke('ai:sessions:delete', { id }),
  onEvent: (cb) => subscribe('ai:event', cb),
}
```

## 4. 渲染层 UI 契约（renderer-dev 实现）

### 4.1 DOM 必须存在的 id / data 属性（e2e 依赖，不可改名）

```
#ai-toggle                 工具栏右侧 AI 图标按钮；data-ai-toggle（不能是 data-action）
#ai-panel                  <aside>：data-mode="open|rail"；隐藏用 hidden 属性
#ai-resizer                面板左缘 6px 拖拽条（rail 模式下隐藏）
#ai-header                 面板 header（40px）
#ai-title                  文本：AI 写作助手
#ai-model-button           模型 pill（当前模型 label）
#ai-model-menu              模型弹出层（ul，hidden）；li[data-model-id="deepseek-flash|deepseek-v4-pro"]，当前项 data-checked="true"
#ai-new-chat               新对话
#ai-history                历史按钮
#ai-history-popover        历史弹出层（hidden）；li[data-session-id]，含删除按钮 [data-session-delete]
#ai-settings-open          设置齿轮
#ai-collapse               收起为 rail
#ai-expand                  rail 模式下展开按钮（位于 rail 内）
#ai-rail                   rail 模式的 40px 容器（data-mode="rail" 时可见）
#ai-context-toggle         上下文开关按钮；data-checked="true|false"
#ai-context-label          上下文 chip 文本（如「当前文档 · 示例.md」/「未打开文档」）
#ai-messages               消息滚动容器
#ai-welcome                欢迎空态（无消息时显示）
  [data-quick-prompt="summary|outline|polish"]  3 个快捷提问按钮
#ai-session-list-mini       欢迎态「最近对话」列表（可选，无历史时隐藏）
#ai-composer               textarea
#ai-send                   发送按钮
#ai-stop                   停止按钮（生成中显示，否则 hidden）
#ai-hint                   输入提示（Enter 发送 · Shift+Enter 换行 / 生成中 · 可随时停止）
#ai-settings                设置弹窗容器（hidden）
  #ai-key-input             password 输入
  #ai-key-save              保存并验证
  #ai-key-clear             清除密钥（无 Key 时 hidden）
  #ai-model-select          <select>（deepseek-flash / deepseek-v4-pro）
  #ai-test-connection      测试连接
  #ai-connection-status    状态行文本（未测试/测试中/成功 xx ms/失败原因）
  #ai-settings-close       关闭
  #ai-settings-status      （可选）保存反馈

消息节点：article.ai-msg[data-role="user|assistant"][data-status="streaming|done|error|cancelled"]
  内部：.ai-msg-body（Markdown 渲染容器，assistant 用 renderMarkdown；user 用纯文本）
        .ai-msg-usage（11px，完成/失败后显示：tokens、耗时或错误）
        [data-reasoning]（可选 details/summary，思考内容）
        button[data-copy]（复制整条回答）
        pre code 旁的复制按钮由渲染层注入
```

### 4.2 行为

- 打开/收起：`#ai-toggle` 在 closed ↔ open 间切换；open 时为 `#app` 增加 `data-ai-panel="open"`（CSS 布局用；`#ai-panel[hidden]` 控制可见）。rail 模式点击 `#ai-expand` → open。
- 布局：≥1180px 面板作为 `#main` 右侧同排（`#app` 右列 6px + width）；<1180px 面板 `position:absolute; top:40px; right:0; bottom:24px;` 覆盖预览区，宽 `min(400px, 100vw - 260px)`，此时隐藏 `#ai-resizer`，`#app` 设 `data-ai-overlay="true"`；无遮罩。
- 拖拽：`makeDragResizer` 复用（反向：拖动改变 `aiPanelWidth`），clamp 320–560，结束时 `api.saveSettings({ aiPanelWidth })`（防抖 300ms 即可）。
- 快捷键：`Ctrl+Shift+A` 切换 open/closed（在现有 `onGlobalKeydown` 加分支；不覆盖已有快捷键）。
- `Esc`（面板内）：优先关闭模型菜单/历史弹层 → 生成中则取消 → 否则收起面板（open → closed）。escape 不得影响编辑器原有行为。
- 模型菜单：显示两个模型 + 「AI 设置…」项；选择后更新 `api.saveSettings({ aiModel })` 与 session.model。
- 设置弹窗：打开时 `#ai-key-input` 置空、placeholder 显示 maskedKey；保存并验证 → `api.ai.setKey` → `api.ai.testConnection()` → 成功 toast「AI 已就绪」并关闭；失败保留弹窗显示 `#ai-connection-status`。清除密钥需二次确认（复用 `api.confirmDelete` 或自定义确认）。
- 上下文：`#ai-context-toggle` 读写 `settings.aiIncludeContext`；无打开文档时禁用并显示「未打开文档」；当前文档名与字数从渲染层文档状态取。
- 快捷提问：点击后自动组装消息并发送（summary/outline 强制附带当前文档；polish 用选区，无选区禁用）。发送时若 `aiIncludeContext` 为真或快捷提问强制，则把 `{fileName, content}` 合并到 `ai:send` 的 messages 最后一条前？**契约**：文档上下文由渲染层放在 `messages` 之外的新字段 `context`：

```ts
ai:send({ requestId, model, messages, context?: { fileName, content } })
```

主进程把 context 转为 instructions 里的 `<当前文档>` 块并截断 20k 字符。（§3.3 已按此实现；`ai:send` 校验允许 `context` 可选。）
- 发送流程：无 Key → toast + 打开设置，不发送；发送后清空输入、禁用发送、显示 stop；收到 `started` 后创建 assistant 占位消息；`text_delta` 追加渲染（节流 30–60ms）、`reasoning_delta` 追加折叠区；`completed` 写 usage 行、恢复输入；`failed` 显示错误卡片（带重试按钮，重试用相同 messages）；`cancelled` 标记「已停止」。
- 会话：首次发送自动创建会话（title 取首条用户消息前 24 字）；每轮结束（completed/failed/cancelled）调用 `api.ai.saveSession(session)`；新对话先取消生成再清空；历史弹层恢复会话（把 messages 渲染出来）；删除会话调 `api.ai.deleteSession` 并刷新。
- 渲染安全：assistant 内容走 `renderMarkdown`（已禁原始 HTML）；user 内容用 `textContent`，绝不 innerHTML。
- 错误文案取自主进程 `error.message`；401/402 的卡片提供「打开 AI 设置」按钮。
- 主题：完全跟随 `data-theme`；AI 消息正文使用独立 `.ai-markdown` 样式（不复用 `.markdown-body`，避免受预览样式影响），基础排版与 Codex 预览近似（13px/1.7，标题/列表/引用/代码块）。
- 无障碍：按钮带 aria-label；面板 `role="complementary"`、消息区 `aria-live="polite"`；焦点进入面板时 `#ai-composer` 自动聚焦。

### 4.3 不新增的 UI

- 不改工具栏其它按钮/布局；不新增 data-action；不改现有菜单分组顺序（视图菜单新增一项「AI 写作助手」放在「预览样式」后、全屏前）。
- 不改 `#app` 现有 grid 子元素顺序与 id；AI 面板与 resizer 作为 `#main` 后的新网格项追加。

## 5. 测试契约

### 5.1 Mock 服务（scripts/smoke.mjs 启动，`http://127.0.0.1:<port>`）

启动参数：`--ai-base-url=http://127.0.0.1:<port>`（开发模式与打包模式都传）。

接口：

- `GET /models`：200 JSON `{ object:'list', data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}] }`；无/错 Key → 401。
- `POST /responses`：需 `Authorization: Bearer <任意非空>`，否则 401 JSON `{error:{message:'Invalid API key',type:'authentication_error'}}`。
  - 读取 JSON body；取最后一条 user message 内容判断剧本：
    - 含 `触发限流` → HTTP 429 JSON `{error:{message:'Rate limit reached'}}`
    - 含 `触发错误` → HTTP 500 JSON `{error:{message:'Internal error'}}`
    - 含 `慢速` → SSE，每 200ms 一个 delta，共 100 个（足够点停止）
    - 默认 → SSE：`response.created` → 8–12 个 `response.output_text.delta`（文本含「Mock AI 回答」与代码块示例；若 body.instructions 含 `<当前文档`，文本末尾加「已参考当前文档」；并把请求 model 回显一行）→ `response.completed`（usage 输入/输出 + total）
  - 响应头 `content-type: text/event-stream; charset=utf-8`，`cache-control: no-cache`；每个事件按 `event: <type>\ndata: <json>\n\n` 写出并 flush（`res.write` + 20ms 间隔）。
- 记录请求数/最近请求体，供 e2e 断言（e2e 在 main 进程无法直接读 smoke 父进程；若需要断言，mock 把最近请求体放在 `GET /__last-request` 返回 JSON；e2e 通过 `http` 请求读取）。

### 5.2 e2e 新增断言（`src/main/e2e.js`，编号续 21 截图后）

1. e2e 启动带 mock base URL + 初始 settings 隔离；`window.api.ai.bootstrap()` 返回 provider=deepseek、2 个模型、默认 deepseek-flash、hasKey=false。
2. 点击 `#ai-toggle` → `#ai-panel` 可见、`data-mode="open"`；再点 → 隐藏。
3. `#ai-settings-open` 打开设置；输入 `test-key-123` → `#ai-key-save`；等待 hasKey/maskedKey（`••••••••` 或 `…123`）；`#ai-connection-status` 显示成功。
4. 输入「你好」发送 → assistant 流式出现，最终包含「Mock AI 回答」；`#ai-hint` 恢复；消息带 usage 行。
5. 打开上下文开关，发送「总结当前文档」→ mock 返回文本含「已参考当前文档」；关闭上下文。
6. 模型切换 deepseek-v4-pro → 发送「测试模型」→ 回复含模型名回显（mock 回显 model）。
7. 发送「慢速」→ 出现 `#ai-stop` → 点击 → 消息标记已停止/cancelled，按钮恢复。
8. 发送「触发限流」→ 错误卡片文案含「请求过于频繁」，重试按钮存在。
9. 历史：新对话后打开 `#ai-history` → 列表含刚才会话；点击恢复 → 消息可见。
10. 设置持久化：`api.saveSettings({})` 返回 aiModel/aiPanelMode/aiPanelWidth/aiIncludeContext。
11. 900×600：面板打开时 `#app[data-ai-overlay="true"]`、无横向溢出；恢复窗口。
12. 截图：`22-ai-panel-light`（浅色面板 + 消息）、`23-ai-panel-dark`（深色流式/完成态）、`24-ai-settings`（设置弹窗）。
13. 原有 124 项断言保持全绿；无未捕获 JS 错误。

### 5.3 单测（Lead，`tests/`）

- `ai-sse.test.mjs`：分片/多行 data/注释/CRLF/坏 JSON/连续事件/EOF flush。
- `ai-responses.test.mjs`：buildRequest（instructions 上下文块、20k 截断、messages 序列化）、normalizeEvent（6 类事件+未知）、normalizeError（9 种场景）。
- `ai-store.test.mjs`：保存/读取/删除、排序、上限淘汰、非法 id 拒绝、原子写。
- `ai-credentials.test.mjs`：注入 stub crypto，set/get/clear/mask/损坏文件处理。
- `state-store.test.mjs`：新增 4 字段清洗与默认值。

## 6. 工作拆分

| 负责人 | 范围 |
| --- | --- |
| Lead | `src/main/ai/**`、`src/main/main.js`（CLI/IPC/关闭清理）、`src/main/state-store.js`、`src/preload/preload.js`、`src/main/e2e.js`、`scripts/smoke.mjs`、`tests/**`、`README/docs` |
| renderer-dev | `src/renderer/index.html`、`styles.css`、`js/ai-panel.js`（新）、`js/app.js`（仅新增 AI 面板初始化/快捷键/菜单项/上下文访问）、`js/icons.js`（AI 图标） |
| QA | 独立复验、`docs/QA-REPORT.md` §17、打包 exe 验收 |

## 7. 完成标准

- 上述 e2e 断言 + 单测全绿；`npm run smoke` 两阶段通过；打包 exe smoke 通过。
- 无 Key、401、429、取消、长回答、900×600、深浅主题手工检查通过。
- 默认关闭 AI 面板时，应用与当前版本视觉/行为一致（原 124 项断言无回归）。
- API Key 不出现在渲染层 / 日志 / 仓库；`git status` 无泄露文件。
