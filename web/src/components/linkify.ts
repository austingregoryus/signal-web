export type TextPart = { text: string; href?: string }

// http(s) URLs and bare www. hosts. Only these schemes are ever turned into
// links, so message text can never produce a javascript: or data: href.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi
// Punctuation that usually ends a sentence rather than the URL.
const TRAILING = /[.,;:!?'"]+$/

/** Split message text into plain runs and link runs. */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0].replace(TRAILING, '')
    // Drop an unbalanced closing paren: "(see https://x.com/a)" -> "https://x.com/a".
    while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      url = url.slice(0, -1)
    }
    const start = match.index
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
