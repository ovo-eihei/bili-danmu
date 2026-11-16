import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'
import type { LiveEvent, UserInfo } from '../../src/core/events.js'
import { EventLine } from '../../src/cli/tui/EventLine.js'

const user: UserInfo = {
  uid: '345259002',
  name: '彩绫恋音',
  guardLevel: 3,
  fansMedal: { name: '塔菲', level: 22 },
}

function frameOf(event: LiveEvent): string {
  const { lastFrame, unmount } = render(<EventLine event={event} />)
  const frame = lastFrame() ?? ''
  unmount()
  return frame
}

describe('EventLine', () => {
  test('弹幕带粉丝团灯牌，用户名链接到空间', () => {
    const frame = frameOf({ type: 'danmu', user, body: '晚上好' })
    expect(frame).toContain('[塔菲|22]')
    expect(frame).toContain('彩绫恋音')
    expect(frame).toContain(': 晚上好')
    expect(frame).toContain('https://space.bilibili.com/345259002')
  })

  test('表情弹幕链接到表情地址', () => {
    const frame = frameOf({
      type: 'emoji',
      user,
      body: '妙',
      uri: 'https://i0.hdslb.com/bfs/emote/abc.png',
    })
    expect(frame).toContain('妙')
    expect(frame).toContain('https://i0.hdslb.com/bfs/emote/abc.png')
  })

  test('礼物展示名称、数量与金额', () => {
    const frame = frameOf({
      type: 'gift',
      user,
      giftId: 1,
      giftName: '小花花',
      num: 2,
      price: 0.2,
      coinType: 'gold',
    })
    expect(frame).toContain('[小花花] × 2')
    expect(frame).toContain('￥0.2')
  })

  test('互动消息使用站内文案', () => {
    const frame = frameOf({
      type: 'interact',
      user,
      msgType: 1,
      msgTypeName: 'ENTER',
    })
    expect(frame).toContain('[进入直播间]')
  })
})
