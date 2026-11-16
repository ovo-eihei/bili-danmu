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
  const app = render(createElement(App, { store: new Store(), version: pkg.version }))
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

function formatEvent(event: LiveEvent): string {
  const time = pc.dim(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
  switch (event.type) {
    case 'danmu':
      return `${time} ${pc.cyan('[弹幕]')} ${withMedal(event)}${event.body}`
    case 'emoji':
      return `${time} ${pc.cyan('[表情]')} ${withMedal(event)}${event.body}`
    case 'gift':
      return `${time} ${pc.magenta('[礼物]')} ${withMedal(event)} ${event.giftName} ×${event.num}${money(event.price)}`
    case 'guard':
      return `${time} ${pc.yellow('[舰长]')} ${withMedal(event)} ${event.roleName} ×${event.num}${money(event.price)}`
    case 'superchat':
      return `${time} ${pc.yellow('[醒目留言]')} ${withMedal(event)} ${event.body}${money(event.price)}（${event.time}s）`
    case 'interact':
      return `${time} ${pc.dim('[互动]')} ${event.msgTypeName} ${event.user.name}`
  }
}

function withMedal(event: Exclude<LiveEvent, { type: 'interact' }>): string {
  const parts = [pc.bold(event.user.name)]
  if (event.user.fansMedal) {
    parts.push(pc.dim(`[${event.user.fansMedal.name} ${event.user.fansMedal.level}]`))
  }
  if (event.user.guardLevel > 0) {
    parts.push(pc.dim(`(${event.user.guardLevel})`))
  }
  return `${parts.join(' ')}: `
}

function money(price: number): string {
  return price > 0 ? pc.yellow(` ¥${price.toFixed(price % 1 === 0 ? 0 : 2)}`) : ''
}

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(pc.red(`错误: ${error instanceof Error ? error.message : String(error)}`))
  process.exit(1)
})
