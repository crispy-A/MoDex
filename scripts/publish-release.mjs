#!/usr/bin/env node
/**
 * 发布 GitHub Release 并上传资产（一次性工具，可复用于后续版本）。
 *
 * 用法：
 *   GH_TOKEN=<token> node scripts/publish-release.mjs \
 *     --tag v1.0.0 --name "MoDex v1.0.0" --notes docs/RELEASE-NOTES-v1.0.0.md \
 *     --asset release/MoDex-1.0.0-setup.exe \
 *     --asset release/MoDex-1.0.0-setup.exe.sha256 \
 *     --asset release/MoDex-1.0.0-win32-x64-portable.zip \
 *     --asset release/MoDex-1.0.0-win32-x64-portable.zip.sha256
 *
 * 令牌只从环境变量读取，不写入文件/日志。已存在的同名资产默认跳过（可加 --replace 覆盖）。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const OWNER = 'crispy-A'
const REPO = 'MoDex'
const API = 'https://api.github.com'
const UPLOADS = 'https://uploads.github.com'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1] || null
}
function argAll(name) {
  const result = []
  for (let i = 0; i < process.argv.length - 1; i += 1) {
    if (process.argv[i] === name) result.push(process.argv[i + 1])
  }
  return result
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
if (!token) {
  console.error('[release] 缺少 GH_TOKEN / GITHUB_TOKEN 环境变量')
  process.exit(2)
}
const tag = arg('--tag')
const name = arg('--name') || tag
const notesPath = arg('--notes')
const assets = argAll('--asset')
const replace = process.argv.includes('--replace')
if (!tag || assets.length === 0) {
  console.error('[release] 用法：--tag v1.0.0 --notes <file> --asset <file> [--asset ...]')
  process.exit(2)
}

const headers = {
  Authorization: `token ${token}`,
  'User-Agent': 'MoDex-Release-Publisher',
  Accept: 'application/vnd.github+json',
}

async function api(pathname, init = {}) {
  const response = await fetch(API + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${pathname} -> ${response.status} ${text.slice(0, 400)}`)
  }
  return text ? JSON.parse(text) : null
}

async function ensureRelease() {
  try {
    const existing = await api(`/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`)
    console.log(`[release] 复用已存在 Release：${existing.html_url}`)
    return existing
  } catch (err) {
    if (!/-> 404/.test(String(err))) throw err
  }
  const body = notesPath && fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : `MoDex ${tag}`
  const release = await api(`/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name, body, draft: false, prerelease: false }),
  })
  console.log(`[release] 已创建 Release：${release.html_url}`)
  return release
}

async function listAssets(release) {
  return api(`/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100`)
}

async function uploadAsset(release, filePath) {
  const fileName = path.basename(filePath)
  if (!fs.existsSync(filePath)) throw new Error(`资产不存在：${filePath}`)
  const stat = fs.statSync(filePath)
  const existing = (await listAssets(release)).find((asset) => asset.name === fileName)
  if (existing) {
    if (!replace) {
      console.log(`[release] 跳过已存在资产：${fileName}（${existing.size} bytes）`)
      return existing
    }
    await api(`/repos/${OWNER}/${REPO}/releases/assets/${existing.id}`, { method: 'DELETE' })
    console.log(`[release] 已删除旧资产：${fileName}`)
  }
  const url = `${UPLOADS}/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`
  console.log(`[release] 上传 ${fileName}（${(stat.size / 1024 / 1024).toFixed(1)} MB）...`)
  const startedAt = Date.now()
  const data = fs.readFileSync(filePath)
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'MoDex-Release-Publisher',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(data.length),
        },
        body: data,
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 300)}`)
      const asset = JSON.parse(text)
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
      console.log(`[release] 上传完成 ${fileName}（${asset.size} bytes，${seconds}s）`)
      return asset
    } catch (err) {
      lastError = err
      console.warn(`[release] 第 ${attempt} 次上传失败：${String(err.message || err).slice(0, 300)}`)
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 5000 * attempt))
    }
  }
  throw lastError
}

async function main() {
  const release = await ensureRelease()
  for (const assetPath of assets) {
    await uploadAsset(release, path.resolve(assetPath))
  }
  const finalAssets = await listAssets(release)
  console.log('[release] 资产清单：')
  for (const asset of finalAssets) {
    console.log(`  - ${asset.name}  ${asset.size} bytes  ${asset.browser_download_url}`)
  }
}

main().catch((err) => {
  console.error('[release] 失败：', err)
  process.exit(1)
})
