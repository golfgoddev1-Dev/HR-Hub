// Date collision rule for an HR backdated entry.
//
// A request that is already pending or approved for the same employee blocks a
// new one; rejected and cancelled rows do not, because that leave never counted.
// Pure functions: the route fetches candidate rows, this decides.

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
