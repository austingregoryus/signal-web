export function authorId(uuid?: string | null, number?: string | null): string {
  if (uuid) return uuid
  if (number) return number
  throw new Error('authorId requires uuid or number')
}
