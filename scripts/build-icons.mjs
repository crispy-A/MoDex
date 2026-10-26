#!/usr/bin/env node
/**
 * MoDex Logo / 图标生成（SVG → 多尺寸 PNG → ICO）。
 *
 * 用法：
 *   npm run icons                  # 用 assets/logo/modex-logo.svg 生成 assets/icon.ico + icon.png
 *   npm run icons -- --candidates  # 渲染 assets/logo/*.svg 全部候选到 artifacts/logo-render/
 *
 * 依赖 devDependency `sharp`（librsvg 栅格化），无需 ImageMagick/Inkscape/Electron 窗口。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const assetsDir = path.join(projectRoot, 'assets')
const logoDir = path.join(assetsDir, 'logo')
const iconSizes = [16, 24, 32, 48, 64, 128, 256]
const candidates = process.argv.includes('--candidates')

function log(message) {
  console.log(`[icons] ${message}`)
}

/** 用 sharp 把 SVG 栅格化为指定尺寸的 PNG Buffer（直接按目标尺寸渲染，边缘更锐利） */
async function renderPng(svgBuffer, size) {
  return sharp(svgBuffer, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

/** 把多尺寸 PNG 封装为 ICO（Windows Vista+ 支持 PNG 条目） */
function buildIco(frames) {
  const count = frames.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const directory = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  frames.forEach((frame, index) => {
    const entry = index * 16
    const dimension = frame.size >= 256 ? 0 : frame.size
    directory.writeUInt8(dimension, entry)
    directory.writeUInt8(dimension, entry + 1)
    directory.writeUInt8(0, entry + 2)
    directory.writeUInt8(0, entry + 3)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frame.png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frame.png.length
  })

  return Buffer.concat([header, directory, ...frames.map((frame) => frame.png)])
}

async function main() {
  if (candidates) {
    const files = fs
      .readdirSync(logoDir)
      .filter((name) => name.endsWith('.svg'))
      .sort()
    if (files.length === 0) {
      console.error('[icons] assets/logo 下没有 SVG 候选')
      process.exit(1)
    }
    const outDir = path.join(projectRoot, 'artifacts', 'logo-render')
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })
    for (const name of files) {
      const id = name.replace(/\.svg$/i, '')
      const svg = fs.readFileSync(path.join(logoDir, name))
      fs.writeFileSync(path.join(outDir, `${id}.png`), await renderPng(svg, 1024))
      for (const size of iconSizes) {
        fs.writeFileSync(path.join(outDir, `${id}-${size}.png`), await renderPng(svg, size))
      }
      log(`候选 ${id} -> artifacts/logo-render/`)
    }
    log('全部候选渲染完成')
    return
  }

  const source = path.join(logoDir, 'modex-logo.svg')
  if (!fs.existsSync(source)) {
    console.error(`[icons] 缺少 ${source}（先确定最终 Logo 并复制到该文件）`)
    process.exit(2)
  }
  const svg = fs.readFileSync(source)
  const frames = []
  for (const size of iconSizes) {
    frames.push({ size, png: await renderPng(svg, size) })
  }
  const icoPath = path.join(assetsDir, 'icon.ico')
  fs.writeFileSync(icoPath, buildIco(frames))
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), await renderPng(svg, 256))
  log(`已生成 assets/icon.ico（${iconSizes.join('/')}）`)
  log('已生成 assets/icon.png（256×256）')
}

main().catch((err) => {
  console.error(`[icons] 失败：${err.message}`)
  process.exit(1)
})
