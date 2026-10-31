// Pure national-ID helpers. The pepper is a parameter; the caller reads the secret.

import { hmacSha256Hex } from "./crypto.js";

/** Strips every non-digit character. */
export function normalizeNationalId(input) {
  return String(input ?? "").replace(/\D/g, "");
}

/** HMAC-SHA256 of the normalized national ID, keyed with the pepper. */
export async function nationalIdHash(normalized, pepper) {
  return hmacSha256Hex(pepper, normalized);
}
