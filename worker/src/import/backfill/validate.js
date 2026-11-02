// Pure parsing and validation for the historical attendance import ("ข้อมูลย้อนหลัง").
// No database access, no I/O, no logging of cell values.
//
// File columns, in order: A ประเภทการประชุม, B วันที่ประชุม, C เวลา, D สถานที่,
// E ชื่อพนักงาน, F สถานะ, G กะที่ลา, H แผนก (auto), I ระดับ (auto),
// J รหัสการประชุม (derived), K ตรวจสอบ (unused on import), L เหตุผล.

import { statusCodeFromLabel } from "../../attendance-status.js";
import { asText, isFormulaRisk } from "../validate.js";

export const BACKFILL_HEADERS = [
  "ประเภทการประชุม",
  "วันที่ประชุม",
  "เวลา",
  "สถานที่",
  "ชื่อพนักงาน",
  "สถานะ",
  "กะที่ลา",
  "แผนก",
  "ระดับ",
  "รหัสการประชุม",
  "ตรวจสอบ",
  "เหตุผล",
];

export const STATUS_LABELS = ["เข้าร่วมประชุม", "ลาประชุม", "ไม่เข้าร่วม", "ติดงานด่วน"];

// ชื่อเรียกเพิ่มเติมที่ยอมรับได้ในคอลัมน์ประเภทการประชุม ค่าคือ code ใน
// meeting_types การเทียบตัดช่องว่างหัว-ท้าย (และยุบช่องว่างซ้ำ) เท่านั้น
// ชื่อที่ไม่อยู่ในตารางนี้ยังถูกข้ามพร้อมเหตุผลเดิม
const MEETING_TYPE_ALIASES = {
  "หัวหน้างาน": "sup",
  "ประชุมหัวหน้างาน": "sup",
  Monthly: "monthly",
  "ประชุม Monthly": "monthly",
};
export const LEAVE_LABEL = "ลาประชุม";

// The database stores "กะ A"/"กะ B"; the file may carry A, B, กะ A or กะ B.
export const SHIFT_BY_LETTER = { A: "กะ A", B: "กะ B" };

export const MAX_REASON_LENGTH = 200;
export const MAX_LOCATION_LENGTH = 120;
export const MAX_NAME_LENGTH = 120;
export const MAX_TYPE_LENGTH = 120;

// Longest first, so นางสาว is tested before นาง.
const PREFIXES = ["นางสาว", "เด็กหญิง", "เด็กชาย", "ด.ช.", "ด.ญ.", "นาย", "นาง", "Mr.", "Mrs.", "Ms."];

export const REASONS = {
  typeEmpty: "ต้องระบุประเภทการประชุม",
  typeTooLong: `ประเภทการประชุมยาวเกิน ${MAX_TYPE_LENGTH} ตัวอักษร`,
  typeUnknown: (found) => `ไม่พบประเภทการประชุมในระบบ (พบ: ${found})`,
  dateEmpty: "ต้องระบุวันที่ประชุม",
  dateInvalid: "วันที่ประชุมไม่ถูกต้อง (รับวันที่ของ Excel หรือ dd/mm/yyyy ปี ค.ศ.)",
  dateBuddhist: "ยังไม่รองรับปี พ.ศ. กรุณาใช้ปี ค.ศ.",
  timeEmpty: "ต้องระบุเวลา",
  timeInvalid: "เวลาไม่ถูกต้อง (ต้องเป็น HH:mm)",
  locationTooLong: `สถานที่ยาวเกิน ${MAX_LOCATION_LENGTH} ตัวอักษร`,
  nameEmpty: "ต้องระบุชื่อพนักงาน",
  nameTooLong: `ชื่อพนักงานยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร`,
  nameNotFound: (found) => `ไม่พบชื่อพนักงานในระบบ (พบ: ${found})`,
  nameAmbiguous: (found) => `ชื่อพนักงานตรงกับมากกว่า 1 คน (พบ: ${found})`,
  employeeUnknown: "ไม่พบพนักงานที่ระบุในระบบ",
  statusUnknown: (found) =>
    `สถานะไม่ถูกต้อง (พบ: ${found}) ต้องเป็น ${STATUS_LABELS.join(", ")}`,
  shiftRequired: "สถานะลาประชุมต้องระบุกะ A หรือ B",
  shiftNotAllowed: (found) => `สถานะนี้ไม่ต้องระบุกะ (พบ: ${found})`,
  shiftUnknown: (found) => `กะไม่ถูกต้อง (พบ: ${found}) ต้องเป็น A หรือ B`,
  reasonTooLong: `เหตุผลยาวเกิน ${MAX_REASON_LENGTH} ตัวอักษร`,
  formula: (label) => `${label}ขึ้นต้นด้วยอักขระที่ไม่อนุญาต`,
};

const FIELD_LABELS = {
  type: "ประเภทการประชุม",
  date: "วันที่ประชุม",
  time: "เวลา",
  location: "สถานที่",
  name: "ชื่อพนักงาน",
  status: "สถานะ",
  shift: "กะที่ลา",
  reason: "เหตุผล",
};

function pad(value) {
  return String(value).padStart(2, "0");
}

/** Trims and collapses inner whitespace, so "นาย  สมชาย" equals "นาย สมชาย". */
export function collapseWhitespace(value) {
  return asText(value).replace(/\s+/g, " ");
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXCEL_SERIAL = 2958465; // 9999-12-31
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

/** Excel serial number -> ISO date (UTC arithmetic, no local timezone). */
function isoFromSerial(serial) {
  const date = new Date(EXCEL_EPOCH_MS + serial * DAY_MS);
  const year = date.getUTCFullYear();
  if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  return `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Accepts an Excel date serial (e.g. 45292) or dd/mm/yyyy in the Christian
 * era. Buddhist-era years are refused with their own reason.
 */
export function parseDateCell(value) {
  const text = asText(value);
  if (text === "") return { ok: false, reason: REASONS.dateEmpty };

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (!Number.isFinite(serial) || serial < 1 || serial > MAX_EXCEL_SERIAL) {
      return { ok: false, reason: REASONS.dateInvalid };
    }
    const iso = isoFromSerial(serial);
    return iso ? { ok: true, iso } : { ok: false, reason: REASONS.dateInvalid };
  }

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return { ok: false, reason: REASONS.dateInvalid };

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year >= 2400) return { ok: false, reason: REASONS.dateBuddhist };
  if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false, reason: REASONS.dateInvalid };

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return { ok: false, reason: REASONS.dateInvalid };
  }
  return { ok: true, iso: `${year}-${pad(month)}-${pad(day)}` };
}

/**
 * Accepts HH:mm, HH:mm:ss and the Excel day fraction (0.375 -> 09:00).
 * Every accepted form is returned as HH:mm; anything else is refused.
 */
export function parseTimeCell(value) {
  const text = asText(value);
  if (text === "") return { ok: false, reason: REASONS.timeEmpty };

  const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    const second = clock[3] === undefined ? 0 : Number(clock[3]);
    if (hour > 23 || minute > 59 || second > 59) return { ok: false, reason: REASONS.timeInvalid };
    return { ok: true, hhmm: `${pad(hour)}:${pad(minute)}` };
  }

  const fraction = /^(?:0)?\.(\d{1,15})$/.exec(text);
  if (fraction) {
    const minutes = Math.round(Number(`0.${fraction[1]}`) * 1440) % 1440;
    return { ok: true, hhmm: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
  }

  return { ok: false, reason: REASONS.timeInvalid };
}

/** A/B/กะ A/กะ B -> "กะ A"|"กะ B"; anything else -> null. */
export function normalizeShift(value) {
  const compact = asText(value).replace(/\s+/g, "").toUpperCase();
  if (compact === "A" || compact === "กะA") return SHIFT_BY_LETTER.A;
  if (compact === "B" || compact === "กะB") return SHIFT_BY_LETTER.B;
  return null;
}

/**
 * Resolves the type column to a stored meeting type. An exact meeting_types
 * name wins; otherwise the alias table maps the value to a type code.
 * Whitespace around the value is ignored. Returns { name, code } (code is
 * null when only names were supplied) or null when nothing matches: never a
 * guess.
 * @param {string} value
 * @param {Array<{code:string, name:string}>} [meetingTypes]
 * @param {string[]} [meetingTypeNames]
 */
export function matchMeetingType(value, meetingTypes = [], meetingTypeNames = []) {
  const name = collapseWhitespace(value).trim();
  if (name === "") return null;

  const types = (Array.isArray(meetingTypes) ? meetingTypes : []).filter(
    (type) => type && typeof type.code === "string" && typeof type.name === "string"
  );
  const exact = types.find((type) => collapseWhitespace(type.name) === name);
  if (exact) return { name: collapseWhitespace(exact.name), code: exact.code };

  const names = Array.isArray(meetingTypeNames) ? meetingTypeNames : [];
  if (names.some((candidate) => collapseWhitespace(candidate) === name)) {
    return { name, code: null };
  }

  if (!Object.prototype.hasOwnProperty.call(MEETING_TYPE_ALIASES, name)) return null;
  const aliasCode = MEETING_TYPE_ALIASES[name];
  const aliased = types.find((type) => type.code === aliasCode);
  return aliased ? { name: collapseWhitespace(aliased.name), code: aliasCode } : null;
}

function stripPrefix(name, namePrefix = "") {
  const prefix = collapseWhitespace(namePrefix);
  if (prefix !== "" && name.startsWith(`${prefix} `)) {
    return name.slice(prefix.length + 1).trim();
  }
  for (const candidate of PREFIXES) {
    if (name.startsWith(`${candidate} `)) return name.slice(candidate.length + 1).trim();
  }
  return name;
}

/**
 * Matches a name from the file against employees. Exact full_name wins; when
 * that finds nothing the leading prefix is dropped and compared again. More
 * than one match is always an error, never a guess.
 * @param {string} refName
 * @param {Array<{id:string, full_name:string, name_prefix?:string, employee_code?:string}>} employees
 */
export function matchEmployees(refName, employees) {
  const name = collapseWhitespace(refName);
  if (name === "") return { ok: false, reason: REASONS.nameEmpty };

  const list = Array.isArray(employees) ? employees : [];
  const exact = list.filter((row) => collapseWhitespace(row?.full_name) === name);
  if (exact.length === 1) return { ok: true, employee: exact[0] };
  if (exact.length > 1) return { ok: false, reason: REASONS.nameAmbiguous(name) };

  const wanted = stripPrefix(name);
  const loose = list.filter(
    (row) => stripPrefix(collapseWhitespace(row?.full_name), row?.name_prefix) === wanted
  );
  if (loose.length === 1) return { ok: true, employee: loose[0] };
  if (loose.length > 1) return { ok: false, reason: REASONS.nameAmbiguous(name) };
  return { ok: false, reason: REASONS.nameNotFound(name) };
}

/**
 * Validates one data row. Returns { ok: true, row } or { ok: false, reason }.
 * Columns H (แผนก), I (ระดับ), J (รหัสการประชุม) and K (ตรวจสอบ) are ignored:
 * the department and position always come from employees at read time.
 * `meetingTypes` is the list of rows from meeting_types ({ code, name });
 * `meetingTypeNames` is still accepted for callers that only have the names.
 */
export function validateBackfillRow(cells, { meetingTypes = [], meetingTypeNames = [] } = {}) {
  const values = Array.isArray(cells) ? cells : [];
  const type = collapseWhitespace(values[0]);
  const date = asText(values[1]);
  const time = asText(values[2]);
  const location = collapseWhitespace(values[3]);
  const employeeName = collapseWhitespace(values[4]);
  const status = collapseWhitespace(values[5]);
  const shift = asText(values[6]);
  const reason = asText(values[11]);

  const formulaChecks = [
    [type, FIELD_LABELS.type],
    [date, FIELD_LABELS.date],
    [time, FIELD_LABELS.time],
    [location, FIELD_LABELS.location],
    [employeeName, FIELD_LABELS.name],
    [status, FIELD_LABELS.status],
    [shift, FIELD_LABELS.shift],
    [reason, FIELD_LABELS.reason],
  ];
  for (const [value, label] of formulaChecks) {
    if (value !== "" && isFormulaRisk(value)) {
      return { ok: false, reason: REASONS.formula(label) };
    }
  }

  if (type === "") return { ok: false, reason: REASONS.typeEmpty };
  if (type.length > MAX_TYPE_LENGTH) return { ok: false, reason: REASONS.typeTooLong };
  const meetingType = matchMeetingType(type, meetingTypes, meetingTypeNames);
  if (meetingType === null) return { ok: false, reason: REASONS.typeUnknown(type) };

  const parsedDate = parseDateCell(date);
  if (!parsedDate.ok) return { ok: false, reason: parsedDate.reason };

  const parsedTime = parseTimeCell(time);
  if (!parsedTime.ok) return { ok: false, reason: parsedTime.reason };

  // สถานที่ว่างได้: เก็บเป็นค่าว่าง ไม่ข้ามแถว
  if (location.length > MAX_LOCATION_LENGTH) return { ok: false, reason: REASONS.locationTooLong };

  if (employeeName === "") return { ok: false, reason: REASONS.nameEmpty };
  if (employeeName.length > MAX_NAME_LENGTH) return { ok: false, reason: REASONS.nameTooLong };

  const statusCode = statusCodeFromLabel(status);
  if (statusCode === null) return { ok: false, reason: REASONS.statusUnknown(status) };

  let savedShift = null;
  const shiftTrimmed = collapseWhitespace(shift);
  if (status === LEAVE_LABEL) {
    if (shiftTrimmed === "") return { ok: false, reason: REASONS.shiftRequired };
    savedShift = normalizeShift(shiftTrimmed);
    if (savedShift === null) return { ok: false, reason: REASONS.shiftUnknown(shiftTrimmed) };
  } else if (shiftTrimmed !== "") {
    return { ok: false, reason: REASONS.shiftNotAllowed(shiftTrimmed) };
  }

  if (reason.length > MAX_REASON_LENGTH) return { ok: false, reason: REASONS.reasonTooLong };

  return {
    ok: true,
    row: {
      meetingTypeName: meetingType.name,
      dateIso: parsedDate.iso,
      timeHhmm: parsedTime.hhmm,
      location,
      employeeName,
      statusLabel: status,
      statusCode,
      shift: savedShift,
      reason: reason === "" ? null : reason,
    },
  };
}
