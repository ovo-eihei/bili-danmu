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
  test('首屏显示标题、登录状态和连接提示', () => {
    const { lastFrame, unmount } = render(<App store={createStore()} version="1.2.3" />)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('bili-danmu')
    expect(frame).toContain('v1.2.3')
    expect(frame).toContain('未登录')
    expect(frame).toContain('输入 /connect 房间号 连接直播间')

    unmount()
  })

  test('/help 把命令写进日志', async () => {
    const { frames, stdin, unmount } = render(<App store={createStore()} version="1.2.3" />)

    stdin.write('/help')
    await delay(20)
    stdin.write('\r')
    await delay()

    const output = frames.join('')
    expect(output).toContain('/connect [房间号]')
    expect(output).toContain('/interact')

    unmount()
  })

  test('未知命令给出提示，未连接时发弹幕也会提示', async () => {
    const { lastFrame, stdin, unmount } = render(<App store={createStore()} version="1.2.3" />)

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
