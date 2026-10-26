'use strict'

/**
 * MoDex preload：渲染进程唯一系统能力入口。
 * 接口契约见 docs/CONTRACTS.md —— 修改任何签名前先改契约文档。
 */
const { contextBridge, ipcRenderer } = require('electron')
const path = require('node:path')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

function subscribe(channel, callback) {
  const listener = (_event, payload) => {
    try {
      callback(payload)
    } catch (err) {
      console.error(`[preload] ${channel} listener failed`, err)
    }
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  appVersion: undefined,

  // 启动与窗口
  bootstrap: () => invoke('app:bootstrap'),
  setDirty: (dirty) => {
    ipcRenderer.send('app:dirty', Boolean(dirty))
  },
  requestClose: () => {
    ipcRenderer.send('app:request-close')
  },
  cancelClose: () => {
    ipcRenderer.send('app:close-cancelled')
  },
  runMenuCommand: (command) => invoke('app:menu-command', command),

  // 原生对话框
  openFolder: () => invoke('dialog:open-folder'),
  openFile: () => invoke('dialog:open-file'),
  saveFileAs: (suggestedPath) => invoke('dialog:save-file', suggestedPath || null),
  confirmUnsaved: (fileName) => invoke('dialog:confirm-unsaved', fileName || '未命名.md'),
  confirmDelete: (displayPath) => invoke('dialog:confirm-delete', displayPath),
  confirmFileConflict: (fileName) => invoke('dialog:confirm-file-conflict', fileName || ''),
  messageBox: (opts) => invoke('dialog:message', opts || {}),

  // 文件系统
  listDir: (dirPath) => invoke('fs:list-dir', dirPath),
  readFile: (filePath) => invoke('fs:read-file', filePath),
  writeFile: (filePath, content) => invoke('fs:write-file', { filePath, content }),
  createFile: (dirPath, name, content) => invoke('fs:create-file', { dirPath, name, content }),
  createFolder: (dirPath, name) => invoke('fs:create-folder', { dirPath, name }),
  rename: (targetPath, newName) => invoke('fs:rename', { targetPath, newName }),
  remove: (targetPath) => invoke('fs:remove', targetPath),
  pathInfo: (targetPath) => invoke('fs:path-info', targetPath),
  setRoots: (rootPaths) => invoke('fs:set-roots', rootPaths),

  // Shell
  revealInExplorer: (targetPath) => invoke('shell:reveal', targetPath),
  openExternal: (url) => invoke('shell:open-external', url),

  // 设置与最近列表
  saveSettings: (patch) => invoke('settings:save', patch),
  addRecent: (kind, targetPath) => invoke('recent:add', { kind, p: targetPath }),
  clearRecent: (kind) => invoke('recent:clear', kind),

  // 事件
  onMenuAction: (cb) => subscribe('menu:action', cb),
  onTreeChanged: (cb) => subscribe('fs:tree-changed', cb),
  onCloseRequested: (cb) => subscribe('app:close-requested', cb),
  onOpenPath: (cb) => subscribe('app:open-path', cb),

  // 纯工具
  toAssetUrl: (absPath) => `app://file/${encodeURIComponent(String(absPath))}`,
  dirname: (p) => path.dirname(String(p)),
  basename: (p) => path.basename(String(p)),
  joinPath: (base, ...parts) => path.join(String(base), ...parts.map(String)),
  extname: (p) => path.extname(String(p)),
}

contextBridge.exposeInMainWorld('api', api)
