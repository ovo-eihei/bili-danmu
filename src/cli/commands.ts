export type Command =
  | { type: 'connect'; room?: string }
  | { type: 'close' }
  | { type: 'status' }
  | { type: 'login'; source?: string }
  | { type: 'logout' }
  | { type: 'help' }
  | { type: 'demo' }
  | { type: 'quit' }
  | { type: 'unknown'; name: string }
  | { type: 'send'; text: string }

const ALIASES: Record<string, Command['type']> = {
  q: 'quit',
  exit: 'quit',
}

export const COMMAND_HELP = [
  '/connect [房间号]  连接直播间，不带房间号从历史里选',
  '/close             断开当前直播间',
  '/status            查看连接与登录状态',
  '/login [来源]      登录：粘贴 Cookie，或从已安装的浏览器读取',
  '/logout            清除本地登录状态',
  '/demo              输出各类示例消息，查看配色效果',
  '/help              显示帮助',
  '/quit              退出',
  '直接输入文字会作为弹幕发送，Ctrl+O 显示/隐藏互动消息',
]

/** 解析一行输入：斜杠开头是命令，其余整行都算弹幕内容。 */
export function parseCommand(input: string): Command | null {
  const line = input.trim()
  if (!line) {
    return null
  }
  if (!line.startsWith('/')) {
    return { type: 'send', text: line }
  }

  const [rawName, ...rest] = line.slice(1).split(/\s+/)
  const name = rawName.toLowerCase()
  const arg = rest.join(' ').trim()
  const type = ALIASES[name] ?? name

  switch (type) {
    case 'connect':
      return { type: 'connect', room: arg || undefined }
    case 'login':
      return { type: 'login', source: arg || undefined }
    case 'close':
    case 'status':
    case 'logout':
    case 'help':
    case 'demo':
    case 'quit':
      return { type }
    default:
      return { type: 'unknown', name: rawName }
  }
}
