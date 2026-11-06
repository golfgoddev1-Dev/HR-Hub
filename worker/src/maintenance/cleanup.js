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

export const AUTH_SESSION_RETENTION_DAYS = 30;
export const AUDIT_RETENTION_DAYS = 365;
// 200 UUIDs keep the id=in.(...) delete URL comfortably under request limits.
export const CLEANUP_BATCH_SIZE = 200;
export const CLEANUP_MAX_ROWS = 5000;
export const CLEANUP_TIMEOUT_MS = 25_000;

const AUTH_SESSIONS_TABLE = "auth_sessions";
const AUDIT_LOGS_TABLE = "audit_logs";

/** ISO cutoff: rows strictly before this instant are old enough to delete. */
export function retentionCutoff(now, retentionDays) {
  const moment = now instanceof Date ? now : new Date(now);
  return new Date(moment.getTime() - retentionDays * 86400000).toISOString();
}

function logSummary(table, deleted, startedAt) {
  console.log("[maintenance-cleanup]", {
    table,
    deleted,
    durationMs: Math.max(0, Date.now() - startedAt),
  });
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

/**
 * One daily pass. A failure in one table is caught inside its own purge, so the
 * second table still runs and the scheduled handler is never rejected.
 */
export async function runDataCleanup(env, now = new Date()) {
  let db;
  try {
    db = createDb(env);
  } catch (error) {
    logFailure("setup", error);
    return { authSessions: 0, auditLogs: 0 };
  }

  const authSessions = await purgeOldAuthSessions(db, now);
  const auditLogs = await purgeOldAuditLogs(db, now);
  return { authSessions, auditLogs };
}
