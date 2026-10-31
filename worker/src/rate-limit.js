// Rate limiting through SQLite-backed Durable Objects.
//
// Each limiter binding is a Durable Object namespace. The key selects the
// object, so counters are shared across Cloudflare locations and survive
// isolate restarts. The raw QR token is never used as a key; callers hash it
// with tokenRateLimitKey() first.

import { sha256Hex } from "./crypto.js";

export const RATE_LIMIT_MESSAGE = "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
export const SERVICE_UNAVAILABLE_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";

const CHECK_URL = "https://rate-limit.internal/check";

/** Client IP from the Cloudflare header, or 'unknown' when absent. */
export function clientIp(request) {
  const value = request?.headers?.get?.("CF-Connecting-IP");
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

/** IP-keyed limit key. */
export function ipRateLimitKey(scope, ip) {
  return `${scope}|${ip}`;
}

/** Token-keyed limit key: SHA-256 hex of the raw QR token, never the token. */
export async function tokenRateLimitKey(token) {
  return `submit|${await sha256Hex(token)}`;
}

function unavailable() {
  return { ok: false, status: 503, message: SERVICE_UNAVAILABLE_MESSAGE };
}

/**
 * Calls one Durable Object limiter. Missing binding, a thrown error, a
 * non-2xx response, or a malformed response fails closed with 503; an
 * over-limit result is 429.
 */
export async function checkRateLimit(env, bindingName, key) {
  const namespace = env ? env[bindingName] : null;
  if (
    !namespace ||
    typeof namespace.idFromName !== "function" ||
    typeof namespace.get !== "function"
  ) {
    return unavailable();
  }

  try {
    const stub = namespace.get(namespace.idFromName(key));
    if (!stub || typeof stub.fetch !== "function") return unavailable();

    const response = await stub.fetch(CHECK_URL, { method: "POST" });
    if (!response.ok) return unavailable();

    const result = await response.json().catch(() => null);
    if (!result || typeof result.success !== "boolean") return unavailable();
    if (result.success) return { ok: true };
    return { ok: false, status: 429, message: RATE_LIMIT_MESSAGE };
  } catch {
    return unavailable();
  }
}
