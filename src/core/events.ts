export interface UserInfo {
  uid: string
  name: string
  guardLevel: number
  fansMedal?: { name: string; level: number }
}

export type LiveEvent =
  | { type: 'danmu'; user: UserInfo; body: string }
  | { type: 'emoji'; user: UserInfo; body: string; uri: string }
  | {
      type: 'gift'
      user: UserInfo
      giftId: number
      giftName: string
      num: number
      price: number
      coinType: string
    }
  | {
      type: 'guard'
      user: UserInfo
      giftId: number
      roleName: string
      num: number
      price: number
      unit: string
      level: number
    }
  | { type: 'superchat'; user: UserInfo; id: number; body: string; price: number; time: number }
  | { type: 'interact'; user: UserInfo; msgType: number; msgTypeName: string }

const INTERACT_TYPE_NAMES: Record<number, string> = {
  1: 'ENTER',
  2: 'FOLLOW',
  3: 'SHARE',
  4: 'SPECIAL_FOLLOW',
  5: 'MUTUAL_FOLLOW',
}

const EMOJI_DM_TYPE = 1

export function parseEvent(message: any): LiveEvent | null {
  const cmd: string | undefined = message?.cmd
  if (!cmd) {
    return null
  }

  if (cmd.startsWith('DANMU_MSG')) {
    return parseDanmu(message)
  }
  switch (cmd) {
    case 'SEND_GIFT':
      return parseGift(message)
    case 'USER_TOAST_MSG':
      return parseGuard(message)
    case 'SUPER_CHAT_MESSAGE':
      return parseSuperChat(message)
    default:
      return cmd.startsWith('INTERACT_WORD') ? parseInteract(message) : null
  }
}

function parseDanmu(message: any): LiveEvent | null {
  const info = message?.info
  if (!Array.isArray(info) || !Array.isArray(info[0])) {
    return null
  }
  const meta = info[0]
  if (meta.length <= 12 || typeof meta[12] !== 'number') {
    return null
  }

  const user = userFromInfo(info)
  const body = toText(info[1])

  if (meta[12] === EMOJI_DM_TYPE) {
    const uri = meta[13]?.url ? String(meta[13].url) : ''
    return { type: 'emoji', user, body, uri }
  }
  return { type: 'danmu', user, body }
}

function userFromInfo(info: any[]): UserInfo {
  const user: UserInfo = {
    uid: toText(info[2]?.[0]),
    name: toText(info[2]?.[1]),
    guardLevel: toNumber(info[7]),
  }
  const medal = info[3]
  if (Array.isArray(medal) && medal.length >= 2) {
    user.fansMedal = { level: toNumber(medal[0]), name: toText(medal[1]) }
  }
  return user
}

function parseGift(message: any): LiveEvent | null {
  const data = message?.data
  if (!data) {
    return null
  }
  const user = userFromData(data)
  const coinType = toText(data.coin_type)
  return {
    type: 'gift',
    user,
    giftId: toNumber(data.giftId),
    giftName: toText(data.giftName),
    num: toNumber(data.num),
    price: coinType === 'gold' ? toNumber(data.total_coin) / 1000 : 0,
    coinType,
  }
}

function parseGuard(message: any): LiveEvent | null {
  const data = message?.data
  if (!data) {
    return null
  }
  const user = userFromData(data, 'username')
  return {
    type: 'guard',
    user,
    giftId: toNumber(data.gift_id),
    roleName: toText(data.role_name),
    num: toNumber(data.num),
    price: toNumber(data.price) / 1000,
    unit: toText(data.unit),
    level: user.guardLevel,
  }
}

function parseSuperChat(message: any): LiveEvent | null {
  const data = message?.data
  if (!data) {
    return null
  }
  const user = userFromData(
    { ...data, uname: data.user_info?.uname, guard_level: data.user_info?.guard_level },
    'uname',
  )
  return {
    type: 'superchat',
    user,
    id: toNumber(data.id),
    body: toText(data.message),
    price: toNumber(data.price),
    time: toNumber(data.time),
  }
}

function parseInteract(message: any): LiveEvent | null {
  const data = message?.data
  if (!data || typeof data !== 'object') {
    return null
  }

  const user: UserInfo = {
    uid: toText(data.uid ?? data.uinfo?.uid),
    name: toText(data.uname ?? data.uinfo?.base?.name),
    guardLevel: 0,
  }
  const medal = data.fans_medal
  if (medal && typeof medal === 'object') {
    user.fansMedal = { name: toText(medal.medal_name), level: toNumber(medal.medal_level) }
    user.guardLevel = toNumber(medal.guard_level)
    if (!user.fansMedal.name) {
      delete user.fansMedal
    }
  }

  let msgType = toNumber(data.msg_type ?? data.trigger_type)
  if ((!user.uid || !user.name || !msgType) && typeof data.pb === 'string' && data.pb) {
    const fromPb = decodeInteractPb(data.pb)
    if (!user.uid && fromPb.uid !== undefined) {
      user.uid = String(fromPb.uid)
    }
    if (!user.name && fromPb.name !== undefined) {
      user.name = fromPb.name
    }
    if (!msgType && fromPb.type !== undefined) {
      msgType = fromPb.type
    }
  }

  return {
    type: 'interact',
    user,
    msgType,
    msgTypeName: INTERACT_TYPE_NAMES[msgType] ?? 'UNKNOWN',
  }
}

/**
 * INTERACT_WORD_V2 把用户信息放在 protobuf 的 pb 字段里。
 * 这里只取 uid(1)、uname(2)、msg_type(5)。
 */
export function decodeInteractPb(base64: string): {
  uid?: number
  name?: string
  type?: number
} {
  const result: { uid?: number; name?: string; type?: number } = {}
  const buffer = Buffer.from(base64, 'base64')

  let offset = 0
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset)
    if (key === undefined) {
      return result
    }
    offset = key.next
    const field = key.value >>> 3
    const wire = key.value & 0x07

    if (wire === 0) {
      const value = readVarint(buffer, offset)
      if (value === undefined) {
        return result
      }
      offset = value.next
      if (field === 1) {
        result.uid = value.value
      } else if (field === 5) {
        result.type = value.value
      }
    } else if (wire === 2) {
      const length = readVarint(buffer, offset)
      if (length === undefined) {
        return result
      }
      offset = length.next
      const end = offset + length.value
      if (end > buffer.length) {
        return result
      }
      if (field === 2) {
        result.name = buffer.subarray(offset, end).toString('utf8')
      }
      offset = end
    } else if (wire === 1) {
      offset += 8
    } else if (wire === 5) {
      offset += 4
    } else {
      return result
    }
  }
  return result
}

function readVarint(buffer: Buffer, offset: number): { value: number; next: number } | undefined {
  let value = 0
  let shift = 0
  for (let i = offset; i < buffer.length && shift < 35; i++) {
    const byte = buffer[i]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, next: i + 1 }
    }
    shift += 7
  }
  return undefined
}

function userFromData(data: any, nameKey = 'uname'): UserInfo {
  const user: UserInfo = {
    uid: toText(data.uid),
    name: toText(data[nameKey]),
    guardLevel: toNumber(data.guard_level),
  }
  const medal = data.medal_info
  if (medal && typeof medal === 'object') {
    user.fansMedal = { name: toText(medal.medal_name), level: toNumber(medal.medal_level) }
    if (!user.name) {
      delete user.fansMedal
    }
  }
  return user
}

function toText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}
