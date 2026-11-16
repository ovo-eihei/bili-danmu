import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'
import { Store } from '../../src/cli/store.js'
import { App } from '../../src/cli/tui/App.js'

function createStore(): Store {
  return new Store({ cwd: mkdtempSync(join(tmpdir(), 'bili-danmu-ui-')) })
}

const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

describe('App', () => {
  test('首屏显示欢迎信息、登录状态和连接提示', async () => {
    const { lastFrame, unmount } = render(<App store={createStore()} />)
    await delay(30)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('欢迎使用 bili-danmu')
    expect(frame).toContain('未登录')
    expect(frame).toContain('输入 /connect 房间号 连接直播间')
    expect(frame).not.toContain('v0.1.0')

    unmount()
  })

  test('/help 把命令写进日志', async () => {
    const { frames, stdin, unmount } = render(<App store={createStore()} />)

    stdin.write('/help')
    await delay(20)
    stdin.write('\r')
    await delay()

    const output = frames.join('')
    expect(output).toContain('/connect [房间号]')
    expect(output).toContain('/interact')

    unmount()
  })

  test('Tab 补全命令名', async () => {
    const { lastFrame, stdin, unmount } = render(<App store={createStore()} />)

    stdin.write('/con')
    await delay(20)
    stdin.write('\t')
    await delay(30)

    expect(lastFrame()).toContain('/connect ')
    unmount()
  })

  test('未知命令给出提示，未连接时发弹幕也会提示', async () => {
    const { lastFrame, stdin, unmount } = render(<App store={createStore()} />)

    stdin.write('/nope')
    await delay(20)
    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('未知命令 /nope')

    stdin.write('晚上好')
    await delay(20)
    stdin.write('\r')
    await delay()
    expect(lastFrame()).toContain('尚未连接直播间')
    expect(lastFrame()).toContain('晚上好')

    unmount()
  })
})
