import { createHash } from 'node:crypto'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const TIMEOUT_MS = 5000

export function httpHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': DEFAULT_UA,
    Accept: 'application/json, text/plain, */*',
    ...extra,
  }
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: httpHeaders(init.headers as Record<string, string> | undefined),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`响应不是 JSON: HTTP ${response.status} ${text.slice(0, 120)}`)
  }
}

export function md5(input: string): string {
  return createHash('md5').update(input).digest('hex')
}
