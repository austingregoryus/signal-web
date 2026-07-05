import { useEffect, useRef } from 'react'
import type { Message as Msg } from '../api/types'
import { Message } from './Message'
import styles from './Thread.module.css'

export function Thread({ messages }: { messages: Msg[] }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView?.() }, [messages.length])
  return (
    <div className={styles.thread}>
      {messages.map((m) => <Message key={m.id} m={m} />)}
      <div ref={endRef} />
    </div>
  )
}
