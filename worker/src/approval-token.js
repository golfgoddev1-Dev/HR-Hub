// Approval-link token rules, shared by the public page and the decision route.
//
// Only the SHA-256 hash of a link token is stored (approval_tokens.token_hash);
// the raw token exists in the email and in the page URL, never in the database.
// A token is 32 random bytes from the platform CSPRNG, base64url encoded to 43
// characters with no padding.
//
// The link base comes from APP_PUBLIC_URL, a plain Worker variable. It is never
// built from a request header, so a forged Host cannot move an approval link to
// another site.

import { sha256Hex } from "./crypto.js";

export const APPROVAL_TOKEN_BYTES = 32;
export const APPROVAL_TOKEN_LENGTH = 43;
export const APPROVAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
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

/** A new raw link token: 32 random bytes, base64url, no padding. */
export function randomApprovalToken() {
  const bytes = new Uint8Array(APPROVAL_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

/** The stored form of a link token. The raw value is never persisted. */
export async function hashApprovalToken(rawToken) {
  return sha256Hex(String(rawToken));
}

/** True for a well-formed raw link token (43 base64url characters). */
export function isApprovalToken(value) {
  return typeof value === "string" && APPROVAL_TOKEN_PATTERN.test(value);
}

/** created_at + 72 hours, or null for an unusable creation time. */
export function approvalTokenExpiresAt(createdAt = new Date()) {
  const base = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(base)) return null;
  return new Date(base + APPROVAL_LINK_TTL_MS).toISOString();
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

/** `<APP_PUBLIC_URL>/approve/<token>`, or null for bad input. */
export function buildApprovalLink(publicUrl, rawToken) {
  const base = approvalLinkBase(publicUrl);
  if (!base || !isApprovalToken(rawToken)) return null;
  return `${base}/approve/${rawToken}`;
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
