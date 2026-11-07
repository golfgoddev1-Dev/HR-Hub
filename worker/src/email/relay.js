// Worker client for the HR Hub mail relay: a Google Apps Script web app that
// sends through the company Workspace account with MailApp.
//
// Hardening rules enforced here:
// - APPS_SCRIPT_URL must be https and its host must be script.google.com, so a
//   wrong or tampered value cannot point the Worker at another server;
// - MAIL_RELAY_SECRET must be at least 32 characters;
// - the token is written with URLSearchParams (never concatenated) and is the
//   only query parameter sent;
// - the final response must come from script.google.com or
//   script.googleusercontent.com, and at most 4 KiB of it is read.
//
// sendRelayEmail never throws and never logs the URL, token, recipient, subject
// or text. Callers retry "upstream" and "network"; "config" and "invalid" are
// permanent until the configuration or the caller changes.

import { getRequiredEnv } from "../env.js";

export const APPS_SCRIPT_URL_ENV = "APPS_SCRIPT_URL";
export const MAIL_RELAY_SECRET_ENV = "MAIL_RELAY_SECRET";

export const TOKEN_HEADER = "X-Relay-Token";
export const TOKEN_QUERY_PARAM = "token";
export const RELAY_TIMEOUT_MS = 10000;

export const MIN_SECRET_LENGTH = 32;
export const MAX_RESPONSE_BYTES = 4096;

// The deployment URL must be the Apps Script host; the redirect it answers with
// lands on its googleusercontent echo host.
export const RELAY_HOST = "script.google.com";
export const ALLOWED_HOSTS = Object.freeze([
  "script.google.com",
  "script.googleusercontent.com",
]);

// Kept equal to the relay's own limits (mail-relay/relay-core.js). A mismatch
// would only mean the relay refuses a message this side accepted; the contract
// test in worker/tests/mail-relay-client.test.js guards the two together.
export const MAX_SUBJECT_LENGTH = 120;
export const MAX_TEXT_LENGTH = 4000;
export const MAX_RECIPIENT_LENGTH = 254;

// Relay code -> caller decision. "config" is a configuration problem the queue
// cannot fix by waiting; "invalid" is the caller's fault; everything else is
// worth retrying later.
const CODE_REASONS = Object.freeze({
  bad_request: "invalid",
  unauthorized: "config",
  disabled: "config",
  config: "config",
  recipient_not_allowed: "config",
  rate_limited: "upstream",
  quota: "upstream",
  send_failed: "upstream",
});

// One bare address: no display name, no list, no whitespace.
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
// A subject is a mail header: CR, LF and NUL would let a caller add headers.
const SUBJECT_CONTROL = /[\u0000\r\n]/;
// No control character anywhere in an address.
const ADDRESS_CONTROL = /[\u0000-\u001f\u007f]/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSingleEmail(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECIPIENT_LENGTH &&
    !ADDRESS_CONTROL.test(value) &&
    EMAIL_PATTERN.test(value)
  );
}

function byteLength(text) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(String(text)).length;
  }
  return String(text).length;
}

/**
 * Local copy of the relay's message rules, so an obviously bad message is
 * refused before it costs a network call. Kept as a copy rather than an import:
 * mail-relay/relay-core.js is a pasted Apps Script file that publishes a global,
 * not a module the Worker bundles. Returns the three fields or null.
 */
export function validateOutgoingMessage(message) {
  if (!isPlainObject(message)) return null;

  const { to, subject, text } = message;
  if (!isSingleEmail(to)) return null;

  if (
    typeof subject !== "string" ||
    subject.length < 1 ||
    subject.length > MAX_SUBJECT_LENGTH ||
    subject.trim().length === 0 ||
    SUBJECT_CONTROL.test(subject)
  ) {
    return null;
  }

  if (
    typeof text !== "string" ||
    text.length < 1 ||
    text.length > MAX_TEXT_LENGTH ||
    text.trim().length === 0
  ) {
    return null;
  }

  return { to, subject, text };
}

/**
 * Reads APPS_SCRIPT_URL and MAIL_RELAY_SECRET and builds the request URL.
 *
 * The URL must be https on script.google.com. Every query parameter it already
 * carried is dropped, then the token is set once through URLSearchParams: the
 * relay refuses unknown or duplicated parameters, and this keeps the request to
 * exactly one. Dropping the old value also means rotating the Worker secret is
 * enough and a stale copy in the URL cannot win.
 */
export function readRelayConfig(env) {
  const unconfigured = { ok: false, reason: "config" };

  const rawUrl =
    typeof env?.[APPS_SCRIPT_URL_ENV] === "string" ? env[APPS_SCRIPT_URL_ENV].trim() : "";
  const secret =
    typeof env?.[MAIL_RELAY_SECRET_ENV] === "string" ? env[MAIL_RELAY_SECRET_ENV] : "";
  if (rawUrl.length === 0 || secret.trim().length < MIN_SECRET_LENGTH) return unconfigured;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return unconfigured;
  }
  if (url.protocol !== "https:") return unconfigured;
  if (url.hostname !== RELAY_HOST) return unconfigured;

  url.search = "";
  url.hash = "";
  url.searchParams.set(TOKEN_QUERY_PARAM, secret);

  return { ok: true, url: url.toString(), secret };
}

/**
 * Sends one plain-text message through the relay.
 *
 * Returns { ok: true } or { ok: false, reason } where reason is:
 *   "config"   — bad configuration, or the relay refused the token / allowlist
 *   "invalid"  — the message fails the rules (and the relay's bad_request)
 *   "upstream" — caps, send failure, odd answer, unexpected host
 *   "network"  — transport failure or the 10 second timeout
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
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        [TOKEN_HEADER]: config.secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      // Apps Script answers with a redirect to its own echo endpoint.
      redirect: "follow",
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!response || response.ok !== true) {
      return { ok: false, reason: "upstream" };
    }

    // The final URL after redirects is exposed by the Workers runtime (and by
    // Node's fetch). If a runtime ever leaves it empty, the https-only config
    // check above is what stands.
    const finalUrl = typeof response.url === "string" ? response.url : "";
    if (finalUrl.length > 0) {
      let host;
      try {
        host = new URL(finalUrl).hostname;
      } catch {
        return { ok: false, reason: "upstream" };
      }
      if (ALLOWED_HOSTS.indexOf(host) === -1) return { ok: false, reason: "upstream" };
    }

    // Refuse an oversized declared body without reading it, then refuse anything
    // that still arrives over the cap. The read is not streamed: the body is
    // bounded by this check, not by aborting mid-stream.
    const declared = Number(response.headers?.get?.("Content-Length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      return { ok: false, reason: "upstream" };
    }

    let text;
    try {
      text = await response.text();
    } catch {
      return { ok: false, reason: "upstream" };
    }
    if (byteLength(text) > MAX_RESPONSE_BYTES) return { ok: false, reason: "upstream" };

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // A sign-in or error page instead of JSON: an upstream fault.
      return { ok: false, reason: "upstream" };
    }

    if (data && data.ok === true) return { ok: true };

    const code = data && typeof data.code === "string" ? data.code : "";
    const reason = CODE_REASONS[code];
    return { ok: false, reason: typeof reason === "string" ? reason : "upstream" };
  } catch {
    return { ok: false, reason: "network" };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** True when both relay values are present; lets a caller skip quietly. */
export function relayIsConfigured(env) {
  try {
    getRequiredEnv(env, APPS_SCRIPT_URL_ENV);
    getRequiredEnv(env, MAIL_RELAY_SECRET_ENV);
    return true;
  } catch {
    return false;
  }
}
