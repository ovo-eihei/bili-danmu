import { describe, expect, test } from 'vitest'
import { encWbi, getMixinKey } from '../../src/core/wbi.js'

describe('wbi', () => {
  test('mixin key 与官方已知向量一致', () => {
    const imgKey = '7cd084941338484aae1ad9425b84077c'
    const subKey = '4932caff0ff746eab6f01bf08b70ac45'

    expect(getMixinKey(imgKey + subKey)).toBe('ea1db124af3c7062474693fa704f4ff8')
  })

  test('encWbi 参数按字典序拼接并带上 wts 与 w_rid', () => {
    const signed = encWbi(
      { id: 545068, type: '0' },
      '7cd084941338484aae1ad9425b84077c',
      '4932caff0ff746eab6f01bf08b70ac45',
      1700000000,
    )

    expect(signed.startsWith('id=545068&type=0&wts=1700000000&w_rid=')).toBe(true)
    expect(signed.slice(-32)).toMatch(/^[0-9a-f]{32}$/)
  })

  test('encWbi 会过滤特殊字符', () => {
    const signed = encWbi(
      { keyword: "a!b'c(d)e*f" },
      '7cd084941338484aae1ad9425b84077c',
      '4932caff0ff746eab6f01bf08b70ac45',
      1,
    )

    expect(signed).toContain('keyword=abcdef')
  })
})
