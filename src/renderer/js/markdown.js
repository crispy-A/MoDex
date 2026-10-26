/**
 * markdown-it 配置与MoDex扩展：
 * - 禁用原始 HTML（html:false），保证预览安全；
 * - 任务列表（- [ ] / - [x]）渲染为禁用复选框；
 * - 标题生成可定位的 slug（中文保留，重复时追加序号）；
 * - 代码围栏输出 data-lang 语言标签，并做 HTML 转义。
 * 本模块不访问 DOM，可安全导入。
 */

import { escapeHtml } from './util.js'

let mdInstance = null

/** 标题文本 -> slug（保留中英文与数字，空白转连字符） */
export function slugify(text) {
  const raw = String(text ?? '').trim().toLowerCase()
  const cleaned = raw
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'section'
}

/** 代码围栏高亮：输出带 data-lang 的 <pre>，交由 CSS 显示语言标签 */
function highlightFence(code, lang) {
  const language = String(lang ?? '')
    .trim()
    .split(/\s+/)[0]
    .replace(/[^\w+#.-]/g, '')
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : ''
  return (
    `<pre class="code-block" data-lang="${escapeHtml(language)}">` +
    `<code${languageClass}>${escapeHtml(code)}</code></pre>`
  )
}

/** 任务列表插件：把列表项开头的 [ ] / [x] 替换成复选框 */
function taskListPlugin(md) {
  md.core.ruler.after('inline', 'qm-task-list', (state) => {
    const tokens = state.tokens
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token.type !== 'inline' || !token.children || token.children.length === 0) continue
      const match = /^\[([ xX])\]\s+/.exec(token.content)
      if (!match) continue
      const first = token.children[0]
      if (!first || first.type !== 'text') continue
      first.content = first.content.replace(/^\[([ xX])\]\s+/, '')
      const checkbox = new state.Token('html_inline', '', 0)
      const checked = match[1].toLowerCase() === 'x' ? ' checked' : ''
      checkbox.content = `<input class="task-list-checkbox" type="checkbox" disabled${checked}>`
      token.children.unshift(checkbox)
      // 标记所属列表项 / 列表，便于 CSS 去掉项目符号
      let listItem = null
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const prev = tokens[cursor]
        if (!listItem && prev.type === 'list_item_open') {
          listItem = prev
          continue
        }
        if (listItem && (prev.type === 'bullet_list_open' || prev.type === 'ordered_list_open')) {
          const listClass = prev.attrGet('class')
          if (!listClass || !listClass.includes('contains-task-list')) {
            prev.attrSet('class', listClass ? `${listClass} contains-task-list` : 'contains-task-list')
          }
          break
        }
        if (listItem && prev.type === 'list_item_close') break
      }
      if (listItem) {
        const itemClass = listItem.attrGet('class')
        if (!itemClass || !itemClass.includes('task-list-item')) {
          listItem.attrSet('class', itemClass ? `${itemClass} task-list-item` : 'task-list-item')
        }
      }
    }
  })
}

/** 标题 id 插件：为每个标题写入唯一 slug id */
function headingIdPlugin(md) {
  md.core.ruler.after('inline', 'qm-heading-id', (state) => {
    const seen = new Map()
    const tokens = state.tokens
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token.type !== 'heading_open') continue
      const inline = tokens[index + 1]
      if (!inline || inline.type !== 'inline') continue
      const base = slugify(inline.content)
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      token.attrSet('id', count === 0 ? base : `${base}-${count + 1}`)
    }
  })
}

/** 获取（首次调用时创建）markdown-it 实例 */
export function getMarkdownIt() {
  if (mdInstance) return mdInstance
  const factory = typeof window !== 'undefined' ? window.markdownit : undefined
  if (typeof factory !== 'function') {
    throw new Error('markdown-it 未加载，请检查 vendor/markdown-it.min.js')
  }
  mdInstance = factory({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight: highlightFence,
  })
  mdInstance.use(taskListPlugin)
  mdInstance.use(headingIdPlugin)
  return mdInstance
}

/** 渲染 Markdown 为可信 HTML（仅 markdown-it 输出） */
export function renderMarkdown(source) {
  const md = getMarkdownIt()
  return md.render(String(source ?? ''))
}
