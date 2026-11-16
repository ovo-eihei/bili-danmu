import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptChromiumValue, readBrowserBilibiliCookie } from '../../src/cli/browser-cookies.js'

const key = randomBytes(32)

function encrypt(value: string, host: string, withDigest = true): Buffer {
  const nonce = randomBytes(12)
  const plaintext = withDigest
    ? Buffer.concat([Buffer.from(value, 'utf8'), createHash('sha256').update(host).digest()])
    : Buffer.from(value, 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([Buffer.from('v10'), nonce, data, cipher.getAuthTag()])
}

describe('decryptChromiumValue', () => {
  it('解密并去掉 host 摘要', () => {
    const encrypted = encrypt('abc123', '.bilibili.com')
    expect(decryptChromiumValue(encrypted, key, '.bilibili.com')).toBe('abc123')
  })

  it('兼容没有摘要后缀的老数据', () => {
    const encrypted = encrypt('abc123', '.bilibili.com', false)
    expect(decryptChromiumValue(encrypted, key, '.bilibili.com')).toBe('abc123')
  })

  it('空值返回空串', () => {
    expect(decryptChromiumValue(Buffer.alloc(0), key, '.bilibili.com')).toBe('')
  })

  it('应用绑定加密给出明确提示', () => {
    const abe = Buffer.concat([Buffer.from('v20'), randomBytes(48)])
    expect(() => decryptChromiumValue(abe, key, '.bilibili.com')).toThrow(/应用绑定加密/)
  })

  it('未知格式直接报错', () => {
    const odd = Buffer.concat([Buffer.from('zzz'), randomBytes(48)])
    expect(() => decryptChromiumValue(odd, key, '.bilibili.com')).toThrow(/未知的 Cookie 加密格式/)
  })

  it('密钥不对时报解密失败', () => {
    const encrypted = encrypt('abc123', '.bilibili.com')
    expect(() => decryptChromiumValue(encrypted, randomBytes(32), '.bilibili.com')).toThrow(/解密失败/)
  })
})

describe('readBrowserBilibiliCookie (firefox)', () => {
  let dir: string | undefined

  afterEach(() => {
    vi.unstubAllEnvs()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  function createProfile(cookies: Array<[string, string, string]>): void {
    dir = mkdtempSync(join(tmpdir(), 'bili-danmu-firefox-'))
    vi.stubEnv('APPDATA', dir)
    const profile = join(dir, 'Mozilla', 'Firefox', 'Profiles', 'test.default')
    mkdirSync(profile, { recursive: true })
    const db = new DatabaseSync(join(profile, 'cookies.sqlite'))
    db.exec('CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT)')
    const insert = db.prepare('INSERT INTO moz_cookies (host, name, value) VALUES (?, ?, ?)')
    for (const row of cookies) {
      insert.run(...row)
    }
    db.close()
  }

  it('只取 bilibili.com 的登录字段', async () => {
    createProfile([
      ['.bilibili.com', 'SESSDATA', 'sess'],
      ['.bilibili.com', 'bili_jct', 'csrf'],
      ['.bilibili.com', 'DedeUserID', '42'],
      ['.bilibili.com', 'buvid3', 'b3'],
      ['.example.com', 'SESSDATA', 'evil'],
    ])
    const result = await readBrowserBilibiliCookie('firefox')
    expect(result.cookie).toBe('SESSDATA=sess; bili_jct=csrf; DedeUserID=42; buvid3=b3')
  })

  it('缺关键字段时报错', async () => {
    createProfile([['.bilibili.com', 'SESSDATA', 'sess']])
    await expect(readBrowserBilibiliCookie('firefox')).rejects.toThrow(/没有找到/)
  })
})
