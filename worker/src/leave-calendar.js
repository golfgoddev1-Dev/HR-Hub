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
 */
export function publicCalendarEvent({
  id,
  employeeName,
  departmentName,
  leaveTypeLabel,
  status,
  startDate,
  endDate,
}) {
  return {
    id,
    employeeName,
    departmentName: departmentName ?? null,
    leaveTypeLabel: leaveTypeLabel ?? "",
    status,
    startDate,
    endDate,
  };
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
