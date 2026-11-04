const PALETTE = [
  '#f97066', // coral
  '#f7b955', // amber
  '#5cc8a7', // teal
  '#4f6ef7', // indigo (accent-adjacent)
  '#8b7ef0', // violet
  '#5aa9e6', // sky
  '#e07bc0', // pink
  '#6bbf6b', // green
]

/** Deterministically pick a background color for an id (e.g. conversation id). */
export function avatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % PALETTE.length
  return PALETTE[idx]
}

/** What to call a conversation: its name, else the contact's number, else the raw id. */
export function conversationLabel(c: { id: string; displayName: string | null; number?: string | null }): string {
  return c.displayName ?? c.number ?? c.id
}

/** Derive 1-2 letter initials from a display name, or a fallback glyph. */
export function initials(name: string | null): string {
  if (!name) return '#'
  const trimmed = name.trim()
  if (!trimmed) return '#'
  // Phone numbers / raw ids: use a generic glyph rather than digits.
  if (/^[+\d][\d\s()+-]*$/.test(trimmed)) return '#'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
