'use strict'

/**
 * 极简 SSE（Server-Sent Events）解析器。
 * 输入是任意分片的文本块，输出完整事件 { event, data, id }。
 * 兼容：event/data/id/retry 字段、多行 data、":" 注释、CRLF、空行派发、流结束时 flush。
 * 纯函数实现，便于单元测试；不依赖 Node 专有 API。
 */

/**
 * @param {(event: {event: string, data: string, id: string|null}) => void} onEvent
 * @returns {{ push: (chunk: string | Buffer | Uint8Array) => void, end: () => void }}
 */
function createSseParser(onEvent) {
  let buffer = ''
  let eventName = ''
  let dataLines = []
  let lastId = null

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = ''
      return
    }
    const event = {
      event: eventName || 'message',
      data: dataLines.join('\n'),
      id: lastId,
    }
    eventName = ''
    dataLines = []
    try {
      onEvent(event)
    } catch (err) {
      // 单个事件回调异常不应中断整条流
      console.error('[sse] 事件回调失败：', err)
    }
  }

  const handleLine = (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return // 注释/心跳
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'event':
        eventName = value
        break
      case 'data':
        dataLines.push(value)
        break
      case 'id':
        lastId = value
        break
      case 'retry':
        // 不处理重连间隔（我们会自行控制重试）
        break
      default:
        // 未知字段按规范忽略
        break
    }
  }

  return {
    push(chunk) {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      buffer += text
      let index = buffer.indexOf('\n')
      while (index !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        handleLine(line)
        index = buffer.indexOf('\n')
      }
    },
    end() {
      if (buffer.length > 0) {
        handleLine(buffer)
        buffer = ''
      }
      dispatch()
    },
  }
}

module.exports = { createSseParser }
