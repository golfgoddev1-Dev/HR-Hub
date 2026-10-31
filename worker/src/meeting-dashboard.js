// Pure meeting dashboard helpers, ported 1:1 from server/meeting-dashboard.js
// so the Express behaviour stays byte-for-byte. No I/O, no secrets, no logging.
// All business time is Asia/Bangkok; timestamp weighting uses Date only.

import {
  countByStatus,
  STATUS_LABEL_BY_CODE,
} from "./meeting-overview.js";

export { countByStatus };

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const DASH = "-";
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 12;
const HISTORY_MONTHS = 12;
const TOP_STATUSES = ["not_attended", "urgent_busy", "leave"];

export const STATUS_LABELS = Object.values(STATUS_LABEL_BY_CODE);
export const STATUS_CODES = Object.keys(STATUS_LABEL_BY_CODE);

export const EMPTY_MESSAGE = "ยังไม่มีข้อมูลในระบบ";
export const NOT_YET_LABEL = "ยังไม่ลงทะเบียน";
export const ATTENDED_LABEL = "เข้าร่วมประชุม";
export const NOT_ATTENDED_LABEL = "ไม่เข้าร่วม";
export const URGENT_BUSY_LABEL = "ติดงานด่วน";
export const LEAVE_LABEL = "ลาประชุม";

function bangkokParts(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: pick("year"), month: pick("month"), day: pick("day") };
}

/** Bangkok YYYY-MM-DD for a passed Date, or Date.now(). */
export function bangkokDayKey(date) {
  const { year, month, day } = bangkokParts(date instanceof Date ? date : new Date());
  return `${year}-${month}-${day}`;
}

/** HH:mm in Bangkok (en-GB, hourCycle h23) for an ISO value; null when unusable. */
export function timeOfDay(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function dayKeyToDate(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dayKey === "string" ? dayKey : "");
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

function monthKeyToDate(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(typeof monthKey === "string" ? monthKey : "");
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12));
}

function thaiPart(date, options) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK_TIME_ZONE, ...options }).format(date);
}

/** 'วันอังคาร 3 พ.ย. 2569' from a YYYY-MM-DD key; '' when unusable. */
export function thaiDateLabel(dayKey) {
  const date = dayKeyToDate(dayKey);
  if (!date) return "";
  const weekday = thaiPart(date, { weekday: "long" });
  const day = thaiPart(date, { day: "numeric" });
  return `${weekday} ${day} ${thaiPart(date, { month: "short", year: "numeric" })}`;
}

/** '3 พ.ย.' from a YYYY-MM-DD key; '' when unusable. */
export function thaiShortDateLabel(dayKey) {
  const date = dayKeyToDate(dayKey);
  if (!date) return "";
  return `${thaiPart(date, { day: "numeric" })} ${thaiPart(date, { month: "short" })}`;
}

/** 'พ.ย. 2569' from a YYYY-MM key; '' when unusable. */
export function thaiMonthLabel(monthKey) {
  const date = monthKeyToDate(monthKey);
  if (!date) return "";
  return thaiPart(date, { month: "short", year: "numeric" });
}

/** Cycle label on the dashboard: short Thai date for sup, Thai month for monthly. */
export function cycleLabel(code, key) {
  return code === "sup" ? thaiShortDateLabel(key) : thaiMonthLabel(key);
}

/** Full cycle label: long Thai date for sup, Thai month for monthly. */
export function cycleFullLabel(code, key) {
  return code === "sup" ? thaiDateLabel(key) : thaiMonthLabel(key);
}

/** Cycle storage key: full date for sup, YYYY-MM for monthly. */
export function cycleKeyOf(code, sessionDate) {
  const text = typeof sessionDate === "string" ? sessionDate : "";
  return code === "sup" ? text : text.slice(0, 7);
}

/** Next calendar month of a YYYY-MM key, via Date.UTC only. */
export function nextMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1, 12));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ISO timestamp weight; rows without a parseable registered_at weigh 0. */
export function registeredTime(row) {
  const time = new Date(row?.registered_at ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

/** Keeps only each employee's latest row by registered_at (ties: later row wins). */
export function latestPerEmployee(rows) {
  const latest = new Map();
  for (const row of rows ?? []) {
    const employeeId = row?.employee_id;
    if (typeof employeeId !== "string" || employeeId.length === 0) continue;
    const current = latest.get(employeeId);
    if (!current || registeredTime(row) >= registeredTime(current)) latest.set(employeeId, row);
  }
  return [...latest.values()];
}

/** Ascending by registered_at; unparseable time weighs 0. Does not mutate. */
export function sortByRegisteredAt(rows) {
  return [...(rows ?? [])].sort((a, b) => registeredTime(a) - registeredTime(b));
}

/** Share of attended people, clamped to 0..1; 0 when total <= 0. */
export function rateOf(attended, total) {
  const attendedCount = Number(attended);
  const totalCount = Number(total);
  if (!Number.isFinite(attendedCount) || !Number.isFinite(totalCount) || totalCount <= 0) return 0;
  const rate = attendedCount / totalCount;
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

/* ------------------------------------------------------------------ */
/* history window (draft section 3)                                    */
/* ------------------------------------------------------------------ */

function parseDayTimestamp(dayKey) {
  const date = dayKeyToDate(dayKey);
  if (!date) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function formatUtcDay(timestamp) {
  const date = new Date(timestamp);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function addDays(dayKey, days) {
  const timestamp = parseDayTimestamp(dayKey);
  if (timestamp === null) return "";
  return formatUtcDay(timestamp + days * DAY_MS);
}

function tuesdayOnOrBefore(dayKey) {
  const timestamp = parseDayTimestamp(dayKey);
  if (timestamp === null) return "";
  let cursor = timestamp;
  for (let step = 0; step < 7; step += 1) {
    if (new Date(cursor).getUTCDay() === 2) return formatUtcDay(cursor);
    cursor -= DAY_MS;
  }
  return "";
}

function shiftMonth(monthKey, delta) {
  const date = monthKeyToDate(monthKey);
  if (!date) return "";
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 15, 12));
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}`;
}

function monthKeyOf(key) {
  return typeof key === "string" ? key.slice(0, 7) : "";
}

function sortedKeys(availableKeys) {
  const keys = (availableKeys ?? []).filter(
    (key) => typeof key === "string" && key.length >= 7,
  );
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

/**
 * Exact history-window rules from the draft:
 * - sup + day: anchor = value or latest key; the Tuesday on or before it, then
 *   12 Tuesdays at 7-day steps oldest first (empty slots included).
 * - monthly + day: 12 calendar months back from the anchor's month.
 * - monthly + month: available months up to the value, last 12.
 * - year: available months starting with the 4-digit basis, sorted ascending.
 */
export function historyKeys({ code, mode, value, availableKeys } = {}) {
  const keys = sortedKeys(availableKeys);
  const latest = keys.length > 0 ? keys[keys.length - 1] : "";
  const requested = typeof value === "string" ? value.trim() : "";

  if (mode === "year") {
    const basis = (requested.length >= 4 ? requested : latest).slice(0, 4);
    if (!/^\d{4}$/.test(basis)) return [];
    return [...new Set(keys.map(monthKeyOf))]
      .filter((key) => key.startsWith(basis))
      .sort((a, b) => a.localeCompare(b));
  }

  if (mode === "month") {
    const months = [...new Set(keys.map(monthKeyOf))].sort((a, b) => a.localeCompare(b));
    const upTo = monthKeyOf(requested);
    const filtered = upTo ? months.filter((key) => key <= upTo) : months;
    return filtered.slice(-HISTORY_MONTHS);
  }

  if (code === "sup") {
    const anchor = requested || latest;
    const end = anchor ? tuesdayOnOrBefore(anchor) : "";
    if (!end) return [];
    const start = addDays(end, -7 * (HISTORY_DAYS - 1));
    const out = [];
    for (let index = 0; index < HISTORY_DAYS; index += 1) out.push(addDays(start, index * 7));
    return out;
  }

  const endMonth = monthKeyOf(requested) || monthKeyOf(latest);
  if (!endMonth) return [];
  const out = [];
  for (let index = HISTORY_MONTHS - 1; index >= 0; index -= 1) out.push(shiftMonth(endMonth, -index));
  return out;
}

/* ------------------------------------------------------------------ */
/* dept summary and top-absent                                         */
/* ------------------------------------------------------------------ */

/** deptNameOf: non-empty strings pass through; otherwise the dash placeholder. */
export function deptName(value) {
  return typeof value === "string" && value.length > 0 ? value : DASH;
}

/** deptName -> totals for one cycle; sorted by outstanding count then Thai name. */
export function deptSummary(roster, latestRows) {
  const latestById = new Map();
  for (const row of latestRows ?? []) {
    if (typeof row?.employee_id === "string") latestById.set(row.employee_id, row);
  }

  const groups = new Map();
  for (const member of roster ?? []) {
    const name = deptName(member?.departmentName);
    const group = groups.get(name) ?? { name, total: 0, registered: 0, attended: 0 };
    group.total += 1;
    const row = latestById.get(member?.employeeId);
    if (row) {
      group.registered += 1;
      if (row.status_code === "attended") group.attended += 1;
    }
    groups.set(name, group);
  }

  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      total: group.total,
      registered: group.registered,
      notYet: group.total - group.registered,
      attended: group.attended,
      rate: rateOf(group.attended, group.total),
    }))
    .sort((a, b) => b.notYet - a.notYet || a.name.localeCompare(b.name, "th"));
}

/**
 * Flat top-absent list, one row per (dept, status) for status codes
 * ['not_attended','urgent_busy','leave']: the best name (count desc, Thai-name
 * tie-break). Empty name for zero counts. Departments ordered by Thai name.
 */
export function topAbsentPerDept(rows) {
  const grouped = new Map();
  for (const row of rows ?? []) {
    const dept = row?.dept;
    const status = row?.status;
    if (typeof dept !== "string" || dept.length === 0) continue;
    if (!TOP_STATUSES.includes(status)) continue;
    const name = typeof row?.name === "string" ? row.name : "";
    const count = Number.isFinite(Number(row?.count)) ? Number(row.count) : 0;

    const perStatus = grouped.get(dept) ?? new Map();
    const current = perStatus.get(status);
    const better =
      !current ||
      count > current.count ||
      (count === current.count && name.localeCompare(current.name, "th") < 0);
    if (better) perStatus.set(status, { name, count });
    grouped.set(dept, perStatus);
  }

  const out = [];
  const departments = [...grouped.keys()].sort((a, b) => a.localeCompare(b, "th"));
  for (const dept of departments) {
    const perStatus = grouped.get(dept);
    for (const status of TOP_STATUSES) {
      const best = perStatus.get(status);
      const count = best?.count ?? 0;
      out.push({ dept, status, name: count > 0 ? best.name : "", count });
    }
  }
  return out;
}
