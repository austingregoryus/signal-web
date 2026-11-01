import type { SearchHit } from '../api/types'
import { avatarColor, initials } from './avatar'
import styles from './SearchResults.module.css'

/** Cut a long body down to a window around the first match. */
export function snippet(body: string, query: string): { before: string; match: string; after: string } {
  const i = body.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return { before: body.slice(0, 90), match: '', after: body.length > 90 ? '…' : '' }
  const from = Math.max(0, i - 30)
  const to = Math.min(body.length, i + query.length + 60)
  return {
    before: (from > 0 ? '…' : '') + body.slice(from, i),
    match: body.slice(i, i + query.length),
    after: body.slice(i + query.length, to) + (to < body.length ? '…' : ''),
  }
}

function when(ts: number): string {
  const d = new Date(ts)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function SearchResults({
  query, results, loading, onPick,
}: {
  query: string
  results: SearchHit[]
  loading: boolean
  onPick: (hit: SearchHit) => void
}): React.JSX.Element {
  if (results.length === 0) {
    return <p className={styles.empty}>{loading ? 'Searching…' : `No messages match "${query}"`}</p>
  }
  return (
    <ul className={styles.list} aria-label="Search results">
      {results.map((hit) => {
        const name = hit.conversationName ?? hit.conversationId
        const s = snippet(hit.body ?? '', query)
        return (
          <li key={hit.id}>
            <button className={styles.row} onClick={() => onPick(hit)}>
              <span className={styles.avatar} style={{ background: avatarColor(hit.conversationId) }} aria-hidden>
                {hit.conversationType === 'group' ? '👥' : initials(hit.conversationName)}
              </span>
              <span className={styles.text}>
                <span className={styles.top}>
                  <span className={styles.name}>{name}</span>
                  <span className={styles.time}>{when(hit.timestamp)}</span>
                </span>
                <span className={styles.snippet}>
                  {hit.direction === 'out' ? 'You: ' : ''}{s.before}<mark>{s.match}</mark>{s.after}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
