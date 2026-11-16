import { deflateSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { HEADER_LENGTH, Operation, pack, unpack } from '../../src/core/protocol.js'

describe('protocol', () => {
  test('打包后长度与头部正确', () => {
    const body = Buffer.from('hello')
    const packet = pack(Operation.Auth, body)

    expect(packet.length).toBe(HEADER_LENGTH + body.length)
    expect(packet.readInt32BE(0)).toBe(packet.length)
    expect(packet.readInt16BE(4)).toBe(HEADER_LENGTH)
    expect(packet.readInt32BE(8)).toBe(Operation.Auth)
    expect(packet.subarray(HEADER_LENGTH).toString()).toBe('hello')
  })

  test('解包单个明文包', () => {
    const original = pack(Operation.Heartbeat, Buffer.alloc(0))
    const packets = unpack(original)

    expect(packets).toHaveLength(1)
    expect(packets[0].operation).toBe(Operation.Heartbeat)
    expect(packets[0].body.length).toBe(0)
  })

  test('同一帧里的多个包各自解析出自己的 operation', () => {
    const first = pack(Operation.HeartbeatReply, Buffer.from([1, 2, 3]))
    const second = pack(Operation.SendSmsReply, Buffer.from('{"cmd":"X"}'))

    const packets = unpack(Buffer.concat([first, second]))

    expect(packets).toHaveLength(2)
    expect(packets[0].operation).toBe(Operation.HeartbeatReply)
    expect(packets[1].operation).toBe(Operation.SendSmsReply)
    expect(packets[1].body.toString()).toBe('{"cmd":"X"}')
  })

  test('zlib 压缩帧会展开成多个包', () => {
    const first = pack(Operation.SendSmsReply, Buffer.from('{"cmd":"A"}'))
    const second = pack(Operation.SendSmsReply, Buffer.from('{"cmd":"B"}'))
    const compressed = deflateSync(Buffer.concat([first, second]))

    const frame = Buffer.alloc(HEADER_LENGTH + compressed.length)
    frame.writeInt32BE(frame.length, 0)
    frame.writeInt16BE(HEADER_LENGTH, 4)
    frame.writeInt16BE(2, 6)
    frame.writeInt32BE(Operation.SendSmsReply, 8)
    compressed.copy(frame, HEADER_LENGTH)

    const packets = unpack(frame)

    expect(packets.map((packet) => packet.body.toString())).toEqual(['{"cmd":"A"}', '{"cmd":"B"}'])
  })

  test('长度异常时不会死循环', () => {
    const broken = Buffer.alloc(HEADER_LENGTH)
    broken.writeInt32BE(4, 0)

    expect(unpack(broken)).toEqual([])
  })
})
