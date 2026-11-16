import { brotliDecompressSync, inflateSync } from 'node:zlib'

export const HEADER_LENGTH = 16

/** 服务端包头里的 operation 字段。 */
export const Operation = {
  Heartbeat: 2,
  HeartbeatReply: 3,
  SendSmsReply: 5,
  Auth: 7,
  AuthReply: 8,
} as const

export interface Packet {
  operation: number
  body: Buffer
}

/**
 * 打包一个弹幕包。
 * 头部：总长度(4) 头长度(2) 协议版本(2) operation(4) sequence(4)。
 */
export function pack(operation: number, body: Buffer): Buffer {
  const buffer = Buffer.alloc(HEADER_LENGTH + body.length)
  buffer.writeInt32BE(HEADER_LENGTH + body.length, 0)
  buffer.writeInt16BE(HEADER_LENGTH, 4)
  buffer.writeInt16BE(0, 6)
  buffer.writeInt32BE(operation, 8)
  buffer.writeInt32BE(0, 12)
  body.copy(buffer, HEADER_LENGTH)
  return buffer
}

/**
 * 解包一帧数据。version 0 明文，2 zlib，3 brotli；
 * 压缩包里可能包含多个包，需要递归展开。
 */
export function unpack(data: Buffer): Packet[] {
  const packets: Packet[] = []
  let offset = 0

  while (offset + HEADER_LENGTH <= data.length) {
    const length = data.readInt32BE(offset)
    if (length < HEADER_LENGTH || offset + length > data.length) {
      break
    }
    const version = data.readInt16BE(offset + 6)
    const operation = data.readInt32BE(offset + 8)
    const body = data.subarray(offset + HEADER_LENGTH, offset + length)

    if (version === 2 || version === 3) {
      const decompressed = version === 2 ? inflateSync(body) : brotliDecompressSync(body)
      packets.push(...unpack(decompressed))
    } else {
      packets.push({ operation, body })
    }

    offset += length
  }

  return packets
}
