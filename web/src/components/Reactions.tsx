import { useState } from 'react'
import type { Reaction } from '../api/types'
import styles from './Reactions.module.css'

const PICKER = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export function Reactions({ reactions, onReact }: { reactions: Reaction[]; onReact: (emoji: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const counts = new Map<string, number>()
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
  return (
    <div className={styles.wrap}>
      {[...counts.entries()].map(([emoji, n]) => (
        <button key={emoji} className={styles.chip} onClick={() => onReact(emoji)}>{emoji} {n}</button>
      ))}
      <button className={styles.add} aria-label="Add reaction" onClick={() => setOpen((o) => !o)}>＋</button>
      {open && (
        <div className={styles.picker}>
          {PICKER.map((e) => (
            <button key={e} aria-label={e} onClick={() => { onReact(e); setOpen(false) }}>{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}
