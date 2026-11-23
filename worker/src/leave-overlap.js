// Date collision rule for leave requests.
//
// A request that is already pending or approved for the same employee blocks a
// new one; rejected and cancelled rows do not, because that leave never counted.
// Pure functions plus a post-insert guard for the TOCTOU race.

export const BLOCKING_STATUSES = ["pending", "approved"];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isBlockingStatus(status) {
  return BLOCKING_STATUSES.includes(status);
}

/**
 * First blocking request whose inclusive date range overlaps [startDate,
 * endDate], as { id, requestCode, startDate, endDate, status }, or null.
 */
export function findOverlappingRequest(rows, { startDate, endDate } = {}) {
  if (!DATE_PATTERN.test(String(startDate ?? "")) || !DATE_PATTERN.test(String(endDate ?? ""))) {
    return null;
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isBlockingStatus(row?.status)) continue;

    const start = String(row.start_date ?? "").slice(0, 10);
    const end = String(row.end_date ?? "").slice(0, 10);
    if (!DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) continue;

    // Inclusive ranges: touching days count as an overlap.
    if (start <= endDate && end >= startDate) {
      return {
        id: row.id ?? null,
        requestCode: row.request_code ?? null,
        startDate: start,
        endDate: end,
        status: row.status,
      };
    }
  }

  return null;
}

/**
 * Post-insert guard: re-reads overlapping rows for the same employee and
 * deletes the just-inserted row if a concurrent insert created a conflict.
 * Returns the conflicting request (same shape as findOverlappingRequest), or
 * null when the insert stands. The caller's row is excluded by id.
 */
export async function guardOverlapAfterInsert(
  db,
  table,
  { insertedId, employeeId, startDate, endDate }
) {
  const rows = await db.select(table, {
    columns: "id,request_code,start_date,end_date,status",
    filters: [
      ["employee_id", "eq", employeeId],
      ["status", "in", BLOCKING_STATUSES],
      ["end_date", "gte", startDate],
      ["start_date", "lte", endDate],
      ["id", "neq", insertedId],
    ],
    limit: 1,
  });
  const conflict = findOverlappingRequest(rows, { startDate, endDate });
  if (!conflict) return null;

  await db.remove(table, [["id", "eq", insertedId]]);
  return conflict;
}
