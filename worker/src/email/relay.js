// Client for the HR Hub mail relay: a Google Apps Script web app that sends
// through the company Workspace account with MailApp (see mail-relay/README.md).
//
// The Worker knows two values: the deployment URL (APPS_SCRIPT_URL) and the
// shared token (MAIL_RELAY_SECRET, the same value as RELAY_TOKEN in the
// script's Script Properties). The token travels in the X-Relay-Token header
// and, because Apps Script's web-app event object does not expose inbound
// request headers, also as the `token` query parameter on the deployment URL.
//
// sendRelayEmail never throws and never logs the URL, token, recipient, subject
// or text. Callers retry "upstream" and "network"; "config" and "invalid" are
// permanent until the caller or the configuration changes.

import { getRequiredEnv } from "../env.js";

export const APPS_SCRIPT_URL_ENV = "APPS_SCRIPT_URL";
export const MAIL_RELAY_SECRET_ENV = "MAIL_RELAY_SECRET";

export const TOKEN_HEADER = "X-Relay-Token";
export const TOKEN_QUERY_PARAM = "token";
export const RELAY_TIMEOUT_MS = 10000;

// Kept equal to the relay's own limits (mail-relay/relay-core.js). A mismatch
// would only mean the relay refuses a message this side accepted; the contract
// test in worker/tests/mail-relay-client.test.js guards the two together.
export const MAX_SUBJECT_LENGTH = 120;
export const MAX_TEXT_LENGTH = 4000;
export const MAX_RECIPIENT_LENGTH = 254;

// One bare address: no display name, no list, no whitespace.
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
// A subject is a mail header: CR, LF and NUL would let a caller add headers.
const SUBJECT_CONTROL = /[\u0000\r\n]/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSingleEmail(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RECIPIENT_LENGTH &&
    EMAIL_PATTERN.test(value)
  );
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
 * HTTPS only: the token travels with the request. The token is appended as the
 * `token` query parameter because that is the only place an Apps Script web app
 * can read it (headers are not exposed). An existing value is replaced, so
 * rotating the Worker secret is enough and a stale URL copy cannot win.
 */
export function readRelayConfig(env) {
  const unconfigured = { ok: false, reason: "config" };

  const rawUrl =
    typeof env?.[APPS_SCRIPT_URL_ENV] === "string" ? env[APPS_SCRIPT_URL_ENV].trim() : "";
  const secret =
    typeof env?.[MAIL_RELAY_SECRET_ENV] === "string" ? env[MAIL_RELAY_SECRET_ENV] : "";
  if (rawUrl.length === 0 || secret.trim().length === 0) return unconfigured;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return unconfigured;
  }
  if (url.protocol !== "https:") return unconfigured;

  url.searchParams.set(TOKEN_QUERY_PARAM, secret);
  url.hash = "";

  return { ok: true, url: url.toString(), secret };
}

/**
 * Sends one plain-text message through the relay.
 *
 * Returns { ok: true } or { ok: false, reason } where reason is:
 *   "config"   — missing/unsafe configuration, or the relay rejected the token
 *   "invalid"  — the message fails the rules (and the relay's bad_request)
 *   "upstream" — quota, send failure, non-JSON answer or a non-2xx response
 *   "network"  — transport failure or the 10 second timeout
 *
 * "config" and "invalid" are permanent; "upstream" and "network" are worth
 * retrying later.
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

    let data;
    try {
      data = await response.json();
    } catch {
      // A sign-in or error page instead of JSON: treat it as an upstream fault.
      return { ok: false, reason: "upstream" };
    }

    if (data && data.ok === true) return { ok: true };

    const code = data && typeof data.code === "string" ? data.code : "";
    if (code === "unauthorized") return { ok: false, reason: "config" };
    if (code === "bad_request") return { ok: false, reason: "invalid" };
    // "quota", "send_failed" and anything unrecognised: worth retrying later.
    return { ok: false, reason: "upstream" };
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
