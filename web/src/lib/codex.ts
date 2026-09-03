import { App } from '@modelcontextprotocol/ext-apps'

export const WIDGET_VERSION = '0.2.0'

interface ToolCallResult<T> {
  structuredContent?: T
  content?: Array<{ type: string, text?: string }>
  isError?: boolean
}

// 独立模式（浏览器直开，无 Codex 宿主）：不建立 MCP 连接，
// 页面走 /api 直连；App 惰性创建，避免自发自收的 JSON-RPC 报错。
const standalone = window.parent === window

const app = standalone
  ? null
  : new App(
      { name: 'XHS Simulator', version: WIDGET_VERSION },
      { availableDisplayModes: ['inline', 'fullscreen'] },
      { autoResize: true, strict: true },
    )
const appReady = app ? app.connect().then(() => app) : null

export const isStandalone = () => standalone

export async function callXhsTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const connectedApp = await appReady
  if (!connectedApp)
    throw new Error('当前为浏览器直开模式，MCP 通道不可用')
  const result = await connectedApp.callServerTool({ name, arguments: args }) as ToolCallResult<T>

  if (result?.isError) {
    const message = result.content?.find(item => item.type === 'text')?.text
    throw new Error(message || `${name} 执行失败`)
  }
  return (result?.structuredContent ?? result) as T
}

export async function sendCodexMessage(prompt: string): Promise<void> {
  const connectedApp = await appReady
  if (!connectedApp)
    throw new Error('当前为浏览器直开模式，MCP 通道不可用')
  await connectedApp.sendMessage({
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  })
}

export async function requestDisplayMode(mode: 'inline' | 'fullscreen'): Promise<void> {
  const connectedApp = await appReady
  if (!connectedApp)
    return
  await connectedApp.requestDisplayMode({ mode })
}

export function createRequestId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${random}`
}
