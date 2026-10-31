// Pure cookie helpers. No env access, no I/O.

export const sessionCookieName = "hr_session";

const DEFAULT_MAX_AGE = 43200;

/**
 * Parses a Cookie header into name -> value.
 * Empty pairs, pairs without "=" and pairs with an empty name are ignored.
 * Values are percent-decoded; malformed escapes keep the raw value.
 */
export function parseCookies(headerValue) {
  const cookies = {};
  if (typeof headerValue !== "string" || headerValue.length === 0) return cookies;

  for (const pair of headerValue.split(";")) {
    const trimmed = pair.trim();
    if (trimmed.length === 0) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const name = trimmed.slice(0, separator).trim();
    if (name.length === 0) continue;

    const rawValue = trimmed.slice(separator + 1).trim();
    // First occurrence wins, like cookie-parser.
    if (Object.prototype.hasOwnProperty.call(cookies, name)) continue;

    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    cookies[name] = value;
  }

  return cookies;
}

/** Cookie options for the session cookie. The caller decides `secure`. */
export function sessionCookieOptions({ secure = true } = {}) {
  return {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: DEFAULT_MAX_AGE,
    secure,
  };
}

/** Builds a Set-Cookie string. `maxAge: 0` clears the cookie. */
export function serializeCookie(name, value, options = {}) {
  const maxAge = Number.isFinite(options.maxAge) ? options.maxAge : DEFAULT_MAX_AGE;
  const parts = [
    `${name}=${encodeURIComponent(value ?? "")}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (options.secure === true) parts.push("Secure");
  return parts.join("; ");
}
