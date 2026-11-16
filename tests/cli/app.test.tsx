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
    expect(output).toContain('Ctrl+O')

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

  test('输入 / 在下方列出命令建议，Esc 收起', async () => {
    const { lastFrame, stdin, unmount } = render(<App store={createStore()} />)

    stdin.write('/')
    await delay()
    expect(lastFrame()).toContain('/connect')
    expect(lastFrame()).toContain('↑↓ 选择')

    stdin.write('\u001B')
    await delay()
    expect(lastFrame()).not.toContain('↑↓ 选择')
    expect(lastFrame()).toContain('查看命令')

    unmount()
  })

  test('方向键加 Enter 选中建议填进输入框', async () => {
    const { lastFrame, stdin, unmount } = render(<App store={createStore()} />)

    stdin.write('/co')
    await delay()
    stdin.write('\u001B[B')
    await delay()
    stdin.write('\r')
    await delay()

    expect(lastFrame()).toContain('/connect')
    expect(lastFrame()).not.toContain('↑↓ 选择')

    stdin.write('2')
    await delay()
    expect(lastFrame()).toContain('/connect 2')

    unmount()
  })

  test('Ctrl+O 切换互动消息显示，底部常驻状态同步变化', async () => {
    const { frames, lastFrame, stdin, unmount } = render(<App store={createStore()} />)

    expect(lastFrame()).toContain('显示互动消息')

    stdin.write('\u000F')
    await delay()
    expect(frames.join('')).toContain('互动消息已显示')
    expect(lastFrame()).toContain('隐藏互动消息')

    stdin.write('\u000F')
    await delay()
    expect(frames.join('')).toContain('互动消息已隐藏')
    expect(lastFrame()).toContain('显示互动消息')

    unmount()
  })

  test('日志直接写入终端历史，不占用固定视口', async () => {
    const { frames, stdin, unmount } = render(<App store={createStore()} />)

    for (let i = 0; i < 3; i++) {
      stdin.write('/help')
      await delay(20)
      stdin.write('\r')
      await delay()
    }

    const output = frames.join('')
    expect(output).toContain('欢迎使用 bili-danmu')
    expect(output).toContain('/connect [房间号]')

    unmount()
  })
})
