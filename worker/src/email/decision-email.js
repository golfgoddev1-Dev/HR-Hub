// The shift-lead and employee decision emails, in pure functions with no I/O.
//
// Rules from the owner:
// - plain text only: no HTML, no cc, no bcc, no attachments, and at most one
//   link, which is the app's login page (never an approval link);
// - shift-lead subjects and the employee subject are fixed generic lines;
// - a shift lead receives the same detail fields as the approver's view plus the
//   decision; the employee report also carries the approver's name;
// - a rejection carries the rejection reason; the employee is only emailed when
//   the leave was approved;
// - if the reason would push the body past the relay's 4000-character limit,
//   the reason becomes the first 1500 code points plus the "read it in the app"
//   line, the same rule as the Phase 2a approval email.

import { previewReason } from "./approval-email.js";
import { MAX_TEXT_LENGTH } from "./relay.js";

export const DECISION_EMAIL_KINDS = Object.freeze({
  SHIFT_APPROVED: "shift_lead_approved",
  SHIFT_REJECTED: "shift_lead_rejected",
  EMPLOYEE_APPROVED: "employee_approved",
});

export const DECISION_EMAIL_SUBJECTS = Object.freeze({
  shift_lead_approved: "HR Hub: แจ้งทราบการลาที่ได้รับการอนุมัติ",
  shift_lead_rejected: "HR Hub: แจ้งทราบการลาที่ไม่ได้รับการอนุมัติ",
  employee_approved: "HR Hub: ใบลาของคุณได้รับการอนุมัติแล้ว",
});

export const DECISION_EMAIL_REASON_PREVIEW_LENGTH = 1500;
export const DECISION_EMAIL_TRUNCATED_NOTICE = "ดูรายละเอียดเต็มในระบบ";

const DASH = "—";

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

function daysLine(days) {
  const value = Number(days);
  if (!Number.isFinite(value)) return DASH;
  return Number.isInteger(value) ? `${value} วัน` : `${value} วัน (ครึ่งวัน)`;
}

function typeLine(leaveTypeName, otherTypeDetail) {
  const type = textOf(leaveTypeName) || "ไม่ระบุประเภท";
  const other = textOf(otherTypeDetail);
  return other.length > 0 ? `${type} (${other})` : type;
}

function dateRangeLine(startDate, endDate) {
  const start = textOf(startDate) || DASH;
  const end = textOf(endDate) || start;
  return start === end ? start : `${start} ถึง ${end}`;
}

function returnLine(returnDate, returnTime) {
  const date = textOf(returnDate);
  if (date.length === 0) return DASH;
  const time = textOf(returnTime);
  return time.length > 0 ? `${date} ${time}` : date;
}

function decisionLabel(decision) {
  return decision === "approved" ? "อนุมัติแล้ว" : "ไม่อนุมัติ";
}

/**
 * One message body. `kind` decides who the greeting is for and whether the
 * approver's name belongs in the body. Returns null for an unknown kind or an
 * input the relay would refuse.
 */
export function buildDecisionEmailText({
  kind,
  decision,
  employeeName,
  employeeCode = null,
  departmentName = null,
  leaveTypeName = null,
  otherTypeDetail = null,
  startDate = null,
  endDate = null,
  days = null,
  returnDate = null,
  returnTime = null,
  shiftCode = null,
  otOption = null,
  reason = null,
  hasMedicalCertificate = false,
  decidedAt = null,
  decisionNote = null,
  approverName = null,
  link = null,
} = {}) {
  if (!Object.prototype.hasOwnProperty.call(DECISION_EMAIL_SUBJECTS, kind)) return null;
  if (decision !== "approved" && decision !== "rejected") return null;

  const isEmployee = kind === DECISION_EMAIL_KINDS.EMPLOYEE_APPROVED;
  const name = textOf(employeeName) || DASH;
  const code = textOf(employeeCode);
  const nameLine = code.length > 0 ? `${name} (${code})` : name;
  const note = textOf(decisionNote);
  const approver = textOf(approverName);
  const decided = textOf(decidedAt).slice(0, 10);

  const lines = [
    isEmployee ? "เรียน พนักงาน" : "เรียน หัวหน้ากะ",
    "",
    isEmployee
      ? "ใบลาของคุณได้รับการพิจารณาแล้ว"
      : "มีผลการพิจารณาใบลาของพนักงานในแผนกของคุณ",
    `ชื่อพนักงาน: ${nameLine}`,
    `แผนก: ${textOf(departmentName) || DASH}`,
    `ประเภทการลา: ${typeLine(leaveTypeName, otherTypeDetail)}`,
    `ช่วงวันที่: ${dateRangeLine(startDate, endDate)}`,
    `จำนวนวัน: ${daysLine(days)}`,
    `กลับมาทำงาน: ${returnLine(returnDate, returnTime)}`,
    `กะ / OT: ${textOf(shiftCode) || DASH} · ${textOf(otOption) || DASH}`,
    `เหตุผล: ${textOf(reason) || DASH}`,
    `ใบรับรองแพทย์: ${hasMedicalCertificate === true ? "มี" : "ไม่มี"}`,
    `ผลการพิจารณา: ${decisionLabel(decision)}`,
  ];

  if (decided.length > 0) lines.push(`วันที่พิจารณา: ${decided}`);
  if (decision === "rejected" && note.length > 0) {
    lines.push(`เหตุผลที่ไม่อนุมัติ: ${note}`);
  }
  // Only the employee report names the approver.
  if (isEmployee && approver.length > 0) lines.push(`ผู้อนุมัติ: ${approver}`);

  if (typeof link === "string" && /^https?:\/\/[^\s]+$/.test(link)) {
    lines.push("", link);
  }

  const text = lines.join("\n");
  return text.length <= MAX_TEXT_LENGTH ? text : null;
}

/** The exact relay message: { subject, text } and nothing else. */
export function buildDecisionEmailMessage(input = {}) {
  const full = buildDecisionEmailText(input);
  if (full !== null) {
    return { subject: DECISION_EMAIL_SUBJECTS[input.kind], text: full };
  }

  // Nothing to shorten when the body is already unusable (unknown kind or an
  // over-long non-reason field): only the reason has a defined preview rule.
  if (!Object.prototype.hasOwnProperty.call(DECISION_EMAIL_SUBJECTS, input.kind)) return null;
  if (input.decision !== "approved" && input.decision !== "rejected") return null;
  if (typeof input.reason !== "string" || input.reason.length === 0) return null;

  const preview = `${previewReason(input.reason, DECISION_EMAIL_REASON_PREVIEW_LENGTH)}\n${DECISION_EMAIL_TRUNCATED_NOTICE}`;
  const text = buildDecisionEmailText({ ...input, reason: preview });
  if (text === null) return null;
  return { subject: DECISION_EMAIL_SUBJECTS[input.kind], text };
}
