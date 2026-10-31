// Cloudflare Turnstile server-side verification.
// The token and secret are never logged, echoed, or stored.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

export function turnstileEnabled(env) {
  return env?.TURNSTILE_ENABLED === "true";
}

/**
 * Verifies a Turnstile token. Returns { ok: true } or { ok: false } for a token
 * Cloudflare rejected, and throws when the verification request itself fails
 * (transport error, timeout, HTTP error, or an unreadable response).
 */
export async function verifyTurnstile(token, ip, secret) {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (typeof ip === "string" && ip.length > 0) body.set("remoteip", ip);

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error("turnstile verification failed");

  let result = null;
  try {
    result = await response.json();
  } catch {
    throw new Error("turnstile verification failed");
  }

  return { ok: result?.success === true };
}
