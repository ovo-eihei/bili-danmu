import { Text } from 'ink'
import type { LiveEvent } from '../../core/events.js'

const INTERACT_NAMES: Record<string, string> = {
  ENTER: '进场',
  FOLLOW: '关注',
  SHARE: '分享',
  SPECIAL_FOLLOW: '特别关注',
  MUTUAL_FOLLOW: '互相关注',
}

export function timeString(date = new Date()): string {
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

function userName(event: Exclude<LiveEvent, { type: 'interact' }>): string {
  const { name, fansMedal, guardLevel } = event.user
  const medals = [
    fansMedal ? `[${fansMedal.name} ${fansMedal.level}]` : '',
    guardLevel > 0 ? `(${guardLevel})` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return medals ? `${name} ${medals}` : name
}

export function EventLine({ event }: { event: LiveEvent }) {
  const time = <Text dimColor>{timeString()} </Text>

  switch (event.type) {
    case 'danmu':
      return (
        <Text>
          {time}
          <Text color="cyan">[弹幕] </Text>
          <Text bold>{userName(event)}</Text>
          <Text>: {event.body}</Text>
        </Text>
      )
    case 'emoji':
      return (
        <Text>
          {time}
          <Text color="cyan">[表情] </Text>
          <Text bold>{userName(event)}</Text>
          <Text>: {event.body}</Text>
        </Text>
      )
    case 'gift':
      return (
        <Text>
          {time}
          <Text color="magenta">[礼物] </Text>
          <Text bold>{userName(event)}</Text>
          <Text>
            {' '}
            送出 {event.giftName} ×{event.num}
          </Text>
          {event.price > 0 ? <Text color="yellow"> ¥{event.price}</Text> : null}
        </Text>
      )
    case 'guard':
      return (
        <Text>
          {time}
          <Text color="yellow">[舰长] </Text>
          <Text bold>{userName(event)}</Text>
          <Text>
            {' '}
            开通 {event.roleName} ×{event.num}
          </Text>
          {event.price > 0 ? <Text color="yellow"> ¥{event.price}</Text> : null}
        </Text>
      )
    case 'superchat':
      return (
        <Text>
          {time}
          <Text color="yellow">[醒目留言] </Text>
          <Text bold>{userName(event)}</Text>
          <Text>: {event.body}</Text>
          <Text color="yellow"> ¥{event.price}</Text>
        </Text>
      )
    case 'interact':
      return (
        <Text dimColor>
          {time}[{INTERACT_NAMES[event.msgTypeName] ?? '互动'}] {event.user.name}
        </Text>
      )
  }
}
