import { readFile } from 'node:fs/promises'
import { useEffect, useRef, useState } from 'react'
import { Box, Static, Text, useApp, useInput } from 'ink'
import { Select } from '@inkjs/ui'
import TextInput from 'ink-text-input'
import { Auth } from '../../core/auth.js'
import { DanmuClient } from '../../core/client.js'
import { COMMAND_HELP, parseCommand } from '../commands.js'
import { parseEvent } from '../../core/events.js'
import type { LiveEvent } from '../../core/events.js'
import { validateCookie } from '../../core/login.js'
import type { LoginUser } from '../../core/login.js'
import { getRoomInfo, resolveRoomId } from '../../core/room.js'
import type { RoomInfo } from '../../core/room.js'
import { sendDanmu } from '../../core/send.js'
import { readBrowserBilibiliCookie } from '../browser-cookies.js'
import type { BrowserName } from '../browser-cookies.js'
import type { Store } from '../store.js'
import { timeString, EventLine } from './EventLine.js'

type Tone = 'info' | 'warn' | 'error' | 'success'

type LogInput =
  | { kind: 'system'; text: string; tone?: Tone }
  | { kind: 'event'; event: LiveEvent }
  | { kind: 'self'; text: string }

type LogEntry = LogInput & { id: number }

type Mode = 'chat' | 'history' | 'room' | 'login'

type ConnState = 'idle' | 'connecting' | 'connected' | 'disconnected'

const STATUS: Record<ConnState, { dot: string; text: string; color: string }> = {
  idle: { dot: '○', text: '未连接', color: 'gray' },
  connecting: { dot: '◐', text: '连接中', color: 'yellow' },
  connected: { dot: '●', text: '已连接', color: 'green' },
  disconnected: { dot: '○', text: '已断开', color: 'yellow' },
}

const TONE_COLOR: Record<Tone, string> = {
  info: 'gray',
  warn: 'yellow',
  error: 'red',
  success: 'green',
}

export function App({ store, version }: { store: Store; version: string }) {
  const { exit } = useApp()
  const [self, setSelf] = useState<LoginUser | null>(store.self)
  const [connState, setConnState] = useState<ConnState>('idle')
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [mode, setMode] = useState<Mode>('chat')
  const [input, setInput] = useState('')
  const [loginValue, setLoginValue] = useState('')
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null)
  const [showInteract, setShowInteract] = useState(false)

  const logId = useRef(0)
  const clientRef = useRef<DanmuClient | null>(null)
  const generation = useRef(0)
  const connecting = useRef(false)
  const showInteractRef = useRef(showInteract)
  showInteractRef.current = showInteract

  const append = (entry: LogInput): void => {
    setLogs((prev) => [...prev, { ...entry, id: ++logId.current }])
  }

  const stopClient = (): void => {
    const client = clientRef.current
    clientRef.current = null
    client?.disconnect()
  }

  useEffect(() => {
    return () => {
      generation.current++
      stopClient()
    }
  }, [])

  const connectTo = async (target: string): Promise<void> => {
    if (connecting.current) {
      setNotice({ tone: 'warn', text: '正在连接中，请稍候' })
      return
    }
    connecting.current = true
    const token = ++generation.current
    stopClient()
    setConnState('connecting')
    setRoom(null)
    setNotice(null)

    try {
      const roomId = await resolveRoomId(target)
      const info = await getRoomInfo(roomId)
      if (token !== generation.current) {
        return
      }
      setRoom(info)
      append({
        kind: 'system',
        text: `连接直播间 ${roomId}${info.owner ? ` · ${info.owner}` : ''}`,
      })
      if (info.liveStatus !== 1) {
        append({ kind: 'system', tone: 'warn', text: '该直播间当前未开播，可能收不到弹幕' })
      }

      const auth = await Auth.create(roomId, store.cookie)
      if (token !== generation.current) {
        return
      }

      const client = new DanmuClient({
        autoReconnect: true,
        onOpen: () => {
          if (token !== generation.current) {
            return
          }
          setConnState('connected')
          append({ kind: 'system', text: '已连接' })
          store.recordRoom(info)
        },
        onClose: (code) => {
          if (token !== generation.current) {
            return
          }
          setConnState('disconnected')
          append({ kind: 'system', tone: 'warn', text: `连接关闭 (${code})` })
        },
        onError: (error) => {
          if (token !== generation.current) {
            return
          }
          append({ kind: 'system', tone: 'error', text: `连接错误: ${error.message}` })
        },
        logger: (line) => {
          if (token !== generation.current) {
            return
          }
          append({ kind: 'system', text: line })
        },
        onMessage: (message) => {
          if (token !== generation.current) {
            return
          }
          const event = parseEvent(message)
          if (!event) {
            return
          }
          if (event.type === 'interact' && !showInteractRef.current) {
            return
          }
          append({ kind: 'event', event })
        },
      })
      clientRef.current = client
      await client.connect(auth)
    } catch (error) {
      if (token === generation.current) {
        setConnState('idle')
        setNotice({ tone: 'error', text: `连接失败: ${errorText(error)}` })
      }
    } finally {
      connecting.current = false
    }
  }

  const closeRoom = (): void => {
    generation.current++
    stopClient()
    setConnState('idle')
    setRoom(null)
    setNotice(null)
    append({ kind: 'system', text: '已断开连接' })
  }

  const sendCurrent = async (text: string): Promise<void> => {
    if (!clientRef.current?.isOpen) {
      setNotice({ tone: 'warn', text: '尚未连接直播间，先 /connect' })
      setInput(text)
      return
    }
    if (!store.isLoggedIn) {
      setNotice({ tone: 'warn', text: '发送弹幕需要登录，先 /login' })
      setInput(text)
      return
    }
    if (!room) {
      return
    }
    try {
      await sendDanmu(store.cookie, room.roomId, text)
      append({ kind: 'self', text })
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) })
      setInput(text)
    }
  }

  const submitLogin = async (source?: string): Promise<void> => {
    try {
      let cookie: string
      let from = ''
      const browser = browserName(source ?? loginValue)
      if (browser) {
        setNotice({ tone: 'info', text: `正在读取 ${browser} 的 Cookie…` })
        const result = await readBrowserBilibiliCookie(browser)
        cookie = result.cookie
        from = ` · 来自 ${result.browser}（${result.profile}）`
      } else if (source) {
        cookie = normalizeCookie(await readFile(source, 'utf8'))
      } else {
        cookie = normalizeCookie(loginValue)
      }
      if (!cookie) {
        return
      }
      setNotice({ tone: 'info', text: '正在校验登录状态…' })
      const user = await validateCookie(cookie)
      store.setLogin(cookie, user)
      setSelf(user)
      setLoginValue('')
      setMode('chat')
      setNotice({ tone: 'success', text: `已登录 ${user.name}${from}` })
      append({ kind: 'system', text: `已登录 ${user.name} (@${user.uid})` })
    } catch (error) {
      setNotice({ tone: 'error', text: `登录失败: ${errorText(error)}` })
    }
  }

  const logout = (): void => {
    store.clearLogin()
    setSelf(null)
    append({ kind: 'system', text: '已退出登录，本地登录状态已清除' })
  }

  const openHistory = (): void => {
    const rooms = store.rooms()
    if (rooms.length === 0) {
      setMode('room')
      setNotice({ tone: 'info', text: '还没有连接历史，输入房间号' })
      return
    }
    setNotice(null)
    setMode('history')
  }

  const showStatus = (): void => {
    append({ kind: 'system', text: `登录: ${self ? `${self.name} (@${self.uid})` : '未登录'}` })
    append({
      kind: 'system',
      text:
        connState === 'connected' && room
          ? `连接: ${room.roomId}${room.owner ? ` · ${room.owner}` : ''}${room.title ? ` · ${room.title}` : ''}`
          : `连接: ${STATUS[connState].text}`,
    })
    append({ kind: 'system', text: `连接历史: ${store.rooms().length} 个直播间` })
    append({ kind: 'system', text: `互动消息: ${showInteract ? '显示' : '隐藏'}` })
  }

  const quit = (): void => {
    generation.current++
    stopClient()
    exit()
  }

  const handleSubmit = (raw: string): void => {
    const command = parseCommand(raw)
    setInput('')
    if (!command) {
      return
    }

    switch (command.type) {
      case 'send':
        void sendCurrent(command.text)
        break
      case 'connect':
        if (command.room) {
          void connectTo(command.room)
        } else {
          openHistory()
        }
        break
      case 'history':
        openHistory()
        break
      case 'close':
        closeRoom()
        break
      case 'status':
        showStatus()
        break
      case 'login':
        if (command.source) {
          void submitLogin(command.source)
        } else {
          setLoginValue('')
          setMode('login')
          setNotice({ tone: 'info', text: '粘贴完整 Cookie，或输入浏览器名直接读取（如 chrome）' })
        }
        break
      case 'logout':
        logout()
        break
      case 'interact': {
        const next = !showInteract
        setShowInteract(next)
        append({ kind: 'system', text: `互动消息已${next ? '显示' : '隐藏'}` })
        break
      }
      case 'help':
        for (const line of COMMAND_HELP) {
          append({ kind: 'system', text: line })
        }
        break
      case 'quit':
        quit()
        break
      case 'unknown':
        setNotice({ tone: 'warn', text: `未知命令 /${command.name}，输入 /help 查看命令` })
        break
    }
  }

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      quit()
      return
    }
    if (key.escape) {
      if (mode !== 'chat') {
        setMode('chat')
        setLoginValue('')
      }
      setNotice(null)
    }
  })

  const status = STATUS[connState]
  const historyOptions = store.rooms().map((item) => ({
    label: `${item.roomId} ${item.owner ?? item.title ?? ''} · ${item.visits} 次 · ${shortTime(item.lastConnectedAt)}`,
    value: String(item.roomId),
  }))
  historyOptions.push({ label: '输入其他房间号…', value: '__manual__' })

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor={connState === 'connected' ? 'green' : 'gray'} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="cyan">
            bili-danmu
          </Text>
          <Text>
            <Text color={status.color}>{status.dot}</Text>
            <Text> {status.text}</Text>
            {room ? (
              <Text dimColor>
                {' '}
                · {room.roomId}
                {room.owner ? ` ${room.owner}` : ''}
              </Text>
            ) : null}
          </Text>
        </Box>
        <Text dimColor>
          v{version} · {self ? `已登录 ${self.name}` : '未登录（发送弹幕前 /login）'}
        </Text>
      </Box>

      <Static items={logs}>
        {(entry) => <LogLine key={entry.id} entry={entry} />}
      </Static>

      <Box height={1}>
        {notice ? <Text color={TONE_COLOR[notice.tone]}>{notice.text}</Text> : <Text> </Text>}
      </Box>

      <Box height={1}>
        {mode === 'chat' ? (
          <Text dimColor>/connect /history /close /status /login /interact /help /quit</Text>
        ) : mode === 'history' ? (
          <Text dimColor>↑↓ 选择 · Enter 连接 · Esc 返回</Text>
        ) : mode === 'login' ? (
          <Text dimColor>粘贴 Cookie 或输入浏览器名（{BROWSERS.join(' / ')}） · Enter 校验 · Esc 取消</Text>
        ) : (
          <Text dimColor>输入房间号 · Enter 连接 · Esc 取消</Text>
        )}
      </Box>

      {mode === 'history' ? (
        <Select
          options={historyOptions}
          visibleOptionCount={Math.min(9, historyOptions.length)}
          onChange={(value) => {
            if (value === '__manual__') {
              setMode('room')
              return
            }
            setMode('chat')
            void connectTo(value)
          }}
        />
      ) : mode === 'login' ? (
        <Box>
          <Text color="cyan">Cookie ❯ </Text>
          <TextInput
            value={loginValue}
            onChange={setLoginValue}
            onSubmit={() => void submitLogin()}
            placeholder="SESSDATA=...; bili_jct=...; DedeUserID=..."
            mask="*"
          />
        </Box>
      ) : mode === 'room' ? (
        <Box>
          <Text color="cyan">房间号 ❯ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={(value) => {
              setInput('')
              setMode('chat')
              if (value.trim()) {
                void connectTo(value.trim())
              }
            }}
            placeholder="例如 545068"
          />
        </Box>
      ) : (
        <Box>
          <Text color={connState === 'connected' ? 'green' : 'gray'}>❯ </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={
              connState === 'connected' ? '输入弹幕，Enter 发送' : '输入 /connect 房间号 连接直播间'
            }
          />
        </Box>
      )}
    </Box>
  )
}

function LogLine({ entry }: { entry: LogEntry }) {
  if (entry.kind === 'event') {
    return <EventLine event={entry.event} />
  }
  if (entry.kind === 'self') {
    return (
      <Text>
        <Text dimColor>{timeString()} </Text>
        <Text color="green">[我] </Text>
        <Text>{entry.text}</Text>
      </Text>
    )
  }
  return (
    <Text color={entry.tone ? TONE_COLOR[entry.tone] : undefined} dimColor={!entry.tone || entry.tone === 'info'}>
      · {entry.text}
    </Text>
  )
}

const BROWSERS: BrowserName[] = ['chrome', 'edge', 'brave', 'firefox']

function browserName(input: string): BrowserName | undefined {
  const lower = input.trim().toLowerCase()
  return BROWSERS.find((name) => name === lower)
}

function normalizeCookie(raw: string): string {
  return raw
    .replace(/^\s*cookie\s*:\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .trim()
}

function shortTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const now = new Date()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (date.toDateString() === now.toDateString()) {
    return time
  }
  return `${date.getMonth() + 1}-${date.getDate()} ${time}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
