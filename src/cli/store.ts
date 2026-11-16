import { chmodSync } from 'node:fs'
import Conf from 'conf'
import type { LoginUser } from '../core/login.js'

export interface RoomRecord {
  roomId: number
  title?: string
  owner?: string
  visits: number
  lastConnectedAt: string
}

interface Schema {
  cookie: string
  self: LoginUser | null
  rooms: RoomRecord[]
}

const MAX_ROOMS = 20

/** 本地配置：登录 cookie、账号信息、连接历史。 */
export class Store {
  private readonly conf: Conf<Schema>

  constructor(options: { cwd?: string } = {}) {
    this.conf = new Conf<Schema>({
      projectName: 'bili-danmu',
      defaults: { cookie: '', self: null, rooms: [] },
      ...(options.cwd ? { cwd: options.cwd } : {}),
    })
  }

  get cookie(): string {
    return this.conf.get('cookie')
  }

  get self(): LoginUser | null {
    return this.conf.get('self')
  }

  get isLoggedIn(): boolean {
    return Boolean(this.cookie && this.self)
  }

  get path(): string {
    return this.conf.path
  }

  setLogin(cookie: string, self: LoginUser): void {
    this.conf.set('cookie', cookie)
    this.conf.set('self', self)
    try {
      chmodSync(this.conf.path, 0o600)
    } catch {
      // Windows 上不生效，忽略
    }
  }

  clearLogin(): void {
    this.conf.set('cookie', '')
    this.conf.set('self', null)
  }

  rooms(): RoomRecord[] {
    return [...this.conf.get('rooms')].sort(
      (a, b) => Date.parse(b.lastConnectedAt) - Date.parse(a.lastConnectedAt),
    )
  }

  recordRoom(room: { roomId: number; title?: string; owner?: string }): void {
    const rooms = this.rooms()
    const existing = rooms.find((item) => item.roomId === room.roomId)
    const record: RoomRecord = {
      roomId: room.roomId,
      title: room.title ?? existing?.title,
      owner: room.owner ?? existing?.owner,
      visits: (existing?.visits ?? 0) + 1,
      lastConnectedAt: new Date().toISOString(),
    }
    const next = [record, ...rooms.filter((item) => item.roomId !== room.roomId)].slice(0, MAX_ROOMS)
    this.conf.set('rooms', next)
  }
}
