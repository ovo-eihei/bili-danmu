import { describe, expect, test } from 'vitest'
import { parseCommand } from '../../src/cli/commands.js'

describe('parseCommand', () => {
  test('空输入忽略', () => {
    expect(parseCommand('   ')).toBeNull()
  })

  test('普通文字当成弹幕发送', () => {
    expect(parseCommand('晚上好')).toEqual({ type: 'send', text: '晚上好' })
    expect(parseCommand(' 带空格的 内容 ')).toEqual({ type: 'send', text: '带空格的 内容' })
  })

  test('连接命令带可不带房间号', () => {
    expect(parseCommand('/connect 545068')).toEqual({ type: 'connect', room: '545068' })
    expect(parseCommand('/connect')).toEqual({ type: 'connect', room: undefined })
  })

  test('登录命令可以带 cookie 文件路径', () => {
    expect(parseCommand('/login')).toEqual({ type: 'login', source: undefined })
    expect(parseCommand('/login ../cookie.txt')).toEqual({ type: 'login', source: '../cookie.txt' })
  })

  test('其余命令与别名', () => {
    expect(parseCommand('/close')).toEqual({ type: 'close' })
    expect(parseCommand('/status')).toEqual({ type: 'status' })
    expect(parseCommand('/history')).toEqual({ type: 'unknown', name: 'history' })
    expect(parseCommand('/q')).toEqual({ type: 'quit' })
    expect(parseCommand('/EXIT')).toEqual({ type: 'quit' })
  })

  test('未知命令单独返回', () => {
    expect(parseCommand('/nope')).toEqual({ type: 'unknown', name: 'nope' })
  })
})
