import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserLabel,
  browserName,
  detectBrowsers,
  readBrowserBilibiliCookie,
} from '../../src/cli/browser-cookies.js'

describe('browserName / browserLabel', () => {
  it('识别浏览器名', () => {
    expect(browserName('Chrome')).toBe('chrome')
    expect(browserName(' firefox ')).toBe('firefox')
    expect(browserName('safari')).toBeUndefined()
    expect(browserLabel('edge')).toBe('Edge')
  })
})

describe.runIf(process.platform === 'win32')('detectBrowsers', () => {
  let dir: string | undefined

  afterEach(() => {
    vi.unstubAllEnvs()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('列出已安装的浏览器', () => {
    dir = mkdtempSync(join(tmpdir(), 'bili-danmu-detect-'))
    const local = join(dir, 'Local')
    const programFiles = join(dir, 'Program Files')
    const programFilesX86 = join(dir, 'Program Files (x86)')
    vi.stubEnv('LOCALAPPDATA', local)
    vi.stubEnv('PROGRAMFILES', programFiles)
    vi.stubEnv('PROGRAMFILES(X86)', programFilesX86)
    vi.stubEnv('APPDATA', join(dir, 'Roaming'))

    mkdirSync(join(local, 'Google', 'Chrome', 'User Data'), { recursive: true })
    const edge = join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    mkdirSync(join(programFilesX86, 'Microsoft', 'Edge', 'Application'), { recursive: true })
    writeFileSync(edge, '')

    expect(detectBrowsers().map((browser) => browser.label)).toEqual(['Chrome', 'Edge'])
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
