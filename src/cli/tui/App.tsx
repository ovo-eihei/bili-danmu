import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { useEffect, useRef, useState } from 'react'
import { Box, Static, Text, useApp, useInput } from 'ink'
import { ConfirmInput, Select } from '@inkjs/ui'
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
import { oscLink, UI_COLOR } from './format.js'
import { TextInput } from './TextInput.js'

type Tone = 'info' | 'warn' | 'error' | 'success'

type LogInput =
  | { kind: 'system'; text: string; tone?: Tone }
  | { kind: 'event'; event: LiveEvent }

type LogEntry = LogInput & { id: number }

type Mode = 'chat' | 'history' | 'room' | 'login'

type LoginStage = 'method' | 'browser' | 'paste' | 'confirm'

type ConnState = 'idle' | 'connecting' | 'connected' | 'disconnected'

const STATUS: Record<ConnState, { dot: string; text: string; color: string }> = {
  idle: { dot: '○', text: '未连接', color: UI_COLOR.dim },
  connecting: { dot: '◐', text: '连接中', color: UI_COLOR.warn },
  connected: { dot: '●', text: '已连接', color: UI_COLOR.success },
  disconnected: { dot: '○', text: '已断开', color: UI_COLOR.warn },
}

const TONE_COLOR: Record<Tone, string> = {
  info: UI_COLOR.info,
  warn: UI_COLOR.warn,
  error: UI_COLOR.error,
  success: UI_COLOR.success,
}

export function App({ store }: { store: Store }) {
  const { exit } = useApp()
  const [self, setSelf] = useState<LoginUser | null>(store.self)
  const [connState, setConnState] = useState<ConnState>('idle')
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [mode, setMode] = useState<Mode>('chat')
  const [input, setInput] = useState('')
  const [loginValue, setLoginValue] = useState('')
  const [loginStage, setLoginStage] = useState<LoginStage>('method')
  const [browserOptions, setBrowserOptions] = useState<DetectedBrowser[]>([])
  const [pendingBrowser, setPendingBrowser] = useState<BrowserName | null>(null)
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null)
  const [showInteract, setShowInteract] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [menuHidden, setMenuHidden] = useState(false)
  const [inputEpoch, setInputEpoch] = useState(0)

  const logId = useRef(0)
  const clientRef = useRef<DanmuClient | null>(null)
  const generation = useRef(0)
  const connecting = useRef(false)
  const loginBusy = useRef(false)
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
    append({ kind: 'system', text: '欢迎使用 bili-danmu' })
    append({
      kind: 'system',
      text: '/connect [房间号] 连接直播间 · /login 登录 · /help 查看全部命令',
    })
  }, [])

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
    setLoginStage('method')
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
      const text = `登录失败: ${errorText(error)}`
      setNotice({ tone: 'error', text })
      append({ kind: 'system', tone: 'error', text })
    }
  }

  const runBrowserLogin = async (browser: BrowserName): Promise<void> => {
    const label = browserLabel(browser)
    setNotice({ tone: 'info', text: `正在通过 ${label} 读取 Cookie…` })
    try {
      const result = await readBrowserBilibiliCookie(browser)
      await completeLogin(result.cookie, ` · 来自 ${label}（${result.profile}）`)
    } catch (error) {
      const text = `登录失败: ${errorText(error)}`
      setNotice({ tone: 'error', text })
      append({ kind: 'system', tone: 'error', text })
      setLoginStage(browserOptions.length > 0 ? 'browser' : 'method')
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
        setLoginStage(browserOptions.length > 0 ? 'browser' : 'method')
        return
      }
      await runBrowserLogin(browser)
    } finally {
      loginBusy.current = false
    }
  }

  const cancelCloseBrowser = (): void => {
    setPendingBrowser(null)
    setLoginStage(browserOptions.length > 0 ? 'browser' : 'method')
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
    setLoginStage('method')
    setMode('login')
    setNotice({ tone: 'info', text: '选择登录方式' })
  }

  const logout = (): void => {
    store.clearLogin()
    setSelf(null)
    append({ kind: 'system', text: '已退出登录，本地登录状态已清除' })
  }

  const toggleInteract = (): void => {
    const next = !showInteractRef.current
    showInteractRef.current = next
    setShowInteract(next)
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
          ? `连接: ${room.roomId}${room.owner ? ` · ${room.owner}` : ''}`
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
    // 重新挂载输入框，让光标落到填入内容的末尾
    setInputEpoch((epoch) => epoch + 1)
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
  const activeSuggestion = Math.min(suggestionIndex, Math.max(0, chatMenu.length - 1))

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      quit()
      return
    }
    if (key.ctrl && _input === 'o') {
      toggleInteract()
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
    if (key.escape) {
      if (chatMenu.length > 0) {
        setMenuHidden(true)
        setNotice(null)
        return
      }
      if (mode === 'login' && loginStage !== 'method') {
        setLoginStage(loginStage === 'confirm' ? 'browser' : 'method')
        setPendingBrowser(null)
        setLoginValue('')
        setNotice(null)
        return
      }
      if (mode !== 'chat') {
        setMode('chat')
        setLoginValue('')
        setLoginStage('method')
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
    label: `${item.roomId}${item.owner ? ` ${item.owner}` : ''} · ${item.visits} 次 · ${shortTime(item.lastConnectedAt)}`,
    value: String(item.roomId),
  }))
  historyOptions.push({ label: '输入其他房间号…', value: '__manual__' })

  const methodOptions = [
    { label: '粘贴 Cookie 或输入文件路径', value: '__paste__' },
    {
      label:
        browserOptions.length > 0
          ? '从浏览器读取 Cookie'
          : '从浏览器读取 Cookie（未检测到浏览器）',
      value: '__browser__',
    },
    { label: '取消', value: '__cancel__' },
  ]

  const browserMenuOptions = [
    ...browserOptions.map((browser) => ({
      label: `${browser.label}（读取 Cookie）`,
      value: browser.name,
    })),
    { label: '返回', value: '__back__' },
  ]

  return (
    <Box flexDirection="column" paddingX={1}>
      <Static items={logs}>
        {(entry) => <LogLine key={entry.id} entry={entry} selfUid={selfUid} />}
      </Static>

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
        loginStage === 'method' ? (
          <Select
            options={methodOptions}
            visibleOptionCount={methodOptions.length}
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
              if (browserOptions.length === 0) {
                setNotice({ tone: 'warn', text: '没有检测到已安装的浏览器，请粘贴 Cookie' })
                return
              }
              setLoginStage('browser')
              setNotice({ tone: 'info', text: '选择浏览器' })
            }}
          />
        ) : loginStage === 'browser' ? (
          <Select
            options={browserMenuOptions}
            visibleOptionCount={Math.min(6, browserMenuOptions.length)}
            onChange={(value) => {
              if (value === '__back__') {
                setLoginStage('method')
                setNotice({ tone: 'info', text: '选择登录方式' })
                return
              }
              void loginWithBrowser(value as BrowserName)
            }}
          />
        ) : loginStage === 'confirm' && pendingBrowser ? (
          <Box flexDirection="column">
            <Text color={UI_COLOR.warn}>
              关闭 {browserLabel(pendingBrowser)} 并继续？未保存的页面可能丢失。
            </Text>
            <Text dimColor>
              新版 Chrome/Edge 的 Cookie 可能因应用绑定加密读取失败，失败后请粘贴 Cookie。
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
            <Text color={UI_COLOR.accent}>Cookie ❯ </Text>
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
          <Text color={UI_COLOR.accent}>房间号 ❯ </Text>
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
          <Text color={connState === 'connected' ? UI_COLOR.success : UI_COLOR.dim}>❯ </Text>
          <TextInput
            key={`chat-${inputEpoch}`}
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
        <Text wrap="truncate-end">
          <Text color={status.color}>{status.dot} {status.text}</Text>
          {roomLabel ? <Text color={UI_COLOR.room}> {roomLabel}</Text> : null}
          <Text dimColor> · </Text>
          <Text color={self ? UI_COLOR.success : UI_COLOR.dim}>
            {self ? `已登录 ${self.name}` : '未登录'}
          </Text>
        </Text>
      </Box>

      <Box height={1}>
        <Text dimColor wrap="truncate-end">
          {mode === 'history'
            ? '↑↓ 选择 · Enter 连接 · Esc 返回'
            : mode === 'login'
              ? loginStage === 'method'
                ? '↑↓ 选择 · Enter 确认 · Esc 取消'
                : loginStage === 'browser'
                  ? '↑↓ 选择 · Enter 读取 · Esc 返回'
                  : loginStage === 'confirm'
                    ? 'y 关闭并继续 · n 取消'
                    : 'Enter 校验 · Esc 返回'
              : mode === 'room'
                ? '输入房间号 · Enter 连接 · Esc 取消'
                : chatMenu.length > 0
                  ? '↑↓ 选择 · Tab/Enter 补全 · Esc 收起'
                  : connState === 'connected'
                    ? 'Enter 发送 · / 命令建议 · /help'
                    : '输入 / 查看命令 · /connect 连接 · /login 登录'}
        </Text>
      </Box>

      <Box height={1}>
        <Text wrap="truncate-end">
          <Text color={UI_COLOR.hotkey} bold>Ctrl+O</Text>
          <Text color={showInteract ? UI_COLOR.success : UI_COLOR.dim}>
            {showInteract ? ' 隐藏互动消息' : ' 显示互动消息'}
          </Text>
          <Text dimColor> · /help 查看全部命令</Text>
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
    <Text color={entry.tone ? TONE_COLOR[entry.tone] : undefined} dimColor={!entry.tone}>
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
