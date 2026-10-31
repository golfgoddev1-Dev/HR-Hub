// Pure meeting overview helpers, ported from server/meeting-overview.js and the
// Express route's inline helpers. No I/O, no secrets, no logging. All business
// time is Asia/Bangkok and HH:mm values compare as strings.

import { bangkokToday, normalizeTime } from "./register-window.js";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";

export const STATUS_LABEL_BY_CODE = {
  attended: "เข้าร่วมประชุม",
  not_attended: "ไม่เข้าร่วม",
  urgent_busy: "ติดงานด่วน",
  leave: "ลาประชุม",
};

const STATUS_CODES = Object.keys(STATUS_LABEL_BY_CODE);

/** Bangkok HH:mm clock, en-GB with hourCycle h23, like the Express helper. */
function bangkokClock(now) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

/**
 * Counts every attendance row of the session, exactly like the Express
 * countByStatus: a row with any non-empty status_code increments total; only
 * known codes increment their own bucket. Rows without a usable status_code are
 * skipped entirely.
 */
export function countByStatus(rows) {
  const counts = { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 };
  for (const row of rows ?? []) {
    const code = row?.status_code;
    if (typeof code !== "string" || code.length === 0) continue;
    counts.total += 1;
    if (STATUS_CODES.includes(code)) counts[code] += 1;
  }
  return counts;
}

/**
 * Excludes roster members with any attendance row in the session (any status),
 * sorted by Thai collation on fullName. Same shape as the Express helper.
 */
export function findPending(roster, attendanceRows) {
  const registered = new Set(
    (attendanceRows ?? [])
      .map((row) => row?.employee_id)
      .filter((id) => typeof id === "string" && id.length > 0)
  );
  return [...(roster ?? [])]
    .filter((member) => !registered.has(member?.employeeId))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "th"));
}

/**
 * not_open / open / closed from the Bangkok clock; 'none' when now is missing
 * or either HH:mm value is unusable. normalizeTime is reused from
 * register-window.js, not duplicated.
 */
export function sessionPhase({ now, openTime, cutoffTime }) {
  const open = normalizeTime(openTime);
  const cutoff = normalizeTime(cutoffTime);
  if (!now || !open || !cutoff) return "none";

  const current = bangkokClock(now);
  if (current < open) return "not_open";
  if (current >= cutoff) return "closed";
  return "open";
}

/** Thai Bangkok date text for today, exactly like the Express formatDateText. */
export function formatDateText(now) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: BANGKOK_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now);
}

/** Weekday number (0 = Sunday) of a YYYY-MM-DD date text, from UTC parts. */
export function weekdayOf(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Bangkok YYYY-MM-DD for now, reused from register-window.js. */
export function todayOf(now) {
  return bangkokToday(now);
}
