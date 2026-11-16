const COMMANDS = [
  'connect',
  'history',
  'close',
  'status',
  'login',
  'logout',
  'interact',
  'help',
  'quit',
]

const LOGIN_SOURCES = ['chrome', 'edge', 'brave', 'firefox']

export interface Completion {
  value: string
  options: string[]
}

/** Tab 补全：命令名、/connect 的历史房间号、/login 的浏览器名。 */
export function complete(input: string, rooms: number[]): Completion | null {
  if (!input.startsWith('/')) {
    return null
  }

  const spaceIndex = input.indexOf(' ')
  if (spaceIndex === -1) {
    const prefix = input.slice(1).toLowerCase()
    const matches = COMMANDS.filter((name) => name.startsWith(prefix))
    return build('', '/', prefix, matches)
  }

  const command = input.slice(1, spaceIndex).toLowerCase()
  const prefix = input.slice(spaceIndex + 1)
  if (prefix.includes(' ')) {
    return null
  }
  const head = input.slice(0, spaceIndex + 1)

  if (command === 'connect' && /^\d*$/.test(prefix)) {
    return build(head, '', prefix, rooms.map(String).filter((id) => id.startsWith(prefix)))
  }
  if (command === 'login') {
    return build(head, '', prefix, LOGIN_SOURCES.filter((name) => name.startsWith(prefix.toLowerCase())))
  }
  return null
}

function build(head: string, marker: string, prefix: string, matches: string[]): Completion | null {
  if (matches.length === 0) {
    return null
  }
  if (matches.length === 1) {
    return { value: `${head}${marker}${matches[0]} `, options: matches }
  }
  const common = commonPrefix(matches)
  return { value: head + marker + (common.length > prefix.length ? common : prefix), options: matches }
}

function commonPrefix(values: string[]): string {
  let prefix = values[0]
  for (const value of values.slice(1)) {
    while (prefix && !value.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
    }
  }
  return prefix
}
