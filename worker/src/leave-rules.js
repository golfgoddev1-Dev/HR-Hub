// Leave rules (phase 1): working-day counting and the return-to-work table.
// Pure functions only: no I/O, no env. The Worker route and the browser form
// import this same module, so a live preview can never disagree with what gets
// stored. All dates are plain YYYY-MM-DD strings compared in UTC, so a
// timezone on the server cannot move a day.

export const WORKING_WEEKDAYS = [1, 2, 3, 4, 5, 6]; // Monday..Saturday
export const MAX_SPAN_DAYS = 365;
export const OTHER_TYPE_NAME = "อื่นๆ";
export const OTHER_DETAIL_MAX_LENGTH = 100;
export const REASON_MAX_LENGTH = 1000;
export const DECISION_NOTE_MAX_LENGTH = 500;
export const ATTACHMENT_URL_MAX_LENGTH = 500;
export const DEFAULT_ATTACHMENT_FROM_DAYS = 3;

export const OT = "OT";
export const NO_OT = "ไม่ OT";
export const OT_VALUES = [OT, NO_OT];

export const MESSAGES = {
  dateFormat: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)",
  endBeforeStart: "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น",
  spanTooLong: `ช่วงวันลาต้องไม่เกิน ${MAX_SPAN_DAYS} วัน`,
  noWorkingDay: "ช่วงวันที่เลือกไม่มีวันทำการ (วันอาทิตย์หรือวันหยุด)",
  halfDayRange: "ลาครึ่งวันต้องเป็นวันเดียว (วันเริ่มต้นเท่ากับวันสิ้นสุด)",
  halfDayNotWorking: "วันที่เลือกไม่ใช่วันทำการ",
  otRequired: "ลาครึ่งวันต้องเลือกว่าจะใช้ OT หรือไม่",
  shiftUnknown: "ไม่พบกะที่เลือก",
  otherDetailRequired: `กรุณาระบุประเภทการลาอื่น ๆ (ไม่เกิน ${OTHER_DETAIL_MAX_LENGTH} ตัวอักษร)`,
  otherDetailTooLong: `รายละเอียดประเภทการลาต้องไม่เกิน ${OTHER_DETAIL_MAX_LENGTH} ตัวอักษร`,
  reasonTooLong: `เหตุผลต้องไม่เกิน ${REASON_MAX_LENGTH} ตัวอักษร`,
  attachmentRequired: "การลาครั้งนี้ต้องแนบใบรับรองแพทย์",
  attachmentUrlInvalid: "ลิงก์ไฟล์แนบไม่ถูกต้อง (ต้องขึ้นต้นด้วย https://)",
  decisionNoteRequired: "กรุณาระบุเหตุผลที่ไม่อนุมัติ",
  decisionNoteTooLong: `เหตุผลต้องไม่เกิน ${DECISION_NOTE_MAX_LENGTH} ตัวอักษร`,
  invalidInput: "ข้อมูลไม่ถูกต้อง",
  employeeRequired: "ไม่พบพนักงานที่เลือก",
  employeeInactive: "พนักงานคนนี้ถูกปิดการใช้งาน",
  typeUnknown: "ไม่พบประเภทการลาที่เลือก",
  approverRequired: "กรุณาเลือกผู้อนุมัติ",
  selfApproval: "ผู้อนุมัติต้องไม่ใช่ผู้ลาด้วยตนเอง",
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toUtcMs(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms) {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Adds whole days to a YYYY-MM-DD string. */
export function addDays(value, amount) {
  return fromUtcMs(toUtcMs(value) + amount * 86400000);
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(value) {
  return new Date(toUtcMs(value)).getUTCDay();
}

/** Inclusive calendar-day count between two dates (start === end is 1). */
export function spanDays(startDate, endDate) {
  return Math.round((toUtcMs(endDate) - toUtcMs(startDate)) / 86400000) + 1;
}

function toHolidaySet(holidays) {
  if (holidays instanceof Set) return holidays;
  if (Array.isArray(holidays)) return new Set(holidays);
  return new Set();
}

/** Monday..Saturday, excluding every date in the holiday set. */
export function isWorkingDay(value, holidays) {
  if (WORKING_WEEKDAYS.includes(weekdayOf(value)) === false) return false;
  return toHolidaySet(holidays).has(value) === false;
}

/** Working days in [startDate, endDate]; 0 when the range holds none. */
export function countWorkingDays(startDate, endDate, holidays) {
  const holidaySet = toHolidaySet(holidays);
  const last = toUtcMs(endDate);
  let count = 0;
  for (let ms = toUtcMs(startDate); ms <= last; ms += 86400000) {
    if (isWorkingDay(fromUtcMs(ms), holidaySet)) count += 1;
  }
  return count;
}

/** The first working day strictly after `value`. */
export function nextWorkingDay(value, holidays) {
  const holidaySet = toHolidaySet(holidays);
  let candidate = addDays(value, 1);
  // A year of Sunday/holiday runs is far more than any real calendar.
  for (let step = 0; step < MAX_SPAN_DAYS; step += 1) {
    if (isWorkingDay(candidate, holidaySet)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

/**
 * Half-day table. `sameDayReturn` keeps the return on the leave date,
 * `nextCalendarDay` moves it one calendar day (night shift crossing midnight),
 * and the remaining case moves it to the next working day.
 */
const HALF_DAY_RULES = {
  DAY_HALF_AM: { sameDayReturn: true, returnTime: "13:00", endTime: "17:00", otEndTime: "20:00" },
  DAY_HALF_PM: { sameDayReturn: false, returnTime: "08:00", endTime: "17:00", otEndTime: "20:00" },
  NIGHT_HALF_AM: { nextCalendarDay: true, returnTime: "01:00", endTime: "05:00", otEndTime: "08:00" },
  NIGHT_HALF_PM: { sameDayReturn: true, returnTime: "20:00", endTime: "05:00", otEndTime: "08:00" },
};

export const FULL_DAY_NIGHT_RETURN_TIME = "20:00";
export const FULL_DAY_RETURN_TIME = "08:00";

function isHalfShift(shift) {
  return shift?.is_half === true || shift?.isHalf === true;
}

/**
 * Works out the stored fields of a leave request from the start/end dates, the
 * chosen shift row and the holiday set. Returns { ok: true, ... } or
 * { ok: false, message }.
 */
export function computeLeave({ startDate, endDate, shift, otOption, holidays } = {}) {
  if (!isDateString(startDate)) return { ok: false, message: MESSAGES.dateFormat };
  const lastDate = endDate === undefined || endDate === null || endDate === "" ? startDate : endDate;
  if (!isDateString(lastDate)) return { ok: false, message: MESSAGES.dateFormat };
  if (!shift || typeof shift.code !== "string" || shift.code.length === 0) {
    return { ok: false, message: MESSAGES.shiftUnknown };
  }

  const holidaySet = toHolidaySet(holidays);
  const span = spanDays(startDate, lastDate);
  if (span <= 0) return { ok: false, message: MESSAGES.endBeforeStart };
  if (span > MAX_SPAN_DAYS) return { ok: false, message: MESSAGES.spanTooLong };

  if (isHalfShift(shift)) {
    if (startDate !== lastDate) return { ok: false, message: MESSAGES.halfDayRange };
    if (isWorkingDay(startDate, holidaySet) === false) {
      return { ok: false, message: MESSAGES.halfDayNotWorking };
    }
    if (OT_VALUES.includes(otOption) === false) return { ok: false, message: MESSAGES.otRequired };

    const rule = HALF_DAY_RULES[shift.code];
    if (!rule) return { ok: false, message: MESSAGES.shiftUnknown };

    const returnDate = rule.nextCalendarDay
      ? addDays(startDate, 1)
      : rule.sameDayReturn
        ? startDate
        : nextWorkingDay(startDate, holidaySet);

    return {
      ok: true,
      days: 0.5,
      returnDate,
      returnTime: rule.returnTime,
      shiftEndOverride: otOption === OT ? rule.otEndTime : rule.endTime,
      otOption,
    };
  }

  const days = countWorkingDays(startDate, lastDate, holidaySet);
  if (days < 1) return { ok: false, message: MESSAGES.noWorkingDay };

  return {
    ok: true,
    days,
    returnDate: nextWorkingDay(lastDate, holidaySet),
    returnTime: shift.code === "NIGHT_FULL" ? FULL_DAY_NIGHT_RETURN_TIME : FULL_DAY_RETURN_TIME,
    shiftEndOverride: null,
    otOption: NO_OT,
  };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function bangkokDateStamp(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replace(/-/g, "");
}

export const REQUEST_CODE_SEQUENCE_WIDTH = 3;

/** `LV-YYYYMMDD-` for the Bangkok date of `now`. */
export function requestCodePrefix(now = new Date()) {
  return `LV-${bangkokDateStamp(now)}-`;
}

/** LV-YYYYMMDD-001; past 999 the number simply grows. */
export function requestCodeFor(prefix, sequence) {
  const safe = Number.isInteger(sequence) && sequence > 0 ? sequence : 1;
  return `${prefix}${String(safe).padStart(REQUEST_CODE_SEQUENCE_WIDTH, "0")}`;
}

/** Sequence carried by one code, or 0 when it does not match the prefix. */
export function requestCodeSequence(code, prefix) {
  if (typeof code !== "string" || code.startsWith(prefix) === false) return 0;
  const digits = code.slice(prefix.length);
  if (/^\d{1,9}$/.test(digits) === false) return 0;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/**
 * LV-YYYYMMDD-XXXXXX: random suffix from the platform CSPRNG. Kept for the
 * older callers and tests; the routes now use the per-day sequence above.
 */
export function buildRequestCode(now = new Date()) {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (const byte of bytes) suffix += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `LV-${bangkokDateStamp(now)}-${suffix}`;
}

/** "อื่นๆ" is the only type that needs a free-text description. */
export function isOtherType(leaveType) {
  const name = typeof leaveType?.name === "string" ? leaveType.name.trim() : "";
  return name === OTHER_TYPE_NAME;
}

/**
 * Sick leave needs a medical certificate from the configured number of days.
 * The threshold column is read as snake_case from the API and camelCase from
 * the browser list; a missing or unusable value falls back to 3 days.
 */
export function attachmentRequiredFor(leaveType, days) {
  const requires = leaveType?.requires_attachment === true || leaveType?.requiresAttachment === true;
  if (!requires) return false;

  const raw =
    leaveType?.attachment_required_from_days ?? leaveType?.attachmentRequiredFromDays ?? null;
  // null/undefined must fall back to 3, not coerce to 0 (Number(null) === 0).
  const parsed = raw === null || raw === undefined ? Number.NaN : Number(raw);
  const from = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_ATTACHMENT_FROM_DAYS;

  return Number(days) >= from;
}
