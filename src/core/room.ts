import { fetchJson } from './http.js'

export interface RoomInfo {
  roomId: number
  title?: string
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

/** 拉取房间标题、主播名与开播状态，失败时尽量返回房间号本身。 */
export async function getRoomInfo(roomId: number): Promise<RoomInfo> {
  try {
    const json = await fetchJson<Record<string, any>>(
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${roomId}`,
    )
    const room = json?.data?.room_info
    if (json?.code === 0 && room) {
      return {
        roomId: Number(room.room_id ?? roomId),
        title: room.title,
        owner: json.data?.anchor_info?.base_info?.uname,
        liveStatus: Number(room.live_status ?? 0),
        online: Number(room.online ?? 0),
      }
    }
  } catch {
    // 退回下面的基础接口
  }

  try {
    const json = await fetchJson<Record<string, any>>(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
    )
    const data = json?.data
    if (json?.code === 0 && data) {
      return {
        roomId: Number(data.room_id ?? roomId),
        title: data.title,
        liveStatus: Number(data.live_status ?? 0),
        online: Number(data.online ?? 0),
      }
    }
  } catch {
    // 拉不到就只显示房间号
  }

  return { roomId, liveStatus: 0 }
}
