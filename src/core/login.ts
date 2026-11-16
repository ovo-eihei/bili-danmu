import { cookieValue, requireCookieValue } from './auth.js'
import { fetchJson } from './http.js'

export interface LoginUser {
  uid: number
  name: string
}

/** 校验 cookie 是否仍处于登录态，并返回账号信息。 */
export async function validateCookie(cookie: string): Promise<LoginUser> {
  if (!cookieValue(cookie, 'SESSDATA')) {
    throw new Error('cookie 缺少 SESSDATA')
  }
  requireCookieValue(cookie, 'bili_jct')
  const uid = Number(requireCookieValue(cookie, 'DedeUserID'))

  const json = await fetchJson<Record<string, any>>('https://api.bilibili.com/x/web-interface/nav', {
    headers: { Cookie: cookie, Referer: 'https://www.bilibili.com/' },
  })
  if (json?.code !== 0 || !json.data?.isLogin) {
    throw new Error(`登录状态无效: ${json?.message ?? `code=${json?.code ?? '?'}`}`)
  }
  return {
    uid: Number(json.data.mid ?? uid),
    name: String(json.data.uname ?? ''),
  }
}
