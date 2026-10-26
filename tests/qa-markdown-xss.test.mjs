/**
 * QA 回归用例：Markdown 渲染安全（XSS）与渲染层纯函数（新增文件，不改动既有测试）。
 * 直接导入 src/renderer/js/markdown.js（真实 markdown-it 配置：html:false + 任务列表 + 标题 id）
 * 与 util.js 纯函数，在 Node 中执行（markdown.js 仅在 getMarkdownIt 内读取 window.markdownit）。
 * 运行：node --test tests/qa-markdown-xss.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const markdownitFactory = require('markdown-it')
globalThis.window = { markdownit: markdownitFactory }

const { renderMarkdown, slugify } = await import('../src/renderer/js/markdown.js')
const util = await import('../src/renderer/js/util.js')
const fsService = require('../src/main/fs-service.js')

const FORBIDDEN_TAGS = /<(script|img|svg|iframe|object|embed|a\s+href|video|audio|link|meta|style)\b/i

test('原始 HTML 一律被转义，不注入 DOM 元素', () => {
  const payloads = [
    '<img src=x onerror="window.__xss=1">',
    '<script>window.__xss=2</script>',
    '<svg onload="window.__xss=3"></svg>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:window.__xss=4">x</a>',
    '<object data="javascript:alert(1)"></object>',
    '<style>body{display:none}</style>',
    '<video src=x onerror=alert(1)>',
  ]
  for (const payload of payloads) {
    const html = renderMarkdown(payload)
    assert.equal(FORBIDDEN_TAGS.test(html), false, `不应注入原始标签：${payload}\n${html}`)
    assert.equal(/<[^>]*\sonerror\s*=/i.test(html), false, `不应出现 raw onerror 属性：${payload}`)
    assert.ok(html.includes('&lt;'), `应转义为文本：${payload}\n${html}`)
  }
})

test('危险协议的链接/图片不会生成可点击 href 或 img src', () => {
  const payloads = [
    '[x](javascript:alert(1))',
    '![x](javascript:alert(1))',
    '[x](vbscript:msgbox(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '![x](data:image/svg+xml,<svg onload=alert(1)>)',
    '[x](JaVaScRiPt:alert(1))',
  ]
  for (const payload of payloads) {
    const html = renderMarkdown(payload)
    assert.equal(/href\s*=\s*["']?\s*(javascript|vbscript|data):/i.test(html), false, `不应生成危险 href：${payload}\n${html}`)
    assert.equal(/<img[^>]+src\s*=\s*["']?\s*(javascript|vbscript):/i.test(html), false, `不应生成危险 img src：${payload}\n${html}`)
  }
})

test('安全链接正常保留（https / 相对路径 / 锚点 / linkify）', () => {
  assert.match(renderMarkdown('[e](https://example.com)'), /href="https:\/\/example\.com"/)
  assert.match(renderMarkdown('[rel](other.md)'), /href="other\.md"/)
  assert.match(renderMarkdown('[锚](#标题)'), /href="#%E6%A0%87%E9%A2%98"|href="#标题"/)
  assert.match(renderMarkdown('访问 https://example.com 看看'), /href="https:\/\/example\.com"/)
})

test('任务列表渲染为 disabled checkbox，并带 task-list 样式类', () => {
  const html = renderMarkdown('- [ ] 未完成\n- [x] 已完成\n- [X] 大写\n')
  const checkboxCount = (html.match(/type="checkbox"/g) || []).length
  assert.equal(checkboxCount, 3)
  assert.equal((html.match(/disabled/g) || []).length, 3)
  assert.match(html, /contains-task-list/)
  assert.match(html, /task-list-item/)
  assert.match(html, /checked/)
  // 输入中的 [ ] 文本不应残留
  assert.equal(html.includes('[ ]'), false)
})

test('标题 slug id：中文保留、特殊字符剔除、重复追加序号', () => {
  assert.equal(slugify('中文 标题'), '中文-标题')
  assert.equal(slugify('Hello, World!'), 'hello-world')
  assert.equal(slugify('!!!'), 'section')
  const html = renderMarkdown('# 标题 A\n\n## 标题 A\n')
  assert.match(html, /id="标题-a"/)
  assert.match(html, /id="标题-a-2"/)
})

test('代码围栏：data-lang 语言标签、代码内容转义、info string 注入被转义', () => {
  const safe = renderMarkdown('```js\nconst a = "<script>alert(1)</script>"\n```\n')
  assert.match(safe, /<pre class="code-block" data-lang="js">/)
  assert.equal(safe.includes('<script>alert(1)</script>'), false)
  assert.match(safe, /&lt;script&gt;/)

  const injection = renderMarkdown('```js"><img src=x onerror=alert(1)>\nbody\n```\n')
  assert.equal(/<img[^>]*onerror/i.test(injection), false, injection)
  assert.equal(/data-lang="[^"]*"/.test(injection), true)
  assert.equal(/<img/i.test(injection), false)
})

test('渲染器 validateName 与主进程 fs-service.validateName 结论一致（契约一致性）', () => {
  const names = [
    'a.md',
    '笔记.md',
    'my note.md',
    '.hidden.md',
    'a.b.c.md',
    'CON',
    'con.md',
    'NUL',
    'COM1.md',
    'LPT9',
    'a:b',
    'a/b',
    'a\\b',
    'a?b',
    'a*b',
    'a"b',
    'a<b',
    'a>b',
    'a|b',
    'name.',
    'name ',
    '.',
    '..',
    '',
    '   ',
    `${'x'.repeat(200)}.md`,
    `${'x'.repeat(196)}.md`,
    '  spaced.md  ',
  ]
  for (const name of names) {
    const renderer = util.validateName(name)
    const main = fsService.validateName(name)
    assert.equal(renderer.ok, main.ok, `名称 ${JSON.stringify(name)} 渲染层/主进程结论不一致`)
  }
  // markdownOnly 与主进程 requireMarkdown 等价
  for (const name of ['note.txt', 'note', 'note.md', 'note.MD', 'CON.md']) {
    const renderer = util.validateName(name, { markdownOnly: true })
    const main = fsService.validateName(name, { requireMarkdown: true })
    assert.equal(renderer.ok, main.ok, `markdownOnly 名称 ${JSON.stringify(name)} 结论不一致`)
  }
})

test('resolveMarkdownName：缺省补 .md，显式其它扩展名报错', () => {
  assert.deepEqual(
    { ok: util.resolveMarkdownName('笔记').ok, name: util.resolveMarkdownName('笔记').name },
    { ok: true, name: '笔记.md' }
  )
  assert.equal(util.resolveMarkdownName('笔记.md').name, '笔记.md')
  assert.equal(util.resolveMarkdownName('笔记.markdown').name, '笔记.markdown')
  assert.equal(util.resolveMarkdownName('笔记.txt').ok, false)
  assert.equal(util.resolveMarkdownName('CON').ok, false)
  assert.equal(util.resolveMarkdownName('').ok, false)
})

test('util 纯函数：escapeHtml / 路径工具 / 字数统计', () => {
  assert.equal(util.escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
  assert.equal(util.escapeHtml('<img onerror=x>').includes('<'), false)
  assert.equal(util.isAbsolutePath('C:\\a\\b.md'), true)
  assert.equal(util.isAbsolutePath('\\\\server\\share\\a.md'), true)
  assert.equal(util.isAbsolutePath('/posix/a.md'), true)
  assert.equal(util.isAbsolutePath('a\\b.md'), false)
  assert.equal(util.isAbsolutePath('..\\..\\evil.md'), false)
  assert.equal(util.isSameOrInside('C:\\a\\b\\c.md', 'C:\\a'), true)
  assert.equal(util.isSameOrInside('C:\\a\\b\\c.md', 'C:\\a\\b'), true)
  assert.equal(util.isSameOrInside('C:\\ab\\c.md', 'C:\\a'), false)
  assert.equal(util.isSameOrInside('C:\\a', 'C:\\a'), true)
  assert.equal(util.normalizeForCompare('C:/A/B.md'), 'c:\\a\\b.md')
  assert.equal(util.countWords('你好 world 123'), 4)
  assert.equal(util.countWords('   '), 0)
})
