// Reversible encryption for national IDs (AES-256-GCM).
//
// The key is a Worker secret (NATIONAL_ID_ENC_KEY) and never leaves the Worker.
// Stored format: "v1." + base64(iv[12] || ciphertext+tag). The HMAC hash in
// national_id_hash stays the value used for lookups and comparisons, so this
// module never affects login.
//
// The key is derived as SHA-256 of the secret text, so any sufficiently long
// random secret works and the same secret always yields the same key.

const PREFIX = "v1.";
const IV_BYTES = 12;
const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importKey(secret) {
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(String(secret)));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypts a normalized national ID. Throws only on a missing key. */
export async function encryptNationalId(secret, digits) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("missing national id key");
  }
  const key = await importKey(secret);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(String(digits))
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return PREFIX + toBase64(combined);
}

/**
 * Decrypts a stored value. Returns null on any failure (wrong key, legacy
 * format, tampered tag) so callers can answer "unavailable" instead of leaking
 * an error. Never logs and never returns the raw stored string.
 */
export async function decryptNationalId(secret, stored) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  if (typeof stored !== "string" || !stored.startsWith(PREFIX)) return null;

  try {
    const combined = fromBase64(stored.slice(PREFIX.length));
    if (combined.length <= IV_BYTES) return null;
    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    const key = await importKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const digits = new TextDecoder().decode(plaintext);
    return /^\d{13}$/.test(digits) ? digits : null;
  } catch {
    return null;
  }
}
