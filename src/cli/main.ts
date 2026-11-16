#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { Command } from 'commander'
import pc from 'picocolors'
import pkg from '../../package.json' with { type: 'json' }
import { Auth } from '../core/auth.js'
import { DanmuClient } from '../core/client.js'
import { parseEvent } from '../core/events.js'
import type { LiveEvent } from '../core/events.js'
import { resolveRoomId } from '../core/room.js'
import { sendDanmu } from '../core/send.js'
import { Store } from './store.js'
import {
  giftColor,
  medalColor,
  oscLink,
  superChatColor,
  userColor,
} from './tui/format.js'

interface CookieOptions {
  cookieFile?: string
}

interface WatchOptions extends CookieOptions {
  json?: boolean
  raw?: boolean
  reconnect: boolean
}

const program = new Command()

program
  .name('bili-danmu')
  .description('哔哩哔哩直播弹幕交互式命令行工具')
  .version(pkg.version)
  .addHelpText('after', '\n直接运行 bili-danmu 进入交互模式。')

program.action(async () => {
  await startTui()
})

program
  .command('watch')
  .description('非交互模式：连接直播间并输出弹幕')
  .argument('<room>', '房间号（真实房间号或短号）')
  .option('--cookie-file <path>', '从文件读取 cookie，默认使用已保存的登录')
  .option('--json', '以 JSON Lines 输出解析后的事件')
  .option('--raw', '输出原始消息 JSON（可与 --json 同时使用）')
  .option('--no-reconnect', '断线后不自动重连')
  .action(async (room: string, options: WatchOptions) => {
    await watch(room, options)
  })

program
  .command('send')
  .description('非交互模式：在直播间发送一条弹幕')
  .argument('<room>', '房间号（真实房间号或短号）')
  .argument('<message>', '弹幕内容')
  .option('--cookie-file <path>', '从文件读取 cookie，默认使用已保存的登录')
  .action(async (room: string, message: string, options: CookieOptions) => {
    const cookie = await loadCookie(options.cookieFile, true)
    const roomId = await resolveRoomId(room)
    await sendDanmu(cookie, roomId, message)
    console.log(pc.green(`已在房间 ${roomId} 发送弹幕`))
  })

async function startTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('交互模式需要终端；非交互场景请使用 bili-danmu watch / send。')
    process.exit(1)
  }
  const [{ render }, { createElement }, { App }] = await Promise.all([
    import('ink'),
    import('react'),
    import('./tui/App.js'),
  ])
  const app = render(createElement(App, { store: new Store() }))
  await app.waitUntilExit()
}

async function watch(room: string, options: WatchOptions): Promise<void> {
  const cookie = await loadCookie(options.cookieFile, false)
  const roomId = await resolveRoomId(room)
  const auth = await Auth.create(roomId, cookie)

  const client = new DanmuClient({
    autoReconnect: options.reconnect,
    onOpen: () => {
      if (!options.json && !options.raw) {
        console.error(`已连接房间 ${roomId}${cookie ? '' : '（匿名，未登录只收部分弹幕）'}`)
      }
    },
    onClose: (code) => {
      if (!options.json && !options.raw) {
        console.error(`连接关闭 (${code})`)
      }
    },
    onError: (error) => {
      if (!options.json && !options.raw) {
        console.error(pc.red(`连接错误: ${error.message}`))
      }
    },
    logger: (line) => {
      if (!options.json && !options.raw) {
        console.error(pc.dim(line))
      }
    },
    onMessage: (message) => {
      if (options.raw) {
        console.log(JSON.stringify(message))
      }
      const event = parseEvent(message)
      if (!event) {
        return
      }
      console.log(options.json ? JSON.stringify(event) : formatEvent(event))
    },
  })

  await client.connect(auth)

  const stop = (): void => {
    client.disconnect()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  await new Promise<never>(() => {})
}

/** 环境变量 > cookie 文件 > 本地保存的登录状态。 */
async function loadCookie(file: string | undefined, required: boolean): Promise<string> {
  let cookie = process.env.BILI_COOKIE?.trim() ?? ''
  if (!cookie && file) {
    cookie = (await readFile(file, 'utf8')).trim()
  }
  if (!cookie) {
    cookie = new Store().cookie
  }
  if (!cookie && required) {
    throw new Error('缺少 cookie：先在交互模式 /login，或用 BILI_COOKIE、--cookie-file 提供')
  }
  return cookie
}

const INTERACT_NAMES: Record<string, string> = {
  ENTER: '进入直播间',
  FOLLOW: '关注了主播',
  SHARE: '分享了直播间',
  SPECIAL_FOLLOW: '特别关注了主播',
  MUTUAL_FOLLOW: '互粉了主播',
}

const PAINT: Record<string, (text: string) => string> = {
  gray: pc.gray,
  blue: pc.blue,
  magenta: pc.magenta,
  yellow: pc.yellow,
  green: pc.green,
  cyan: pc.cyan,
  red: pc.red,
  white: pc.white,
  yellowBright: pc.yellowBright,
  cyanBright: pc.cyanBright,
  magentaBright: pc.magentaBright,
  redBright: pc.redBright,
}

function paint(color: string, text: string): string {
  return (PAINT[color] ?? ((value: string) => value))(text)
}

function link(text: string, url: string): string {
  return process.stdout.isTTY && url ? oscLink(text, url) : text
}

function formatEvent(event: LiveEvent): string {
  const time = pc.dim(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
  switch (event.type) {
    case 'danmu':
      return `${time} ${who(event.user)}: ${event.body}`
    case 'emoji':
      return `${time} ${who(event.user)}: [${link(event.body, event.uri)}]`
    case 'gift': {
      const color = giftColor(event.price)
      return `${time} ${who(event.user)} ${paint(color, `[${event.giftName}] × ${event.num}`)}${money(event.price, color)}`
    }
    case 'guard': {
      const color = userColor(event.level)
      return `${time} ${who(event.user)} ${paint(color, `[${event.roleName}] × ${event.num}`)}${money(event.price, color)}`
    }
    case 'superchat': {
      const color = superChatColor(event.price)
      return `${time} ${who(event.user)} ${pc.bold(paint(color, `[￥${event.price} ${event.body}]`))}`
    }
    case 'interact':
      return `${time} ${pc.dim(`${event.user.name} [${INTERACT_NAMES[event.msgTypeName] ?? '互动'}]`)}`
  }
}

function who(user: LiveEvent['user']): string {
  const medal = user.fansMedal
    ? paint(medalColor(user.fansMedal.level), `[${user.fansMedal.name}|${user.fansMedal.level}]`)
    : ''
  const name = paint(userColor(user.guardLevel), pc.bold(link(user.name, `https://space.bilibili.com/${user.uid}`)))
  return `${medal}${name}`
}

function money(price: number, color: string): string {
  return price > 0 ? paint(color, ` ￥${price.toFixed(price % 1 === 0 ? 0 : 2)}`) : ''
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(pc.red(`错误: ${error instanceof Error ? error.message : String(error)}`))
  process.exit(1)
})
