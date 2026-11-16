import { execFile } from 'node:child_process'
import { createDecipheriv, createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, platform, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const require = createRequire(import.meta.url)

export type BrowserName = 'chrome' | 'edge' | 'brave' | 'firefox'

export interface BrowserCookieResult {
  cookie: string
  browser: BrowserName
  profile: string
}

const COOKIE_NAMES = ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3', 'buvid4']
const REQUIRED = ['SESSDATA', 'bili_jct', 'DedeUserID']

/** 从本机浏览器读取 bilibili.com 的登录 Cookie。只读取需要的几个字段。 */
export async function readBrowserBilibiliCookie(browser: BrowserName): Promise<BrowserCookieResult> {
  const result = browser === 'firefox' ? await readFirefox() : await readChromium(browser)
  const missing = REQUIRED.filter((name) => !result.values[name])
  if (missing.length > 0) {
    throw new Error(`${browser} 里没有找到 ${missing.join('、')}，请确认已登录 bilibili.com`)
  }
  const cookie = COOKIE_NAMES.filter((name) => result.values[name])
    .map((name) => `${name}=${result.values[name]}`)
    .join('; ')
  return { cookie, browser, profile: result.profile }
}

interface RawCookies {
  values: Record<string, string>
  profile: string
}

function chromiumRoot(browser: Exclude<BrowserName, 'firefox'>): string {
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

async function readChromium(browser: Exclude<BrowserName, 'firefox'>): Promise<RawCookies> {
  const root = chromiumRoot(browser)
  if (!existsSync(root)) {
    throw new Error(`没有找到 ${browser} 的数据目录: ${root}`)
  }

  const profiles = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => cookieDbPath(dir) !== undefined)
    .sort((a, b) => Number(b.endsWith('Default')) - Number(a.endsWith('Default')))

  if (profiles.length === 0) {
    throw new Error(`${browser} 数据目录里没有可用的 Cookie 数据库`)
  }

  const key = await chromiumKey(root)
  let lastError: unknown

  for (const profileDir of profiles) {
    try {
      const values = readChromiumProfile(cookieDbPath(profileDir)!, key)
      if (REQUIRED.some((name) => values[name])) {
        return { values, profile: profileDir.slice(root.length + 1) }
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }
  throw new Error(`${browser} 中没有 bilibili.com 的登录 Cookie`)
}

function cookieDbPath(profileDir: string): string | undefined {
  for (const candidate of [join(profileDir, 'Network', 'Cookies'), join(profileDir, 'Cookies')]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

function readChromiumProfile(dbPath: string, key: Buffer): Record<string, string> {
  const temp = copySqliteToTemp(dbPath)
  try {
    const { DatabaseSync } = requireSqlite()
    const db = new DatabaseSync(join(temp.dir, 'Cookies'), { readOnly: true })
    try {
      const placeholders = COOKIE_NAMES.map(() => '?').join(', ')
      const rows = db
        .prepare(
          `SELECT host_key, name, value, encrypted_value FROM cookies
           WHERE name IN (${placeholders}) AND host_key LIKE '%bilibili.com'`,
        )
        .all(...COOKIE_NAMES) as Array<{
        host_key: string
        name: string
        value: string
        encrypted_value: Uint8Array | null
      }>

      const values: Record<string, string> = {}
      for (const row of rows) {
        const plain = row.value || decryptChromiumValue(Buffer.from(row.encrypted_value ?? []), key, row.host_key)
        if (plain) {
          values[row.name] = plain
        }
      }
      return values
    } finally {
      db.close()
    }
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
}

async function chromiumKey(root: string): Promise<Buffer> {
  const localStatePath = join(root, 'Local State')
  if (!existsSync(localStatePath)) {
    throw new Error('浏览器缺少 Local State，无法解密 Cookie')
  }
  const encryptedKey = JSON.parse(readFileSync(localStatePath, 'utf8'))?.os_crypt?.encrypted_key
  if (typeof encryptedKey !== 'string' || !encryptedKey) {
    throw new Error('Local State 里没有 os_crypt.encrypted_key')
  }
  const raw = Buffer.from(encryptedKey, 'base64')
  const key = raw.subarray(0, 5).toString() === 'DPAPI' ? raw.subarray(5) : raw
  if (platform() !== 'win32') {
    throw new Error('当前系统暂不支持自动解密 Chromium 浏览器 Cookie，请手动粘贴')
  }
  return dpapiUnprotect(key)
}

export function decryptChromiumValue(encrypted: Buffer, key: Buffer, hostKey: string): string {
  if (encrypted.length === 0) {
    return ''
  }
  const prefix = encrypted.subarray(0, 3).toString()
  if (prefix === 'v20' || prefix === 'v24') {
    throw new Error('浏览器 Cookie 使用了应用绑定加密（Chrome/Edge 127+），无法直接读取，请手动粘贴')
  }
  if (prefix !== 'v10' && prefix !== 'v11') {
    throw new Error(`未知的 Cookie 加密格式: ${prefix}`)
  }

  const nonce = encrypted.subarray(3, 15)
  const payload = encrypted.subarray(15)
  const tag = payload.subarray(payload.length - 16)
  const data = payload.subarray(0, payload.length - 16)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(data), decipher.final()])
    // 新版 Chromium 在明文末尾附 32 字节 host_key 摘要，老数据没有
    if (plain.length > 32 && plain.subarray(plain.length - 32).equals(sha256(hostKey))) {
      return plain.subarray(0, plain.length - 32).toString('utf8')
    }
    return plain.toString('utf8')
  } catch {
    throw new Error('Cookie 解密失败（DPAPI 密钥可能已变化），请手动粘贴')
  }
}

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest()
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

function copySqliteToTemp(dbPath: string): { dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bili-danmu-cookies-'))
  const base = basename(dbPath)
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

async function readFirefox(): Promise<RawCookies> {
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
             WHERE name IN (${placeholders}) AND host LIKE '%bilibili.com'`,
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

/** 用 Windows DPAPI 解密 Chromium 的 AES 密钥；密钥通过 stdin 传入，不进 argv。 */
function dpapiUnprotect(encrypted: Buffer): Promise<Buffer> {
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$b64=[Console]::In.ReadLine()',
    '$p=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b64),$null,\'CurrentUser\')',
    '[Console]::Out.Write([Convert]::ToBase64String($p))',
  ].join('; ')

  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`DPAPI 解密失败: ${error.message}`))
          return
        }
        resolve(Buffer.from(stdout.trim(), 'base64'))
      },
    )
    child.stdin?.end(encrypted.toString('base64'))
  })
}
