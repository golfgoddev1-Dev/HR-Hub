// Approval-by-email routes, mounted at /api/approve-link by src/app.js.
//
// Rules kept here:
// - no login: the signed token is the only credential and its approverId is the
//   approver's identity, whoever (or nobody) is signed in in this browser;
// - the token travels only in a POST body (the page reads it from the URL
//   fragment); no path or query carries one, so no log does. Any GET under this
//   prefix answers 405 and touches nothing, so a scanner that opens a link
//   cannot decide a request;
// - POSTs need the custom X-Approval-Request header (CSRF);
// - /detail only reads. /decision re-checks at use time (request still pending,
//   approver still responsible under the shared scope rule), then consumes the
//   nonce with one atomic conditional update before calling the same
//   applyLeaveDecision() the in-app route uses. If the request was decided
//   elsewhere in between, the nonce is put back;
// - every unusable link answers one shape with a category only. No token, reason
//   or personal data is ever echoed or logged, and errors are fixed codes;
// - both routes use the existing Durable Object limiters and carry no-store,
//   noindex and no-referrer headers.

import { Hono } from "hono";

import {
  APPROVAL_TOKENS_TABLE,
  loadApprovalContext,
  loadApprovalDetail,
} from "../approval-link.js";
import {
  DECISION_REASON_MAX_LENGTH,
  isApprovalToken,
  normalizeDecisionReason,
  decisionReasonProblem,
} from "../approval-token.js";
import { createDb } from "../db.js";
import { applyLeaveDecision } from "../leave-decision.js";
import { notifyLeaveDecisionSafely } from "../decision-notify.js";
import { NOTIFICATION_KINDS } from "../push/payload.js";
import { enqueueNotificationSafely } from "../push/queue.js";
import {
  checkRateLimit,
  clientIp,
  ipRateLimitKey,
  tokenRateLimitKey,
} from "../rate-limit.js";

export const APPROVAL_LINK_PREFIX = "/api/approve-link";

const RATE_LIMIT_IP_BINDING = "RL_SUBMIT_IP";
const RATE_LIMIT_TOKEN_BINDING = "RL_SUBMIT_TOKEN";

const AUDIT_TABLE = "audit_logs";
const ENTITY_REQUEST = "leave_request";

/** The request's ExecutionContext, or null when the runtime has none. */
function requestContext(c) {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

const MAX_BODY_BYTES = 8 * 1024;
const DETAIL_KEYS = ["token"];
const DECISION_KEYS = ["token", "decision", "reason"];
const DECISIONS = ["approve", "reject"];
const CSRF_HEADER = "X-Approval-Request";

export const APPROVAL_LINK_CODES = Object.freeze({
  unusable: "link_unusable",
  invalidRequest: "invalid_request",
  reasonRequired: "reason_required",
  reasonTooLong: "reason_too_long",
  rateLimited: "rate_limited",
  unavailable: "service_unavailable",
  serverError: "server_error",
});

const approveLink = new Hono();

approveLink.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

async function readStrictJson(c) {
  if (!isJsonContentType(c.req.header("Content-Type"))) return null;

  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;

  let text;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  if (text.trim().length === 0) return {};

  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The one answer for an expired, used or otherwise unusable link. */
function unusable(c, category) {
  return c.json(
    {
      ok: false,
      code: APPROVAL_LINK_CODES.unusable,
      category: category === "used" || category === "expired" ? category : "invalid",
    },
    410
  );
}

function invalidRequest(c, status = 400) {
  return c.json({ ok: false, code: APPROVAL_LINK_CODES.invalidRequest }, status);
}

async function enforceLimit(c, bindingName, key) {
  const result = await checkRateLimit(c.env, bindingName, key);
  if (result.ok) return null;
  return c.json(
    {
      ok: false,
      code:
        result.status === 429
          ? APPROVAL_LINK_CODES.rateLimited
          : APPROVAL_LINK_CODES.unavailable,
    },
    result.status
  );
}

function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

function approvalSecret(c) {
  const secret = c.env?.APPROVAL_LINK_SECRET;
  return typeof secret === "string" && secret.length >= 32 ? secret : null;
}

/**
 * Shared front of both POSTs: CSRF header and strict JSON body. Returns
 * { body } or a Response.
 */
async function openRequest(c, keys) {
  if (c.req.header(CSRF_HEADER) !== "1") return invalidRequest(c, 403);

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, keys) || !isApprovalToken(body.token)) return invalidRequest(c);
  return { body };
}

// A GET never reads a token and never touches the database.
approveLink.on(["GET", "HEAD", "PUT", "PATCH", "DELETE"], "*", (c) =>
  c.json({ ok: false, code: APPROVAL_LINK_CODES.invalidRequest }, 405)
);

// --- POST /api/approve-link/detail ------------------------------------------
// Read-only: nothing is written here.

approveLink.post("/detail", async (c) => {
  const limited = await enforceLimit(
    c,
    RATE_LIMIT_IP_BINDING,
    ipRateLimitKey("approve-link", clientIp(c.req.raw))
  );
  if (limited) return limited;

  const secret = approvalSecret(c);
  if (!secret) return c.json({ ok: false, code: APPROVAL_LINK_CODES.unavailable }, 503);

  const opened = await openRequest(c, DETAIL_KEYS);
  if (opened instanceof Response) return opened;

  try {
    const db = createDb(c.env);
    const context = await loadApprovalContext(db, {
      secret,
      rawToken: opened.body.token,
      readRow: true,
    });
    if (context.ok !== true) return unusable(c, context.category);

    const request = await loadApprovalDetail(db, context.token, context.request);
    return c.json({ ok: true, request }, 200);
  } catch (error) {
    logError("[approval-link-read]", error);
    return c.json({ ok: false, code: APPROVAL_LINK_CODES.serverError }, 500);
  }
});

// --- POST /api/approve-link/decision ----------------------------------------

approveLink.post("/decision", async (c) => {
  const secret = approvalSecret(c);
  if (!secret) return c.json({ ok: false, code: APPROVAL_LINK_CODES.unavailable }, 503);

  const opened = await openRequest(c, DECISION_KEYS);
  if (opened instanceof Response) return opened;
  const { body } = opened;

  const limited = await enforceLimit(
    c,
    RATE_LIMIT_TOKEN_BINDING,
    await tokenRateLimitKey(body.token)
  );
  if (limited) return limited;

  if (!DECISIONS.includes(body.decision)) return invalidRequest(c);

  let note = null;
  if (body.decision === "reject") {
    const problem = decisionReasonProblem(body.reason);
    if (problem === "required") {
      return c.json({ ok: false, code: APPROVAL_LINK_CODES.reasonRequired }, 400);
    }
    if (problem === "too_long") {
      return c.json({ ok: false, code: APPROVAL_LINK_CODES.reasonTooLong }, 400);
    }
    note = normalizeDecisionReason(body.reason);
    if (Array.from(note).length > DECISION_REASON_MAX_LENGTH) {
      return c.json({ ok: false, code: APPROVAL_LINK_CODES.reasonTooLong }, 400);
    }
  }

  try {
    const db = createDb(c.env);
    const context = await loadApprovalContext(db, {
      secret,
      rawToken: body.token,
    });
    if (context.ok !== true) return unusable(c, context.category);

    const now = new Date();
    const nowIso = now.toISOString();
    const status = body.decision === "approve" ? "approved" : "rejected";
    const nonceHash = context.token.nonce_hash;

    // The single-use gate: one conditional update, one row. It only matches an
    // unused, uninvalidated, unexpired row, so of two parallel uses exactly one
    // wins. A nonce the database never issued matches nothing.
    const marked = await db.update(
      APPROVAL_TOKENS_TABLE,
      { used_at: nowIso },
      [
        ["nonce_hash", "eq", nonceHash],
        ["used_at", "is", null],
        ["invalidated_at", "is", null],
        ["expires_at", "gt", nowIso],
      ],
      { returning: true, columns: "id" }
    );
    if (marked.error) {
      throw Object.assign(new Error("approval token update failed"), {
        code: marked.error.code,
      });
    }
    if (!Array.isArray(marked.data) || marked.data.length !== 1) {
      return unusable(c, "used");
    }

    const applied = await applyLeaveDecision(db, {
      requestId: context.request.id,
      approverId: context.token.approver_employee_id,
      status,
      note,
      nowIso,
    });

    if (applied.ok !== true) {
      // The request was decided in the app between the read and this write.
      // Put the nonce back so "no change" stays true, then answer generically.
      await db.update(
        APPROVAL_TOKENS_TABLE,
        { used_at: null },
        [
          ["nonce_hash", "eq", nonceHash],
          ["used_at", "eq", nowIso],
        ]
      );

      if (applied.error) {
        console.error("[approval-link-decision]", { code: applied.code });
        return c.json({ ok: false, code: APPROVAL_LINK_CODES.serverError }, 500);
      }
      return unusable(c, "invalid");
    }

    // Channel only: no reason, no name, no email, no token.
    const audited = await db.insert(AUDIT_TABLE, {
      actor_id: context.token.approver_employee_id,
      action: status === "approved" ? "leave_approved" : "leave_rejected",
      entity: ENTITY_REQUEST,
      entity_id: context.request.id,
      detail: JSON.stringify({
        requestCode: context.request.request_code ?? null,
        channel: "email",
      }),
    });
    if (audited.error) {
      throw Object.assign(new Error("approval audit failed"), {
        code: audited.error.code,
      });
    }

    // The requester's in-app notice, same kind the in-app route enqueues. The
    // cron sends it, so this route never waits for a push service.
    await enqueueNotificationSafely(db, {
      employeeId: context.request.employee_id,
      leaveRequestId: context.request.id,
      kind: NOTIFICATION_KINDS.DECIDED,
      status,
    });

    // Shift-lead notices and the approved-leave report, queued after the
    // decision; a failure here never changes the response.
    await notifyLeaveDecisionSafely(c.env, db, requestContext(c), {
      leaveRequestId: context.request.id,
      decision: status,
    });

    return c.json({ ok: true, status }, 200);
  } catch (error) {
    logError("[approval-link-decision]", error);
    return c.json({ ok: false, code: APPROVAL_LINK_CODES.serverError }, 500);
  }
});

export default approveLink;
