// Shared-secret check for the relay endpoint.
//
// The presented and expected secrets are hashed first and the digests compared
// byte by byte without an early exit, so the comparison time does not depend on
// how many leading characters matched (nor on the two lengths differing).

const encoder = new TextEncoder();

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value))
  );
}

/** True only for two non-empty strings that are exactly equal. */
export async function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;

  const [left, right] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

/**
 * Token from an `Authorization: Bearer <token>` header, or null.
 * The token must be exactly one value: surrounding whitespace is refused
 * rather than trimmed, so `Bearer  secret` and `Bearer secret ` are both
 * treated as malformed headers instead of quietly accepted.
 */
export function bearerToken(headerValue) {
  if (typeof headerValue !== "string") return null;
  const prefix = "bearer ";
  if (headerValue.slice(0, prefix.length).toLowerCase() !== prefix) return null;
  const token = headerValue.slice(prefix.length);
  if (token.length === 0 || token !== token.trim()) return null;
  return token;
}
