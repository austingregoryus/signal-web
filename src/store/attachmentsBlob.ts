import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class AttachmentBlobStore {
  private readonly key: Buffer

  constructor(private readonly dir: string, keyPhrase: string) {
    // Derive a 32-byte key from the phrase (the store key is already high-entropy).
    this.key = createHash('sha256').update(keyPhrase).digest()
  }

  private pathFor(id: string): string {
    const name = createHash('sha256').update(id).digest('hex')
    return join(this.dir, name)
  }

  async delete(id: string): Promise<void> {
    const { unlink } = await import('node:fs/promises')
    try { await unlink(this.pathFor(id)) } catch { /* already gone — fine */ }
  }

  async put(id: string, bytes: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const enc = Buffer.concat([cipher.update(bytes), cipher.final()])
    const tag = cipher.getAuthTag()
    // file layout: iv(12) | tag(16) | ciphertext
    await writeFile(this.pathFor(id), Buffer.concat([iv, tag, enc]))
  }

  async get(id: string): Promise<Buffer | null> {
    let raw: Buffer
    try {
      raw = await readFile(this.pathFor(id))
    } catch {
      return null
    }
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const enc = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()])
  }
}
