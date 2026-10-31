// Pure Web Crypto helpers. No Node APIs, no secrets, no I/O.

const encoder = new TextEncoder();
const HEX_64 = /^[a-f\d]{64}$/i;

function toHex(buffer) {
  let out = "";
  for (const byte of new Uint8Array(buffer)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/** SHA-256 of the UTF-8 text, lowercase hex. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
  return toHex(digest);
}

/** HMAC-SHA256 of the UTF-8 text with the UTF-8 key, lowercase hex. */
export async function hmacSha256Hex(key, text) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(key)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(String(text)));
  return toHex(signature);
}

/**
 * Compares two 64-character hex digests in constant time.
 * Anything that is not a 64-character hex string is rejected without comparing.
 * Values are compared case-insensitively, like decoding hex to bytes would.
 */
export function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!HEX_64.test(a) || !HEX_64.test(b)) return false;

  const left = a.toLowerCase();
  const right = b.toLowerCase();
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
