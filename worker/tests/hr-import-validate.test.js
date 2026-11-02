import test from "node:test";
import assert from "node:assert/strict";

import { hmacSha256Hex } from "../src/crypto.js";
import {
  MAX_LENGTHS,
  REASONS,
  isValidNationalId,
  maskNationalId,
  matchPrefix,
  nationalIdCheckDigit,
  validateRow,
} from "../src/import/validate.js";
import { buildPlan, DECISION_KEEP, DECISION_USE_FILE } from "../src/import/plan.js";

const PEPPER = "fake-national-pepper";
const PREFIXES = ["นาย", "นาง", "นางสาว"];
const DEPARTMENTS = [
  { id: "dept-1", name: "ฝ่ายบุคคล" },
  { id: "dept-2", name: "ฝ่ายขาย" },
];
const DEPARTMENT_NAMES = DEPARTMENTS.map((department) => department.name);

/** Builds a fake 13-digit ID whose check digit is correct. */
function withCheckDigit(first12) {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(first12[index]) * (13 - index);
  }
  return `${first12}${(11 - (sum % 11)) % 10}`;
}

const ID_A = withCheckDigit("110170020011");
const ID_B = withCheckDigit("110170020012");
const ID_C = withCheckDigit("110170020013");

function row(code, prefix, first, last, department, id) {
  return [code, prefix, first, last, department, id];
}

test("check digit accepts a valid fake ID and rejects a wrong last digit", () => {
  assert.equal(nationalIdCheckDigit(ID_A), Number(ID_A[12]));
  assert.equal(isValidNationalId(ID_A), true);
  const wrong = `${ID_A.slice(0, 12)}${(Number(ID_A[12]) + 1) % 10}`;
  assert.equal(isValidNationalId(wrong), false);
});

test("maskNationalId shows only the last four digits", () => {
  assert.equal(maskNationalId(ID_A), `${"•".repeat(9)}${ID_A.slice(9)}`);
  assert.equal(maskNationalId(ID_A).includes(ID_A.slice(0, 9)), false);
});

test("prefix matching corrects spaces and case only", () => {
  assert.deepEqual(matchPrefix("นาย", PREFIXES), { ok: true, value: "นาย", adjusted: false });
  const spaced = matchPrefix("นาง สาว", PREFIXES);
  assert.equal(spaced.ok, true);
  assert.equal(spaced.adjusted, true);
  assert.equal(spaced.value, "นางสาว");
  assert.equal(spaced.found, "นาง สาว");

  const foreign = matchPrefix("ดร.", PREFIXES);
  assert.equal(foreign.ok, false);
  assert.match(foreign.reason, /ไม่พบคำนำหน้าในรายการ \(พบ: ดร\.\)/);
});

test("valid row passes with trimmed values", () => {
  const result = validateRow(row("  ABC-00220  ", " นาย ", " สมชาย ", " ทดสอบ ", "ฝ่ายบุคคล", ID_A), {
    allowedPrefixes: PREFIXES,
    departmentNames: DEPARTMENT_NAMES,
  });
  assert.equal(result.ok, true);
  assert.equal(result.employee.employeeCode, "ABC-00220");
  assert.equal(result.employee.prefix, "นาย");
  assert.equal(result.employee.nationalId, ID_A);
  assert.deepEqual(result.adjustments, []);
});

test("prefix with extra spaces is adjusted and reported", () => {
  const result = validateRow(row("ABC-00221", "นาง  สาว", "สมหญิง", "ทดสอบ", "ฝ่ายบุคคล", ID_B), {
    allowedPrefixes: PREFIXES,
    departmentNames: DEPARTMENT_NAMES,
  });
  assert.equal(result.ok, true);
  assert.equal(result.employee.prefix, "นางสาว");
  assert.deepEqual(result.adjustments, [{ field: "prefix", from: "นาง  สาว", to: "นางสาว" }]);
});

test("row rejections use the confirmed messages and never include the ID", () => {
  const cases = [
    [row("abc-0022", "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A), REASONS.codeFormat],
    [row("AB-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A), REASONS.codeFormat],
    [row("ABC-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", `${ID_A.slice(0, 12)}`), REASONS.idDigits],
    [
      row("ABC-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", `${ID_A.slice(0, 12)}${(Number(ID_A[12]) + 3) % 10}`),
      REASONS.idCheckDigit,
    ],
    [row("ABC-00220", "ดร.", "ก", "ข", "ฝ่ายบุคคล", ID_A), /ไม่พบคำนำหน้า/],
    [row("ABC-00220", "นาย", "ก", "ข", "ฝ่ายบัญชี", ID_A), /ไม่พบแผนกในรายการ/],
    [row("ABC-00220", "นาย", "ก", "ข", "", ID_A), REASONS.departmentEmpty],
    [row("ABC-00220", "นาย", "ก", "", "ฝ่ายบุคคล", ID_A), REASONS.nameEmpty],
    [row("ABC-00220", "นาย", "=SUM(A1)", "ข", "ฝ่ายบุคคล", ID_A), /ชื่อขึ้นต้นด้วยอักขระที่ไม่อนุญาต/],
    [row("ABC-00220", "นาย", "ก", "ข", "ฝ่ายบุคคล", ID_A).map((cell, index) => (index === 4 ? "@แผนก" : cell)), /แผนกขึ้นต้นด้วยอักขระ/],
  ];

  for (const [cells, expected] of cases) {
    const result = validateRow(cells, {
      allowedPrefixes: PREFIXES,
      departmentNames: DEPARTMENT_NAMES,
    });
    assert.equal(result.ok, false, JSON.stringify(cells));
    if (expected instanceof RegExp) assert.match(result.reason, expected);
    else assert.equal(result.reason, expected);

    assert.equal(result.reason.includes(ID_A), false);
    assert.equal(/\d{13}/.test(result.reason), false);
  }
});

test("field length caps are enforced and published", () => {
  const longName = "ก".repeat(MAX_LENGTHS.firstName + 1);
  const result = validateRow(row("ABC-00220", "นาย", longName, "ข", "ฝ่ายบุคคล", ID_A), {
    allowedPrefixes: PREFIXES,
    departmentNames: DEPARTMENT_NAMES,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, REASONS.tooLong("ชื่อ", MAX_LENGTHS.firstName));
});

async function planFor(rows, options = {}) {
  const existingByCode = options.existingByCode ?? new Map();
  const credentialByEmployeeId = options.credentialByEmployeeId ?? new Map();
  return buildPlan({
    rows,
    allowedPrefixes: PREFIXES,
    departments: DEPARTMENTS,
    existingByCode,
    credentialByEmployeeId,
    hashOf: (digits) => hmacSha256Hex(PEPPER, digits),
    decryptOf: options.decryptOf ?? (async () => null),
    decisions: options.decisions ?? new Map(),
  });
}

test("plan separates new rows, updates, choices and skips", async () => {
  const matchingHash = await hmacSha256Hex(PEPPER, ID_A);
  const existingByCode = new Map([
    ["ABC-00220", { id: "emp-1", employee_code: "ABC-00220", is_active: true }],
    ["ABC-00221", { id: "emp-2", employee_code: "ABC-00221", is_active: true }],
  ]);
  const credentialByEmployeeId = new Map([
    ["emp-1", { employee_id: "emp-1", national_id_hash: matchingHash, national_id_enc: "v1.xx" }],
    ["emp-2", { employee_id: "emp-2", national_id_hash: await hmacSha256Hex(PEPPER, ID_C), national_id_enc: "v1.yy" }],
  ]);

  const rows = [
    { rowNumber: 2, cells: row("ABC-00220", "นาย", "สมชาย", "ใหม่", "ฝ่ายขาย", ID_A) },
    { rowNumber: 3, cells: row("ABC-00221", "นาย", "สมชาย", "อื่น", "ฝ่ายขาย", ID_B) },
    { rowNumber: 4, cells: row("ABC-00222", "นาย", "สมหญิง", "ใหม่", "ฝ่ายบุคคล", ID_C) },
    { rowNumber: 5, cells: row("abc-1", "นาย", "ผิด", "รูปแบบ", "ฝ่ายบุคคล", ID_B) },
    { rowNumber: 6, cells: row("ABC-00223", "นาย", "ซ้ำ", "ไฟล์", "ฝ่ายบุคคล", ID_B) },
    { rowNumber: 7, cells: row("ABC-00223", "นาย", "ซ้ำ", "ไฟล์", "ฝ่ายบุคคล", ID_C) },
  ];

  const plan = await planFor(rows, { existingByCode, credentialByEmployeeId });

  assert.equal(plan.summary.dataRows, 6);
  assert.equal(plan.summary.added, 1);
  assert.equal(plan.summary.updated, 1);
  assert.equal(plan.summary.needsChoice, 1);
  assert.equal(plan.summary.skipped, 3);
  assert.equal(plan.choices.length, 1);
  assert.equal(plan.choices[0].row, 3);
  assert.equal(plan.choices[0].decision, DECISION_KEEP);
  assert.equal(plan.choices[0].fileIdMasked.endsWith(ID_B.slice(-4)), true);
  assert.equal(plan.choices[0].fileIdMasked.includes(ID_B), false);

  const duplicateSkips = plan.skipped.filter((item) => item.reason === REASONS.duplicateInFile);
  assert.deepEqual(duplicateSkips.map((item) => item.row).sort(), [6, 7]);

  assert.equal(JSON.stringify(plan.skipped).includes(ID_A), false);
  assert.equal(JSON.stringify(plan.choices).includes(ID_B), false);
});

test("a file decision writes the file values, the default keeps the old ones", async () => {
  const existingByCode = new Map([
    ["ABC-00220", { id: "emp-1", employee_code: "ABC-00220", is_active: true }],
  ]);
  const credentialByEmployeeId = new Map([
    ["emp-1", { employee_id: "emp-1", national_id_hash: "deadbeef", national_id_enc: "v1.zz" }],
  ]);
  const rows = [{ rowNumber: 2, cells: row("ABC-00220", "นาย", "ก", "ข", "ฝ่ายขาย", ID_A) }];

  const kept = await planFor(rows, { existingByCode, credentialByEmployeeId });
  assert.equal(kept.updated.length, 0);
  assert.equal(kept.keptExisting.length, 1);
  assert.equal(kept.choices[0].applied, false);

  const decided = await planFor(rows, {
    existingByCode,
    credentialByEmployeeId,
    decisions: new Map([[2, DECISION_USE_FILE]]),
  });
  assert.equal(decided.updated.length, 1);
  assert.equal(decided.updated[0].useFileId, true);
  assert.equal(decided.choices.length, 0);
  assert.equal(decided.keptExisting.length, 0);
});

test("stored masked ID is shown when decryption succeeds and null otherwise", async () => {
  const existingByCode = new Map([
    ["ABC-00220", { id: "emp-1", employee_code: "ABC-00220", is_active: true }],
  ]);
  const credentialByEmployeeId = new Map([
    ["emp-1", { employee_id: "emp-1", national_id_hash: "mismatch", national_id_enc: "v1.aa" }],
  ]);
  const rows = [{ rowNumber: 2, cells: row("ABC-00220", "นาย", "ก", "ข", "ฝ่ายขาย", ID_A) }];

  const withStored = await planFor(rows, {
    existingByCode,
    credentialByEmployeeId,
    decryptOf: async () => ID_B,
  });
  assert.equal(withStored.choices[0].storedIdMasked.endsWith(ID_B.slice(-4)), true);
  assert.equal(withStored.choices[0].storedIdMasked.includes(ID_B), false);

  const withoutStored = await planFor(rows, { existingByCode, credentialByEmployeeId });
  assert.equal(withoutStored.choices[0].storedIdMasked, null);
});
