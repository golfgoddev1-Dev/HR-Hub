// Base64url helpers. The platform gives us btoa/atob (Workers and Node both
// expose them), so no buffer polyfill and no dependency is needed.

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes base64url (padding optional). Returns null for anything unusable. */
export function base64UrlToBytes(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function concatBytes(...parts) {
  const list = parts.filter((part) => part && part.length > 0);
  const total = list.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of list) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function utf8(value) {
  return new TextEncoder().encode(String(value));
}
