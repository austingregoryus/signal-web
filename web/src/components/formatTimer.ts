/** Human label for a disappearing-message timer, e.g. "30s", "5m", "1h", "4w". */
export function formatTimer(ms: number): string {
  const s = Math.round(ms / 1000)
  const units: [number, string][] = [[604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']]
  // Prefer an exact unit (90m stays "90m", not "2h"); otherwise round the largest.
  for (const [size, label] of units) if (s >= size && s % size === 0) return `${s / size}${label}`
  for (const [size, label] of units) if (s >= size) return `${Math.round(s / size)}${label}`
  return `${s}s`
}
