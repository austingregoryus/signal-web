/**
 * Group ID normalization.
 *
 * signal-cli delivers inbound group envelopes with a raw base64 group id
 * (e.g. "GxH1JWjt6...="). Its REST send API, and the /v1/groups list, use a
 * *different* form: "group." + base64(<raw id as a UTF-8 string>) (e.g.
 * "group.R3hIMUpX..."). Storing both as conversation ids splits a group into
 * two conversations — outbound under the prefixed form, inbound under the raw.
 *
 * Canonical form is the RAW base64 (matches inbound parsing). Profile sync and
 * any other prefixed source must call normalizeGroupId before storing.
 */

/**
 * Convert any group id to its canonical RAW form.
 * - Already-raw ids (no "group." prefix) pass through unchanged.
 * - "group."-prefixed ids are decoded back to the raw base64 string.
 */
export function normalizeGroupId(id: string): string {
  if (id.startsWith('group.')) {
    try {
      return Buffer.from(id.slice('group.'.length), 'base64').toString('utf8')
    } catch {
      return id // malformed; leave as-is rather than throw
    }
  }
  return id
}

/**
 * Convert a raw group id to the form signal-cli's /v2/send expects:
 * "group." + base64(<raw id as UTF-8>). Already-prefixed ids pass through
 * unchanged. Used only at the send boundary.
 *
 * Detection: a Signal group id (delivered raw in inbound envelopes) is base64-
 * encoded binary of 30+ chars AND contains at least one non-hex base64 char
 * (`+` or `/`) — hex-only strings (e.g. a 32-char sha256 prefix) are NOT
 * treated as group ids, since real group ids always contain bytes outside the
 * hex alphabet once base64-encoded. This avoids misfiring on long hex tokens.
 */
export function toSendGroupId(id: string): string {
  if (id.startsWith('group.')) return id
  if (!/^[A-Za-z0-9+/]{30,}={0,2}$/.test(id)) return id
  if (!/[+/]/.test(id)) return id // hex-only — not a real group id
  return 'group.' + Buffer.from(id, 'utf8').toString('base64')
}
