'use strict'

/**
 * 应用菜单（中文）。
 *
 * 约定：所有「文档/视图」类动作通过 menu:action 发给渲染层，由渲染层统一分发；
 * 这些菜单项用 registerAccelerator:false —— 仅展示快捷键提示，实际按键由渲染层 keydown 处理，
 * 避免菜单与页面重复触发。撤销/剪切/复制/粘贴/全选使用 Electron 原生 role，由系统处理。
 */
const { Menu, dialog, app } = require('electron')

const SHORTCUTS_TEXT = [
  '文件：Ctrl+N 新建  ·  Ctrl+O 打开  ·  Ctrl+S 保存  ·  Ctrl+Shift+S 另存为  ·  Ctrl+W 关闭',
  '视图：Ctrl+1 编辑  ·  Ctrl+2 分栏  ·  Ctrl+3 预览  ·  Ctrl+Shift+E 侧栏  ·  Ctrl+Shift+T 主题',
  '字号：Ctrl+= 放大  ·  Ctrl+- 缩小  ·  Ctrl+0 重置',
  '编辑：Ctrl+F 查找  ·  Ctrl+B 加粗（编辑器内）/ 侧栏（编辑器外）  ·  Ctrl+I 斜体  ·  Ctrl+K 链接',
  '编辑：Tab 缩进两空格  ·  Enter 自动续写列表  ·  Esc 关闭查找栏',
].join('\n')

function showShortcuts(parentWindow) {
  return dialog.showMessageBox(parentWindow || undefined, {
    type: 'info',
    title: '键盘快捷键',
    message: 'MoDex 键盘快捷键',
    detail: SHORTCUTS_TEXT,
    buttons: ['知道了'],
    noLink: true,
  })
}

function showAbout(parentWindow) {
  return dialog.showMessageBox(parentWindow || undefined, {
    type: 'info',
    title: '关于 MoDex',
    message: `MoDex ${app.getVersion()}`,
    detail: [
      '轻量化 Markdown 编辑器桌面应用',
      '',
      '· 实时 Markdown 预览，编辑 / 分栏 / 预览三种视图',
      '· 打开文件夹、文件树管理、新建文件与文件夹、重命名、删除到回收站',
      '· 本地优先：纯离线、无账号、无遥测',
      '',
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    ].join('\n'),
    buttons: ['关闭'],
    noLink: true,
  })
}

/**
 * @param {{ getWindow: () => import('electron').BrowserWindow | null }} options
 */
function createAppMenu({ getWindow }) {
  const send = (action) => {
    const win = getWindow && getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('menu:action', action)
  }

  const actionItem = (label, action, accelerator) => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(action),
  })

  const template = [
    {
      label: '文件',
      submenu: [
        actionItem('新建文档', 'file:new', 'CmdOrCtrl+N'),
        actionItem('打开文件…', 'file:open', 'CmdOrCtrl+O'),
        actionItem('添加文件夹…', 'file:open-folder'),
        { type: 'separator' },
        actionItem('保存', 'file:save', 'CmdOrCtrl+S'),
        actionItem('另存为…', 'file:save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        actionItem('关闭文档', 'file:close', 'CmdOrCtrl+W'),
        { type: 'separator' },
        { label: '退出', role: 'quit', accelerator: 'Alt+F4' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { label: '重做', role: 'redo', accelerator: 'CmdOrCtrl+Y' },
        { type: 'separator' },
        { label: '剪切', role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { label: '复制', role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { label: '粘贴', role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { label: '全选', role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
        { type: 'separator' },
        actionItem('查找…', 'edit:find', 'CmdOrCtrl+F'),
      ],
    },
    {
      label: '视图',
      submenu: [
        actionItem('编辑模式', 'view:edit', 'CmdOrCtrl+1'),
        actionItem('分栏模式', 'view:split', 'CmdOrCtrl+2'),
        actionItem('预览模式', 'view:preview', 'CmdOrCtrl+3'),
        { type: 'separator' },
        actionItem('显示 / 隐藏侧栏', 'view:toggle-sidebar', 'CmdOrCtrl+Shift+E'),
        actionItem('切换浅色 / 深色主题', 'view:theme-toggle', 'CmdOrCtrl+Shift+T'),
        { type: 'separator' },
        actionItem('放大字号', 'view:zoom-in', 'CmdOrCtrl+='),
        actionItem('缩小字号', 'view:zoom-out', 'CmdOrCtrl+-'),
        actionItem('重置字号', 'view:zoom-reset', 'CmdOrCtrl+0'),
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        { label: '开发者工具', role: 'toggleDevTools', accelerator: 'F12' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '键盘快捷键', click: () => showShortcuts(getWindow && getWindow()) },
        { label: '关于 MoDex', click: () => showAbout(getWindow && getWindow()) },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

module.exports = { createAppMenu, showShortcuts, showAbout, SHORTCUTS_TEXT }
