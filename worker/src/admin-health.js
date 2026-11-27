// Counts for GET /api/admin/health: how far behind the two send queues are.
// Only counts and two timestamps leave the Worker; no recipient, payload or
// error text is read, so nothing personal can reach the page.

export const HEALTH_QUEUES = Object.freeze([
  { key: "push", table: "notification_queue" },
  { key: "email", table: "decision_email_jobs" },
]);

/** A pending row older than this has missed its normal one-minute pass. */
export const OVERDUE_MINUTES = 10;
export const FAILED_WINDOW_HOURS = 24;

export function healthCutoffs(now = new Date()) {
  return {
    overdueBefore: new Date(now.getTime() - OVERDUE_MINUTES * 60 * 1000).toISOString(),
    failedSince: new Date(now.getTime() - FAILED_WINDOW_HOURS * 3600 * 1000).toISOString(),
  };
}

/** The PostgREST filters for each number of one queue. */
export function queueFilters(cutoffs) {
  return {
    pending: [["status", "eq", "pending"]],
    sending: [["status", "eq", "sending"]],
    overdue: [
      ["status", "eq", "pending"],
      ["created_at", "lt", cutoffs.overdueBefore],
    ],
    failed: [
      ["status", "eq", "failed"],
      ["created_at", "gte", cutoffs.failedSince],
    ],
    lastSent: [["status", "eq", "sent"]],
  };
}
