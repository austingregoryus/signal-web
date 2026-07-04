import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'
import { AttachmentBlobStore } from '../../src/store/attachmentsBlob'
import { safeContentType } from '../../src/api/attachments'

let dir: string
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('AttachmentBlobStore', () => {
  it('stores encrypted (ciphertext on disk) and round-trips the plaintext', async () => {
    dir = mkdtempSync(join(tmpdir(), 'swblob-'))
    const blobs = new AttachmentBlobStore(dir, 'a-256-bit-keyphrase-................')
    const plain = Buffer.from('secret image bytes')
    await blobs.put('att-1', plain)
    const back = await blobs.get('att-1')
    expect(back?.toString()).toBe('secret image bytes')
  })

  it('returns null for an unknown id', async () => {
    dir = mkdtempSync(join(tmpdir(), 'swblob-'))
    const blobs = new AttachmentBlobStore(dir, 'a-256-bit-keyphrase-................')
    expect(await blobs.get('missing')).toBeNull()
  })
})

describe('safeContentType', () => {
  it('serves allowlisted image types inline', () => {
    expect(safeContentType('image/png')).toEqual({ contentType: 'image/png', disposition: 'inline' })
  })

  it('forces text/html to octet-stream + attachment', () => {
    expect(safeContentType('text/html')).toEqual({ contentType: 'application/octet-stream', disposition: 'attachment' })
  })

  it('forces image/svg+xml to octet-stream + attachment (SVG can carry script)', () => {
    expect(safeContentType('image/svg+xml')).toEqual({ contentType: 'application/octet-stream', disposition: 'attachment' })
  })

  it('defaults null content-type to octet-stream + attachment', () => {
    expect(safeContentType(null)).toEqual({ contentType: 'application/octet-stream', disposition: 'attachment' })
  })
})
