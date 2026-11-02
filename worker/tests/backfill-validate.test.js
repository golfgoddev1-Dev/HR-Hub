// Historical attendance import: date/time parsing, status and shift rules,
// employee name matching, and the A-L template.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKFILL_HEADERS,
  REASONS,
  matchEmployees,
  normalizeShift,
  parseDateCell,
  parseTimeCell,
  validateBackfillRow,
} from "../src/import/backfill/validate.js";
import { buildBackfillTemplateXlsx } from "../src/import/backfill/template.js";
import { parseXlsx } from "../src/import/xlsx.js";

const TYPE_NAMES = ["ประชุมหัวหน้างาน", "ประชุมประจำเดือน"];

function cells(overrides = {}) {
  const base = {
    type: "ประชุมหัวหน้างาน",
    date: "01/10/2026",
    time: "09:00",
    location: "ห้องประชุม 1",
    name: "นาย สมชาย ใจดี",
    status: "เข้าร่วมประชุม",
    shift: "",
    department: "ฝ่ายขาย",
    position: "หัวหน้า",
    code: "SUP-2026-10-01",
    check: "OK",
    reason: "",
  };
  const merged = { ...base, ...overrides };
  return [
    merged.type,
    merged.date,
    merged.time,
    merged.location,
    merged.name,
    merged.status,
    merged.shift,
    merged.department,
    merged.position,
    merged.code,
    merged.check,
    merged.reason,
  ];
}

const EMPLOYEES = [
  { id: "e1", full_name: "นาย สมชาย ใจดี", name_prefix: "นาย", employee_code: "ABC-00001" },
  { id: "e2", full_name: "นาง สมหญิง ใจดี", name_prefix: "นาง", employee_code: "ABC-00002" },
  { id: "e3", full_name: "นางสาว สมศรี ใจงาม", name_prefix: "นางสาว", employee_code: "ABC-00003" },
];

/* headers and template                                                */

test("the template carries headers A-L exactly as the reader expects", () => {
  assert.deepEqual(BACKFILL_HEADERS, [
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
  ]);

  const rows = parseXlsx(buildBackfillTemplateXlsx());
  assert.deepEqual(rows[0], BACKFILL_HEADERS);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 12);
});

/* dates                                                               */

test("Excel date serials and dd/mm/yyyy both parse to an ISO date", () => {
  assert.deepEqual(parseDateCell("45292"), { ok: true, iso: "2024-01-01" });
  assert.deepEqual(parseDateCell("01/10/2026"), { ok: true, iso: "2026-10-01" });
  assert.deepEqual(parseDateCell("1/2/2026"), { ok: true, iso: "2026-02-01" });
  assert.deepEqual(parseDateCell(" 31/12/2025 "), { ok: true, iso: "2025-12-31" });
});

test("impossible dates, Buddhist years and blanks are refused", () => {
  assert.deepEqual(parseDateCell(""), { ok: false, reason: REASONS.dateEmpty });
  assert.deepEqual(parseDateCell("31/02/2026"), { ok: false, reason: REASONS.dateInvalid });
  assert.deepEqual(parseDateCell("2026-10-01"), { ok: false, reason: REASONS.dateInvalid });
  assert.deepEqual(parseDateCell("45292.5"), { ok: true, iso: "2024-01-01" });
  assert.deepEqual(parseDateCell("01/10/2569"), { ok: false, reason: REASONS.dateBuddhist });
  assert.deepEqual(parseDateCell("0"), { ok: false, reason: REASONS.dateInvalid });
});

/* times                                                               */

test("HH:mm and the Excel time fraction both parse", () => {
  assert.deepEqual(parseTimeCell("09:00"), { ok: true, hhmm: "09:00" });
  assert.deepEqual(parseTimeCell("9:05"), { ok: true, hhmm: "09:05" });
  assert.deepEqual(parseTimeCell("13:45:00"), { ok: true, hhmm: "13:45" });
  assert.deepEqual(parseTimeCell("0.375"), { ok: true, hhmm: "09:00" });
  assert.deepEqual(parseTimeCell(".5208333333"), { ok: true, hhmm: "12:30" });
});

test("bad times are refused", () => {
  assert.deepEqual(parseTimeCell(""), { ok: false, reason: REASONS.timeEmpty });
  assert.deepEqual(parseTimeCell("24:00"), { ok: false, reason: REASONS.timeInvalid });
  assert.deepEqual(parseTimeCell("09:60"), { ok: false, reason: REASONS.timeInvalid });
  assert.deepEqual(parseTimeCell("9.30"), { ok: false, reason: REASONS.timeInvalid });
});

/* shifts                                                              */

test("A, B, กะ A and กะ B all normalise to the stored label", () => {
  assert.equal(normalizeShift("A"), "กะ A");
  assert.equal(normalizeShift("b"), "กะ B");
  assert.equal(normalizeShift("กะ A"), "กะ A");
  assert.equal(normalizeShift("กะB"), "กะ B");
  assert.equal(normalizeShift("C"), null);
  assert.equal(normalizeShift(""), null);
});

/* rows                                                                */

test("a valid row maps every imported column and ignores H, I, J and K", () => {
  const result = validateBackfillRow(cells({ status: "ลาประชุม", shift: "A" }), {
    meetingTypeNames: TYPE_NAMES,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.row, {
    meetingTypeName: "ประชุมหัวหน้างาน",
    dateIso: "2026-10-01",
    timeHhmm: "09:00",
    location: "ห้องประชุม 1",
    employeeName: "นาย สมชาย ใจดี",
    statusLabel: "ลาประชุม",
    statusCode: "leave",
    shift: "กะ A",
    reason: null,
  });
});

test("each of the four statuses maps to its code", () => {
  const expected = {
    เข้าร่วมประชุม: "attended",
    ลาประชุม: "leave",
    ไม่เข้าร่วม: "not_attended",
    ติดงานด่วน: "urgent_busy",
  };
  for (const [label, code] of Object.entries(expected)) {
    const shift = label === "ลาประชุม" ? "B" : "";
    const result = validateBackfillRow(cells({ status: label, shift }), {
      meetingTypeNames: TYPE_NAMES,
    });
    assert.equal(result.ok, true, label);
    assert.equal(result.row.statusCode, code);
  }
});

test("leave needs a valid shift; other statuses must not carry one", () => {
  assert.deepEqual(validateBackfillRow(cells({ status: "ลาประชุม", shift: "" }), { meetingTypeNames: TYPE_NAMES }), {
    ok: false,
    reason: REASONS.shiftRequired,
  });
  assert.deepEqual(
    validateBackfillRow(cells({ status: "ลาประชุม", shift: "C" }), { meetingTypeNames: TYPE_NAMES }),
    { ok: false, reason: REASONS.shiftUnknown("C") }
  );
  assert.deepEqual(
    validateBackfillRow(cells({ status: "ไม่เข้าร่วม", shift: "A" }), { meetingTypeNames: TYPE_NAMES }),
    { ok: false, reason: REASONS.shiftNotAllowed("A") }
  );
});

test("urgent business imports with or without a reason", () => {
  const withoutReason = validateBackfillRow(cells({ status: "ติดงานด่วน", reason: "" }), {
    meetingTypeNames: TYPE_NAMES,
  });
  assert.equal(withoutReason.ok, true);
  assert.equal(withoutReason.row.reason, null);

  const withReason = validateBackfillRow(cells({ status: "ติดงานด่วน", reason: " ประชุมลูกค้าด่วน " }), {
    meetingTypeNames: TYPE_NAMES,
  });
  assert.equal(withReason.ok, true);
  assert.equal(withReason.row.reason, "ประชุมลูกค้าด่วน");
});

test("unknown meeting type and bad status are refused; a blank location is allowed", () => {
  assert.deepEqual(
    validateBackfillRow(cells({ type: "ประชุมอื่น" }), { meetingTypeNames: TYPE_NAMES }),
    { ok: false, reason: REASONS.typeUnknown("ประชุมอื่น") }
  );
  const blankLocation = validateBackfillRow(cells({ location: "" }), { meetingTypeNames: TYPE_NAMES });
  assert.equal(blankLocation.ok, true);
  assert.equal(blankLocation.row.location, "");
  assert.deepEqual(validateBackfillRow(cells({ status: "มาไม่ทัน" }), { meetingTypeNames: TYPE_NAMES }), {
    ok: false,
    reason: REASONS.statusUnknown("มาไม่ทัน"),
  });
});

test("a formula cell and an over-long reason are refused", () => {
  assert.deepEqual(validateBackfillRow(cells({ location: "=1+1" }), { meetingTypeNames: TYPE_NAMES }), {
    ok: false,
    reason: REASONS.formula("สถานที่"),
  });
  assert.deepEqual(
    validateBackfillRow(cells({ status: "ติดงานด่วน", reason: "ก".repeat(201) }), {
      meetingTypeNames: TYPE_NAMES,
    }),
    { ok: false, reason: REASONS.reasonTooLong }
  );
});

/* employee matching                                                   */

test("employee names match exactly first, then without the prefix", () => {
  assert.equal(matchEmployees("นาย สมชาย ใจดี", EMPLOYEES).employee?.id, "e1");
  assert.equal(matchEmployees("สมชาย ใจดี", EMPLOYEES).employee?.id, "e1");
  assert.equal(matchEmployees("สมศรี ใจงาม", EMPLOYEES).employee?.id, "e3");
});

test("unknown and ambiguous names are refused, never guessed", () => {
  assert.deepEqual(matchEmployees("นาย ไม่มี ตัวตน", EMPLOYEES), {
    ok: false,
    reason: REASONS.nameNotFound("นาย ไม่มี ตัวตน"),
  });

  const duplicated = [
    { id: "d1", full_name: "นาย สมชาย ใจดี", name_prefix: "นาย" },
    { id: "d2", full_name: "นาย สมชาย ใจดี", name_prefix: "นาย" },
  ];
  const ambiguous = matchEmployees("สมชาย ใจดี", duplicated);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.reason, /มากกว่า 1 คน/);
});

/* meeting type names                                                  */

const TYPES_WITH_CODES = [
  { id: "type-sup", code: "sup", name: "ประชุมหัวหน้างาน" },
  { id: "type-monthly", code: "monthly", name: "ประชุม Monthly" },
];

test("the four accepted type names resolve to their meeting type", () => {
  const accepted = {
    "หัวหน้างาน": "ประชุมหัวหน้างาน",
    "ประชุมหัวหน้างาน": "ประชุมหัวหน้างาน",
    Monthly: "ประชุม Monthly",
    "ประชุม Monthly": "ประชุม Monthly",
  };
  for (const [label, canonical] of Object.entries(accepted)) {
    const result = validateBackfillRow(cells({ type: label }), { meetingTypes: TYPES_WITH_CODES });
    assert.equal(result.ok, true, label);
    assert.equal(result.row.meetingTypeName, canonical, label);
  }
});

test("other meeting type names are still skipped", () => {
  for (const label of ["ประชุมอื่น", "หัวหน้า", "monthly", "Monthly ประชุม"]) {
    assert.deepEqual(
      validateBackfillRow(cells({ type: label }), { meetingTypes: TYPES_WITH_CODES }),
      { ok: false, reason: REASONS.typeUnknown(label) },
      label
    );
  }
});

test("the type comparison ignores whitespace around the value", () => {
  for (const label of ["  หัวหน้างาน ", "  ประชุม Monthly  ", "   Monthly"]) {
    const result = validateBackfillRow(cells({ type: label }), { meetingTypes: TYPES_WITH_CODES });
    assert.equal(result.ok, true, JSON.stringify(label));
  }
});

test("HH:mm, HH:mm:ss and the Excel fraction all become HH:mm", () => {
  const accepted = {
    "09:00": "09:00",
    "9:05": "09:05",
    "13:45:00": "13:45",
    "09:30:59": "09:30",
    "0.375": "09:00",
    ".5208333333": "12:30",
    " 08:15 ": "08:15",
  };
  for (const [input, expected] of Object.entries(accepted)) {
    assert.deepEqual(parseTimeCell(input), { ok: true, hhmm: expected }, input);
  }
});

test("times that are not valid are still refused", () => {
  assert.deepEqual(parseTimeCell(""), { ok: false, reason: REASONS.timeEmpty });
  for (const input of ["25:00", "abc", "09:60", "09:00:99", "9.30", "-0.375", "1.5"]) {
    assert.deepEqual(parseTimeCell(input), { ok: false, reason: REASONS.timeInvalid }, input);
  }
});
