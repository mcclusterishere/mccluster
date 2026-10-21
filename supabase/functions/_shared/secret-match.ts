// Shared-secret comparison for verify_jwt=false internal Edge Functions.
//
// Incoming credentials are attacker-controlled. Hash both values to a fixed
// width before the byte comparison so ordinary string equality cannot leak
// the first differing position or the configured secret's length through the
// comparison loop. Missing credentials fail closed.
export async function secretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!provided || !expected || provided.length > 4096) return false;

  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const a = new Uint8Array(providedHash);
  const b = new Uint8Array(expectedHash);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
