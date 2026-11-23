// Approval-link token rules, shared by the page route and the decision route.
//
// A link token is `<base64url payload>.<hex HMAC-SHA256>` (APPROVAL_LINK_SECRET).
// The payload is {l: leaveId, a: approverId, e: expiry ms, n: nonce}; it never
// carries the decision. Only sha256(nonce) is stored (approval_tokens.nonce_hash)
// with used_at, so a token is single-use and the database never holds a value
// that could be replayed.
//
// The link is `<APP_PUBLIC_URL>/approve#t=<token>`: the fragment is never sent
// to a server, a log or a Referer header; the page puts it in a POST body. The
// base comes from APP_PUBLIC_URL, a plain Worker variable, never from a request
// header.

import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "./crypto.js";

export const APPROVAL_NONCE_BYTES = 16;
export const APPROVAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,600}\.[a-f\d]{64}$/;
export const APPROVAL_LINK_TTL_MS = 72 * 60 * 60 * 1000;

// Same rule as the in-app reject note (worker/src/leave-rules.js): whitespace is
// collapsed, at least one visible character is required, and the note is capped
// at 500 code points.
export const DECISION_REASON_MAX_LENGTH = 500;

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function textToBase64Url(text) {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function base64UrlToText(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0))
  );
}

/** A new random nonce: 16 CSPRNG bytes, base64url. */
export function randomApprovalNonce() {
  const bytes = new Uint8Array(APPROVAL_NONCE_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

/** The stored form of a nonce. The nonce itself is never persisted. */
export async function hashApprovalNonce(nonce) {
  return sha256Hex(String(nonce));
}

/** True for a well-formed token shape; the signature is checked separately. */
export function isApprovalToken(value) {
  return typeof value === "string" && APPROVAL_TOKEN_PATTERN.test(value);
}

/** Signs {leaveId, approverId, exp (ms), nonce}. */
export async function signApprovalToken(secret, { leaveId, approverId, exp, nonce }) {
  const body = textToBase64Url(JSON.stringify({ l: leaveId, a: approverId, e: exp, n: nonce }));
  return `${body}.${await hmacSha256Hex(secret, body)}`;
}

/**
 * The payload of a token with a valid signature, or null. The signature is
 * compared in constant time; nothing is parsed before it matches. Expiry is the
 * caller's check (it needs its own category).
 */
export async function verifyApprovalToken(secret, token) {
  if (typeof secret !== "string" || secret.length === 0 || !isApprovalToken(token)) return null;

  const [body, signature] = token.split(".");
  if (!timingSafeEqualHex(await hmacSha256Hex(secret, body), signature)) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlToText(body));
  } catch {
    return null;
  }
  const { l, a, e, n } = payload ?? {};
  if (typeof l !== "string" || typeof a !== "string" || typeof n !== "string") return null;
  if (!Number.isFinite(e)) return null;
  return { leaveId: l, approverId: a, exp: e, nonce: n };
}

/**
 * Expiry in ms: 72 hours after issuance, nothing else (retroactive leaves are
 * legitimate, so the leave's start date never shortens it). null for an
 * unusable creation time.
 */
export function approvalTokenExpiryMs(createdAt = new Date()) {
  const base = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  return Number.isFinite(base) ? base + APPROVAL_LINK_TTL_MS : null;
}

/**
 * The configured public origin, without query, fragment or trailing slashes.
 * Returns null when APP_PUBLIC_URL is missing or is not an http(s) URL. A plain
 * http origin is accepted for local development only; production uses https.
 */
export function approvalLinkBase(publicUrl) {
  if (typeof publicUrl !== "string" || publicUrl.trim().length === 0) return null;

  let url;
  try {
    url = new URL(publicUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.search.length > 0 || url.hash.length > 0) return null;

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** `<APP_PUBLIC_URL>/approve#t=<token>`, or null for bad input. */
export function buildApprovalLink(publicUrl, token) {
  const base = approvalLinkBase(publicUrl);
  if (!base || !isApprovalToken(token)) return null;
  return `${base}/approve#t=${token}`;
}

/** The in-app rule: collapse runs of whitespace, then trim. */
export function normalizeDecisionReason(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/** null when the reason is acceptable, otherwise "required" or "too_long". */
export function decisionReasonProblem(value) {
  if (typeof value !== "string") return "required";
  const note = normalizeDecisionReason(value);
  if (note.length === 0) return "required";
  if (Array.from(note).length > DECISION_REASON_MAX_LENGTH) return "too_long";
  return null;
}

/**
 * Why a link cannot be used, as one of the only three categories the page
 * shows: "used", "expired" or "invalid". Returns null when the link is usable.
 *
 * Order matters: a used token stays "used" even if it has since expired, and a
 * replaced token is "invalid" rather than "expired". `approverResponsible` is
 * the existing scope rule evaluated at read/decision time, never a stored flag.
 */
export function approvalTokenFailureCategory({
  token,
  request,
  now = new Date(),
  approverResponsible = false,
} = {}) {
  if (!token || typeof token !== "object") return "invalid";
  if (token.used_at) return "used";
  if (token.invalidated_at) return "invalid";

  const expiresMs = Date.parse(String(token.expires_at ?? ""));
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(expiresMs) || !Number.isFinite(nowMs) || expiresMs <= nowMs) {
    return "expired";
  }

  if (!request || typeof request !== "object") return "invalid";
  if (request.status !== "pending") return "invalid";
  if (request.approver_id !== token.approver_employee_id) return "invalid";
  if (approverResponsible !== true) return "invalid";
  return null;
}
