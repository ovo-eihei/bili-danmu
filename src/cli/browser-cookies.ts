import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, platform, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import WebSocket from 'ws'

const require = createRequire(import.meta.url)

export type BrowserName = 'chrome' | 'edge' | 'brave' | 'firefox'
export type ChromiumName = Exclude<BrowserName, 'firefox'>

export interface DetectedBrowser {
  name: BrowserName
  label: string
}

export interface BrowserCookieResult {
  cookie: string
  browser: BrowserName
  profile: string
}

const COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3', 'buvid4']
const REQUIRED = ['SESSDATA', 'bili_jct', 'DedeUserID']
const BROWSER_NAMES: BrowserName[] = ['chrome', 'edge', 'brave', 'firefox']

const LABELS: Record<BrowserName, string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  brave: 'Brave',
  firefox: 'Firefox',
}

/** 按名称识别浏览器（/login chrome 这类直接指定来源）。 */
export function browserName(input: string): BrowserName | undefined {
  const lower = input.trim().toLowerCase()
  return BROWSER_NAMES.find((name) => name === lower)
}

export function browserLabel(name: BrowserName): string {
  return LABELS[name]
}

/** 检测本机安装的浏览器；Chromium 系要求能找到数据目录或可执行文件。 */
export function detectBrowsers(): DetectedBrowser[] {
  const found: DetectedBrowser[] = []
  for (const name of ['chrome', 'edge', 'brave'] as ChromiumName[]) {
    if (existsSync(chromiumRoot(name)) || chromiumExecutable(name)) {
      found.push({ name, label: LABELS[name] })
    }
  }
  if (firefoxInstalled()) {
    found.push({ name: 'firefox', label: LABELS.firefox })
  }
  return found
}

/** 浏览器进程是否在运行；Chromium 系运行时会独占 Cookie 数据库。 */
export async function isBrowserRunning(browser: BrowserName): Promise<boolean> {
  if (platform() === 'win32') {
    const image = { chrome: 'chrome.exe', edge: 'msedge.exe', brave: 'brave.exe', firefox: 'firefox.exe' }[
      browser
    ]
    try {
      const output = await run('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'])
      return output.toLowerCase().includes(image)
    } catch {
      return false
    }
  }

  const processName =
    platform() === 'darwin'
      ? { chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave Browser', firefox: 'firefox' }[browser]
      : { chrome: 'chrome', edge: 'msedge', brave: 'brave', firefox: 'firefox' }[browser]
  try {
    await run('pgrep', ['-x', processName])
    return true
  } catch {
    return false
  }
}

/**
 * 关闭浏览器：先请求正常退出，5 秒内没退就强制结束（用户已确认关闭）。
 * 返回 false 表示进程仍在运行。
 */
export async function closeBrowser(browser: BrowserName): Promise<boolean> {
  if (!(await isBrowserRunning(browser))) {
    return true
  }
  const image = { chrome: 'chrome.exe', edge: 'msedge.exe', brave: 'brave.exe', firefox: 'firefox.exe' }[
    browser
  ]
  const processName =
    platform() === 'darwin'
      ? { chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave Browser', firefox: 'firefox' }[browser]
      : { chrome: 'chrome', edge: 'msedge', brave: 'brave', firefox: 'firefox' }[browser]

  if (platform() === 'win32') {
    await run('taskkill', ['/IM', image]).catch(() => '')
    if (await waitForExit(browser, 10)) {
      return true
    }
    // 后台常驻进程不会响应正常关闭，用户已授权关闭则强制结束
    await run('taskkill', ['/IM', image, '/F']).catch(() => '')
    return waitForExit(browser, 10)
  }

  await run('pkill', ['-x', processName]).catch(() => '')
  if (await waitForExit(browser, 10)) {
    return true
  }
  await run('pkill', ['-9', '-x', processName]).catch(() => '')
  return waitForExit(browser, 10)
}

async function waitForExit(browser: BrowserName, attempts: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    await sleep(500)
    if (!(await isBrowserRunning(browser))) {
      return true
    }
  }
  return false
}

/** 从本机浏览器读取 bilibili.com 的登录 Cookie。只读取需要的几个字段。 */
export async function readBrowserBilibiliCookie(browser: BrowserName): Promise<BrowserCookieResult> {
  if (browser === 'firefox') {
    return assemble('firefox', await readFirefox())
  }
  return readChromiumViaCdp(browser)
}

function assemble(browser: BrowserName, raw: { values: Record<string, string>; profile: string }): BrowserCookieResult {
  const missing = REQUIRED.filter((name) => !raw.values[name])
  if (missing.length > 0) {
    throw new Error(`${browser} 里没有找到 ${missing.join('、')}，请确认已登录 bilibili.com`)
  }
  const cookie = COOKIE_NAMES.filter((name) => raw.values[name])
    .map((name) => `${name}=${raw.values[name]}`)
    .join('; ')
  return { cookie, browser, profile: raw.profile }
}

function chromiumRoot(browser: ChromiumName): string {
  const os = platform()
  if (os === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    if (browser === 'chrome') return join(local, 'Google', 'Chrome', 'User Data')
    if (browser === 'edge') return join(local, 'Microsoft', 'Edge', 'User Data')
    return join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')
  }
  if (os === 'darwin') {
    const support = join(homedir(), 'Library', 'Application Support')
    if (browser === 'chrome') return join(support, 'Google', 'Chrome')
    if (browser === 'edge') return join(support, 'Microsoft Edge')
    return join(support, 'BraveSoftware', 'Brave-Browser')
  }
  const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  if (browser === 'chrome') return join(config, 'google-chrome')
  if (browser === 'edge') return join(config, 'microsoft-edge')
  return join(config, 'BraveSoftware', 'Brave-Browser')
}

function chromiumExecutable(browser: ChromiumName): string | undefined {
  const os = platform()
  const candidates: string[] = []
  if (os === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
    if (browser === 'chrome') {
      candidates.push(
        join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      )
    } else if (browser === 'edge') {
      candidates.push(
        join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      )
    } else {
      candidates.push(
        join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      )
    }
  } else if (os === 'darwin') {
    if (browser === 'chrome') candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    if (browser === 'edge') candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
    if (browser === 'brave') candidates.push('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser')
  } else {
    const names =
      browser === 'chrome'
        ? ['google-chrome', 'google-chrome-stable']
        : browser === 'edge'
          ? ['microsoft-edge', 'microsoft-edge-stable']
          : ['brave-browser']
    candidates.push(...findInPath(names))
  }
  return candidates.find((candidate) => existsSync(candidate))
}

function findInPath(names: string[]): string[] {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  return dirs.flatMap((dir) => names.map((name) => join(dir, name)))
}

function firefoxInstalled(): boolean {
  if (platform() === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
    return (
      existsSync(join(appData, 'Mozilla', 'Firefox')) ||
      existsSync(join(programFiles, 'Mozilla Firefox', 'firefox.exe'))
    )
  }
  if (platform() === 'darwin') {
    return existsSync(join(homedir(), 'Library', 'Application Support', 'Firefox')) ||
      existsSync('/Applications/Firefox.app')
  }
  return existsSync(join(homedir(), '.mozilla', 'firefox')) || findInPath(['firefox']).some(existsSync)
}

function cookieDbPath(profileDir: string): string | undefined {
  for (const candidate of [join(profileDir, 'Network', 'Cookies'), join(profileDir, 'Cookies')]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

interface ChromiumProfile {
  dbPath: string
  name: string
}

/** 找到带 bilibili 登录字段的配置目录；只查字段是否存在，不解密。 */
function findChromiumProfile(root: string): ChromiumProfile {
  const profiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => cookieDbPath(dir) !== undefined)
    .sort((a, b) => Number(b.endsWith('Default')) - Number(a.endsWith('Default')))

  if (profiles.length === 0) {
    throw new Error('浏览器数据目录里没有可用的 Cookie 数据库')
  }

  let lastError: unknown
  for (const profileDir of profiles) {
    const dbPath = cookieDbPath(profileDir)!
    try {
      if (hasBilibiliLogin(dbPath)) {
        return { dbPath, name: profileDir.slice(root.length + 1) }
      }
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) {
    throw new Error(`无法读取 Cookie 数据库（浏览器可能仍在运行）: ${errorText(lastError)}`)
  }
  throw new Error('浏览器中没有 bilibili.com 的登录 Cookie')
}

function hasBilibiliLogin(dbPath: string): boolean {
  const { DatabaseSync } = requireSqlite()
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const placeholders = REQUIRED.map(() => '?').join(', ')
    const row = db
      .prepare(
        `SELECT name FROM cookies
         WHERE name IN (${placeholders})
           AND (host_key = 'bilibili.com' OR host_key LIKE '%.bilibili.com')
         LIMIT 1`,
      )
      .get(...REQUIRED) as { name: string } | undefined
    return row !== undefined
  } finally {
    db.close()
  }
}

/**
 * Chromium 系：把 Cookie 数据库和 Local State 复制到临时配置档，
 * 用无头浏览器打开并通过 CDP 让浏览器自己解密（兼容 v10/v11 与 v20）。
 * 调用前必须先确认浏览器已退出。
 */
async function readChromiumViaCdp(browser: ChromiumName): Promise<BrowserCookieResult> {
  const root = chromiumRoot(browser)
  if (!existsSync(root)) {
    throw new Error(`没有找到 ${LABELS[browser]} 的数据目录: ${root}`)
  }
  if (await isBrowserRunning(browser)) {
    throw new Error(`${LABELS[browser]} 正在运行，关闭后才能读取 Cookie`)
  }
  const exe = chromiumExecutable(browser)
  if (!exe) {
    throw new Error(`没有找到 ${LABELS[browser]} 的可执行文件`)
  }

  const profile = findChromiumProfile(root)
  const tempDir = mkdtempSync(join(tmpdir(), 'bili-danmu-cdp-'))
  const cookieDir = join(tempDir, 'Default', 'Network')
  mkdirSync(cookieDir, { recursive: true })
  copyFileShared(profile.dbPath, join(cookieDir, 'Cookies'))
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(profile.dbPath + suffix)) {
      copyFileShared(profile.dbPath + suffix, join(cookieDir, `Cookies${suffix}`))
    }
  }
  const localState = join(root, 'Local State')
  if (existsSync(localState)) {
    copyFileShared(localState, join(tempDir, 'Local State'))
  }

  const child = spawn(
    exe,
    [
      '--headless=new',
      `--user-data-dir=${tempDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-sync',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )

  try {
    const port = await waitForDebugPort(tempDir, child)
    const cookies = await cdpGetAllCookies(port)
    const values: Record<string, string> = {}
    for (const cookie of cookies) {
      if (!COOKIE_NAMES.includes(cookie.name) || !cookie.value || !isBilibiliHost(cookie.domain)) {
        continue
      }
      values[cookie.name] = cookie.value
    }
    return assemble(browser, { values, profile: profile.name })
  } finally {
    killTree(child)
    await waitForChildExit(child, 3000)
    // 临时配置档里是 Cookie 数据库，尽量清掉；文件句柄未释放时重试几次
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
        break
      } catch {
        await sleep(200)
      }
    }
  }
}

function waitForChildExit(child: ChildProcess, timeout: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeout)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function isBilibiliHost(host: string): boolean {
  return host === 'bilibili.com' || host.endsWith('.bilibili.com')
}

function waitForDebugPort(dir: string, child: ChildProcess): Promise<number> {
  const portFile = join(dir, 'DevToolsActivePort')
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000
    const timer = setInterval(() => {
      if (child.exitCode !== null) {
        clearInterval(timer)
        reject(new Error('无头浏览器启动后立即退出，可能是配置档被占用'))
        return
      }
      if (existsSync(portFile)) {
        const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
        if (Number.isInteger(port) && port > 0) {
          clearInterval(timer)
          resolve(port)
          return
        }
      }
      if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error('无头浏览器启动超时'))
      }
    }, 100)
  })
}

interface CdpCookie {
  name: string
  value: string
  domain: string
}

async function cdpGetAllCookies(port: number): Promise<CdpCookie[]> {
  const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
    response.json(),
  )) as { webSocketDebuggerUrl?: string }
  // Network 域只存在于页面 target 上，浏览器级端点没有 Network.enable
  const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
    response.json(),
  )) as Array<{ type: string; webSocketDebuggerUrl?: string }>
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  const url = page?.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl
  if (!url) {
    throw new Error('无法连接无头浏览器的调试端口')
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map<
      number,
      { resolve: (value: any) => void; reject: (error: Error) => void }
    >()
    let id = 0

    const send = (method: string): Promise<any> =>
      new Promise((res, rej) => {
        const messageId = ++id
        pending.set(messageId, { resolve: res, reject: rej })
        socket.send(JSON.stringify({ id: messageId, method }))
      })

    socket.on('open', () => {
      void (async () => {
        try {
          await send('Network.enable')
          const result = await send('Network.getAllCookies')
          socket.close()
          resolve((result?.cookies ?? []) as CdpCookie[])
        } catch (error) {
          socket.close()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    })
    socket.on('message', (raw) => {
      let message: any
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (typeof message.id !== 'number') {
        return
      }
      const entry = pending.get(message.id)
      if (!entry) {
        return
      }
      pending.delete(message.id)
      if (message.error) {
        entry.reject(new Error(String(message.error.message)))
      } else {
        entry.resolve(message.result)
      }
    })
    socket.on('error', (error) => reject(error))
    socket.on('close', () => {
      for (const entry of pending.values()) {
        entry.reject(new Error('调试连接已关闭'))
      }
      pending.clear()
    })
  })
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) {
    return
  }
  if (platform() === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {})
  } else {
    child.kill('SIGTERM')
  }
}

function requireSqlite(): typeof import('node:sqlite') {
  try {
    // node:sqlite 在 Node 22.5+ 可用，延迟加载避免影响正常启动
    return require('node:sqlite') as typeof import('node:sqlite')
  } catch {
    throw new Error('当前 Node 版本缺少 node:sqlite，请升级到 Node 22.5+')
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readFirefox(): Promise<{ values: Record<string, string>; profile: string }> {
  const profiles = firefoxProfileDirs()
  if (profiles.length === 0) {
    throw new Error('没有找到 Firefox 配置目录')
  }

  for (const dir of profiles) {
    const dbPath = join(dir, 'cookies.sqlite')
    if (!existsSync(dbPath)) {
      continue
    }
    const temp = copySqliteToTemp(dbPath)
    try {
      const { DatabaseSync } = requireSqlite()
      const db = new DatabaseSync(join(temp.dir, 'cookies.sqlite'), { readOnly: true })
      try {
        const placeholders = COOKIE_NAMES.map(() => '?').join(', ')
        const rows = db
          .prepare(
            `SELECT host, name, value FROM moz_cookies
             WHERE name IN (${placeholders})
               AND (host = 'bilibili.com' OR host LIKE '%.bilibili.com')`,
          )
          .all(...COOKIE_NAMES) as Array<{ host: string; name: string; value: string }>
        const values: Record<string, string> = {}
        for (const row of rows) {
          if (row.value) {
            values[row.name] = row.value
          }
        }
        if (REQUIRED.some((name) => values[name])) {
          return { values, profile: dir }
        }
      } finally {
        db.close()
      }
    } catch {
      // 继续尝试下一个配置
    } finally {
      rmSync(temp.dir, { recursive: true, force: true })
    }
  }
  throw new Error('Firefox 中没有 bilibili.com 的登录 Cookie')
}

function firefoxProfileDirs(): string[] {
  const os = platform()
  const root =
    os === 'win32'
      ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Mozilla', 'Firefox')
      : os === 'darwin'
        ? join(homedir(), 'Library', 'Application Support', 'Firefox')
        : join(homedir(), '.mozilla', 'firefox')
  const profilesDir = join(root, 'Profiles')
  if (!existsSync(profilesDir)) {
    return []
  }
  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(profilesDir, entry.name))
    .sort((a, b) => Number(existsSync(join(b, 'cookies.sqlite'))) - Number(existsSync(join(a, 'cookies.sqlite'))))
}

function copySqliteToTemp(dbPath: string): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bili-danmu-cookies-'))
  const base = 'cookies.sqlite'
  try {
    copyFileShared(dbPath, join(dir, base))
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) {
        copyFileShared(dbPath + suffix, join(dir, base + suffix))
      }
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`无法读取浏览器 Cookie 数据库（浏览器可能正独占运行），可关闭浏览器后重试: ${errorText(error)}`)
  }
  return { dir }
}

// 浏览器运行时会锁住 Cookies 文件，按共享读打开再写副本，比 copyFile 更稳
function copyFileShared(from: string, to: string): void {
  writeFileSync(to, readFileSync(from))
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message)))
          return
        }
        resolve(String(stdout))
      },
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
