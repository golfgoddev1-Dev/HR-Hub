// Notification queue: enqueue from the leave routes, then a cron pass sends one
// push per active subscription.
//
// Safety rules:
// - enqueue never breaks the leave action itself (a failed insert is logged);
// - a row is claimed with a conditional update (status pending -> sending), so
//   two overlapping runs cannot send the same row twice;
// - at most NOTIFICATION_BATCH rows per run, to stay inside the free plan;
// - 404/410 from the push service deactivates that subscription;
// - the payload never carries a reason or a leave type (see push/payload.js).

import { createDb } from "../db.js";
import { base64UrlToBytes, utf8 } from "./base64url.js";
import { encryptWebPush } from "./encrypt.js";
import { buildNotificationPayload, payloadFits } from "./payload.js";
import { buildVapidAuthorization } from "./vapid.js";

export const NOTIFICATION_QUEUE_TABLE = "notification_queue";
export const PUSH_SUBSCRIPTIONS_TABLE = "push_subscriptions";
export const AUDIT_TABLE = "audit_logs";

export const NOTIFICATION_CRON = "*/5 * * * *";
export const NOTIFICATION_BATCH = 50;
export const MAX_ATTEMPTS = 5;
export const RETRY_DELAY_MINUTES = [1, 5, 15, 60, 240];
export const PUSH_TTL_SECONDS = 3600;
export const MAX_SUBSCRIPTIONS_PER_EMPLOYEE = 10;
export const STALE_CLAIM_MINUTES = 10;

/**
 * A row claimed but not finished is a crashed run, not a live one. Anything
 * claimed longer ago than this is handed back to the queue.
 */
export function staleClaimCutoff(now) {
  return new Date(now.getTime() - STALE_CLAIM_MINUTES * 60000).toISOString();
}

const ACTION_RUN = "notifications_run";
const ENTITY_RUN = "notification_run";

/** Delay before the next attempt, indexed by the attempt that just failed. */
export function retryDelayMinutes(attempts) {
  const index = Math.min(Math.max(attempts, 1), RETRY_DELAY_MINUTES.length) - 1;
  return RETRY_DELAY_MINUTES[index];
}

/**
 * Retry plan after a failed attempt. The fifth failure is final: the row becomes
 * 'failed' and is never picked up again.
 */
export function planRetry({ attempts, now }) {
  const previous = Number.isFinite(attempts) ? attempts : 0;
  const nextAttempts = previous + 1;

  if (nextAttempts >= MAX_ATTEMPTS) {
    return { status: "failed", attempts: nextAttempts, nextAttemptAt: null };
  }

  const delay = retryDelayMinutes(nextAttempts);
  return {
    status: "pending",
    attempts: nextAttempts,
    nextAttemptAt: new Date(now.getTime() + delay * 60000).toISOString(),
  };
}

function lastErrorCode(results) {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return null;
  const status = failed[failed.length - 1]?.status;
  return Number.isFinite(status) && status > 0 ? `http_${status}` : "send_failed";
}

/**
 * Final state of one queue row after trying every subscription.
 * - no subscription at all      -> cancelled (nothing to retry)
 * - at least one delivery       -> sent (a partial failure is recorded, not retried,
 *                                  so the devices that succeeded do not get it twice)
 * - every delivery failed       -> pending with backoff, or failed at the cap
 */
export function planSendOutcome({ results, attempts, now }) {
  const list = Array.isArray(results) ? results : [];
  const deactivated = list
    .filter((result) => result.gone === true && typeof result.endpoint === "string")
    .map((result) => result.endpoint);

  if (list.length === 0) {
    return {
      status: "cancelled",
      attempts: Number.isFinite(attempts) ? attempts : 0,
      nextAttemptAt: null,
      sentAt: null,
      deactivated,
      error: "no_subscription",
    };
  }

  if (list.some((result) => result.ok === true)) {
    const partial = list.some((result) => result.ok !== true);
    return {
      status: "sent",
      attempts: Number.isFinite(attempts) ? attempts : 0,
      nextAttemptAt: null,
      sentAt: now.toISOString(),
      deactivated,
      error: partial ? "partial_failure" : null,
    };
  }

  const retry = planRetry({ attempts, now });
  return {
    ...retry,
    sentAt: null,
    deactivated,
    error: lastErrorCode(list),
  };
}

/**
 * Adds one queue row. Returns { ok } or { ok: false, code }; callers that must
 * not fail (a leave submit) use enqueueNotificationSafely instead.
 */
export async function enqueueNotification(
  db,
  { employeeId, leaveRequestId = null, kind, status = null, now = new Date() }
) {
  const payload = buildNotificationPayload(kind, { requestId: leaveRequestId, status });
  if (!payload || !payloadFits(payload)) return { ok: false, code: "invalid_payload" };

  const result = await db.insert(NOTIFICATION_QUEUE_TABLE, {
    employee_id: employeeId,
    leave_request_id: leaveRequestId,
    kind,
    payload,
    status: "pending",
    attempts: 0,
    next_attempt_at: now.toISOString(),
    created_at: now.toISOString(),
  });
  if (result?.error) return { ok: false, code: result.error.code };
  return { ok: true };
}

/** Queueing must never break the leave action it belongs to. */
export async function enqueueNotificationSafely(db, options) {
  try {
    const result = await enqueueNotification(db, options);
    if (result.ok !== true) {
      console.error("[notification-enqueue]", { code: result.code });
    }
    return result;
  } catch (error) {
    console.error("[notification-enqueue-error]", { name: error?.name, code: error?.code });
    return { ok: false, code: "enqueue_failed" };
  }
}

/** Conditional claim: only the run that flips pending -> sending may send. */
async function claimRow(db, id) {
  if (!id) return false;
  const claimed = await db.update(
    NOTIFICATION_QUEUE_TABLE,
    { status: "sending" },
    [
      ["id", "eq", id],
      ["status", "eq", "pending"],
    ],
    { returning: true, columns: "id" }
  );
  if (claimed.error) return false;
  return Array.isArray(claimed.data) && claimed.data.length > 0;
}

async function deactivateSubscriptions(db, endpoints) {
  let count = 0;
  for (const endpoint of endpoints) {
    const updated = await db.update(
      PUSH_SUBSCRIPTIONS_TABLE,
      { is_active: false },
      [["endpoint", "eq", endpoint]]
    );
    if (!updated.error) count += 1;
  }
  return count;
}

/** One push to one subscription. Throws only on unexpected programming errors. */
export async function sendToSubscription(env, subscription, payloadText, now) {
  const uaPublicKey = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth);
  if (!uaPublicKey || !authSecret) {
    return { ok: false, status: 0, gone: false, endpoint: subscription.endpoint };
  }

  const vapid = await buildVapidAuthorization({
    endpoint: subscription.endpoint,
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    now,
  });

  const { body } = await encryptWebPush({
    payload: payloadText,
    uaPublicKey,
    authSecret,
  });

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapid.authorization,
      TTL: String(PUSH_TTL_SECONDS),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Urgency: "normal",
    },
    body,
  });

  return {
    ok: response.ok,
    status: response.status,
    gone: response.status === 404 || response.status === 410,
    endpoint: subscription.endpoint,
  };
}

async function writeRunAudit(db, summary) {
  try {
    await db.insert(AUDIT_TABLE, {
      actor_id: null,
      action: ACTION_RUN,
      entity: ENTITY_RUN,
      entity_id: null,
      detail: JSON.stringify(summary),
    });
  } catch (error) {
    console.error("[notification-audit-error]", { name: error?.name, code: error?.code });
  }
}

/**
 * One cron pass. Never throws: the summary is returned (and an audit row is
 * written when anything failed) so the scheduler only has to log it.
 */
export async function runNotificationQueue(env, now = new Date()) {
  const summary = {
    selected: 0,
    recovered: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    deactivated: 0,
    errors: 0,
  };

  if (!env?.VAPID_PUBLIC_KEY || !env?.VAPID_PRIVATE_KEY || !env?.VAPID_SUBJECT) {
    console.error("[notification-config]", { code: "missing_vapid" });
    return { ...summary, skipped: true };
  }

  try {
    const db = createDb(env);
    const nowIso = now.toISOString();

    // A run that died between claim and update leaves a row in 'sending'. Put
    // those back so nothing is stranded; the row keeps its attempts count.
    const recovered = await db.update(
      NOTIFICATION_QUEUE_TABLE,
      { status: "pending" },
      [
        ["status", "eq", "sending"],
        ["next_attempt_at", "lte", staleClaimCutoff(now)],
      ],
      { returning: true, columns: "id" }
    );
    if (!recovered.error && Array.isArray(recovered.data)) {
      summary.recovered = recovered.data.length;
    }

    const rows = await db.select(NOTIFICATION_QUEUE_TABLE, {
      columns: "id,employee_id,leave_request_id,kind,payload,attempts,status",
      filters: [
        ["status", "eq", "pending"],
        ["next_attempt_at", "lte", nowIso],
      ],
      order: "next_attempt_at.asc",
      limit: NOTIFICATION_BATCH,
    });

    for (const row of rows) {
      if (!(await claimRow(db, row.id))) continue;
      summary.selected += 1;

      let payloadText;
      try {
        payloadText = JSON.stringify(row.payload);
      } catch {
        payloadText = null;
      }

      const subscriptions = await db.select(PUSH_SUBSCRIPTIONS_TABLE, {
        columns: "id,endpoint,p256dh,auth",
        filters: [
          ["employee_id", "eq", row.employee_id],
          ["is_active", "eq", true],
        ],
        limit: MAX_SUBSCRIPTIONS_PER_EMPLOYEE,
      });

      const results = [];
      if (payloadText) {
        for (const subscription of subscriptions) {
          try {
            results.push(await sendToSubscription(env, subscription, payloadText, now));
          } catch (error) {
            console.error("[notification-send-error]", { name: error?.name });
            results.push({ ok: false, status: 0, gone: false, endpoint: subscription.endpoint });
          }
        }
      }

      const outcome = planSendOutcome({ results, attempts: row.attempts ?? 0, now });

      const updated = await db.update(
        NOTIFICATION_QUEUE_TABLE,
        {
          status: outcome.status,
          attempts: outcome.attempts,
          next_attempt_at: outcome.nextAttemptAt,
          sent_at: outcome.sentAt,
          last_error: outcome.error,
        },
        [["id", "eq", row.id], ["status", "eq", "sending"]]
      );
      if (updated.error) summary.errors += 1;

      if (outcome.deactivated.length > 0) {
        summary.deactivated += await deactivateSubscriptions(db, outcome.deactivated);
      }

      if (outcome.status === "sent") summary.sent += 1;
      else if (outcome.status === "failed") summary.failed += 1;
      else if (outcome.status === "cancelled") summary.cancelled += 1;
      else summary.retried += 1;

      if (outcome.error) summary.errors += 1;
    }

    if (summary.errors > 0 || summary.failed > 0 || summary.deactivated > 0) {
      await writeRunAudit(db, summary);
    }

    return summary;
  } catch (error) {
    console.error("[notification-run-error]", { name: error?.name, code: error?.code });
    summary.errors += 1;
    return summary;
  }
}
