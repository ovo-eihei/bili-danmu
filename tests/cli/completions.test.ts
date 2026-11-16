import { describe, expect, it } from 'vitest'
import { complete } from '../../src/cli/completions.js'

describe('complete', () => {
  it('唯一匹配时补全命令并加空格', () => {
    expect(complete('/con', [])).toEqual({ value: '/connect ', options: ['connect'] })
  })

  it('多个匹配时补到公共前缀并给出候选', () => {
    expect(complete('/c', [])).toEqual({ value: '/c', options: ['connect', 'close'] })
  })

  it('补全 /connect 的历史房间号', () => {
    expect(complete('/connect 22603', [22603245, 545068])).toEqual({
      value: '/connect 22603245 ',
      options: ['22603245'],
    })
  })

  it('补全 /login 的浏览器名', () => {
    expect(complete('/login fir', [])).toEqual({ value: '/login firefox ', options: ['firefox'] })
  })

  it('非命令文本不补全', () => {
    expect(complete('晚上好', [])).toBeNull()
  })

  it('没有匹配时返回 null', () => {
    expect(complete('/zzz', [])).toBeNull()
    expect(complete('/connect 999', [22603245])).toBeNull()
  })
})
