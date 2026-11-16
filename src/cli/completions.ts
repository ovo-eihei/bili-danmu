export interface SuggestionRoom {
  roomId: number
  owner?: string
  title?: string
}

export interface Suggestion {
  /** 选中后填进输入框的完整内容。 */
  value: string
  label: string
  hint?: string
}

const COMMANDS: { name: string; summary: string }[] = [
  { name: 'connect', summary: '连接直播间' },
  { name: 'history', summary: '最近连接过的直播间' },
  { name: 'close', summary: '断开当前直播间' },
  { name: 'status', summary: '连接与登录状态' },
  { name: 'login', summary: '登录账号' },
  { name: 'logout', summary: '清除本地登录状态' },
  { name: 'interact', summary: '显示/隐藏互动消息' },
  { name: 'help', summary: '命令列表' },
  { name: 'quit', summary: '退出' },
]

const LOGIN_SOURCES = ['chrome', 'edge', 'brave', 'firefox']

/**
 * 斜杠命令建议：命令名，以及 /connect 的历史房间号、/login 的浏览器名。
 * 返回空数组表示不展示建议列表。
 */
export function suggest(
  input: string,
  rooms: SuggestionRoom[],
  limit = 6,
): Suggestion[] {
  if (!input.startsWith('/')) {
    return []
  }

  const spaceIndex = input.indexOf(' ')
  if (spaceIndex === -1) {
    const prefix = input.slice(1).toLowerCase()
    return COMMANDS.filter((item) => item.name.startsWith(prefix))
      .slice(0, limit)
      .map((item) => ({
        value: `/${item.name} `,
        label: `/${item.name}`,
        hint: item.summary,
      }))
  }

  const command = input.slice(1, spaceIndex).toLowerCase()
  const prefix = input.slice(spaceIndex + 1)
  if (prefix.includes(' ')) {
    return []
  }

  const head = input.slice(0, spaceIndex + 1)
  if (command === 'connect' && /^\d*$/.test(prefix)) {
    return rooms
      .filter((room) => String(room.roomId).startsWith(prefix))
      .slice(0, limit)
      .map((room) => ({
        value: `${head}${room.roomId} `,
        label: String(room.roomId),
        hint: room.owner ?? '历史直播间',
      }))
  }
  if (command === 'login') {
    const lower = prefix.toLowerCase()
    return LOGIN_SOURCES.filter((name) => name.startsWith(lower))
      .slice(0, limit)
      .map((name) => ({
        value: `${head}${name} `,
        label: name,
        hint: '从本机浏览器读取 Cookie',
      }))
  }
  return []
}
