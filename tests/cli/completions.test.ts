import { describe, expect, it } from 'vitest'
import { suggest } from '../../src/cli/completions.js'

describe('suggest', () => {
  it('只看斜杠开头的输入', () => {
    expect(suggest('晚上好', [])).toEqual([])
  })

  it('斜杠列出命令建议', () => {
    const items = suggest('/', [])
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toMatchObject({ value: '/connect ', label: '/connect' })
  })

  it('按前缀过滤命令', () => {
    expect(suggest('/con', []).map((item) => item.value)).toEqual(['/connect '])
    expect(suggest('/c', []).map((item) => item.label)).toEqual(['/connect', '/close'])
  })

  it('没有匹配的命令返回空列表', () => {
    expect(suggest('/zzz', [])).toEqual([])
  })

  it('补全 /connect 的历史房间号并带出主播名', () => {
    const rooms = [
      { roomId: 22603245, owner: '永雏塔菲' },
      { roomId: 545068, owner: '某主播' },
    ]
    expect(suggest('/connect 22603', rooms)).toEqual([
      { value: '/connect 22603245 ', label: '22603245', hint: '永雏塔菲' },
    ])
    expect(suggest('/connect 999', rooms)).toEqual([])
  })

  it('补全 /login 的浏览器名', () => {
    expect(suggest('/login fir', [])).toEqual([
      { value: '/login firefox ', label: 'firefox', hint: '从本机浏览器读取 Cookie' },
    ])
  })

  it('带完整参数或非参数命令时不给建议', () => {
    expect(suggest('/connect 22603245 ', [])).toEqual([])
    expect(suggest('/help x', [])).toEqual([])
  })
})
