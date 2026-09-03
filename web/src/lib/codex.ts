import { App } from '@modelcontextprotocol/ext-apps'

interface ToolCallResult<T> {
  structuredContent?: T
  content?: Array<{ type: string, text?: string }>
  isError?: boolean
}

const app = new App(
  { name: 'XHS Simulator', version: '0.1.2' },
  { availableDisplayModes: ['inline', 'fullscreen'] },
  { autoResize: true, strict: true },
)
const appReady = app.connect().then(() => app)

export async function callXhsTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const connectedApp = await appReady
  const result = await connectedApp.callServerTool({ name, arguments: args }) as ToolCallResult<T>

  if (result?.isError) {
    const message = result.content?.find(item => item.type === 'text')?.text
    throw new Error(message || `${name} 执行失败`)
  }
  return (result?.structuredContent ?? result) as T
}

export async function sendCodexMessage(prompt: string): Promise<void> {
  const connectedApp = await appReady
  await connectedApp.sendMessage({
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  })
}

export async function requestDisplayMode(mode: 'inline' | 'fullscreen'): Promise<void> {
  const connectedApp = await appReady
  await connectedApp.requestDisplayMode({ mode })
}

export function createRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}
