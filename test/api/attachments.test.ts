import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'
import { AttachmentBlobStore } from '../../src/store/attachmentsBlob'

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
