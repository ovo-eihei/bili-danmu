const USER_SPACE = (uid: string): string => `https://space.bilibili.com/${uid}`

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
      return 'red'
    case 2:
      return 'magenta'
    case 3:
      return 'blue'
    default:
      return 'white'
  }
}

export function medalColor(level: number): string {
  if (level > 28) return 'magentaBright'
  if (level > 24) return 'cyanBright'
  if (level > 20) return 'cyan'
  if (level > 16) return 'green'
  if (level > 12) return 'yellow'
  if (level > 8) return 'magenta'
  if (level > 4) return 'blue'
  return 'gray'
}

export function giftColor(price: number): string {
  if (price >= 100) return 'magenta'
  if (price >= 50) return 'blue'
  if (price >= 10) return 'yellowBright'
  if (price >= 5) return 'green'
  return 'yellow'
}

export function superChatColor(price: number): string {
  if (price >= 2000) return 'magentaBright'
  if (price >= 1000) return 'redBright'
  if (price >= 500) return 'red'
  if (price >= 100) return 'yellow'
  if (price >= 50) return 'cyan'
  return 'blue'
}
