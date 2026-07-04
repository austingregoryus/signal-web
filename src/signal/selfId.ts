export async function resolveSelfId(
  client: { getAccountUuid: () => Promise<string | null> },
  fallbackNumber: string,
): Promise<string> {
  try {
    const uuid = await client.getAccountUuid()
    return uuid ?? fallbackNumber
  } catch {
    return fallbackNumber
  }
}
