/**
 * 文档打开令牌（纯逻辑，便于单测）。
 *
 * 打开文件是异步的：点击 A 后立刻点击 B，若 A 的 readFile 晚于 B 返回，
 * 旧实现会把 A 的内容盖到 B 上。这里用单调递增令牌标记「最后一次打开请求」，
 * 只有令牌仍是最新的请求才允许 applyDocument。
 */
export function createLoadGuard() {
  let token = 0
  return {
    /** 开始一次打开请求，返回本次令牌 */
    begin() {
      token += 1
      return token
    },
    /** 该令牌是否仍代表最后一次请求 */
    isCurrent(value) {
      return value === token
    },
    /** 让所有在途请求失效（新建 / 关闭文档时调用） */
    invalidate() {
      token += 1
    },
  }
}
