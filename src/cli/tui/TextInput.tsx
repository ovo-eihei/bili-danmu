import { useEffect, useRef, useState } from 'react'
import { Text, useInput } from 'ink'

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit?: (value: string) => void
  placeholder?: string
  mask?: string
  focus?: boolean
  showCursor?: boolean
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder = '',
  mask,
  focus = true,
  showCursor = true,
}: TextInputProps) {
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const selfChange = useRef(false)

  useEffect(() => {
    if (selfChange.current) {
      selfChange.current = false
      return
    }
    // 外部填入内容（补全、发送失败回填）时光标落到末尾
    setCursorOffset(value.length)
  }, [value])

  useInput(
    (input, key) => {
      // Ctrl/Meta 组合键留给全局快捷键，不能当成字符写进输入框
      if (key.ctrl || key.meta) {
        return
      }
      if (key.upArrow || key.downArrow || key.tab) {
        return
      }
      if (key.return) {
        onSubmit?.(value)
        return
      }

      let nextValue = value
      let nextOffset = cursorOffset
      if (key.leftArrow) {
        nextOffset = Math.max(0, cursorOffset - 1)
      } else if (key.rightArrow) {
        nextOffset = Math.min(value.length, cursorOffset + 1)
      } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset)
          nextOffset = cursorOffset - 1
        }
      } else {
        nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset)
        nextOffset = cursorOffset + input.length
      }

      setCursorOffset(nextOffset)
      if (nextValue !== value) {
        selfChange.current = true
        onChange(nextValue)
      }
    },
    { isActive: focus },
  )

  const display = mask ? mask.repeat(value.length) : value

  if (!focus || !showCursor) {
    return <Text>{display || (placeholder ? <Text dimColor>{placeholder}</Text> : ' ')}</Text>
  }

  if (display.length === 0) {
    if (!placeholder) {
      return <Text inverse> </Text>
    }
    return (
      <Text>
        <Text inverse>{placeholder[0]}</Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    )
  }

  const before = display.slice(0, cursorOffset)
  const cursor = display[cursorOffset] ?? ' '
  const after = display.slice(cursorOffset + 1)

  return (
    <Text>
      {before}
      <Text inverse>{cursor}</Text>
      {after}
    </Text>
  )
}
