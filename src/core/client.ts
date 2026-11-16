import WebSocket from 'ws'
import type { Auth } from './auth.js'
import { Operation, pack, unpack } from './protocol.js'

const HEARTBEAT_MS = 30_000
const CONNECT_TIMEOUT_MS = 10_000
const MAX_RECONNECT_DELAY_SECONDS = 30
const DEFAULT_HOST = { host: 'broadcastlv.chat.bilibili.com', wssPort: 2245 }

export interface DanmuClientOptions {
  /** 断线后自动重连，默认开启。 */
  autoReconnect?: boolean
  onOpen?: () => void
  onClose?: (code: number, reason: string) => void
  onError?: (error: Error) => void
  /** 收到 SEND_SMS_REPLY 时回调解析后的 JSON。 */
  onMessage?: (message: any) => void
  /** 连接状态等提示信息。 */
  logger?: (line: string) => void
}

export class DanmuClient {
  private readonly options: DanmuClientOptions
  private auth?: Auth
  private ws?: WebSocket
  private heartbeat?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private attempts = 0
  private closedByUser = false

  constructor(options: DanmuClientOptions = {}) {
    this.options = options
  }

  async connect(auth: Auth): Promise<void> {
    this.auth = auth
    this.closedByUser = false
    this.attempts = 0
    this.clearReconnect()
    this.closeSocket()
    await this.open()
  }

  disconnect(): void {
    this.closedByUser = true
    this.clearReconnect()
    this.closeSocket()
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.resolveUrl()
      const ws = new WebSocket(url)
      this.ws = ws

      let settled = false
      const timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        ws.terminate()
        reject(new Error(`连接 ${url} 超时`))
      }, CONNECT_TIMEOUT_MS)

      ws.once('open', () => {
        if (this.ws !== ws) {
          return
        }
        this.attempts = 0
        this.sendAuth(ws)
        this.startHeartbeat(ws)
        this.options.onOpen?.()
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve()
        }
      })

      ws.on('message', (data) => {
        if (this.ws === ws) {
          this.handleData(toBuffer(data))
        }
      })

      ws.once('error', (error) => {
        this.options.onError?.(error)
      })

      ws.once('close', (code, reason) => {
        if (this.ws !== ws) {
          return
        }
        this.stopHeartbeat()
        this.ws = undefined
        this.options.onClose?.(code, reason.toString())

        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(new Error(`连接关闭: ${code}${reason.length > 0 ? ` ${reason}` : ''}`))
        }
        if (!this.closedByUser) {
          this.scheduleReconnect()
        }
      })
    })
  }

  private resolveUrl(): string {
    const serverUri = process.env.BILI_DANMU_SERVER
    if (serverUri) {
      return serverUri
    }
    const hosts = this.auth?.hosts ?? []
    const picked = hosts.length > 0
      ? hosts[Math.floor(Math.random() * hosts.length)]
      : DEFAULT_HOST
    return `wss://${picked.host}:${picked.wssPort}/sub`
  }

  private sendAuth(ws: WebSocket): void {
    if (!this.auth) {
      ws.close()
      return
    }
    ws.send(pack(Operation.Auth, Buffer.from(JSON.stringify(this.auth))))
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(pack(Operation.Heartbeat, Buffer.alloc(0)))
      }
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = undefined
    }
  }

  private handleData(data: Buffer): void {
    let packets
    try {
      packets = unpack(data)
    } catch (error) {
      this.options.onError?.(asError(error))
      return
    }

    for (const packet of packets) {
      if (packet.operation !== Operation.SendSmsReply) {
        continue
      }
      try {
        this.options.onMessage?.(JSON.parse(packet.body.toString('utf8')))
      } catch (error) {
        this.options.onError?.(new Error(`解析消息失败: ${asError(error).message}`))
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.options.autoReconnect === false || this.reconnectTimer) {
      return
    }
    const attempt = this.attempts++
    const delay = Math.min(MAX_RECONNECT_DELAY_SECONDS, 2 ** Math.min(attempt, 5))
    this.options.logger?.(`连接已断开，${delay} 秒后重连（第 ${attempt + 1} 次）`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.reconnect()
    }, delay * 1000)
  }

  private async reconnect(): Promise<void> {
    if (this.closedByUser) {
      return
    }
    try {
      await this.auth?.refresh()
    } catch (error) {
      this.options.logger?.(`刷新 token 失败，使用原 token 重连: ${asError(error).message}`)
    }
    if (this.closedByUser || this.ws) {
      return
    }
    try {
      await this.open()
    } catch {
      // close 事件里已经排好下一次重连
    }
  }

  private closeSocket(): void {
    const ws = this.ws
    this.ws = undefined
    this.stopHeartbeat()
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close()
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data)
  }
  return Buffer.from(data)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
