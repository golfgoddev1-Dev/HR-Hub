// Pure validation helpers for the HR employee import.
// No database access, no I/O, and no national ID ever appears inside a reason.

export const HEADERS = [
  "รหัสพนักงาน",
  "คำนำหน้าชื่อ",
  "ชื่อ",
  "สกุล",
  "แผนก",
  "เลขที่บัตรประชาชน",
];

export const EMPLOYEE_CODE_PATTERN = /^[A-Z]{3}-\d{5}$/;

const FIELDS = [
  { key: "employeeCode", index: 0, label: "รหัสพนักงาน", max: 9 },
  { key: "prefix", index: 1, label: "คำนำหน้าชื่อ", max: 20 },
  { key: "firstName", index: 2, label: "ชื่อ", max: 60 },
  { key: "lastName", index: 3, label: "สกุล", max: 60 },
  { key: "department", index: 4, label: "แผนก", max: 100 },
  { key: "nationalId", index: 5, label: "เลขที่บัตรประชาชน", max: 20 },
];

// Announced to HR in the preview response (SETTINGS.maxLengths).
export const MAX_LENGTHS = Object.fromEntries(FIELDS.map((field) => [field.key, field.max]));
export const FIELD_LABELS = Object.fromEntries(FIELDS.map((field) => [field.key, field.label]));

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

export const REASONS = {
  codeFormat: "รหัสพนักงานไม่ถูกต้อง (ต้องเป็นตัวพิมพ์ใหญ่ 3 ตัว + ขีด + เลข 5 หลัก)",
  nameEmpty: "ต้องมีทั้งชื่อและสกุล",
  departmentEmpty: "ต้องระบุแผนก",
  prefixEmpty: "ต้องระบุคำนำหน้าชื่อ",
  idDigits: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก",
  idCheckDigit: "เลขบัตรไม่ผ่านการตรวจ check digit",
  formula: (label) => `${label}ขึ้นต้นด้วยอักขระที่ไม่อนุญาต`,
  tooLong: (label, max) => `${label}ยาวเกิน ${max} ตัวอักษร`,
  prefixNotFound: (found) => `ไม่พบคำนำหน้าในรายการ (พบ: ${found})`,
  departmentNotFound: (found) => `ไม่พบแผนกในรายการ (พบ: ${found})`,
  duplicateInFile: "รหัสพนักงานซ้ำในไฟล์",
  tooManyRows: "จำนวนแถวข้อมูลเกิน 500 แถว",
};

/** Trims a cell to a plain string. */
export function asText(value) {
  return String(value ?? "").trim();
}

/** True when every cell of the row is empty after trimming. */
export function isBlankRow(cells) {
  return cells.every((cell) => asText(cell) === "");
}

/** True when the value starts with a spreadsheet formula trigger character. */
export function isFormulaRisk(value) {
  const text = asText(value);
  return FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** Strips every non-digit character from a national ID value. */
export function normalizeNationalId(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Thai national ID check digit: digits 1-12 multiplied by 13..2, then
 * (11 - (sum mod 11)) mod 10 must equal digit 13. Returns null for bad input.
 */
export function nationalIdCheckDigit(digits) {
  if (!/^\d{13}$/.test(digits)) return null;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(digits[index]) * (13 - index);
  }
  return (11 - (sum % 11)) % 10;
}

/** Full national ID validation, check digit included. */
export function isValidNationalId(value) {
  const digits = normalizeNationalId(value);
  if (!/^\d{13}$/.test(digits)) return false;
  return nationalIdCheckDigit(digits) === Number(digits[12]);
}

/** Keeps only the last four digits visible. */
export function maskNationalId(value) {
  const digits = normalizeNationalId(value);
  if (digits.length < 4) return "";
  return `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Comparison key that ignores spaces and letter case, for prefix matching. */
export function prefixKey(value) {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

/**
 * Matches a prefix against the allowed list.
 * Whitespace/case-only differences are corrected and reported as adjusted;
 * anything else is a row-level rejection.
 */
export function matchPrefix(rawValue, allowedPrefixes) {
  const value = asText(rawValue);
  if (allowedPrefixes.includes(value)) {
    return { ok: true, value, adjusted: false };
  }
  const key = prefixKey(value);
  const hit = allowedPrefixes.find((prefix) => prefixKey(prefix) === key);
  if (hit) return { ok: true, value: hit, adjusted: true, found: value };
  return { ok: false, reason: REASONS.prefixNotFound(value) };
}

/**
 * Validates one data row (six cells, header already removed).
 * Returns { ok: true, employee, adjustments } or { ok: false, reason }.
 * Blank rows are the caller's responsibility.
 */
export function validateRow(cells, { allowedPrefixes = [], departmentNames = [] } = {}) {
  const values = FIELDS.map((field) => asText(cells[field.index]));

  for (const field of FIELDS) {
    if (values[field.index].length > field.max) {
      return { ok: false, reason: REASONS.tooLong(field.label, field.max) };
    }
  }

  for (const field of FIELDS) {
    if (isFormulaRisk(values[field.index])) {
      return { ok: false, reason: REASONS.formula(field.label) };
    }
  }

  const [employeeCode, prefixRaw, firstName, lastName, departmentName, idRaw] = values;

  if (!EMPLOYEE_CODE_PATTERN.test(employeeCode)) {
    return { ok: false, reason: REASONS.codeFormat };
  }
  if (prefixRaw === "") return { ok: false, reason: REASONS.prefixEmpty };

  const prefixMatch = matchPrefix(prefixRaw, allowedPrefixes);
  if (!prefixMatch.ok) return { ok: false, reason: prefixMatch.reason };

  if (firstName === "" || lastName === "") {
    return { ok: false, reason: REASONS.nameEmpty };
  }
  if (departmentName === "") return { ok: false, reason: REASONS.departmentEmpty };
  if (!departmentNames.includes(departmentName)) {
    return { ok: false, reason: REASONS.departmentNotFound(departmentName) };
  }

  const digits = normalizeNationalId(idRaw);
  if (!/^\d{13}$/.test(digits)) return { ok: false, reason: REASONS.idDigits };
  if (!isValidNationalId(digits)) return { ok: false, reason: REASONS.idCheckDigit };

  const adjustments = [];
  if (prefixMatch.adjusted) {
    adjustments.push({ field: "prefix", from: prefixMatch.found, to: prefixMatch.value });
  }

  return {
    ok: true,
    employee: {
      employeeCode,
      prefix: prefixMatch.value,
      firstName,
      lastName,
      departmentName,
      nationalId: digits,
    },
    adjustments,
  };
}
