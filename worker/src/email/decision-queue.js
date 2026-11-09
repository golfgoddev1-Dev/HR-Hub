// Decision-email queue: a durable dedupe ledger plus the same bounded retry
// pattern as the Phase 2a approval email.
//
// Why a table instead of the in-memory Phase 2a queue: the idempotency key is
// (leave_request_id, recipient_employee_id, kind, decision), and the Phase 2a
// queue cannot dedupe across isolates or a cold start. The unique index on those
// four columns is the dedupe; a duplicate enqueue inserts nothing and therefore
// sends nothing. The row stores ids only, never the message, so no name,
// address or reason is copied into the queue.
//
// Retry rule (owner confirmed, same as Phase 2a):
//   network, upstream -> retry with a short backoff
//   config, invalid   -> permanent, never retried until configuration changes
//
// Delivery runs in the request's background task (waitUntil) and is bounded to
// three seconds when there is no ExecutionContext, exactly like Phase 2a.

import { DECISION_EMAIL_KINDS } from "./decision-email.js";
import { sendRelayEmail } from "./relay.js";

export const DECISION_EMAIL_JOBS_TABLE = "decision_email_jobs";
export const DECISION_EMAIL_RETRY_DELAYS_MS = Object.freeze([2000, 5000]);
export const DECISION_EMAIL_RETRYABLE_REASONS = Object.freeze(["network", "upstream"]);
export const DECISION_EMAIL_PERMANENT_REASONS = Object.freeze(["config", "invalid"]);

const DECISION_EMAIL_JOB_KINDS = new Set(Object.values(DECISION_EMAIL_KINDS));

export const DECISION_EMAIL_JOB_COLUMNS =
  "id,leave_request_id,recipient_employee_id,kind,decision,status,attempts,created_at,sent_at";

/** The idempotency key of one job, in the same shape the unique index uses. */
export function decisionEmailJobKey(job = {}) {
  return [job.leaveRequestId, job.recipientEmployeeId, job.kind, job.decision]
    .map((value) => String(value ?? ""))
    .join("|");
}

/** "retry" or "drop" for one relay failure reason. Unknown is upstream. */
export function decisionEmailRetryDecision(reason) {
  if (DECISION_EMAIL_PERMANENT_REASONS.includes(reason)) return "drop";
  return "retry";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeReason(value) {
  if (DECISION_EMAIL_RETRYABLE_REASONS.includes(value)) return value;
  if (DECISION_EMAIL_PERMANENT_REASONS.includes(value)) return value;
  return "upstream";
}

/**
 * Inserts the job keys, ignoring rows that already exist. Returns the inserted
 * rows only, so a caller never dispatches a key that was enqueued before.
 */
export async function enqueueDecisionEmails(db, jobs) {
  const list = (Array.isArray(jobs) ? jobs : []).filter(
    (job) =>
      typeof job?.leaveRequestId === "string" &&
      job.leaveRequestId.length > 0 &&
      typeof job.recipientEmployeeId === "string" &&
      job.recipientEmployeeId.length > 0 &&
      typeof job.kind === "string" &&
      DECISION_EMAIL_JOB_KINDS.has(job.kind) &&
      (job.decision === "approved" || job.decision === "rejected")
  );
  if (list.length === 0) return { ok: true, data: [] };

  const rows = list.map((job) => ({
    leave_request_id: job.leaveRequestId,
    recipient_employee_id: job.recipientEmployeeId,
    kind: job.kind,
    decision: job.decision,
    status: "pending",
    attempts: 0,
  }));

  const result = await db.insertMany(DECISION_EMAIL_JOBS_TABLE, rows, {
    returning: true,
    ignoreDuplicates: true,
  });
  if (result.error) return { ok: false, code: result.error.code ?? "insert_failed" };
  return { ok: true, data: Array.isArray(result.data) ? result.data : [] };
}

/**
 * Sends one message with bounded retries. `send` and `wait` are injectable for
 * tests. Never throws and never logs: the dispatcher logs fixed codes only.
 */
export async function deliverDecisionEmail(
  env,
  message,
  { send = sendRelayEmail, wait = sleep, delays = DECISION_EMAIL_RETRY_DELAYS_MS } = {}
) {
  if (
    !message ||
    typeof message.to !== "string" ||
    message.to.trim().length === 0 ||
    typeof message.subject !== "string" ||
    typeof message.text !== "string"
  ) {
    return { ok: false, reason: "invalid", attempts: 0 };
  }

  const retryDelays = Array.isArray(delays) ? delays : DECISION_EMAIL_RETRY_DELAYS_MS;
  let attempts = 0;

  for (;;) {
    attempts += 1;

    let result;
    try {
      result = await send(env, {
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } catch {
      result = { ok: false, reason: "network" };
    }

    if (result?.ok === true) return { ok: true, attempts };

    const reason = normalizeReason(result?.reason);
    if (reason === "config" || reason === "invalid") {
      return { ok: false, reason, attempts };
    }
    if (attempts > retryDelays.length) {
      return { ok: false, reason, attempts };
    }

    await wait(retryDelays[attempts - 1]);
  }
}

/**
 * Claims each inserted row (pending -> sending), sends its message, then marks
 * it sent or failed. Two overlapping dispatches cannot send the same row twice
 * because only one claim can match `status = pending`.
 */
export async function dispatchDecisionEmails(env, ctx, db, entries, options = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter(
    (entry) => typeof entry?.row?.id === "string" && entry.message
  );
  if (list.length === 0) return false;

  const run = (async () => {
    for (const { row, message } of list) {
      const claimed = await db.update(
        DECISION_EMAIL_JOBS_TABLE,
        { status: "sending" },
        [
          ["id", "eq", row.id],
          ["status", "eq", "pending"],
        ],
        { returning: true, columns: "id" }
      );
      if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length === 0) {
        continue;
      }

      const result = await deliverDecisionEmail(env, message, options);

      const updated = await db.update(
        DECISION_EMAIL_JOBS_TABLE,
        {
          status: result.ok === true ? "sent" : "failed",
          attempts: result.attempts ?? 0,
          sent_at: result.ok === true ? new Date().toISOString() : null,
        },
        [
          ["id", "eq", row.id],
          ["status", "eq", "sending"],
        ]
      );

      if (result.ok !== true) {
        // Fixed reason, attempts and kind only: no recipient, subject or body.
        console.error("[decision-email-delivery]", {
          reason: result.reason,
          attempts: result.attempts,
          kind: row.kind,
        });
      }
      if (updated.error) {
        console.error("[decision-email-state]", { code: updated.error.code ?? null });
      }
    }
  })();

  if (typeof ctx?.waitUntil === "function") {
    ctx.waitUntil(run);
    return true;
  }

  let timer = null;
  try {
    await Promise.race([
      run,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 3000);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  return true;
}
