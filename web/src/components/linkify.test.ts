import { describe, it, expect } from 'vitest'
import { linkify } from './linkify'

describe('linkify', () => {
  it('leaves plain text alone', () => {
    expect(linkify('just words')).toEqual([{ text: 'just words' }])
  })

  it('finds http(s) and www links, leaving trailing punctuation outside', () => {
    expect(linkify('see https://example.com/a?b=1, and www.foo.org.')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: ', and ' },
      { text: 'www.foo.org', href: 'https://www.foo.org' },
      { text: '.' },
    ])
  })

  it('keeps balanced parens in a URL but not a wrapping one', () => {
    expect(linkify('(https://en.wikipedia.org/wiki/Foo_(bar))')).toEqual([
      { text: '(' },
      { text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { text: ')' },
    ])
  })

  it('never links other schemes', () => {
    expect(linkify('javascript:alert(1) data:text/html,x')).toEqual([{ text: 'javascript:alert(1) data:text/html,x' }])
  })
})
