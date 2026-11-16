const USER_SPACE = (uid: string): string => `https://space.bilibili.com/${uid}`

/** 黑底终端下的界面配色 */
export const UI_COLOR = {
  accent: '#7aa2f7',
  hotkey: '#ff9edb',
  room: '#7dcfff',
  success: '#9ece6a',
  warn: '#e0af68',
  error: '#f7768e',
  info: '#9aa5ce',
  dim: '#7f8ea3',
  self: '#9ece6a',
}

/** OSC 8 超链接；终端不支持时多数会退化为普通文本。 */
export function oscLink(text: string, url: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}

export function userLink(uid: string, name: string): string {
  return uid ? oscLink(name, USER_SPACE(uid)) : name
}

export function userColor(guardLevel: number): string {
  switch (guardLevel) {
    case 1:
      return '#ff6b81'
    case 2:
      return '#d98cff'
    case 3:
      return '#7dcfff'
    default:
      return '#c0caf5'
  }
}

export function medalColor(level: number): string {
  if (level > 28) return '#ff79c6'
  if (level > 24) return '#7dcfff'
  if (level > 20) return '#66d9ef'
  if (level > 16) return '#9ece6a'
  if (level > 12) return '#e0af68'
  if (level > 8) return '#bb9af7'
  if (level > 4) return '#ff9e64'
  return '#8fa1c7'
}

export function giftColor(price: number): string {
  if (price >= 100) return '#ff79c6'
  if (price >= 50) return '#82aaff'
  if (price >= 10) return '#ffd166'
  if (price >= 5) return '#9ece6a'
  return '#e0af68'
}

export function superChatColor(price: number): string {
  if (price >= 2000) return '#ff79c6'
  if (price >= 1000) return '#ff6b81'
  if (price >= 500) return '#f7768e'
  if (price >= 100) return '#ffd166'
  if (price >= 50) return '#66d9ef'
  return '#7dcfff'
}
