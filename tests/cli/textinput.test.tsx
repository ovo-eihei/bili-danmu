import { useState } from 'react'
import { render } from 'ink-testing-library'
import { describe, expect, test } from 'vitest'
import { TextInput } from '../../src/cli/tui/TextInput.js'

const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

describe('TextInput', () => {
  test('Ctrl 组合键不写入字符', async () => {
    const changes: string[] = []

    function Harness() {
      const [value, setValue] = useState('')
      return (
        <TextInput
          value={value}
          onChange={(next) => {
            changes.push(next)
            setValue(next)
          }}
        />
      )
    }

    const { stdin, unmount } = render(<Harness />)

    stdin.write('\u000F')
    await delay()
    expect(changes).toEqual([])

    stdin.write('a')
    await delay()
    expect(changes).toEqual(['a'])

    unmount()
  })
})
