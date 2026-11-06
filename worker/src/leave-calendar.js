// Pure helpers for GET /api/leave/calendar: range validation, the shared
// display name and the read-only event shape. No I/O here, so the route stays a
// thin read and the rules are testable without a database.

import { isDateString, spanDays } from "./leave-rules.js";

export const CALENDAR_MAX_RANGE_DAYS = 62;
export const CALENDAR_STATUSES = Object.freeze(["pending", "approved"]);

export const CALENDAR_MESSAGES = Object.freeze({
  invalid: "ข้อมูลไม่ถูกต้อง",
  dateFormat: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)",
  endBeforeStart: "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น",
  rangeTooLong: `ช่วงวันที่ต้องไม่เกิน ${CALENDAR_MAX_RANGE_DAYS} วัน`,
  departmentInvalid: "รหัสแผนกไม่ถูกต้อง",
});

/**
 * Reads ?from, ?to and ?departmentId. Both dates are required, must be real
 * calendar dates, must be ordered and must span at most 62 days inclusive.
 */
export function parseCalendarRange(params) {
  const from = params.get("from");
  const to = params.get("to");

  if (!isDateString(from) || !isDateString(to)) {
    return { ok: false, message: CALENDAR_MESSAGES.dateFormat };
  }
  if (from > to) {
    return { ok: false, message: CALENDAR_MESSAGES.endBeforeStart };
  }
  if (spanDays(from, to) > CALENDAR_MAX_RANGE_DAYS) {
    return { ok: false, message: CALENDAR_MESSAGES.rangeTooLong };
  }

  const raw = params.get("departmentId");
  const departmentId = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;

  return { ok: true, from, to, departmentId };
}

/** "นาย สมชาย" style display name; empty when the row has no name. */
export function displayName(namePrefix, fullName) {
  const name = typeof fullName === "string" ? fullName.trim() : "";
  if (name.length === 0) return "";
  const prefix = typeof namePrefix === "string" ? namePrefix.trim() : "";
  return prefix.length > 0 ? `${prefix} ${name}` : name;
}

/**
 * Exactly the keys the calendar may expose. No reason, attachment, approver or
 * national id can ride along, because only these fields are read out.
 *
 * `detail` is added only when the caller passed the one read-scope rule
 * (worker/src/leave-scope.js): the review fields, including the reason, live
 * there, and they are absent for a colleague who may not read the request.
 */
export function publicCalendarEvent({
  id,
  employeeName,
  departmentName,
  leaveTypeLabel,
  status,
  startDate,
  endDate,
  detail = null,
}) {
  const event = {
    id,
    employeeName,
    departmentName: departmentName ?? null,
    leaveTypeLabel: leaveTypeLabel ?? "",
    status,
    startDate,
    endDate,
  };
  if (detail && typeof detail === "object") event.detail = detail;
  return event;
}

/** The review fields the approval page shows, or null for an unusable row. */
export function publicCalendarDetail({
  requestCode,
  employeeCode,
  otherTypeDetail,
  days,
  returnDate,
  returnTime,
  shiftCode,
  shiftEndOverride,
  otOption,
  reason,
  hasMedicalCertificate,
  decisionNote,
  decidedAt,
  createdAt,
}) {
  return {
    requestCode: requestCode ?? null,
    employeeCode: employeeCode ?? null,
    otherTypeDetail: otherTypeDetail ?? null,
    days: days === null || days === undefined ? null : Number(days),
    returnDate: returnDate ?? null,
    returnTime: returnTime ?? null,
    shiftCode: shiftCode ?? null,
    shiftEndOverride: shiftEndOverride ?? null,
    otOption: otOption ?? null,
    reason: reason ?? null,
    hasMedicalCertificate: hasMedicalCertificate === true,
    decisionNote: decisionNote ?? null,
    decidedAt: decidedAt ?? null,
    createdAt: createdAt ?? null,
  };
}

const DAY_MS = 86400000;

/** YYYY-MM-DD + whole days, string-only: a date-only value never meets UTC. */
export function addCalendarDays(value, amount) {
  if (!isDateString(value) || !Number.isInteger(amount)) return "";
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) + amount * DAY_MS);
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * Distinct people on approved leave per day, keyed by YYYY-MM-DD. A multi-day
 * request counts once on every day it covers, and a half day is one person. A
 * person with two approved requests on the same day is still one person.
 */
export function buildDayCounts(rows) {
  const peopleByDay = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.status !== "approved") continue;
    if (typeof row.employee_id !== "string" || row.employee_id.length === 0) continue;

    const start = String(row.start_date ?? "").slice(0, 10);
    const end = String(row.end_date ?? row.start_date ?? "").slice(0, 10);
    if (!isDateString(start) || !isDateString(end) || end < start) continue;

    let date = start;
    // The route already caps the range at 62 days; this is a second bound so a
    // malformed row cannot loop for years.
    for (let index = 0; index < 64; index += 1) {
      const people = peopleByDay.get(date) ?? new Set();
      people.add(row.employee_id);
      peopleByDay.set(date, people);
      if (date === end) break;
      date = addCalendarDays(date, 1);
      if (!date) break;
    }
  }

  const counts = {};
  for (const [date, people] of peopleByDay) counts[date] = people.size;
  return counts;
}

/** Splits a list into PostgREST-safe `in.(...)` chunks. */
export function chunksOf(list, size = 100) {
  const source = Array.isArray(list) ? list : [];
  const chunkSize = Number.isInteger(size) && size > 0 ? size : 100;
  const chunks = [];
  for (let index = 0; index < source.length; index += chunkSize) {
    chunks.push(source.slice(index, index + chunkSize));
  }
  return chunks;
}
