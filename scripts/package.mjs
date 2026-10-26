#!/usr/bin/env node
/**
 * 便携版打包：npm run package
 *
 * 复用 node_modules/electron/dist 中已安装的 Electron 运行时，把 src/assets 拷进
 * resources/app，重命名可执行文件，产出免安装目录：
 *   release/MoDex-win32-x64/MoDex.exe
 * 不依赖 electron-builder / 网络下载，产物为绿色便携版。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { rcedit } from 'rcedit'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const electronDist = path.dirname(require('electron'))
const releaseRoot = path.join(projectRoot, 'release')
const outDir = path.join(releaseRoot, `MoDex-${pkg.version}-win32-x64`)
const exeName = 'MoDex.exe'

async function copyRuntime() {
  await fsp.rm(outDir, { recursive: true, force: true })
  await fsp.mkdir(outDir, { recursive: true })
  await fsp.cp(electronDist, outDir, { recursive: true })

  // 移除 Electron 默认应用，避免与 resources/app 混淆
  await fsp.rm(path.join(outDir, 'resources', 'default_app.asar'), { force: true })

  const sourceExe = path.join(outDir, 'electron.exe')
  if (!fs.existsSync(sourceExe)) throw new Error(`Electron 运行时缺少 electron.exe：${sourceExe}`)
  await fsp.rename(sourceExe, path.join(outDir, exeName))
}

/** 把 Logo / 产品版本信息写入 MoDex.exe（文件资源管理器、快捷方式、任务栏都使用它） */
async function applyExeMetadata() {
  const exePath = path.join(outDir, exeName)
  const iconPath = path.join(projectRoot, 'assets', 'icon.ico')
  if (!fs.existsSync(iconPath)) {
    throw new Error('缺少 assets/icon.ico；请先运行 npm run icons')
  }
  await rcedit(exePath, {
    icon: iconPath,
    'file-version': pkg.version,
    'product-version': pkg.version,
    'version-string': {
      CompanyName: 'crispy-A',
      FileDescription: 'MoDex · 轻量化 Markdown 编辑器',
      FileVersion: pkg.version,
      InternalName: 'MoDex',
      LegalCopyright: `Copyright © ${new Date().getFullYear()} crispy-A`,
      OriginalFilename: exeName,
      ProductName: 'MoDex',
      ProductVersion: pkg.version,
    },
  })
  console.log('[package] 已写入 Logo 与版本信息：', exeName)
}

async function copyApp() {
  const appDir = path.join(outDir, 'resources', 'app')
  await fsp.mkdir(path.join(appDir, 'resources'), { recursive: true })

  await fsp.cp(path.join(projectRoot, 'src'), path.join(appDir, 'src'), { recursive: true })
  if (fs.existsSync(path.join(projectRoot, 'assets'))) {
    await fsp.cp(path.join(projectRoot, 'assets'), path.join(appDir, 'assets'), { recursive: true })
  }
  if (fs.existsSync(path.join(projectRoot, 'docs'))) {
    await fsp.cp(path.join(projectRoot, 'docs'), path.join(appDir, 'docs'), { recursive: true })
  }
  if (fs.existsSync(path.join(projectRoot, 'README.md'))) {
    await fsp.copyFile(path.join(projectRoot, 'README.md'), path.join(outDir, 'README.md'))
  }

  const runtimePkg = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    main: 'src/main/main.js',
    author: pkg.author,
    license: pkg.license,
  }
  await fsp.writeFile(path.join(appDir, 'package.json'), JSON.stringify(runtimePkg, null, 2), 'utf8')
}

async function directorySize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) total += (await fsp.stat(full)).size
    }
  }
  return total
}

async function main() {
  if (process.platform !== 'win32') {
    console.warn('[package] 当前打包脚本面向 Windows，其他平台请自行调整 Electron 运行时与可执行文件名。')
  }
  console.log('[package] 复用 Electron 运行时：', electronDist)
  await copyRuntime()
  await applyExeMetadata()
  await copyApp()

  const size = await directorySize(outDir)
  console.log('\n[package] 完成 ✅')
  console.log(`  目录：${outDir}`)
  console.log(`  可执行：${path.join(outDir, exeName)}`)
  console.log(`  体积：${(size / 1024 / 1024).toFixed(1)} MB（Electron 运行时占绝大部分）`)
  console.log('\n直接双击 exe 即可运行；验收打包产物：npm run smoke -- --app "<exe 路径>"')
}

main().catch((err) => {
  console.error('[package] 失败：', err)
  process.exit(1)
})
