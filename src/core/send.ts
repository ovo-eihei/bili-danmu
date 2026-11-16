import { cookieValue, requireCookieValue } from './auth.js'
import { fetchJson, httpHeaders } from './http.js'

export interface SendResult {
  code: number
  message: string
  msg?: string
  data?: unknown
}

/** 发送弹幕。业务失败（如风控、禁言）会抛错。 */
export async function sendDanmu(
  cookie: string,
  roomId: number | string,
  message: string,
): Promise<SendResult> {
  const csrf = requireCookieValue(cookie, 'bili_jct')
  const buvid3 = cookieValue(cookie, 'buvid3')

  const body = new URLSearchParams({
    color: '16777215',
    fontsize: '25',
    mode: '1',
    msg: message,
    rnd: String(Math.floor(Date.now() / 1000)),
    roomid: String(roomId),
    bubble: '0',
    csrf_token: csrf,
    csrf,
  })

  const result = await fetchJson<SendResult>('https://api.live.bilibili.com/msg/send', {
    method: 'POST',
    headers: httpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      Referer: `https://live.bilibili.com/${roomId}`,
      ...(buvid3 ? { 'X-Buvid3': buvid3 } : {}),
    }),
    body: body.toString(),
  })

  if (result.code !== 0) {
    throw new Error(`发送失败: code=${result.code} ${result.message ?? ''}`.trim())
  }
  return result
}
