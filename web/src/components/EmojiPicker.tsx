import { useMemo, useRef, useState } from 'react'
import { EMOJI_CATEGORIES, ALL_EMOJI } from './emoji'
import styles from './EmojiPicker.module.css'

/**
 * Pop-up emoji picker for the composer. Renders above the textarea with a
 * search box and category tabs; selecting an emoji calls onPick and stays open
 * so several can be picked in a row. Click-outside / Escape closes it.
 */
export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState(EMOJI_CATEGORIES[0].id)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return EMOJI_CATEGORIES.find((c) => c.id === activeCat)?.emojis ?? []
    return ALL_EMOJI.filter((e) => e.e.includes(q) || e.k.includes(q))
  }, [query, activeCat])

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className={styles.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div className={styles.picker} role="dialog" aria-label="Emoji picker" ref={rootRef}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search emoji…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search emoji"
          autoFocus
        />
        <div className={styles.grid} role="listbox" aria-label="Emoji">
          {list.length === 0 ? (
            <div className={styles.empty}>No matches</div>
          ) : (
            list.map((entry) => (
              <button
                key={entry.e + entry.k}
                className={styles.btn}
                role="option"
                aria-label={entry.k.split(' ')[0]}
                onClick={() => onPick(entry.e)}
                type="button"
              >
                {entry.e}
              </button>
            ))
          )}
        </div>
        {!query ? (
          <div className={styles.tabs} role="tablist" aria-label="Emoji categories">
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`${styles.tab} ${c.id === activeCat ? styles.tabActive : ''}`}
                role="tab"
                aria-selected={c.id === activeCat}
                onClick={() => setActiveCat(c.id)}
                type="button"
                aria-label={c.label}
                title={c.label}
              >
                {c.icon}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
