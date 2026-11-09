// Daily cleanup for the two login-related tables that only grow.
//
// auth_sessions: expired or revoked for more than 30 days.
// audit_logs: older than the one retention constant HR can change.
//
// Both jobs delete in bounded batches and stop at a per-run cap, so the 02:00
// scheduled run stays short. Nothing here logs a row id, token, IP or any
// personal data: only the table name, deleted count and duration on success,
// and the error name/code on failure.

import { createDb } from "../db.js";
import { certificateStoragePath, deleteStorageObjects } from "../leave-retention.js";
import { readLeaveSettings } from "../leave-settings.js";

export const AUTH_SESSION_RETENTION_DAYS = 30;
export const AUDIT_RETENTION_DAYS = 365;
// 200 UUIDs keep the id=in.(...) delete URL comfortably under request limits.
export const CLEANUP_BATCH_SIZE = 200;
export const CLEANUP_MAX_ROWS = 5000;
export const CLEANUP_TIMEOUT_MS = 25_000;

// Growing tables that used to have no retention at all. The leave window comes
// from the leave_settings row HR edits on the settings page, never from an
// environment variable.
export const NOTIFICATION_QUEUE_RETENTION_DAYS = 30;
export const APPROVAL_TOKEN_RETENTION_DAYS = 30;
export const APPROVAL_TOKENS_TABLE = "approval_tokens";
export const NOTIFICATION_QUEUE_TABLE = "notification_queue";
export const FINAL_NOTIFICATION_STATUSES = Object.freeze(["sent", "failed", "cancelled"]);
export const LEAVE_REQUESTS_TABLE = "leave_requests";
export const FINAL_LEAVE_STATUSES = Object.freeze(["approved", "rejected", "cancelled"]);

const AUTH_SESSIONS_TABLE = "auth_sessions";
const AUDIT_LOGS_TABLE = "audit_logs";

/** ISO cutoff: rows strictly before this instant are old enough to delete. */
export function retentionCutoff(now, retentionDays) {
  const moment = now instanceof Date ? now : new Date(now);
  return new Date(moment.getTime() - retentionDays * 86400000).toISOString();
}

function logSummary(table, deleted, startedAt, cutoff = null) {
  const entry = {
    table,
    deleted,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  // The new date-range jobs also record the cutoff date; the two existing jobs
  // keep their exact three-key entry.
  if (typeof cutoff === "string" && cutoff.length > 0) entry.cutoff = cutoff;
  console.log("[maintenance-cleanup]", entry);
}

/** A positive integer only: unset, empty, 0, negative or text disables the job. */
export function parseLeaveRetentionDays(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** YYYY-MM-DD cutoff for a date-only column, computed from the UTC instant. */
export function retentionDateCutoff(now, retentionDays) {
  const moment = now instanceof Date ? now : new Date(now);
  return new Date(moment.getTime() - retentionDays * 86400000).toISOString().slice(0, 10);
}

function logFailure(table, error) {
  // Fixed tag plus the error's own name/code only. Never a message or response
  // body: a PostgREST error can carry the request URL.
  console.error(`[maintenance-cleanup:${table}:error]`, {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
  });
}

/**
 * Deletes matching rows one batch at a time. `conditions` are OR-ed by running
 * them in sequence, each condition being an AND-ed PostgREST filter list. The
 * shared `maxRows` cap covers the whole call, not each condition.
 */
async function purgeInBatches(db, table, conditions, cutoff, maxRows) {
  let deleted = 0;

  for (const condition of conditions) {
    while (deleted < maxRows) {
      const batchLimit = Math.min(CLEANUP_BATCH_SIZE, maxRows - deleted);
      const rows = await db.select(table, {
        columns: "id",
        filters: condition.filters(cutoff),
        order: condition.order,
        limit: batchLimit,
      });

      const ids = (Array.isArray(rows) ? rows : [])
        .map((row) => row?.id)
        .filter((id) => typeof id === "string" && id.length > 0);
      if (ids.length === 0) break;

      const removed = await db.remove(
        table,
        [["id", "in", ids]],
        { returning: true, columns: "id" }
      );
      if (removed.error) {
        throw Object.assign(new Error("maintenance delete failed"), {
          code: removed.error.code,
        });
      }

      const count = Array.isArray(removed.data) ? removed.data.length : 0;
      deleted += count;

      // A concurrent run may have deleted the selected rows already. Stop
      // instead of selecting the same ids forever.
      if (count === 0 || ids.length < batchLimit) break;
    }

    if (deleted >= maxRows) break;
  }

  return deleted;
}

/** Deletes sessions expired or revoked for more than 30 days. Never throws. */
export async function purgeOldAuthSessions(db, now = new Date()) {
  const startedAt = Date.now();
  let deleted = 0;
  try {
    const cutoff = retentionCutoff(now, AUTH_SESSION_RETENTION_DAYS);
    deleted = await purgeInBatches(
      db,
      AUTH_SESSIONS_TABLE,
      [
        {
          filters: (at) => [["expires_at", "lt", at]],
          order: "expires_at.asc",
        },
        {
          filters: (at) => [
            ["revoked_at", "not.is", null],
            ["revoked_at", "lt", at],
          ],
          order: "revoked_at.asc",
        },
      ],
      cutoff,
      CLEANUP_MAX_ROWS
    );
    logSummary(AUTH_SESSIONS_TABLE, deleted, startedAt);
  } catch (error) {
    logFailure(AUTH_SESSIONS_TABLE, error);
  }
  return deleted;
}

/** Deletes audit rows older than AUDIT_RETENTION_DAYS. Never throws. */
export async function purgeOldAuditLogs(db, now = new Date()) {
  const startedAt = Date.now();
  let deleted = 0;
  try {
    const cutoff = retentionCutoff(now, AUDIT_RETENTION_DAYS);
    deleted = await purgeInBatches(
      db,
      AUDIT_LOGS_TABLE,
      [
        {
          filters: (at) => [["created_at", "lt", at]],
          order: "created_at.asc",
        },
      ],
      cutoff,
      CLEANUP_MAX_ROWS
    );
    logSummary(AUDIT_LOGS_TABLE, deleted, startedAt);
  } catch (error) {
    logFailure(AUDIT_LOGS_TABLE, error);
  }
  return deleted;
}

/** Deletes sent/failed/cancelled queue rows older than 30 days. Never throws. */
export async function purgeOldNotificationQueue(db, now = new Date()) {
  const startedAt = Date.now();
  let deleted = 0;
  try {
    const cutoff = retentionCutoff(now, NOTIFICATION_QUEUE_RETENTION_DAYS);
    deleted = await purgeInBatches(
      db,
      NOTIFICATION_QUEUE_TABLE,
      [
        {
          // pending and sending are never matched, at any age.
          filters: (at) => [
            ["status", "in", [...FINAL_NOTIFICATION_STATUSES]],
            ["created_at", "lt", at],
          ],
          order: "created_at.asc",
        },
      ],
      cutoff,
      CLEANUP_MAX_ROWS
    );
    logSummary(NOTIFICATION_QUEUE_TABLE, deleted, startedAt, cutoff);
  } catch (error) {
    logFailure(NOTIFICATION_QUEUE_TABLE, error);
  }
  return deleted;
}

/**
 * Deletes approval tokens that are finished and older than 30 days:
 * used, invalidated, or expired. A pending token inside its 72-hour window is
 * never selected, at any created_at age. The three conditions are OR-ed by
 * running them in sequence and share one CLEANUP_MAX_ROWS cap.
 */
export async function purgeOldApprovalTokens(
  db,
  now = new Date(),
  { maxRows = CLEANUP_MAX_ROWS } = {}
) {
  const startedAt = Date.now();
  let deleted = 0;
  try {
    const cutoff = retentionCutoff(now, APPROVAL_TOKEN_RETENTION_DAYS);
    const nowIso = now.toISOString();
    deleted = await purgeInBatches(
      db,
      APPROVAL_TOKENS_TABLE,
      [
        {
          filters: (at) => [
            ["created_at", "lt", at],
            ["used_at", "not.is", null],
          ],
          order: "created_at.asc",
        },
        {
          filters: (at) => [
            ["created_at", "lt", at],
            ["invalidated_at", "not.is", null],
          ],
          order: "created_at.asc",
        },
        {
          filters: (at) => [
            ["created_at", "lt", at],
            ["expires_at", "lt", nowIso],
          ],
          order: "created_at.asc",
        },
      ],
      cutoff,
      maxRows
    );
    logSummary(APPROVAL_TOKENS_TABLE, deleted, startedAt, cutoff);
  } catch (error) {
    logFailure(APPROVAL_TOKENS_TABLE, error);
  }
  return deleted;
}

/**
 * Deletes final leave requests older than the stored retention window, children
 * before parents. It is opt-in: `enabled: false` (the default setting) or an
 * unusable retention value returns at once and logs that the job is disabled.
 * Pending requests are never selected.
 *
 * `end_date` is the cutoff column: a leave record ages from the day the leave
 * ended. A request whose end_date equals the cutoff date is kept; only a date
 * strictly before it is deleted.
 */
export async function purgeOldLeaveData(
  db,
  now = new Date(),
  { enabled = null, retentionDays = null, dryRun = false, env = null } = {}
) {
  const startedAt = Date.now();
  const summary = {
    disabled: false,
    dryRun: dryRun === true,
    cutoff: null,
    leaveRequests: 0,
    notifications: 0,
    certificates: 0,
    skipped: 0,
  };

  const days = parseLeaveRetentionDays(retentionDays);
  if (enabled === false || days === null) {
    summary.disabled = true;
    console.log("[maintenance-cleanup]", {
      table: LEAVE_REQUESTS_TABLE,
      deleted: 0,
      durationMs: 0,
      cutoff: null,
      disabled: "leave retention disabled",
    });
    return summary;
  }

  const cutoff = retentionDateCutoff(now, days);
  summary.cutoff = cutoff;
  const baseFilters = [
    ["status", "in", [...FINAL_LEAVE_STATUSES]],
    ["end_date", "lt", cutoff],
  ];

  try {
    if (summary.dryRun) {
      const rows = await db.select(LEAVE_REQUESTS_TABLE, {
        columns: "id,medical_certificate_url",
        filters: baseFilters,
        order: "end_date.asc",
        limit: CLEANUP_MAX_ROWS,
      });
      const candidates = (Array.isArray(rows) ? rows : []).filter((row) => row?.id);
      const ids = candidates.map((row) => row.id);
      const notices = ids.length
        ? await db.select(NOTIFICATION_QUEUE_TABLE, {
            columns: "id,leave_request_id,status",
            filters: [["leave_request_id", "in", ids]],
          })
        : [];
      const blocked = new Set(
        notices
          .filter((row) => !FINAL_NOTIFICATION_STATUSES.includes(row.status))
          .map((row) => row.leave_request_id)
      );
      const deletable = candidates.filter((row) => !blocked.has(row.id));
      const deletableIds = new Set(deletable.map((row) => row.id));

      summary.leaveRequests = deletable.length;
      summary.notifications = notices.filter(
        (row) => FINAL_NOTIFICATION_STATUSES.includes(row.status) && deletableIds.has(row.leave_request_id)
      ).length;
      summary.certificates = deletable.filter(
        (row) => certificateStoragePath(row.medical_certificate_url) !== null
      ).length;
      summary.skipped = candidates.length - deletable.length;
      return summary;
    }

    const seen = new Set();
    let scanned = 0;

    while (summary.leaveRequests < CLEANUP_MAX_ROWS && scanned < CLEANUP_MAX_ROWS) {
      const batchLimit = Math.min(
        CLEANUP_BATCH_SIZE,
        CLEANUP_MAX_ROWS - scanned,
        CLEANUP_MAX_ROWS - summary.leaveRequests
      );
      if (batchLimit <= 0) break;

      const rows = await db.select(LEAVE_REQUESTS_TABLE, {
        columns: "id,medical_certificate_url",
        filters: baseFilters,
        order: "end_date.asc",
        limit: batchLimit,
      });
      const fresh = (Array.isArray(rows) ? rows : []).filter(
        (row) => row?.id && seen.has(row.id) === false
      );
      if (fresh.length === 0) break;
      for (const row of fresh) seen.add(row.id);
      scanned += fresh.length;

      const ids = fresh.map((row) => row.id);
      const notices = await db.select(NOTIFICATION_QUEUE_TABLE, {
        columns: "id,leave_request_id,status",
        filters: [["leave_request_id", "in", ids]],
      });
      // A request still waiting to be sent (or being sent) is left alone until
      // the queue finishes; it stays eligible on a later run.
      const active = new Set(
        notices
          .filter((row) => !FINAL_NOTIFICATION_STATUSES.includes(row.status))
          .map((row) => row.leave_request_id)
      );
      let deletable = fresh.filter((row) => !active.has(row.id));
      summary.skipped += fresh.length - deletable.length;

      // Storage first, then the child rows, then the request itself. A failed
      // storage delete leaves that request for the next run rather than
      // orphaning its certificate object.
      const withPath = deletable.filter(
        (row) => certificateStoragePath(row.medical_certificate_url) !== null
      );
      if (withPath.length > 0) {
        let storageOk = false;
        if (env) {
          const result = await deleteStorageObjects(
            env,
            withPath.map((row) => certificateStoragePath(row.medical_certificate_url))
          );
          storageOk = result.ok === true;
        }
        if (storageOk) {
          summary.certificates += withPath.length;
        } else {
          const keep = new Set(withPath.map((row) => row.id));
          deletable = deletable.filter((row) => !keep.has(row.id));
          summary.skipped += withPath.length;
        }
      }

      const deletableIds = deletable.map((row) => row.id);
      if (deletableIds.length === 0) continue;

      const noticeIds = notices
        .filter(
          (row) =>
            FINAL_NOTIFICATION_STATUSES.includes(row.status) &&
            deletableIds.includes(row.leave_request_id)
        )
        .map((row) => row.id);

      for (const chunk of chunksById(noticeIds)) {
        const removed = await db.remove(
          NOTIFICATION_QUEUE_TABLE,
          [["id", "in", chunk]],
          { returning: true, columns: "id" }
        );
        if (removed?.error) {
          throw Object.assign(new Error("maintenance delete failed"), {
            code: removed.error.code,
          });
        }
        summary.notifications += Array.isArray(removed?.data) ? removed.data.length : 0;
      }

      for (const chunk of chunksById(deletableIds)) {
        const removed = await db.remove(LEAVE_REQUESTS_TABLE, [["id", "in", chunk]], {
          returning: true,
          columns: "id",
        });
        if (removed?.error) {
          throw Object.assign(new Error("maintenance delete failed"), {
            code: removed.error.code,
          });
        }
        summary.leaveRequests += Array.isArray(removed?.data) ? removed.data.length : 0;
      }
    }

    logSummary(LEAVE_REQUESTS_TABLE, summary.leaveRequests, startedAt, cutoff);
    logSummary(NOTIFICATION_QUEUE_TABLE, summary.notifications, startedAt, cutoff);
  } catch (error) {
    logFailure(LEAVE_REQUESTS_TABLE, error);
  }

  return summary;
}

/** 200 ids per DELETE keeps the URL bounded, as the other jobs do. */
function chunksById(ids) {
  const chunks = [];
  for (let index = 0; index < ids.length; index += CLEANUP_BATCH_SIZE) {
    chunks.push(ids.slice(index, index + CLEANUP_BATCH_SIZE));
  }
  return chunks;
}

/**
 * One daily pass. A failure in one table is caught inside its own purge, so the
 * other tables still run and the scheduled handler is never rejected.
 */
export async function runDataCleanup(env, now = new Date()) {
  let db;
  try {
    db = createDb(env);
  } catch (error) {
    logFailure("setup", error);
    return {
      authSessions: 0,
      auditLogs: 0,
      notificationQueue: 0,
      approvalTokens: 0,
      leaveRetention: null,
    };
  }

  const authSessions = await purgeOldAuthSessions(db, now);
  const auditLogs = await purgeOldAuditLogs(db, now);
  const notificationQueue = await purgeOldNotificationQueue(db, now);
  const approvalTokens = await purgeOldApprovalTokens(db, now);

  // The stored row is the only source for the leave window. A read failure
  // leaves the job disabled for this run; only the error code is logged.
  let leaveSettings = null;
  try {
    leaveSettings = await readLeaveSettings(db);
  } catch (error) {
    logFailure(LEAVE_REQUESTS_TABLE, error);
  }
  const leaveRetention = await purgeOldLeaveData(db, now, {
    enabled: leaveSettings?.leaveRetentionEnabled === true,
    retentionDays: leaveSettings?.leaveRetentionDays ?? null,
    env,
  });
  return { authSessions, auditLogs, notificationQueue, approvalTokens, leaveRetention };
}
