/**
 * 语法门禁：对 src / scripts / tests 下的 JS/MJS 逐个用 `node --check` 解析。
 *
 * 渲染层的 .js 是 ES Module（仓库根 package.json 未声明 type:module），
 * 直接 --check 会按 CommonJS 解析失败，因此复制到临时目录并改名为 .mjs。
 * 该脚本只做解析，不执行任何业务代码，可在 CI 与本地快速运行。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = []

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor' || entry.name === 'node_modules') continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(full)
  }
}

for (const directory of ['src', 'scripts', 'tests']) walk(path.join(root, directory))

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modex-syntax-'))
let failed = 0

files.forEach((file, index) => {
  const isRendererModule =
    file.endsWith('.js') && file.split(path.sep).includes('renderer')
  const target = isRendererModule ? path.join(tempDir, `${index}-${path.basename(file, '.js')}.mjs`) : file
  if (isRendererModule) fs.copyFileSync(file, target)
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' })
  } catch (error) {
    failed += 1
    console.error(`✗ ${path.relative(root, file)}`)
    console.error(String(error.stderr || error.message).trim())
  }
})

fs.rmSync(tempDir, { recursive: true, force: true })
console.log(`语法检查：${files.length - failed}/${files.length} 通过`)
process.exit(failed > 0 ? 1 : 0)
