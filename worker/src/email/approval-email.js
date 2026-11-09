// The approval email, in one pure function with no I/O.
//
// Rules from the owner:
// - plain text only: no HTML, no cc, no bcc, no attachments, and the link is
//   the only URL the body carries;
// - the subject is the fixed generic line, so an inbox preview never shows a
//   person's name;
// - the employee name, the leave summary and the reason are in the body;
// - if the reason would push the body past the relay's 4000-character limit,
//   the body shows the first 1500 characters followed by a line telling the
//   approver to read the full reason on the approval page.
//
// The current submission rule caps a stored reason at 1000 characters
// (REASON_MAX_LENGTH), so the truncation path is a safety net for older or
// imported rows, not the normal shape.

import { MAX_TEXT_LENGTH } from "./relay.js";

export const APPROVAL_EMAIL_SUBJECT = "HR Hub: มีใบลารออนุมัติ";
export const APPROVAL_EMAIL_BUTTON_LABEL = "เปิดหน้าอนุมัติ";
export const APPROVAL_EMAIL_BUTTON_HINT = "กดปุ่มนี้เพื่อตรวจรายละเอียดและอนุมัติ";
export const APPROVAL_EMAIL_GREETING = "เรียน ผู้อนุมัติ";
export const APPROVAL_EMAIL_REASON_PREVIEW_LENGTH = 1500;
export const APPROVAL_EMAIL_TRUNCATED_NOTICE = "ดูรายละเอียดเต็มในหน้าอนุมัติ";

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

/** First `limit` code points of the reason, so a Thai character is never split. */
export function previewReason(reason, limit = APPROVAL_EMAIL_REASON_PREVIEW_LENGTH) {
  const chars = Array.from(typeof reason === "string" ? reason : "");
  return chars.slice(0, Math.max(0, Number(limit) || 0)).join("");
}

function compose({
  employeeName,
  employeeCode,
  leaveTypeName,
  otherTypeDetail,
  startDate,
  endDate,
  days,
  reason,
  link,
}) {
  const name = textOf(employeeName) || DASH;
  const code = textOf(employeeCode);
  const nameLine = code.length > 0 ? `${name} (${code})` : name;

  return [
    APPROVAL_EMAIL_GREETING,
    "",
    "มีใบลาของพนักงานรอการอนุมัติ",
    `ชื่อพนักงาน: ${nameLine}`,
    `ประเภทการลา: ${typeLine(leaveTypeName, otherTypeDetail)}`,
    `ช่วงวันที่: ${dateRangeLine(startDate, endDate)}`,
    `จำนวนวัน: ${daysLine(days)}`,
    `เหตุผล: ${textOf(reason) || DASH}`,
    "",
    APPROVAL_EMAIL_BUTTON_LABEL,
    APPROVAL_EMAIL_BUTTON_HINT,
    link,
  ].join("\n");
}

/**
 * The message body, or null when it cannot be built safely. The link is
 * required and must be an http(s) URL; everything else falls back to a dash.
 */
export function buildApprovalEmailText({
  employeeName,
  employeeCode = null,
  leaveTypeName = null,
  otherTypeDetail = null,
  startDate = null,
  endDate = null,
  days = null,
  reason = null,
  link,
} = {}) {
  if (typeof link !== "string" || !/^https?:\/\/[^\s]+$/.test(link)) return null;

  const full = compose({
    employeeName,
    employeeCode,
    leaveTypeName,
    otherTypeDetail,
    startDate,
    endDate,
    days,
    reason,
    link,
  });
  if (full.length <= MAX_TEXT_LENGTH) return full;

  const preview = compose({
    employeeName,
    employeeCode,
    leaveTypeName,
    otherTypeDetail,
    startDate,
    endDate,
    days,
    reason: `${previewReason(reason)}\n${APPROVAL_EMAIL_TRUNCATED_NOTICE}`,
    link,
  });
  if (preview.length > MAX_TEXT_LENGTH) return null;
  return preview;
}

/** The exact relay message: { subject, text } and nothing else. */
export function buildApprovalEmailMessage(input) {
  const text = buildApprovalEmailText(input);
  if (text === null) return null;
  return { subject: APPROVAL_EMAIL_SUBJECT, text };
}
