#!/usr/bin/env node
/**
 * 构建 Windows 安装包（Inno Setup 6）。
 *
 * 用法：
 *   npm run installer                 # 先打包便携版，再生成安装包
 *   npm run installer -- --skip-package   # 复用已存在的便携版产物
 *
 * 依赖：Inno Setup 6（仅构建机需要）。可通过 winget install JRSoftware.InnoSetup 安装；
 * 也可设置环境变量 INNO_SETUP_ISCC 指向 ISCC.exe。
 *
 * 产物：release/MoDex-<version>-setup.exe
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const releaseDir = path.join(projectRoot, 'release')
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const appVersion = pkg.version
const portableDir = path.join(releaseDir, `MoDex-${appVersion}-win32-x64`)
const installerScript = path.join(projectRoot, 'installer', 'MoDex.iss')
const chineseIsl = path.join(projectRoot, 'installer', 'ChineseSimplified.isl')
const outputFile = path.join(releaseDir, `MoDex-${appVersion}-setup.exe`)

function log(message) {
  console.log(`[installer] ${message}`)
}

function run(command, args, options = {}) {
  log(`运行：${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    stdio: options.stdio || 'inherit',
    env: process.env,
    windowsHide: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} 退出码 ${result.status}`)
  }
}

function findIscc() {
  const candidates = []
  if (process.env.INNO_SETUP_ISCC) candidates.push(process.env.INNO_SETUP_ISCC)
  const localAppData = process.env.LOCALAPPDATA || ''
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  if (localAppData) candidates.push(path.join(localAppData, 'Programs', 'Inno Setup 6', 'ISCC.exe'))
  candidates.push(path.join(programFilesX86, 'Inno Setup 6', 'ISCC.exe'))
  candidates.push(path.join(programFiles, 'Inno Setup 6', 'ISCC.exe'))
  candidates.push(path.join(programFilesX86, 'Inno Setup 5', 'ISCC.exe'))
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return null
}

function main() {
  const skipPackage = process.argv.includes('--skip-package')
  if (!fs.existsSync(installerScript)) {
    console.error(`[installer] 缺少安装脚本：${installerScript}`)
    process.exit(2)
  }
  if (!skipPackage || !fs.existsSync(path.join(portableDir, 'MoDex.exe'))) {
    log(`打包便携版（${path.basename(portableDir)}）...`)
    run(process.execPath, [path.join(projectRoot, 'scripts', 'package.mjs')])
  } else {
    log(`复用便携版产物：${portableDir}`)
  }
  if (!fs.existsSync(path.join(portableDir, 'MoDex.exe'))) {
    console.error(`[installer] 便携版产物不存在：${portableDir}`)
    process.exit(2)
  }

  const iscc = findIscc()
  if (!iscc) {
    console.error(
      '[installer] 找不到 Inno Setup 6 的 ISCC.exe。\n' +
        '  安装方式：winget install JRSoftware.InnoSetup\n' +
        '  或设置环境变量 INNO_SETUP_ISCC 指向 ISCC.exe'
    )
    process.exit(2)
  }
  log(`使用 Inno Setup：${iscc}`)

  if (fs.existsSync(outputFile)) {
    fs.rmSync(outputFile, { force: true })
    log(`清理旧安装包：${path.basename(outputFile)}`)
  }

  const defines = [
    `/DAppVersion=${appVersion}`,
    `/DSourceDir=${portableDir}`,
    `/DOutputDir=${releaseDir}`,
  ]
  if (fs.existsSync(chineseIsl)) {
    defines.push(`/DChineseIsl=${chineseIsl}`)
    log('安装界面语言：简体中文')
  } else {
    log('未找到 ChineseSimplified.isl，安装界面使用英文')
  }

  const startedAt = Date.now()
  run(iscc, ['/Qp', ...defines, installerScript])
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)

  if (!fs.existsSync(outputFile)) {
    console.error(`[installer] 未生成安装包：${outputFile}`)
    process.exit(1)
  }
  const sizeMb = (fs.statSync(outputFile).size / (1024 * 1024)).toFixed(1)
  log(`完成：${outputFile}（${sizeMb} MB，用时 ${seconds}s）`)
}

try {
  main()
} catch (err) {
  console.error(`[installer] 失败：${err.message}`)
  process.exit(1)
}
