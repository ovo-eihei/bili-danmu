import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Store } from '../../src/cli/store.js'

let dirs: string[] = []

function createStore(): { store: Store; cwd: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'bili-danmu-'))
  dirs.push(cwd)
  return { store: new Store({ cwd }), cwd }
}

afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  dirs = []
})

describe('Store', () => {
  test('登录信息落盘并能重新读取', () => {
    const { store } = createStore()
    store.setLogin('SESSDATA=x; bili_jct=y; DedeUserID=42', { uid: 42, name: '立青' })

    expect(store.isLoggedIn).toBe(true)
    expect(store.self).toEqual({ uid: 42, name: '立青' })
    expect(JSON.parse(readFileSync(store.path, 'utf8')).cookie).toContain('SESSDATA=x')
  })

  test('退出登录只清登录状态', () => {
    const { store } = createStore()
    store.setLogin('cookie', { uid: 1, name: 'a' })
    store.recordRoom({ roomId: 545068, owner: '德云色' })

    store.clearLogin()

    expect(store.isLoggedIn).toBe(false)
    expect(store.rooms()).toHaveLength(1)
  })

  test('同房间累积访问次数并排到最前', () => {
    const { store } = createStore()
    store.recordRoom({ roomId: 1, owner: '旧主播' })
    store.recordRoom({ roomId: 2, owner: '新主播' })
    store.recordRoom({ roomId: 1 })

    const rooms = store.rooms()
    expect(rooms[0]).toMatchObject({ roomId: 1, visits: 2, owner: '旧主播' })
    expect(rooms[1]).toMatchObject({ roomId: 2, visits: 1 })
  })

  test('新 Store 实例读取同一份配置', () => {
    const { store, cwd } = createStore()
    store.setLogin('cookie', { uid: 7, name: 'b' })

    const reopened = new Store({ cwd })
    expect(reopened.self).toEqual({ uid: 7, name: 'b' })
  })
})
