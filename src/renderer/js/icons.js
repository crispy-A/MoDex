/**
 * MoDex 内联 SVG 图标。
 * 统一 16×16 视图盒、使用 currentColor 描边，可直接随主题着色。
 * 说明：图标字符串均为可信静态常量，允许赋给 innerHTML。
 */

const svg = (body) =>
  `<svg class="icon-svg" viewBox="0 0 16 16" width="16" height="16" fill="none" ` +
  `stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${body}</svg>`

/** 品牌标记：M 字描边 SVG（CODEX-UI-DESIGN 第 5 节），尺寸由外层 CSS 控制 */
const brandSvg =
  '<svg class="icon-svg brand-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2.5 12.5V4l5.5 5 5.5-5v8.5"/></svg>'

export const icons = {
  // 品牌
  brand: brandSvg,

  // 侧栏与窗口
  sidebar: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6.5 2.5v11"/>'),

  // 文件相关
  newDoc: svg(
    '<path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z"/>' +
      '<path d="M9 2v4h4"/><path d="M8 8.5v4M6 10.5h4"/>'
  ),
  openFile: svg(
    '<path d="M8 10.5V2.5"/><path d="M5 5.5l3-3 3 3"/>' +
      '<path d="M3 10.5v2A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-2"/>'
  ),
  openFolder: svg(
    '<path d="M2 5.5V4a1.5 1.5 0 0 1 1.5-1.5h3L8 4h4.5A1.5 1.5 0 0 1 14 5.5v1"/>' +
      '<path d="M2.2 6.5h12l-1.05 6.2a1 1 0 0 1-1 .8H4.25a1 1 0 0 1-1-.8z"/>'
  ),
  folder: svg(
    '<path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z"/>'
  ),
  folderOpen: svg(
    '<path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H12A1.5 1.5 0 0 1 13.5 6v1"/>' +
      '<path d="M2 6.5h12l-1.1 6.1a1 1 0 0 1-1 .9H4.2a1 1 0 0 1-1-.85z"/>'
  ),
  file: svg('<path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z"/><path d="M9 2v4h4"/>'),
  fileMd: svg(
    '<path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z"/>' +
      '<path d="M9 2v4h4"/><path d="M5 12V9.5l1.3 1.7L7.6 9.5V12"/>'
  ),
  newFile: svg(
    '<path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z"/>' +
      '<path d="M9 2v4h4"/><path d="M8 8.5v4M6 10.5h4"/>'
  ),
  newFolder: svg(
    '<path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z"/>' +
      '<path d="M8 7.5v4M6 9.5h4"/>'
  ),
  refresh: svg('<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5V6H10"/>'),

  // 保存
  save: svg(
    '<path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.2L14 5.3v7.2A1.5 1.5 0 0 1 12.5 14h-8A1.5 1.5 0 0 1 3 12.5z"/>' +
      '<path d="M5 2v3.5h5V2"/><path d="M5.5 8.5h5v5h-5z"/>'
  ),
  saveAs: svg(
    '<path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.2L14 5.3v7.2A1.5 1.5 0 0 1 12.5 14h-8A1.5 1.5 0 0 1 3 12.5z"/>' +
      '<path d="M5 2v3.5h5V2"/><path d="M5.5 8.5h5v5h-5z"/><path d="M12 4.5v3M10.5 6h3"/>'
  ),

  // 主题
  sun: svg(
    '<circle cx="8" cy="8" r="2.8" fill="currentColor" stroke="none"/>' +
      '<path d="M8 1.1v2.1M8 12.8v2.1M14.9 8h-2.1M3.2 8H1.1M12.9 3.1l-1.5 1.5M4.6 11.4l-1.5 1.5M12.9 12.9l-1.5-1.5M4.6 4.6L3.1 3.1"/>'
  ),
  moon: svg('<path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z"/>'),

  // 通用
  chevron: svg('<path d="M6 3.5L10.5 8 6 12.5"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>'),
  arrowUp: svg('<path d="M8 13V3"/><path d="M4 7l4-4 4 4"/>'),
  arrowDown: svg('<path d="M8 3v10"/><path d="M4 9l4 4 4-4"/>'),
  rename: svg('<path d="M11.5 2.5l2 2L5 13l-2.6.6L3 11z"/>'),
  trash: svg(
    '<path d="M2.5 4.5h11"/><path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5"/>' +
      '<path d="M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6"/><path d="M6.5 7v4M9.5 7v4"/>'
  ),
  reveal: svg(
    '<path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10"/>' +
      '<path d="M10 2h4v4"/><path d="M14 2L7.5 8.5"/>'
  ),
  copy: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/>' +
      '<path d="M10.5 2.5H3A1.5 1.5 0 0 0 1.5 4v7.5"/>'
  ),
  check: svg('<path d="M3 8.5l3 3 7-7"/>'),
  info: svg('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6"/><path d="M8 5.2v.1"/>'),
  alert: svg('<path d="M8 2L14.2 13H1.8z"/><path d="M8 6.2v3.2"/><path d="M8 11.6v.1"/>'),
  clock: svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>'),
  dot: svg('<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>'),

  // AI 写作助手
  ai: svg(
    '<path d="M8 1.8l1.5 4.2 4.2 1.5-4.2 1.5L8 13.2 6.5 9 2.3 7.5 6.5 6z"/>' +
      '<path d="M12.6 11.2l.45 1.25 1.25.45-1.25.45-.45 1.25-.45-1.25-1.25-.45 1.25-.45z"/>'
  ),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  settings: svg(
    '<circle cx="8" cy="8" r="2.2"/>' +
      '<path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2"/>'
  ),
  stop: svg('<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2" fill="currentColor" stroke="none"/>'),
  list: svg(
    '<path d="M5.5 4.2h9M5.5 8h9M5.5 11.8h9"/>' +
      '<circle cx="2.6" cy="4.2" r="0.9" fill="currentColor" stroke="none"/>' +
      '<circle cx="2.6" cy="8" r="0.9" fill="currentColor" stroke="none"/>' +
      '<circle cx="2.6" cy="11.8" r="0.9" fill="currentColor" stroke="none"/>'
  ),
  chevronDown: svg('<path d="M3.5 6L8 10.5 12.5 6"/>'),
}

export default icons
