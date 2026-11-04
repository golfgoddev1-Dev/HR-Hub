// Backdated leave entered by HR.
//
// Pure row builder: it runs the phase 1 rules (src/leave-rules.js) and returns
// exactly the row the insert should carry, so the test can compare it against
// computeLeave() without a database. Differences from an employee submission:
//   source = 'hr_backdated', entered_by_id = the HR employee,
//   status = 'approved', decided_at = now (no approval queue).

import {
  MESSAGES,
  OTHER_DETAIL_MAX_LENGTH,
  REASON_MAX_LENGTH,
  computeLeave,
  isDateString,
  isOtherType,
} from "./leave-rules.js";

export const BACKDATED_SOURCE = "hr_backdated";
export const EMPLOYEE_SOURCE = "employee";

/**
 * Normalises the optional fields. Returns { ok: true, otherTypeDetail, reason,
 * hasMedicalCertificate } or { ok: false, message }.
 *
 * A backdated entry never carries a certificate file or link: HR only records
 * whether one exists, and the day count never forces the checkbox.
 */
export function normalizeOptionalFields({
  leaveType,
  otherTypeDetail,
  reason,
  hasMedicalCertificate,
}) {
  let other = null;
  if (isOtherType(leaveType)) {
    const raw = typeof otherTypeDetail === "string" ? otherTypeDetail : "";
    const value = raw.replace(/\s+/g, " ").trim();
    if (value.length === 0) return { ok: false, message: MESSAGES.otherDetailRequired };
    if (Array.from(value).length > OTHER_DETAIL_MAX_LENGTH) {
      return { ok: false, message: MESSAGES.otherDetailTooLong };
    }
    other = value;
  }

  let normalizedReason = null;
  if (reason !== undefined && reason !== null) {
    if (typeof reason !== "string") return { ok: false, message: MESSAGES.invalidInput ?? "ข้อมูลไม่ถูกต้อง" };
    const value = reason.trim();
    if (Array.from(value).length > REASON_MAX_LENGTH) {
      return { ok: false, message: MESSAGES.reasonTooLong };
    }
    normalizedReason = value.length > 0 ? value : null;
  }

  if (hasMedicalCertificate !== undefined && typeof hasMedicalCertificate !== "boolean") {
    return { ok: false, message: MESSAGES.invalidInput ?? "ข้อมูลไม่ถูกต้อง" };
  }

  return {
    ok: true,
    otherTypeDetail: other,
    reason: normalizedReason,
    hasMedicalCertificate: hasMedicalCertificate === true,
  };
}

/**
 * Builds the leave_requests row for an HR backdated entry.
 * `now` is injected so the test can freeze the clock; `requestCode` is passed in
 * because it must stay unique even when two entries share a timestamp.
 */
export function buildBackdatedRow({
  input = {},
  employee,
  leaveType,
  shift,
  approverId,
  enteredById,
  holidays,
  now,
  requestCode,
}) {
  if (!employee || typeof employee.id !== "string") {
    return { ok: false, message: MESSAGES.employeeRequired ?? "ไม่พบพนักงาน" };
  }
  if (!leaveType || typeof leaveType.id !== "string") {
    return { ok: false, message: MESSAGES.typeUnknown ?? "ไม่พบประเภทการลาที่เลือก" };
  }
  if (!shift || typeof shift.code !== "string") {
    return { ok: false, message: MESSAGES.shiftUnknown };
  }
  if (typeof approverId !== "string" || approverId.length === 0) {
    return { ok: false, message: MESSAGES.approverRequired };
  }
  if (approverId === employee.id) {
    return { ok: false, message: MESSAGES.selfApproval };
  }
  if (typeof enteredById !== "string" || enteredById.length === 0) {
    return { ok: false, message: MESSAGES.invalidInput ?? "ข้อมูลไม่ถูกต้อง" };
  }
  if (!isDateString(input.startDate)) {
    return { ok: false, message: MESSAGES.dateFormat };
  }

  const computed = computeLeave({
    startDate: input.startDate,
    endDate: input.endDate === undefined || input.endDate === null ? input.startDate : input.endDate,
    shift,
    otOption: input.otOption,
    holidays,
  });
  if (computed.ok !== true) return { ok: false, message: computed.message };

  const optional = normalizeOptionalFields({
    leaveType,
    otherTypeDetail: input.otherTypeDetail,
    reason: input.reason,
    hasMedicalCertificate: input.hasMedicalCertificate,
  });
  if (optional.ok !== true) return optional;

  const nowIso = (now instanceof Date ? now : new Date()).toISOString();

  return {
    ok: true,
    row: {
      request_code: requestCode,
      employee_id: employee.id,
      leave_type_id: leaveType.id,
      other_type_detail: optional.otherTypeDetail,
      ot_option: computed.otOption,
      start_date: input.startDate,
      end_date: computed.days === 0.5 ? input.startDate : input.endDate ?? input.startDate,
      days: computed.days,
      return_date: computed.returnDate,
      return_time: computed.returnTime,
      reason: optional.reason,
      // HR never attaches a file; the column only records that one exists.
      medical_certificate_url: null,
      has_medical_certificate: optional.hasMedicalCertificate,
      status: "approved",
      approver_id: approverId,
      shift_option_code: shift.code,
      shift_end_override: computed.shiftEndOverride,
      source: BACKDATED_SOURCE,
      entered_by_id: enteredById,
      decided_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    },
  };
}
