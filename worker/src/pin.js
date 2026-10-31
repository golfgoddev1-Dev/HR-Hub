// Pure HMAC helper. Web Crypto only: no Node APIs, no secrets, no I/O.

const encoder = new TextEncoder();

function toHex(buffer) {
  let out = "";
  for (const byte of new Uint8Array(buffer)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * HMAC-SHA256 keyed with the pepper, over the PIN string, as 64 lowercase hex chars.
 * Deterministic and pure: same arguments always produce the same output.
 */
export async function pinHmacHex(pepper, pin) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(pepper)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(pin)));
  return toHex(signature);
}

/** Constant-time-ish comparison of two hex digests. */
export function hmacHexMatches(expectedHex, actualHex) {
  const a = String(expectedHex).trim().toLowerCase();
  const b = String(actualHex).trim().toLowerCase();
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
