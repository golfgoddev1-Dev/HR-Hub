// Approval-email dispatch, mirroring the existing notification queue pattern:
// the route enqueues a job and hands it to the request's ExecutionContext, so
// the response never waits for the relay, and a retryable failure is tried
// again inside that background task.
//
// The queue is deliberately in-memory: approval_tokens is the only new table
// this phase allows, and the raw link token must never be stored. A job carries
// the raw token in memory only, for the single send it exists to make.
//
// Retry rule (owner confirmed):
//   network, upstream -> retry with a short backoff
//   config, invalid   -> permanent, never retried until the owner changes config
//
// Idempotency: one job per token. A token whose email was accepted by the relay
// is remembered, a concurrent dispatch for the same token reuses the in-flight
// promise, and a permanent failure is remembered too so a later dispatch cannot
// turn it into a duplicate send.

import { buildApprovalEmailMessage } from "./approval-email.js";
import { sendRelayEmail } from "./relay.js";

export const EMAIL_RETRY_DELAYS_MS = Object.freeze([2000, 5000]);
export const RETRYABLE_REASONS = Object.freeze(["network", "upstream"]);
export const PERMANENT_REASONS = Object.freeze(["config", "invalid"]);

const deliveredTokenIds = new Set();
const inFlightByToken = new Map();

/** Test hook: forget which tokens this isolate has already handled. */
export function resetApprovalEmailState() {
  deliveredTokenIds.clear();
  inFlightByToken.clear();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeReason(value) {
  if (RETRYABLE_REASONS.includes(value)) return value;
  if (PERMANENT_REASONS.includes(value)) return value;
  // An unknown answer is treated as an upstream fault, the same choice
  // worker/src/email/relay.js makes for an unrecognised relay code.
  return "upstream";
}

/** "retry" or "drop" for one relay failure reason. */
export function emailRetryDecision(reason) {
  return RETRYABLE_REASONS.includes(normalizeReason(reason)) ? "retry" : "drop";
}

/**
 * One job from the request data. Returns null when the message cannot be built
 * or the job has no token id or recipient, so the caller simply skips sending.
 */
export function buildApprovalEmailJob({
  tokenId,
  to,
  employeeName,
  employeeCode = null,
  leaveTypeName = null,
  otherTypeDetail = null,
  startDate = null,
  endDate = null,
  days = null,
  reason = null,
  link,
} = {}) {
  if (typeof tokenId !== "string" || tokenId.length === 0) return null;
  if (typeof to !== "string" || to.trim().length === 0) return null;

  const message = buildApprovalEmailMessage({
    employeeName,
    employeeCode,
    leaveTypeName,
    otherTypeDetail,
    startDate,
    endDate,
    days,
    reason,
    link,
  });
  if (!message) return null;

  return { tokenId, to: to.trim(), subject: message.subject, text: message.text };
}

/**
 * Sends one job. `send` and `sleep` are injectable for tests; production uses
 * sendRelayEmail and a real timer. Never throws and never logs a recipient,
 * token, subject or body, only a fixed reason code (by the dispatcher).
 */
export async function deliverApprovalEmail(
  env,
  job,
  { send = sendRelayEmail, wait = sleep, delays = EMAIL_RETRY_DELAYS_MS } = {}
) {
  if (!job || typeof job.tokenId !== "string" || job.tokenId.length === 0) {
    return { ok: false, reason: "invalid", attempts: 0 };
  }
  if (deliveredTokenIds.has(job.tokenId)) {
    return { ok: true, skipped: true, attempts: 0 };
  }

  const running = inFlightByToken.get(job.tokenId);
  if (running) return running;

  const run = (async () => {
    const retryDelays = Array.isArray(delays) ? delays : EMAIL_RETRY_DELAYS_MS;
    let attempts = 0;

    for (;;) {
      attempts += 1;

      let result;
      try {
        result = await send(env, {
          to: job.to,
          subject: job.subject,
          text: job.text,
        });
      } catch {
        result = { ok: false, reason: "network" };
      }

      if (result?.ok === true) {
        deliveredTokenIds.add(job.tokenId);
        return { ok: true, attempts };
      }

      const reason = normalizeReason(result?.reason);
      if (reason === "config" || reason === "invalid") {
        // Permanent for this token: no later dispatch may send it.
        deliveredTokenIds.add(job.tokenId);
        return { ok: false, reason, attempts };
      }

      // A retryable failure that has used every attempt stays unremembered, so
      // a future dispatch may try again; this token is still one email.
      if (attempts > retryDelays.length) {
        return { ok: false, reason, attempts };
      }

      await wait(retryDelays[attempts - 1]);
    }
  })();

  inFlightByToken.set(job.tokenId, run);
  try {
    return await run;
  } finally {
    inFlightByToken.delete(job.tokenId);
  }
}

/**
 * Runs the jobs after the response when the runtime gives an ExecutionContext,
 * or inline with a three-second bound when it does not (tests, a plain fetch).
 */
export async function dispatchApprovalEmails(env, ctx, jobs, options = {}) {
  const list = (Array.isArray(jobs) ? jobs : [jobs]).filter(Boolean);
  if (list.length === 0) return false;

  const run = (async () => {
    for (const job of list) {
      const result = await deliverApprovalEmail(env, job, options);
      if (result.ok !== true) {
        // Fixed codes only: never the recipient, token, subject or body.
        console.error("[approval-email-delivery]", {
          reason: result.reason,
          attempts: result.attempts,
        });
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
