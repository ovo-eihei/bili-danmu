import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, test, vi } from 'vitest'
import { Store } from '../../src/cli/store.js'
import { App } from '../../src/cli/tui/App.js'

vi.mock('../../src/cli/browser-cookies.js', () => ({
  detectBrowsers: () => [
    { name: 'chrome', label: 'Chrome' },
    { name: 'firefox', label: 'Firefox' },
  ],
  browserName: (input: string) =>
    ['chrome', 'edge', 'brave', 'firefox'].includes(input.trim().toLowerCase())
      ? input.trim().toLowerCase()
      : undefined,
  browserLabel: (name: string) => ({ chrome: 'Chrome', edge: 'Edge', brave: 'Brave', firefox: 'Firefox' })[name],
  isBrowserRunning: vi.fn(async () => true),
  closeBrowser: vi.fn(async () => true),
  readBrowserBilibiliCookie: vi.fn(async () => ({
    cookie: 'SESSDATA=s; bili_jct=c; DedeUserID=1',
    browser: 'chrome',
    profile: 'Default',
  })),
}))

vi.mock('../../src/core/login.js', () => ({
  validateCookie: vi.fn(async () => ({ uid: 1, name: '测试用户' })),
}))

const delay = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

function createStore(): Store {
  return new Store({ cwd: mkdtempSync(join(tmpdir(), 'bili-danmu-login-')) })
}

describe('登录流程', () => {
  test('/login 先选登录方式，再选浏览器；运行中先确认再关闭', async () => {
    const { closeBrowser } = await import('../../src/cli/browser-cookies.js')
    const { lastFrame, stdin, unmount } = render(<App store={createStore()} />)

    stdin.write('/login')
    await delay(20)
    stdin.write('\r')
    await delay()

    expect(lastFrame()).toContain('粘贴 Cookie')
    expect(lastFrame()).toContain('从浏览器读取 Cookie')
    expect(lastFrame()).not.toContain('Chrome（读取 Cookie）')

    stdin.write('\u001B[B')
    await delay()
    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('Chrome（读取 Cookie）')
    expect(lastFrame()).toContain('Firefox（读取 Cookie）')

    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('关闭 Chrome 并继续？')

    await delay(50)
    stdin.write('n')
    await delay(200)
    expect(lastFrame()).toContain('已取消，未关闭浏览器')
    expect(vi.mocked(closeBrowser)).not.toHaveBeenCalled()

    stdin.write('\r')
    await delay()
    await delay(50)
    stdin.write('y')
    await delay(300)

    expect(vi.mocked(closeBrowser)).toHaveBeenCalledWith('chrome')
    expect(lastFrame()).toContain('已登录 测试用户')

    unmount()
  })
})
