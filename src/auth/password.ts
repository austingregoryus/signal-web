import { hash, verify, Algorithm } from '@node-rs/argon2'

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: Algorithm.Argon2id })
}

export async function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashString, plain)
  } catch {
    // A malformed stored hash must not throw into the auth path.
    return false
  }
}
