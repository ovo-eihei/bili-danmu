import { describe, expect, test } from 'vitest'
import { decodeInteractPb, parseEvent } from '../../src/core/events.js'

function danmu(info: unknown[], cmd = 'DANMU_MSG') {
  return {
    cmd,
    info: [info, '测试内容', [123456, '测试用户', 0, 0, 0, 10000, 1], [1, '粉丝团', '主播', 123, 10426609], 0, 0, 1, 0, 0, ''],
  }
}

const META = [0, 1, 25, 16777215, 1234567890, 1234567890, 0, 'abc', 0, 0, 0, '', 0]

describe('events', () => {
  test('解析普通弹幕', () => {
    const event = parseEvent(danmu(META))

    expect(event).toMatchObject({
      type: 'danmu',
      body: '测试内容',
      user: { uid: '123456', name: '测试用户', fansMedal: { name: '粉丝团', level: 1 } },
    })
  })

  test('cmd 带后缀也能解析', () => {
    expect(parseEvent(danmu(META, 'DANMU_MSG:4:0:2:2:2:2'))?.type).toBe('danmu')
  })

  test('表情弹幕解析成 emoji', () => {
    const meta = META.slice()
    meta[12] = 1
    const event = parseEvent(danmu(meta))

    expect(event?.type).toBe('emoji')
  })

  test('info 结构异常时返回 null', () => {
    expect(parseEvent({ cmd: 'DANMU_MSG', info: [[0, 1]] })).toBeNull()
    expect(parseEvent({})).toBeNull()
  })

  test('解析礼物并把金瓜子换算成元', () => {
    const event = parseEvent({
      cmd: 'SEND_GIFT',
      data: {
        uid: 100,
        uname: '送礼人',
        giftId: 31036,
        giftName: '小花花',
        num: 2,
        total_coin: 200,
        coin_type: 'gold',
        guard_level: 3,
      },
    })

    expect(event).toMatchObject({
      type: 'gift',
      giftName: '小花花',
      num: 2,
      price: 0.2,
      user: { uid: '100', name: '送礼人', guardLevel: 3 },
    })
  })

  test('解析舰长购买', () => {
    const event = parseEvent({
      cmd: 'USER_TOAST_MSG',
      data: {
        uid: 200,
        username: '舰长用户',
        gift_id: 10003,
        role_name: '舰长',
        num: 1,
        price: 138000,
        unit: '月',
      },
    })

    expect(event).toMatchObject({ type: 'guard', roleName: '舰长', price: 138 })
  })

  test('解析醒目留言', () => {
    const event = parseEvent({
      cmd: 'SUPER_CHAT_MESSAGE',
      data: {
        id: 9001,
        message: '加油',
        price: 30,
        time: 60,
        user_info: { uname: 'SC 用户', guard_level: 0 },
      },
    })

    expect(event).toMatchObject({ type: 'superchat', body: '加油', price: 30, time: 60 })
    expect(event?.user.name).toBe('SC 用户')
  })

  test('INTERACT_WORD_V2 从 pb 里取 uid/昵称/类型', () => {
    // field1(uid)=123456, field2(name)="小明", field5(type)=2
    const bytes = Buffer.from([0x08, 0xc0, 0xc4, 0x07, 0x12, 0x06, 0xe5, 0xb0, 0x8f, 0xe6, 0x98, 0x8e, 0x28, 0x02])
    const pb = bytes.toString('base64')

    const decoded = decodeInteractPb(pb)
    expect(decoded).toEqual({ uid: 123456, name: '小明', type: 2 })

    const event = parseEvent({ cmd: 'INTERACT_WORD_V2', data: { pb } })
    expect(event).toMatchObject({
      type: 'interact',
      msgType: 2,
      msgTypeName: 'FOLLOW',
      user: { uid: '123456', name: '小明' },
    })
  })
})
