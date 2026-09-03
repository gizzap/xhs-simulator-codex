interface ToolCallResult<T> {
  structuredContent?: T
  content?: Array<{ type: string, text?: string }>
  isError?: boolean
}

interface OpenAIWidgetBridge {
  callTool?: <T>(name: string, args: Record<string, unknown>) => Promise<ToolCallResult<T>>
  sendFollowUpMessage?: (message: { prompt: string }) => Promise<unknown>
  requestDisplayMode?: (request: { mode: 'inline' | 'fullscreen' }) => Promise<unknown>
}

declare global {
  interface Window {
    openai?: OpenAIWidgetBridge
  }
}

let nextRequestId = 1
const pending = new Map<number, {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: number
}>()

window.addEventListener('message', (event) => {
  if (event.source !== window.parent)
    return
  const message = event.data
  if (!message || message.jsonrpc !== '2.0' || message.id === undefined)
    return
  const request = pending.get(message.id)
  if (!request)
    return
  pending.delete(message.id)
  window.clearTimeout(request.timer)
  if (message.error)
    request.reject(new Error(message.error.message || 'Codex Widget 请求失败'))
  else
    request.resolve(message.result)
}, { passive: true })

function rpc<T>(method: string, params: Record<string, unknown>, timeoutMs = 45_000): Promise<T> {
  if (window.parent === window)
    return Promise.reject(new Error('当前页面不在 Codex Widget 容器中'))
  const id = nextRequestId++
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Codex Widget 请求超时：${method}`))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
  })
}

export async function callXhsTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  let result: ToolCallResult<T>
  if (window.openai?.callTool)
    result = await window.openai.callTool<T>(name, args)
  else
    result = await rpc<ToolCallResult<T>>('tools/call', { name, arguments: args })

  if (result?.isError) {
    const message = result.content?.find(item => item.type === 'text')?.text
    throw new Error(message || `${name} 执行失败`)
  }
  return (result?.structuredContent ?? result) as T
}

export async function sendCodexMessage(prompt: string): Promise<void> {
  if (window.openai?.sendFollowUpMessage) {
    await window.openai.sendFollowUpMessage({ prompt })
    return
  }
  await rpc('ui/message', {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  }, 15_000)
}

export async function requestDisplayMode(mode: 'inline' | 'fullscreen'): Promise<void> {
  if (window.openai?.requestDisplayMode) {
    await window.openai.requestDisplayMode({ mode })
    return
  }
  await rpc('ui/request-display-mode', { mode }, 10_000)
}

export function createRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}
