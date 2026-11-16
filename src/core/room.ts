import { fetchJson } from './http.js'

export interface RoomInfo {
  roomId: number
  owner?: string
  liveStatus: number
  online?: number
}

/** 支持真实房间号，也顺手兼容短号。 */
export async function resolveRoomId(input: string): Promise<number> {
  const numeric = Number(input)
  try {
    const json = await fetchJson<Record<string, any>>(
      `https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(input)}`,
    )
    if (json?.code === 0 && json.data?.room_id) {
      return Number(json.data.room_id)
    }
  } catch {
    // 接口不可用时退回数字房间号
  }
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric
  }
  throw new Error(`无法解析房间号: ${input}`)
}

async function fetchLiveInfo(
  roomId: number,
): Promise<Pick<RoomInfo, 'liveStatus' | 'online'> | undefined> {
  try {
    const json = await fetchJson<Record<string, any>>(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
    )
    const data = json?.data
    if (json?.code === 0 && data) {
      return {
        liveStatus: Number(data.live_status ?? 0),
        online: Number(data.online ?? 0),
      }
    }
  } catch {
    // 拉不到就按未开播处理
  }
  return undefined
}

/** getInfoByRoom 匿名常被风控，主播名单独从这个接口取。 */
async function fetchAnchorName(roomId: number): Promise<string | undefined> {
  try {
    const json = await fetchJson<Record<string, any>>(
      `https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid=${roomId}`,
    )
    if (json?.code === 0) {
      return json.data?.info?.uname
    }
  } catch {
    // 没有主播名就只显示房间号
  }
  return undefined
}

/** 拉取主播名与开播状态，失败时尽量返回房间号本身。 */
export async function getRoomInfo(roomId: number): Promise<RoomInfo> {
  const [live, owner] = await Promise.all([fetchLiveInfo(roomId), fetchAnchorName(roomId)])
  return {
    roomId,
    owner,
    liveStatus: live?.liveStatus ?? 0,
    online: live?.online,
  }
}
