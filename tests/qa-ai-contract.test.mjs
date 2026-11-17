/**
 * AI 生成参数契约测试：
 * 主进程 ai-options、渲染层 ai-options、settings 清洗、HTML 设置面板四处的
 * 枚举 / 默认值 / 范围必须完全一致，避免新增档位时只改一处造成漂移。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mainOptions from '../src/main/ai/ai-options.js'
import * as rendererOptions from '../src/renderer/js/ai-options.js'
import {
  DEFAULT_SETTINGS,
  NUMERIC_LIMITS,
  AI_CONTEXT_WINDOWS,
  AI_REASONING_EFFORTS,
} from '../src/main/state-store.js'
import { MODEL_MAX_OUTPUT_TOKENS } from '../src/main/ai/provider-registry.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8')

/** 读取指定 select 的 option value 列表（保持 HTML 顺序） */
function selectValues(id) {
  const start = html.indexOf(`id="${id}"`)
  if (start === -1) return []
  const end = html.indexOf('</select>', start)
  const block = html.slice(start, end)
  return [...block.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])
}

test('契约：渲染层镜像与主进程枚举/默认值一致', () => {
  assert.deepEqual([...rendererOptions.CONTEXT_WINDOW_IDS], [...mainOptions.CONTEXT_WINDOW_IDS])
  assert.deepEqual([...rendererOptions.REASONING_EFFORTS], [...mainOptions.REASONING_EFFORTS])
  assert.deepEqual([...rendererOptions.OUTPUT_TOKEN_PRESETS], [...mainOptions.OUTPUT_TOKEN_PRESETS])

  assert.equal(rendererOptions.DEFAULT_CONTEXT_WINDOW, mainOptions.DEFAULT_CONTEXT_WINDOW)
  assert.equal(rendererOptions.DEFAULT_REASONING_EFFORT, mainOptions.DEFAULT_REASONING_EFFORT)
  assert.equal(rendererOptions.DEFAULT_MAX_OUTPUT_TOKENS, mainOptions.DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(rendererOptions.MIN_OUTPUT_TOKENS, mainOptions.MIN_OUTPUT_TOKENS)
  assert.equal(rendererOptions.MAX_OUTPUT_TOKENS, mainOptions.MAX_OUTPUT_TOKENS)
})

test('契约：设置清洗与 AI 代码共用同一套枚举/默认值/范围', () => {
  assert.deepEqual([...AI_CONTEXT_WINDOWS], [...mainOptions.CONTEXT_WINDOW_IDS])
  assert.deepEqual([...AI_REASONING_EFFORTS], [...mainOptions.REASONING_EFFORTS])

  assert.equal(DEFAULT_SETTINGS.aiContextWindow, mainOptions.DEFAULT_CONTEXT_WINDOW)
  assert.equal(DEFAULT_SETTINGS.aiMaxOutputTokens, mainOptions.DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(DEFAULT_SETTINGS.aiReasoningEffort, mainOptions.DEFAULT_REASONING_EFFORT)

  assert.equal(NUMERIC_LIMITS.aiMaxOutputTokens.min, mainOptions.MIN_OUTPUT_TOKENS)
  assert.equal(NUMERIC_LIMITS.aiMaxOutputTokens.max, mainOptions.MAX_OUTPUT_TOKENS)
  assert.equal(NUMERIC_LIMITS.aiMaxOutputTokens.fallback, mainOptions.DEFAULT_MAX_OUTPUT_TOKENS)
})

test('契约：输出上限对齐模型注册表，档位升序且不超过上限', () => {
  assert.equal(mainOptions.MAX_OUTPUT_TOKENS, MODEL_MAX_OUTPUT_TOKENS)

  const presets = [...mainOptions.OUTPUT_TOKEN_PRESETS]
  assert.equal(presets[0], 4096)
  assert.equal(presets[presets.length - 1], mainOptions.MAX_OUTPUT_TOKENS)
  for (let index = 1; index < presets.length; index += 1) {
    assert.ok(presets[index] > presets[index - 1], `档位应升序：${presets.join(',')}`)
  }
  for (const preset of presets) {
    assert.ok(preset >= mainOptions.MIN_OUTPUT_TOKENS && preset <= mainOptions.MAX_OUTPUT_TOKENS)
  }
})

test('契约：AI 设置弹窗的 option 与枚举/档位一致', () => {
  assert.deepEqual(selectValues('ai-context-window'), [...mainOptions.CONTEXT_WINDOW_IDS])
  assert.deepEqual(selectValues('ai-max-output'), mainOptions.OUTPUT_TOKEN_PRESETS.map(String))
  assert.deepEqual(selectValues('ai-reasoning-effort'), [...mainOptions.REASONING_EFFORTS])
})
