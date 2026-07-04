export async function resolveSelfId(
  client: { getAccountUuid: () => Promise<string | null> },
  fallbackNumber: string,
  explicitUuid?: string,
): Promise<string> {
  if (explicitUuid) return explicitUuid
  try {
    const uuid = await client.getAccountUuid()
    return uuid ?? fallbackNumber
  } catch {
    return fallbackNumber
  }
}
