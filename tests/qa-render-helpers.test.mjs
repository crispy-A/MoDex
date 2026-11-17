/**
 * 渲染层性能辅助函数（纯函数）：
 * - rootsSignature：只有根集合/激活根变化才持久化，展开折叠不写盘
 * - streamRenderInterval：流式回答越长，markdown 全量重解析降频越多
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { rootsSignature, streamRenderInterval } from '../src/renderer/js/util.js'

test('rootsSignature：根顺序或激活根变化时签名变化', () => {
  const a = rootsSignature(['D:\\notes', 'D:\\work'], 'D:\\notes')
  assert.equal(a, rootsSignature(['D:\\notes', 'D:\\work'], 'D:\\notes'))
  // 展开/折叠不改变根集合，签名必须稳定
  assert.equal(a, rootsSignature(['D:\\notes', 'D:\\work'], 'D:\\notes'))
  // 激活根变化
  assert.notEqual(a, rootsSignature(['D:\\notes', 'D:\\work'], 'D:\\work'))
  // 顺序变化
  assert.notEqual(a, rootsSignature(['D:\\work', 'D:\\notes'], 'D:\\notes'))
  // 大小写与分隔符按 Windows 语义归一
  assert.equal(a, rootsSignature(['d:/notes', 'D:\\work'], 'd:/notes'))
  // 空列表
  assert.equal(rootsSignature([], null), rootsSignature([], null))
})

test('streamRenderInterval：短回答 50ms，长回答自适应降频', () => {
  assert.equal(streamRenderInterval(0), 50)
  assert.equal(streamRenderInterval(19999), 50)
  assert.equal(streamRenderInterval(20000), 120)
  assert.equal(streamRenderInterval(59999), 120)
  assert.equal(streamRenderInterval(60000), 200)
  assert.equal(streamRenderInterval(500000), 200)
  // 非法输入按 0 处理
  assert.equal(streamRenderInterval(undefined), 50)
  assert.equal(streamRenderInterval('abc'), 50)
})
