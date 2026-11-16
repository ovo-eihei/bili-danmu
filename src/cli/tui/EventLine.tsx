import { Text } from 'ink'
import type { LiveEvent, UserInfo } from '../../core/events.js'
import {
  giftColor,
  medalColor,
  oscLink,
  superChatColor,
  userColor,
  userLink,
} from './format.js'

const INTERACT_NAMES: Record<string, string> = {
  ENTER: '进入直播间',
  FOLLOW: '关注了主播',
  SHARE: '分享了直播间',
  SPECIAL_FOLLOW: '特别关注了主播',
  MUTUAL_FOLLOW: '互粉了主播',
}

function Medal({ user }: { user: UserInfo }) {
  if (!user.fansMedal) {
    return null
  }
  return (
    <Text color={medalColor(user.fansMedal.level)}>
      [{user.fansMedal.name}|{user.fansMedal.level}]
    </Text>
  )
}

function User({ user, mine }: { user: UserInfo; mine?: boolean }) {
  return (
    <Text color={mine ? 'green' : userColor(user.guardLevel)}>{userLink(user.uid, user.name)}</Text>
  )
}

function isSelf(user: UserInfo, selfUid: string | undefined): boolean {
  return selfUid !== undefined && user.uid === selfUid
}

function yuan(price: number): string {
  return ` ￥${price.toFixed(price % 1 === 0 ? 0 : 2)}`
}

export function EventLine({ event, selfUid }: { event: LiveEvent; selfUid?: string }) {
  switch (event.type) {
    case 'danmu': {
      const mine = isSelf(event.user, selfUid)
      return (
        <Text>
          <Medal user={event.user} />
          <User user={event.user} mine={mine} />
          <Text color={mine ? 'green' : undefined}>: {event.body}</Text>
        </Text>
      )
    }
    case 'emoji': {
      const mine = isSelf(event.user, selfUid)
      return (
        <Text>
          <Medal user={event.user} />
          <User user={event.user} mine={mine} />
          <Text>: [</Text>
          <Text color={mine ? 'green' : 'yellow'}>
            {event.uri ? oscLink(event.body, event.uri) : event.body}
          </Text>
          <Text>]</Text>
        </Text>
      )
    }
    case 'gift': {
      const color = giftColor(event.price)
      return (
        <Text>
          <Medal user={event.user} />
          <User user={event.user} />
          <Text color={color}> [{event.giftName}] × {event.num}</Text>
          {event.price > 0 ? <Text color={color}>{yuan(event.price)}</Text> : null}
        </Text>
      )
    }
    case 'guard': {
      const color = userColor(event.level)
      return (
        <Text>
          <Medal user={event.user} />
          <User user={event.user} />
          <Text color={color}> [{event.roleName}] × {event.num}</Text>
          {event.price > 0 ? <Text color={color}>{yuan(event.price)}</Text> : null}
        </Text>
      )
    }
    case 'superchat': {
      const color = superChatColor(event.price)
      return (
        <Text>
          <Medal user={event.user} />
          <User user={event.user} />
          <Text color={color} bold> [￥{event.price} {event.body}]</Text>
        </Text>
      )
    }
    case 'interact':
      return (
        <Text dimColor>
          <User user={event.user} /> [{INTERACT_NAMES[event.msgTypeName] ?? '互动'}]
        </Text>
      )
  }
}
