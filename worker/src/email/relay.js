// Client for the HR Hub mail relay (mail-relay/).
//
// The relay is a separate Worker that holds the email provider key. This
// module only knows two values: where the relay is (MAIL_RELAY_URL) and the
// shared secret it must present (MAIL_RELAY_SECRET). It sends one plain-text
// message — one recipient, one subject, one body — and never a second field
// the relay would have to ignore.
//
// The function never throws and never logs: a caller (a queue worker, later the
// approval email) gets a small result object and decides whether to retry. No
// recipient, subject, body or secret ever reaches a log line or an error.

import { getRequiredEnv } from "../env.js";

export const MAIL_RELAY_URL_ENV = "MAIL_RELAY_URL";
export const MAIL_RELAY_SECRET_ENV = "MAIL_RELAY_SECRET";

export const RELAY_SEND_PATH = "/send";
export const RELAY_TIMEOUT_MS = 10000;

// Kept equal to the relay's own limits (mail-relay/src/message.js). A mismatch
// would only mean the relay refuses a message this side accepted, which the
// contract test in worker/tests/mail-relay-client.test.js guards.
export const MAX_RECIPIENT_LENGTH = 254;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_TEXT_LENGTH = 4000;

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const HEADER_CONTROL = /[\u0000-\u001f\u007f]/;
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainEmail(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECIPIENT_LENGTH &&
    !HEADER_CONTROL.test(value) &&
    EMAIL_PATTERN.test(value)
  );
}

/**
 * Local copy of the relay's message rules, so an obviously bad message is
 * refused before it costs a network call. Returns the three fields or null.
 */
export function validateOutgoingMessage(message) {
  if (!isPlainObject(message)) return null;

  const { to, subject, text } = message;
  if (!isPlainEmail(to)) return null;

  if (
    typeof subject !== "string" ||
    subject.length < 1 ||
    subject.length > MAX_SUBJECT_LENGTH ||
    subject !== subject.trim() ||
    HEADER_CONTROL.test(subject)
  ) {
    return null;
  }

  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > MAX_TEXT_LENGTH ||
    text.trim().length === 0 ||
    BODY_CONTROL.test(text)
  ) {
    return null;
  }

  return { to, subject, text };
}

/**
 * Reads MAIL_RELAY_URL and MAIL_RELAY_SECRET. HTTPS is required because the
 * secret travels in a header; the only exception is a loopback http URL, which
 * local `wrangler dev` uses. Query strings and fragments are refused so the
 * base URL is unambiguous.
 */
export function readRelayConfig(env) {
  const config = { ok: false, reason: "config" };

  const rawUrl = typeof env?.[MAIL_RELAY_URL_ENV] === "string" ? env[MAIL_RELAY_URL_ENV].trim() : "";
  const secret = typeof env?.[MAIL_RELAY_SECRET_ENV] === "string" ? env[MAIL_RELAY_SECRET_ENV] : "";
  if (rawUrl.length === 0 || secret.trim().length === 0) return config;

  let baseUrl;
  try {
    const url = new URL(rawUrl);
    const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
    if (url.protocol !== "https:" && !loopbackHttp) return config;
    if (url.search.length > 0 || url.hash.length > 0) return config;
    baseUrl = url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    return config;
  }

  return { ok: true, baseUrl, secret };
}

/**
 * Sends one plain-text message through the relay.
 *
 * Returns:
 *   { ok: true, status }
 *   { ok: false, reason: "config" }             — missing or unsafe relay config
 *   { ok: false, reason: "invalid" }            — message fails the local rules
 *   { ok: false, reason: "upstream", status }   — the relay refused it
 *   { ok: false, reason: "network" }            — transport failure or timeout
 *
 * A "network" or "upstream" result is retryable by the caller; "config" and
 * "invalid" are not.
 */
export async function sendRelayEmail(env, options = {}) {
  const config = readRelayConfig(env);
  if (!config.ok) return { ok: false, reason: "config" };

  const message = validateOutgoingMessage(options);
  if (!message) return { ok: false, reason: "invalid" };

  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== "function") return { ok: false, reason: "config" };

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : RELAY_TIMEOUT_MS;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  if (controller && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const response = await fetchImpl(`${config.baseUrl}${RELAY_SEND_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      ...(controller ? { signal: controller.signal } : {}),
    });

    // The relay's body is a short code we do not need; not reading it keeps any
    // echo of the message out of this process entirely.
    if (response && response.ok === true) {
      return { ok: true, status: response.status };
    }
    return { ok: false, reason: "upstream", status: response?.status ?? 0 };
  } catch {
    return { ok: false, reason: "network" };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** True when both relay values are present; lets a caller skip quietly. */
export function relayIsConfigured(env) {
  try {
    getRequiredEnv(env, MAIL_RELAY_URL_ENV);
    getRequiredEnv(env, MAIL_RELAY_SECRET_ENV);
    return true;
  } catch {
    return false;
  }
}
