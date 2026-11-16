import { fetchJson } from './http.js'
import { wbiSign } from './wbi.js'

export interface Host {
  host: string
  wssPort: number
}

export function cookieValue(cookie: string, name: string): string | undefined {
  const match = cookie.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`))
  return match ? match[1] : undefined
}

export function requireCookieValue(cookie: string, name: string): string {
  const value = cookieValue(cookie, name)
  if (!value) {
    throw new Error(`cookie 缺少 ${name}`)
  }
  return value
}

interface DanmuInfo {
  token: string
  hosts: Host[]
}

interface Fingerprint {
  b3: string
  b4: string
}

export class Auth {
  readonly roomid: number
  readonly uid: number
  readonly buvid: string
  readonly protover = 2
  readonly platform = 'web'
  readonly type = 2

  key: string
  hosts: Host[]

  private readonly cookie: string

  private constructor(
    roomid: number,
    uid: number,
    buvid: string,
    key: string,
    hosts: Host[],
    cookie: string,
  ) {
    this.roomid = roomid
    this.uid = uid
    this.buvid = buvid
    this.key = key
    this.hosts = hosts
    this.cookie = cookie
  }

  /** 创建连接凭证。传 cookie 时使用登录态，否则匿名连接。 */
  static async create(roomid: number, cookie = ''): Promise<Auth> {
    const fingerprint = await fetchFingerprint()
    const buvid = (cookie ? cookieValue(cookie, 'buvid3') : undefined) ?? fingerprint.b3
    const buvid4 = (cookie ? cookieValue(cookie, 'buvid4') : undefined) ?? fingerprint.b4
    const requestCookie = withFingerprintCookie(cookie, buvid, buvid4)
    const uid = cookie ? Number(requireCookieValue(cookie, 'DedeUserID')) : 0

    const info = await fetchDanmuInfo(roomid, requestCookie)
    return new Auth(roomid, uid, buvid, info.token, info.hosts, requestCookie)
  }

  /** 重新拉取 token 与服务器列表，用于断线重连。 */
  async refresh(): Promise<void> {
    const info = await fetchDanmuInfo(this.roomid, this.cookie)
    this.key = info.token
    this.hosts = info.hosts
  }

  /** 只序列化 auth 包需要的字段。 */
  toJSON(): Record<string, unknown> {
    return {
      uid: this.uid,
      roomid: this.roomid,
      protover: this.protover,
      buvid: this.buvid,
      platform: this.platform,
      type: this.type,
      key: this.key,
    }
  }
}

function withFingerprintCookie(cookie: string, buvid: string, buvid4: string): string {
  const parts = cookie
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith('buvid3=') && !part.startsWith('buvid4='))
  parts.push(`buvid3=${buvid}`)
  if (buvid4) {
    parts.push(`buvid4=${buvid4}`)
  }
  return parts.join('; ')
}

async function fetchDanmuInfo(roomid: number, cookie: string): Promise<DanmuInfo> {
  const signed = await wbiSign({ id: roomid, type: '0' }, cookie)
  const url = `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${signed}`
  const json = await fetchJson<Record<string, any>>(url, {
    headers: {
      Cookie: cookie,
      Referer: `https://live.bilibili.com/${roomid}`,
    },
  })

  const data = json?.data
  if (json?.code !== 0 || !data?.token) {
    throw new Error(`获取弹幕服务器信息失败: code=${json?.code ?? '?'} ${json?.message ?? ''}`)
  }

  const hosts: Host[] = []
  const seen = new Set<string>()
  for (const item of data.host_list ?? []) {
    const host = item?.host
    if (!host || seen.has(host)) {
      continue
    }
    seen.add(host)
    hosts.push({ host, wssPort: Number(item.wss_port ?? 2245) })
  }

  return { token: data.token, hosts }
}

let fingerprint: Promise<Fingerprint> | undefined

function fetchFingerprint(): Promise<Fingerprint> {
  fingerprint ??= fetchJson<Record<string, any>>('https://api.bilibili.com/x/frontend/finger/spi')
    .then((json) => {
      const b3 = json?.data?.b_3
      if (!b3) {
        throw new Error('获取 buvid 失败')
      }
      return { b3, b4: json?.data?.b_4 ?? '' }
    })
    .catch((error: unknown) => {
      fingerprint = undefined
      throw error
    })
  return fingerprint
}
