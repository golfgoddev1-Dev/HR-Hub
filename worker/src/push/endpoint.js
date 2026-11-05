// Push endpoints identify one browser installation. The subscribe and logout
// routes share this check, so both store and delete exactly the same string.

export const ENDPOINT_MAX_LENGTH = 1000;

/** https only, a real host, and short enough to store. */
export function normalizeEndpoint(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > ENDPOINT_MAX_LENGTH) return null;
  if (/^https:\/\//i.test(trimmed) === false) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" || url.hostname.length === 0) return null;
    return url.toString();
  } catch {
    return null;
  }
}
