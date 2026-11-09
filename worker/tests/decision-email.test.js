// Decision email content: fixed subjects, plain text only, one login link,
// the approver's name only in the employee report, and the shared 1500-code-
// point reason preview when the body would exceed the relay's 4000 limit.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_EMAIL_KINDS,
  DECISION_EMAIL_SUBJECTS,
  DECISION_EMAIL_TRUNCATED_NOTICE,
  buildDecisionEmailMessage,
} from "../src/email/decision-email.js";

const LINK = "https://hr.example.test/login";

const BASE = {
  employeeName: "สมชาย ใจดี",
  employeeCode: "EMP-001",
  departmentName: "ฝ่ายบุคคล",
  leaveTypeName: "ลากิจ",
  otherTypeDetail: null,
  startDate: "2026-11-10",
  endDate: "2026-11-11",
  days: 2,
  returnDate: "2026-11-12",
  returnTime: "08:00",
  shiftCode: "DAY_FULL",
  otOption: "ไม่ OT",
  reason: "ไปธุระที่ต่างจังหวัด",
  hasMedicalCertificate: true,
  decidedAt: "2026-11-09T03:00:00.000Z",
  decisionNote: "ช่วงนี้คนขาด",
  approverName: "ผู้อนุมัติ ทดสอบ",
  requestCode: "LV-20261109-001",
  link: LINK,
};

function message(overrides) {
  return buildDecisionEmailMessage({ ...BASE, ...overrides });
}

test("the four subjects are the fixed generic lines", () => {
  assert.equal(
    DECISION_EMAIL_SUBJECTS.shift_lead_approved,
    "HR Hub: แจ้งทราบการลาที่ได้รับการอนุมัติ"
  );
  assert.equal(
    DECISION_EMAIL_SUBJECTS.shift_lead_rejected,
    "HR Hub: แจ้งทราบการลาที่ไม่ได้รับการอนุมัติ"
  );
  assert.equal(
    DECISION_EMAIL_SUBJECTS.employee_approved,
    "HR Hub: ใบลาของคุณได้รับการอนุมัติแล้ว"
  );
  assert.equal(
    DECISION_EMAIL_SUBJECTS.employee_rejected,
    "HR Hub: ใบลาของคุณไม่ได้รับการอนุมัติ"
  );
});

test("an approved shift-lead notice carries the details, decision and one login link", () => {
  const built = message({
    kind: DECISION_EMAIL_KINDS.SHIFT_APPROVED,
    decision: "approved",
  });

  assert.equal(built.subject, DECISION_EMAIL_SUBJECTS.shift_lead_approved);
  for (const value of [
    "สมชาย ใจดี",
    "EMP-001",
    "ฝ่ายบุคคล",
    "ลากิจ",
    "2026-11-10",
    "2026-11-11",
    "2 วัน",
    "2026-11-12 08:00",
    "DAY_FULL",
    "ไม่ OT",
    "ไปธุระที่ต่างจังหวัด",
    "ใบรับรองแพทย์: มี",
    "อนุมัติแล้ว",
    "2026-11-09",
  ]) {
    assert.equal(built.text.includes(value), true, value);
  }

  // A shift lead is never given an approver name or an approval action.
  assert.equal(built.text.includes("ผู้อนุมัติ:"), false);
  assert.equal(built.text.includes("/approve/"), false);

  const urls = built.text.match(/https?:\/\//g) ?? [];
  assert.equal(urls.length, 1);
  assert.equal(built.text.includes(LINK), true);
  assert.equal(built.text.trimEnd().endsWith(LINK), true);
});

test("a rejected shift-lead notice includes the rejection reason", () => {
  const built = message({
    kind: DECISION_EMAIL_KINDS.SHIFT_REJECTED,
    decision: "rejected",
  });

  assert.equal(built.subject, DECISION_EMAIL_SUBJECTS.shift_lead_rejected);
  assert.equal(built.text.includes("ไม่อนุมัติ"), true);
  assert.equal(built.text.includes("เหตุผลที่ไม่อนุมัติ: ช่วงนี้คนขาด"), true);
});

test("the employee report is the only one that names the approver", () => {
  const employee = message({
    kind: DECISION_EMAIL_KINDS.EMPLOYEE_APPROVED,
    decision: "approved",
  });

  assert.equal(employee.subject, DECISION_EMAIL_SUBJECTS.employee_approved);
  assert.equal(employee.text.includes("รหัสคำขอ: LV-20261109-001"), true);
  assert.equal(employee.text.includes("ผู้อนุมัติ: ผู้อนุมัติ ทดสอบ"), true);
  assert.equal(employee.text.includes("อนุมัติแล้ว"), true);
  assert.equal(employee.text.includes("/approve/"), false);
  // No employee email mentions a certificate.
  assert.equal(employee.text.includes("ใบรับรองแพทย์"), false);
});

test("the employee rejection report carries the reason and has no link", () => {
  const built = message({
    kind: DECISION_EMAIL_KINDS.EMPLOYEE_REJECTED,
    decision: "rejected",
  });

  assert.equal(built.subject, DECISION_EMAIL_SUBJECTS.employee_rejected);
  for (const value of [
    "รหัสคำขอ: LV-20261109-001",
    "ประเภทการลา: ลากิจ",
    "ช่วงวันที่: 2026-11-10 ถึง 2026-11-11",
    "จำนวนวัน: 2 วัน",
    "กลับมาทำงาน: 2026-11-12 08:00",
    "ผู้อนุมัติ: ผู้อนุมัติ ทดสอบ",
    "วันที่พิจารณา: 2026-11-09",
    "เหตุผลที่ไม่อนุมัติ: ช่วงนี้คนขาด",
    "ไม่อนุมัติ",
  ]) {
    assert.equal(built.text.includes(value), true, value);
  }

  // No link, no certificate, no approval action.
  assert.equal(built.text.includes("http"), false);
  assert.equal(built.text.includes("ใบรับรองแพทย์"), false);
  assert.equal(built.text.includes("/approve/"), false);
  assert.deepEqual(Object.keys(built).sort(), ["subject", "text"]);
});

test("the body is plain text with no html, cc, bcc or attachment fields", () => {
  for (const kind of Object.values(DECISION_EMAIL_KINDS)) {
    const built = message({ kind, decision: "approved" });
    assert.equal(/<[a-z][^>]*>/i.test(built.text), false, kind);
    assert.equal(/\b(cc|bcc|attachment)s?:/i.test(built.text), false, kind);
  }
});

test("a reason that would overflow is cut to 1500 code points plus the notice", () => {
  const reason = "ก".repeat(4000);
  const built = message({
    kind: DECISION_EMAIL_KINDS.SHIFT_APPROVED,
    decision: "approved",
    reason,
  });

  assert.equal(built.text.length <= 4000, true);
  assert.equal(built.text.includes(DECISION_EMAIL_TRUNCATED_NOTICE), true);
  assert.equal(built.text.includes(reason.slice(0, 1500)), true);
  assert.equal(built.text.includes(reason.slice(0, 1501)), false);
});

test("a reason that fits is sent whole with no notice", () => {
  const reason = "ไปธุระ".repeat(50);
  const built = message({
    kind: DECISION_EMAIL_KINDS.SHIFT_APPROVED,
    decision: "approved",
    reason,
  });

  assert.equal(built.text.includes(reason), true);
  assert.equal(built.text.includes(DECISION_EMAIL_TRUNCATED_NOTICE), false);
});

test("an unknown kind or decision is refused", () => {
  assert.equal(message({ kind: "leave_decided", decision: "approved" }), null);
  assert.equal(
    message({ kind: DECISION_EMAIL_KINDS.SHIFT_APPROVED, decision: "pending" }),
    null
  );
});
