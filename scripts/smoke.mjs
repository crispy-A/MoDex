#!/usr/bin/env node
/**
 * 端到端验收：npm run smoke [-- --app <打包后的 exe>]
 *
 * 1. 在 artifacts/e2e/workspace 生成一套测试 Markdown 工作区；
 * 2. 用隔离的 userData 启动应用（开发模式或指定 exe），执行 --e2e 驱动脚本；
 * 3. 读取 src/main/e2e.js 产出的 results.json，汇总断言与截图，非全绿则退出码 1。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const fixturesDir = path.join(scriptDir, 'fixtures')
const artifactsDir = path.join(projectRoot, 'artifacts', 'e2e')

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] || null
}

const packagedApp = argValue('--app')

async function prepareWorkspace() {
  await fsp.rm(artifactsDir, { recursive: true, force: true })
  const workspace = path.join(artifactsDir, 'workspace')
  const workspace2 = path.join(artifactsDir, '第二工作区')
  await fsp.mkdir(path.join(workspace, 'assets'), { recursive: true })
  await fsp.mkdir(path.join(workspace, '子目录', '深入'), { recursive: true })
  await fsp.mkdir(path.join(workspace2, '资料'), { recursive: true })

  await fsp.copyFile(path.join(fixturesDir, 'sample.md'), path.join(workspace, '示例.md'))
  await fsp.copyFile(path.join(fixturesDir, 'diagram.svg'), path.join(workspace, 'assets', 'diagram.svg'))

  await fsp.writeFile(
    path.join(workspace, '欢迎.md'),
    ['# 欢迎使用 MoDex', '', '这是一个本地优先的 Markdown 编辑器。', '', '- 左侧文件树管理文件', '- 右侧实时预览', ''].join('\n'),
    'utf8'
  )
  await fsp.writeFile(
    path.join(workspace, '子目录', '笔记.md'),
    ['# 子目录笔记', '', '用于验证文件夹展开与嵌套文件打开。', ''].join('\n'),
    'utf8'
  )
  await fsp.writeFile(
    path.join(workspace, '子目录', '深入', '语法速查.md'),
    ['# 语法速查', '', '| 语法 | 写法 |', '| --- | --- |', '| 标题 | # 标题 |', '| 加粗 | **加粗** |', ''].join('\n'),
    'utf8'
  )
  // 第二个工作区：用于验证多文件夹（多根）能力
  await fsp.writeFile(
    path.join(workspace2, '第二笔记.md'),
    ['# 第二工作区', '', '这个文件位于第二个打开的文件夹中。', ''].join('\n'),
    'utf8'
  )
  await fsp.writeFile(
    path.join(workspace2, '资料', '索引.md'),
    ['# 资料索引', '', '第二个文件夹的子目录文件。', ''].join('\n'),
    'utf8'
  )

  // 第三个用于「关闭软件自动保存」第二阶段验证的文件
  const autosaveFile = path.join(workspace, '自动保存关闭测试.md')
  await fsp.writeFile(autosaveFile, '# 自动保存关闭测试\n\n初始内容\n', 'utf8')

  const sampleFile = path.join(workspace, '示例.md')
  const userData = path.join(artifactsDir, 'userdata')
  const screenshots = path.join(artifactsDir, 'screenshots')
  const resultsPath = path.join(artifactsDir, 'results.json')
  await fsp.mkdir(userData, { recursive: true })
  await fsp.mkdir(screenshots, { recursive: true })
  return { workspace, workspace2, autosaveFile, sampleFile, userData, screenshots, resultsPath }
}

/**
 * 第二阶段：关闭软件自动保存验证。
 * 启动应用 → 打开目标文件 → 编辑 → 触发 win.close()；预期自动保存后进程正常退出，无保存询问。
 */
async function runAutoSaveCloseCheck({ electronExe, packagedApp: isPackaged, projectRoot, env, paths }) {
  const file = paths.autosaveFile
  await fsp.writeFile(file, '# 自动保存关闭测试\n\n初始内容\n', 'utf8')
  const userData = path.join(artifactsDir, 'userdata-autosave')
  await fsp.rm(userData, { recursive: true, force: true })
  await fsp.mkdir(userData, { recursive: true })

  const appArgs = ['--root', paths.workspace, '--open', file, '--autosave-test', file, '--user-data', userData]
  const args = isPackaged ? appArgs : [projectRoot, ...appArgs]
  console.log('\n[smoke] 第二阶段：关闭软件自动保存（预期无保存询问、保存后退出）')

  const child = spawn(electronExe, args, { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
    process.stderr.write(chunk)
  })
  const timer = setTimeout(() => {
    console.error('[smoke] 关闭自动保存验证超时，强制结束进程')
    child.kill()
  }, 60000)
  const code = await new Promise((resolve) => {
    child.on('exit', (exitCode) => resolve(exitCode))
    child.on('error', () => resolve(-1))
  })
  clearTimeout(timer)

  let content = ''
  try {
    content = await fsp.readFile(file, 'utf8')
  } catch {
    /* 文件不存在视为失败 */
  }
  const markerSaved = content.includes('AUTO_SAVE_CLOSE_CHECK')
  const passed = code === 0 && markerSaved
  console.log(`[smoke] 关闭自动保存：退出码=${code}，编辑内容已落盘=${markerSaved}`)
  if (!passed && output.trim()) {
    console.error('[smoke] 第二阶段日志末尾：\n' + output.trim().split('\n').slice(-15).join('\n'))
  }
  return { pass: passed, code, markerSaved }
}

async function main() {
  const paths = await prepareWorkspace()

  const electronExe = packagedApp ? path.resolve(packagedApp) : require('electron')
  if (!fs.existsSync(electronExe)) {
    console.error(`找不到可执行文件：${electronExe}`)
    process.exit(2)
  }

  const appArgs = [
    '--root',
    paths.workspace,
    '--open',
    paths.sampleFile,
    '--e2e',
    paths.resultsPath,
    '--screenshots',
    paths.screenshots,
    '--user-data',
    paths.userData,
    '--delay',
    '800',
  ]
  const args = packagedApp ? appArgs : [projectRoot, ...appArgs]

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  console.log(`[smoke] 启动：${electronExe}`)
  console.log(`[smoke] 工作区：${paths.workspace}`)
  console.log(`[smoke] 截图目录：${paths.screenshots}`)

  const child = spawn(electronExe, args, { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
    process.stderr.write(chunk)
  })

  const timeout = setTimeout(() => {
    console.error('[smoke] 超时（120s），强制结束进程')
    child.kill()
  }, 120000)

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code))
    child.on('error', (err) => {
      console.error('[smoke] 启动失败：', err.message)
      resolve(1)
    })
  })
  clearTimeout(timeout)

  if (!fs.existsSync(paths.resultsPath)) {
    console.error(`\n[smoke] 未找到验收结果文件：${paths.resultsPath}`)
    if (stderr.trim()) console.error('[smoke] stderr 末尾：\n' + stderr.trim().split('\n').slice(-25).join('\n'))
    process.exit(2)
  }

  const report = JSON.parse(await fsp.readFile(paths.resultsPath, 'utf8'))
  const failed = report.assertions.filter((item) => !item.pass)
  console.log('\n================ 验收结果 ================')
  for (const item of report.assertions) {
    console.log(`${item.pass ? '✅' : '❌'} ${item.name}${item.pass ? '' : `  ->  ${JSON.stringify(item.detail)}`}`)
  }
  console.log('------------------------------------------')
  console.log(`断言：${report.assertions.length - failed.length}/${report.assertions.length} 通过`)
  if (report.errors.length) {
    console.log('执行错误：')
    for (const err of report.errors) console.log(`  - ${err.name}: ${err.error}`)
  }
  console.log(`截图：${report.screenshots.length} 张 -> ${paths.screenshots}`)
  if (report.disk && Object.keys(report.disk).length) console.log('磁盘检查：', JSON.stringify(report.disk))
  console.log(`应用退出码：${exitCode}`)
  console.log('==========================================\n')

  // 第二阶段：关闭软件自动保存
  const autoSaveCheck = await runAutoSaveCloseCheck({
    electronExe,
    packagedApp,
    projectRoot,
    env,
    paths,
  })
  console.log(`[smoke] 阶段二结果：${autoSaveCheck.pass ? '通过 ✅' : '失败 ❌'}（退出码 ${autoSaveCheck.code}）`)
  console.log('==========================================\n')

  const pass =
    report.ok === true &&
    failed.length === 0 &&
    report.errors.length === 0 &&
    autoSaveCheck.pass === true
  console.log(pass ? '[smoke] 通过 ✅' : '[smoke] 失败 ❌')
  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error('[smoke] 未捕获异常：', err)
  process.exit(3)
})
