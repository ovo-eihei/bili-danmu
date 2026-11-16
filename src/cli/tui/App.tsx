import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { ConfirmInput, Select } from '@inkjs/ui'
import TextInput from 'ink-text-input'
import { Auth } from '../../core/auth.js'
import { DanmuClient } from '../../core/client.js'
import { COMMAND_HELP, parseCommand } from '../commands.js'
import { suggest } from '../completions.js'
import type { Suggestion } from '../completions.js'
import { parseEvent } from '../../core/events.js'
import type { LiveEvent } from '../../core/events.js'
import { validateCookie } from '../../core/login.js'
import type { LoginUser } from '../../core/login.js'
import { getRoomInfo, resolveRoomId } from '../../core/room.js'
import type { RoomInfo } from '../../core/room.js'
import { sendDanmu } from '../../core/send.js'
import { browserLabel, browserName, closeBrowser, detectBrowsers, isBrowserRunning, readBrowserBilibiliCookie } from '../browser-cookies.js'
import type { BrowserName, DetectedBrowser } from '../browser-cookies.js'
import type { Store } from '../store.js'
import { EventLine } from './EventLine.js'
import { oscLink } from './format.js'

type Tone = 'info' | 'warn' | 'error' | 'success'

type LogInput =
  | { kind: 'system'; text: string; tone?: Tone }
  | { kind: 'event'; event: LiveEvent }

type LogEntry = LogInput & { id: number }

type Mode = 'chat' | 'history' | 'room' | 'login'

type LoginStage = 'select' | 'paste' | 'confirm'

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

const MAX_LOGS = 500

export function App({ store }: { store: Store }) {
  const { exit } = useApp()
  const [self, setSelf] = useState<LoginUser | null>(store.self)
  const [connState, setConnState] = useState<ConnState>('idle')
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [mode, setMode] = useState<Mode>('chat')
  const [input, setInput] = useState('')
  const [loginValue, setLoginValue] = useState('')
  const [loginStage, setLoginStage] = useState<LoginStage>('select')
  const [browserOptions, setBrowserOptions] = useState<DetectedBrowser[]>([])
  const [pendingBrowser, setPendingBrowser] = useState<BrowserName | null>(null)
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null)
  const [showInteract, setShowInteract] = useState(false)
  const [rows, setRows] = useState(process.stdout.rows ?? 24)
  const [scroll, setScroll] = useState(0)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [menuHidden, setMenuHidden] = useState(false)

  const logId = useRef(0)
  const clientRef = useRef<DanmuClient | null>(null)
  const generation = useRef(0)
  const connecting = useRef(false)
  const loginBusy = useRef(false)
  const showInteractRef = useRef(showInteract)
  showInteractRef.current = showInteract
  const logCount = useRef(0)

  const append = (entry: LogInput): void => {
    setLogs((prev) => {
      const next = [...prev, { ...entry, id: ++logId.current }]
      return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next
    })
  }

  const stopClient = (): void => {
    const client = clientRef.current
    clientRef.current = null
    client?.disconnect()
  }

  useEffect(() => {
    append({ kind: 'system', text: '欢迎使用 bili-danmu' })
    append({
      kind: 'system',
      text: '/connect [房间号] 连接直播间 · /login 登录 · /help 查看全部命令',
    })
    append({ kind: 'system', text: 'Tab 补全命令与历史房间号' })
  }, [])

  useEffect(() => {
    return () => {
      generation.current++
      stopClient()
    }
  }, [])

  useEffect(() => {
    const onResize = (): void => {
      const columns = process.stdout.columns ?? 80
      const nextRows = process.stdout.rows ?? 24
      setRows(nextRows)
      const text = `终端已调整为 ${columns}×${nextRows}`
      setNotice({ tone: 'info', text })
      setTimeout(() => setNotice((prev) => (prev?.text === text ? null : prev)), 1500)
    }
    process.stdout.on('resize', onResize)
    return () => {
      process.stdout.off('resize', onResize)
    }
  }, [])

  useEffect(() => {
    const appended = logs.length - logCount.current
    logCount.current = logs.length
    if (appended > 0) {
      // 正在翻历史时把视口钉在原地，新弹幕进到底部而不打断阅读
      setScroll((current) => (current > 0 ? current + appended : 0))
    }
  }, [logs.length])

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
    setScroll(0)

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
    setScroll(0)
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
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', text: errorText(error) })
      setInput(text)
    }
  }

  const completeLogin = async (cookie: string, from: string): Promise<void> => {
    setNotice({ tone: 'info', text: '正在校验登录状态…' })
    const user = await validateCookie(cookie)
    store.setLogin(cookie, user)
    setSelf(user)
    setLoginValue('')
    setMode('chat')
    setLoginStage('select')
    setPendingBrowser(null)
    setNotice({ tone: 'success', text: `已登录 ${user.name}${from}` })
    append({ kind: 'system', text: `已登录 ${user.name} (@${user.uid})` })
  }

  const submitLogin = async (source?: string): Promise<void> => {
    try {
      const singleLine = loginValue.trim()
      const cookie = source
        ? normalizeCookie(await readFile(source, 'utf8'))
        : singleLine && existsSync(singleLine)
          ? normalizeCookie(await readFile(singleLine, 'utf8'))
          : normalizeCookie(loginValue)
      if (!cookie) {
        return
      }
      await completeLogin(cookie, '')
    } catch (error) {
      setNotice({ tone: 'error', text: `登录失败: ${errorText(error)}` })
    }
  }

  const runBrowserLogin = async (browser: BrowserName): Promise<void> => {
    const label = browserLabel(browser)
    setNotice({ tone: 'info', text: `正在通过 ${label} 读取 Cookie…` })
    try {
      const result = await readBrowserBilibiliCookie(browser)
      await completeLogin(result.cookie, ` · 来自 ${label}（${result.profile}）`)
    } catch (error) {
      setNotice({ tone: 'error', text: `登录失败: ${errorText(error)}` })
      setLoginStage(browserOptions.length > 0 ? 'select' : 'paste')
    }
  }

  const loginWithBrowser = async (browser: BrowserName): Promise<void> => {
    if (loginBusy.current) {
      return
    }
    loginBusy.current = true
    try {
      const label = browserLabel(browser)
      setNotice({ tone: 'info', text: `正在检查 ${label} 是否在运行…` })
      if (await isBrowserRunning(browser)) {
        setPendingBrowser(browser)
        setLoginStage('confirm')
        setNotice({
          tone: 'warn',
          text: `${label} 正在运行，读取 Cookie 需要先关闭；确认后会关闭所有 ${label} 窗口（必要时强制结束）`,
        })
        return
      }
      setPendingBrowser(null)
      await runBrowserLogin(browser)
    } finally {
      loginBusy.current = false
    }
  }

  const confirmCloseBrowser = async (): Promise<void> => {
    const browser = pendingBrowser
    if (!browser || loginBusy.current) {
      return
    }
    loginBusy.current = true
    try {
      const label = browserLabel(browser)
      setNotice({ tone: 'info', text: `正在关闭 ${label}…` })
      if (!(await closeBrowser(browser))) {
        setNotice({ tone: 'error', text: `${label} 没有退出，请手动关闭窗口后重新选择` })
        setPendingBrowser(null)
        setLoginStage(browserOptions.length > 0 ? 'select' : 'paste')
        return
      }
      await runBrowserLogin(browser)
    } finally {
      loginBusy.current = false
    }
  }

  const cancelCloseBrowser = (): void => {
    setPendingBrowser(null)
    setLoginStage(browserOptions.length > 0 ? 'select' : 'paste')
    setNotice({ tone: 'info', text: '已取消，未关闭浏览器' })
  }

  const openLogin = (source?: string): void => {
    if (source) {
      const browser = browserName(source)
      if (browser) {
        void loginWithBrowser(browser)
        return
      }
      void submitLogin(source)
      return
    }

    setLoginValue('')
    setPendingBrowser(null)
    let detected: DetectedBrowser[] = []
    try {
      detected = detectBrowsers()
    } catch {
      detected = []
    }
    setBrowserOptions(detected)
    setLoginStage(detected.length > 0 ? 'select' : 'paste')
    setMode('login')
    setNotice({
      tone: 'info',
      text: detected.length > 0 ? '选择登录来源' : '粘贴 Cookie，或输入 Cookie 文件路径',
    })
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

  const applySuggestion = (item: Suggestion): void => {
    setInput(item.value)
    setSuggestionIndex(0)
    setMenuHidden(false)
    setNotice(null)
  }

  const handleChatChange = (value: string): void => {
    if (value.endsWith('\t')) {
      const base = value.slice(0, -1)
      const items = suggest(base, store.rooms())
      if (items.length === 0) {
        setInput(base)
        setNotice({ tone: 'warn', text: '没有匹配的补全项' })
        return
      }
      applySuggestion(items[Math.min(suggestionIndex, items.length - 1)])
      return
    }
    setInput(value)
    setSuggestionIndex(0)
    setMenuHidden(false)
  }

  const handleSubmit = (raw: string): void => {
    const items = suggest(raw, store.rooms())
    if (!menuHidden && items.length > 0) {
      const active = items[Math.min(suggestionIndex, items.length - 1)]
      if (raw.trim() !== active.value.trim()) {
        applySuggestion(active)
        return
      }
    }

    const command = parseCommand(raw)
    setInput('')
    setSuggestionIndex(0)
    setMenuHidden(false)
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
        openLogin(command.source)
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

  const chatMenu = mode === 'chat' && !menuHidden ? suggest(input, store.rooms()) : []
  const overlayLines =
    mode === 'chat'
      ? chatMenu.length
      : mode === 'login'
        ? loginStage === 'select'
          ? Math.min(6, browserOptions.length + 2)
          : loginStage === 'confirm'
            ? 2
            : 0
        : mode === 'history'
          ? Math.min(9, store.rooms().length + 1)
          : 0
  const activeSuggestion = Math.min(suggestionIndex, Math.max(0, chatMenu.length - 1))
  const logHeight = Math.max(3, rows - 5 - overlayLines)
  const maxScroll = Math.max(0, logs.length - logHeight)
  const scrollOffset = Math.min(scroll, maxScroll)
  const logEnd = Math.max(0, logs.length - scrollOffset)
  const visibleLogs = logs.slice(Math.max(0, logEnd - logHeight), logEnd)
  const pageStep = Math.max(2, logHeight - 2)

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      quit()
      return
    }
    if (chatMenu.length > 0) {
      if (key.upArrow) {
        setSuggestionIndex((index) => (index - 1 + chatMenu.length) % chatMenu.length)
        return
      }
      if (key.downArrow) {
        setSuggestionIndex((index) => (index + 1) % chatMenu.length)
        return
      }
    }
    if (key.pageUp) {
      setScroll((current) => Math.min(maxScroll, current + pageStep))
      return
    }
    if (key.pageDown) {
      setScroll((current) => Math.max(0, current - pageStep))
      return
    }
    if (key.escape) {
      if (chatMenu.length > 0) {
        setMenuHidden(true)
        setNotice(null)
        return
      }
      if (scrollOffset > 0) {
        setScroll(0)
        setNotice(null)
        return
      }
      if (mode !== 'chat') {
        setMode('chat')
        setLoginValue('')
        setLoginStage('select')
        setPendingBrowser(null)
      }
      setNotice(null)
    }
  })

  const status = STATUS[connState]
  const selfUid = self ? String(self.uid) : undefined
  const roomLabel = room
    ? `${oscLink(String(room.roomId), `https://live.bilibili.com/${room.roomId}`)}${room.owner ? ` ${room.owner}` : ''}`
    : ''
  const historyOptions = store.rooms().map((item) => ({
    label: `${item.roomId} ${item.owner ?? item.title ?? ''} · ${item.visits} 次 · ${shortTime(item.lastConnectedAt)}`,
    value: String(item.roomId),
  }))
  historyOptions.push({ label: '输入其他房间号…', value: '__manual__' })

  const loginOptions = [
    ...browserOptions.map((browser) => ({
      label: `${browser.label}（读取 Cookie）`,
      value: browser.name,
    })),
    { label: '粘贴 Cookie 或输入文件路径', value: '__paste__' },
    { label: '取消', value: '__cancel__' },
  ]

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        {visibleLogs.map((entry) => (
          <LogLine key={entry.id} entry={entry} selfUid={selfUid} />
        ))}
      </Box>

      <Box height={1}>
        {notice ? (
          <Text color={TONE_COLOR[notice.tone]} wrap="truncate-end">
            {notice.text}
          </Text>
        ) : (
          <Text> </Text>
        )}
      </Box>

      {mode === 'history' ? (
        <Select
          options={historyOptions}
          visibleOptionCount={Math.min(9, historyOptions.length, Math.max(3, rows - 8))}
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
        loginStage === 'select' ? (
          <Select
            options={loginOptions}
            visibleOptionCount={Math.min(6, loginOptions.length)}
            onChange={(value) => {
              if (value === '__paste__') {
                setLoginStage('paste')
                setNotice({ tone: 'info', text: '粘贴 Cookie，或输入 Cookie 文件路径' })
                return
              }
              if (value === '__cancel__') {
                setMode('chat')
                setNotice(null)
                return
              }
              void loginWithBrowser(value as BrowserName)
            }}
          />
        ) : loginStage === 'confirm' && pendingBrowser ? (
          <Box flexDirection="column">
            <Text color="yellow">
              关闭 {browserLabel(pendingBrowser)} 并继续？未保存的页面可能丢失。
            </Text>
            <Box>
              <Text>关闭后继续 </Text>
              <ConfirmInput
                defaultChoice="cancel"
                submitOnEnter={false}
                onConfirm={() => void confirmCloseBrowser()}
                onCancel={cancelCloseBrowser}
              />
              <Text dimColor>（y 关闭 · n 取消）</Text>
            </Box>
          </Box>
        ) : (
          <Box>
            <Text color="cyan">Cookie ❯ </Text>
            <TextInput
              value={loginValue}
              onChange={setLoginValue}
              onSubmit={() => void submitLogin()}
              placeholder="粘贴 Cookie，或输入 Cookie 文件路径"
              mask="*"
            />
          </Box>
        )
      ) : mode === 'room' ? (
        <Box>
          <Text color="cyan">房间号 ❯ </Text>
          <TextInput
            value={input}
            onChange={(value) => setInput(value.replace(/\t/g, ''))}
            onSubmit={(value) => {
              setInput('')
              setMode('chat')
              if (value.trim()) {
                void connectTo(value.trim())
              }
            }}
            placeholder="例如 22603245"
          />
        </Box>
      ) : (
        <Box>
          <Text color={connState === 'connected' ? 'green' : 'gray'}>❯ </Text>
          <TextInput
            value={input}
            onChange={handleChatChange}
            onSubmit={handleSubmit}
            placeholder={
              connState === 'connected' ? '输入弹幕，Enter 发送' : '输入 /connect 房间号 连接直播间'
            }
          />
        </Box>
      )}

      {chatMenu.length > 0 ? (
        <Box flexDirection="column">
          {chatMenu.map((item, index) => (
            <Text
              key={item.value}
              inverse={index === activeSuggestion}
              color={index === activeSuggestion ? undefined : 'gray'}
              wrap="truncate-end"
            >
              {' '}
              {item.label}
              {item.hint ? `  ${item.hint}` : ''}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box height={1}>
        <Text dimColor wrap="truncate-end">
          {status.dot} {status.text}
          {roomLabel ? ` ${roomLabel}` : ''} · {self ? `已登录 ${self.name}` : '未登录'}
        </Text>
      </Box>

      <Box height={1}>
        <Text dimColor wrap="truncate-end">
          {mode === 'history'
            ? '↑↓ 选择 · Enter 连接 · Esc 返回'
            : mode === 'login'
              ? loginStage === 'select'
                ? '↑↓ 选择 · Enter 确认 · Esc 取消'
                : loginStage === 'confirm'
                  ? 'y 关闭并继续 · n 取消'
                  : 'Enter 校验 · Esc 取消'
              : mode === 'room'
                ? '输入房间号 · Enter 连接 · Esc 取消'
                : scrollOffset > 0
                  ? `历史 ${logEnd}/${logs.length} · PgUp/PgDn 翻页 · Esc 回到底部`
                  : chatMenu.length > 0
                    ? '↑↓ 选择 · Tab/Enter 补全 · Esc 收起'
                    : connState === 'connected'
                      ? 'Enter 发送 · / 命令建议 · PgUp 历史 · /help'
                      : '输入 / 查看命令 · PgUp 历史 · /history 连接 · /login 登录'}
        </Text>
      </Box>
    </Box>
  )
}

function LogLine({ entry, selfUid }: { entry: LogEntry; selfUid?: string }) {
  if (entry.kind === 'event') {
    return <EventLine event={entry.event} selfUid={selfUid} />
  }
  return (
    <Text color={entry.tone ? TONE_COLOR[entry.tone] : undefined} dimColor={!entry.tone || entry.tone === 'info'}>
      · {entry.text}
    </Text>
  )
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
