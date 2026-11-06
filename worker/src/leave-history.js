// Pure helpers for GET /api/leave/approvals/history: query parsing, the
// decided-status set, the database filters and the narrow list row.
//
// The list row never carries a reason, a note or an attachment: the history
// page is a decision log, and the read-only detail is a separate, scoped read.

import { isDateString } from "./leave-rules.js";

export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_MAX_PAGE_SIZE = 50;
export const HISTORY_MAX_SCAN_ROWS = 1000;
export const HISTORY_SEARCH_LIMIT = 300;
export const HISTORY_DECISIONS = Object.freeze(["all", "approved", "rejected"]);
export const HISTORY_STATUSES = Object.freeze(["approved", "rejected"]);

export const HISTORY_MESSAGES = Object.freeze({
  invalid: "ข้อมูลไม่ถูกต้อง",
  decisionInvalid: "ตัวกรองการตัดสินใจไม่ถูกต้อง",
});

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Reads ?from, ?to, ?decision, ?search, ?page and ?pageSize. Both dates are
 * optional but must be real YYYY-MM-DD values when present. pageSize is capped
 * at 50, which is the page size the page asks for.
 */
export function parseHistoryQuery(params) {
  const from = params.get("from");
  const to = params.get("to");
  const decision = params.get("decision") ?? "all";
  const search = (params.get("search") ?? "").trim();

  if (from !== null && from !== "" && !isDateString(from)) {
    return { ok: false, message: HISTORY_MESSAGES.invalid };
  }
  if (to !== null && to !== "" && !isDateString(to)) {
    return { ok: false, message: HISTORY_MESSAGES.invalid };
  }
  if (from && to && from > to) {
    return { ok: false, message: HISTORY_MESSAGES.invalid };
  }
  if (!HISTORY_DECISIONS.includes(decision)) {
    return { ok: false, message: HISTORY_MESSAGES.decisionInvalid };
  }
  if (search.length > 100) {
    return { ok: false, message: HISTORY_MESSAGES.invalid };
  }

  return {
    ok: true,
    from: from && from !== "" ? from : null,
    to: to && to !== "" ? to : null,
    decision,
    search,
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(positiveInt(params.get("pageSize"), HISTORY_PAGE_SIZE), HISTORY_MAX_PAGE_SIZE),
  };
}

/** The statuses a decision filter selects. */
export function historyStatuses(decision) {
  if (decision === "approved") return ["approved"];
  if (decision === "rejected") return ["rejected"];
  return [...HISTORY_STATUSES];
}

/**
 * Index-friendly filters: status + decided_at for both scopes, plus approver_id
 * for an approver. The decided_at bounds are inclusive whole Bangkok calendar
 * days expressed in UTC (the column stores an ISO instant).
 */
export function historyFilters({ employeeId = null, from = null, to = null, decision = "all" } = {}) {
  const filters = [
    ["status", "in", historyStatuses(decision)],
    ["decided_at", "not.is", null],
  ];
  if (from) filters.push(["decided_at", "gte", `${from}T00:00:00.000Z`]);
  if (to) filters.push(["decided_at", "lte", `${to}T23:59:59.999Z`]);
  if (typeof employeeId === "string" && employeeId.length > 0) {
    filters.push(["approver_id", "eq", employeeId]);
  }
  return filters;
}

/** Newest decision first; a stable tie-break keeps pagination repeatable. */
export function sortHistoryRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byTime = String(right?.decided_at ?? "").localeCompare(String(left?.decided_at ?? ""));
    if (byTime !== 0) return byTime;
    return String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  });
}

/**
 * Exactly the keys the history list may expose. The reason, the decision note,
 * the certificate and the approver's own identity never leave this function.
 */
export function publicHistoryRow({ row, requesterName, departmentName, leaveTypeName } = {}) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    decidedAt: row.decided_at ?? null,
    employeeName: requesterName ?? "",
    departmentName: departmentName ?? null,
    leaveTypeName: leaveTypeName ?? "",
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    days: row.days === null || row.days === undefined ? null : Number(row.days),
    decision: row.status ?? null,
  };
}
