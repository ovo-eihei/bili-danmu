import { fetchJson, md5 } from './http.js'

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

export interface WbiKeys {
  imgKey: string
  subKey: string
}

export function getMixinKey(orig: string): string {
  let result = ''
  for (const index of MIXIN_KEY_ENC_TAB) {
    if (index < orig.length) {
      result += orig[index]
    }
  }
  return result.slice(0, 32)
}

export function encWbi(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  wts = Math.floor(Date.now() / 1000),
): string {
  const mixinKey = getMixinKey(imgKey + subKey)
  const signed: Record<string, string> = { wts: String(wts) }
  for (const [key, value] of Object.entries(params)) {
    signed[key] = String(value).replace(/[!'()*]/g, '')
  }

  const query = Object.keys(signed)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key])}`)
    .join('&')

  return `${query}&w_rid=${md5(query + mixinKey)}`
}

export async function fetchWbiKeys(cookie: string): Promise<WbiKeys> {
  const json = await fetchJson<Record<string, any>>('https://api.bilibili.com/x/web-interface/nav', {
    headers: cookie ? { Cookie: cookie, Referer: 'https://www.bilibili.com/' } : {},
  })
  const wbiImg = json?.data?.wbi_img
  if (!wbiImg?.img_url || !wbiImg?.sub_url) {
    throw new Error(`获取 wbi 密钥失败: code=${json?.code ?? '?'} ${json?.message ?? ''}`)
  }
  return {
    imgKey: filenameWithoutExt(wbiImg.img_url),
    subKey: filenameWithoutExt(wbiImg.sub_url),
  }
}

function filenameWithoutExt(url: string): string {
  const name = url.slice(url.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(0, dot) : name
}

export async function wbiSign(
  params: Record<string, string | number>,
  cookie = '',
): Promise<string> {
  const keys = await fetchWbiKeys(cookie)
  return encWbi(params, keys.imgKey, keys.subKey)
}
