// Company holidays: one row per non-working date.
//
// The table is `holidays (holiday_date date primary key, name text)`. There is
// no `date` and no `created_at` column, so every query and every caller uses
// `holiday_date`.
//
// Reading the table is required, not optional: counting working days without
// the holiday list would silently over-count leave. A failed read therefore
// throws, and the caller refuses the submission with a message instead of
// calculating anything.

import { isDateString } from "./leave-rules.js";

export const HOLIDAYS_TABLE = "holidays";
export const HOLIDAY_DATE_COLUMN = "holiday_date";
export const HOLIDAYS_UNAVAILABLE = "ระบบวันหยุดยังไม่พร้อม กรุณาติดต่อฝ่ายบุคคล";

/** Set of YYYY-MM-DD strings; anything else in the list is dropped. */
export function holidaySetOf(dates) {
  const set = new Set();
  for (const value of Array.isArray(dates) ? dates : []) {
    if (isDateString(value)) set.add(value);
  }
  return set;
}

/** Normalises one row to its date string, or null when unusable. */
export function holidayDateOf(row) {
  const value = String(row?.[HOLIDAY_DATE_COLUMN] ?? "").slice(0, 10);
  return isDateString(value) ? value : null;
}

/** One row as { date, name }, or null when the date is unusable. */
export function holidayRowOf(row) {
  const date = holidayDateOf(row);
  if (!date) return null;
  const name = typeof row?.name === "string" ? row.name.replace(/\s+/g, " ").trim() : "";
  return { date, name: name.length > 0 ? name : null };
}

/**
 * Holidays with their names, optionally limited to an inclusive range. Used by
 * the calendar, which needs the name on the day; the day-counting callers keep
 * using readHolidays(), which reads the date column only.
 */
export async function readHolidayRows(db, { from = null, to = null } = {}) {
  const filters = [];
  if (isDateString(from)) filters.push([HOLIDAY_DATE_COLUMN, "gte", from]);
  if (isDateString(to)) filters.push([HOLIDAY_DATE_COLUMN, "lte", to]);

  const rows = await db.select(HOLIDAYS_TABLE, {
    columns: `${HOLIDAY_DATE_COLUMN},name`,
    filters,
    order: `${HOLIDAY_DATE_COLUMN}.asc`,
    limit: 400,
  });

  return (Array.isArray(rows) ? rows : []).map(holidayRowOf).filter(Boolean);
}

/**
 * Every holiday date. Throws when the table cannot be read: the caller turns
 * that into HOLIDAYS_UNAVAILABLE rather than computing days without holidays.
 */
export async function readHolidays(db) {
  const rows = await db.select(HOLIDAYS_TABLE, {
    columns: HOLIDAY_DATE_COLUMN,
    order: `${HOLIDAY_DATE_COLUMN}.asc`,
  });

  const dates = (Array.isArray(rows) ? rows : []).map(holidayDateOf).filter(Boolean);
  return { dates };
}
