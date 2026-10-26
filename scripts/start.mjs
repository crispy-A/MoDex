#!/usr/bin/env node
/**
 * 开发启动器：npm start
 * 通过 Node 包解析出 Electron 可执行文件后拉起应用，并清除可能继承的
 * ELECTRON_RUN_AS_NODE（否则 Electron 会以 Node 模式运行而不是启动窗口）。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const electronExe = require('electron')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const args = [projectRoot, ...process.argv.slice(2)]
const child = spawn(electronExe, args, { cwd: projectRoot, env, stdio: 'inherit' })

child.on('error', (err) => {
  console.error('无法启动 Electron：', err.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron 被信号 ${signal} 终止`)
    process.exit(1)
  }
  process.exit(code ?? 0)
})
