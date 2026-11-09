// Approval-link service: issue, validate and read the email-link token.
//
// Data rules:
// - only the SHA-256 hash is written to approval_tokens; the raw token is
//   returned once, in memory, to the email job;
// - the approver's responsibility is re-read from the existing approver tables
//   and evaluated with the existing scope function at read and decision time;
// - the detail payload carries the same fields the in-app approval detail shows
//   and never an email address or a storage path.

import { readApproverGrants } from "./leave-approvers.js";
import { displayName } from "./leave-calendar.js";
import { canViewLeaveRequest } from "./leave-scope.js";
import { buildApprovalEmailJob } from "./email/approval-queue.js";
import {
  approvalLinkBase,
  approvalTokenExpiresAt,
  approvalTokenFailureCategory,
  buildApprovalLink,
  hashApprovalToken,
  isApprovalToken,
  randomApprovalToken,
} from "./approval-token.js";

export const APPROVAL_TOKENS_TABLE = "approval_tokens";
export const LEAVE_REQUESTS_TABLE = "leave_requests";
export const EMPLOYEES_TABLE = "employees";
export const LEAVE_TYPES_TABLE = "leave_types";
export const DEPARTMENTS_TABLE = "departments";

export const APPROVAL_TOKEN_COLUMNS =
  "id,leave_request_id,approver_employee_id,token_hash,created_at,expires_at,used_at,invalidated_at,created_by";

export const APPROVAL_REQUEST_COLUMNS =
  "id,request_code,employee_id,approver_id,leave_type_id,other_type_detail,start_date,end_date,days,return_date,return_time,status,ot_option,shift_option_code,shift_end_override,reason,has_medical_certificate,created_at";

/** A request's open links all become invalid; a used row is left as history. */
export async function invalidateOpenApprovalTokens(db, leaveRequestId, nowIso) {
  return db.update(
    APPROVAL_TOKENS_TABLE,
    { invalidated_at: nowIso },
    [
      ["leave_request_id", "eq", leaveRequestId],
      ["used_at", "is", null],
      ["invalidated_at", "is", null],
    ]
  );
}

/**
 * Inserts one token row. The raw token is returned for the email job and is
 * never part of the row. `created_by` is the HR employee for a resend and null
 * for the first email.
 */
export async function createApprovalToken(
  db,
  { leaveRequestId, approverEmployeeId, createdBy = null, now = new Date() } = {}
) {
  if (typeof leaveRequestId !== "string" || leaveRequestId.length === 0) {
    return { ok: false, code: "missing_request" };
  }
  if (typeof approverEmployeeId !== "string" || approverEmployeeId.length === 0) {
    return { ok: false, code: "missing_approver" };
  }

  const createdAt = now instanceof Date ? now : new Date(now);
  const expiresAt = approvalTokenExpiresAt(createdAt);
  if (!expiresAt) return { ok: false, code: "invalid_time" };

  const rawToken = randomApprovalToken();
  const tokenHash = await hashApprovalToken(rawToken);

  const inserted = await db.insert(
    APPROVAL_TOKENS_TABLE,
    {
      leave_request_id: leaveRequestId,
      approver_employee_id: approverEmployeeId,
      token_hash: tokenHash,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt,
      used_at: null,
      invalidated_at: null,
      created_by: createdBy,
    },
    { returning: true, columns: "id" }
  );
  if (inserted.error) {
    return { ok: false, code: inserted.error.code ?? "insert_failed" };
  }

  const id = inserted.data?.id ?? null;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, code: "insert_failed" };
  }

  return { ok: true, id, rawToken, expiresAt };
}

/** The token row for a raw token, or null. Never logs or returns the raw value. */
export async function findApprovalToken(db, rawToken) {
  if (!isApprovalToken(rawToken)) return null;
  const tokenHash = await hashApprovalToken(rawToken);
  return db.select(APPROVAL_TOKENS_TABLE, {
    columns: APPROVAL_TOKEN_COLUMNS,
    filters: [["token_hash", "eq", tokenHash]],
    single: true,
  });
}

/**
 * True when the stored approver is still responsible for this request under the
 * shared scope rule: the named approver of the requester, or an approver of the
 * requester's current department. A deactivated approver row grants nothing.
 */
export async function approverIsResponsible(db, token, request) {
  const grants = await readApproverGrants(db, token.approver_employee_id);
  const requester = await db.select(EMPLOYEES_TABLE, {
    columns: "id,department_id",
    filters: [["id", "eq", request.employee_id]],
    single: true,
  });

  return canViewLeaveRequest({
    role: null,
    employeeId: token.approver_employee_id,
    grants,
    request,
    requesterDepartmentId: requester?.department_id ?? null,
  });
}

/**
 * Full validation for a page read or a decision. Any failure is one of the
 * three public categories; the caller never learns which check failed.
 */
export async function loadApprovalContext(db, rawToken, now = new Date()) {
  const token = await findApprovalToken(db, rawToken);
  if (!token) return { ok: false, category: "invalid" };

  const request = await db.select(LEAVE_REQUESTS_TABLE, {
    columns: APPROVAL_REQUEST_COLUMNS,
    filters: [["id", "eq", token.leave_request_id]],
    single: true,
  });

  const responsible =
    request === null ? false : await approverIsResponsible(db, token, request);

  const category = approvalTokenFailureCategory({
    token,
    request,
    now,
    approverResponsible: responsible,
  });
  if (category) return { ok: false, category };

  return { ok: true, token, request };
}

/** The public detail payload, matching the in-app approval detail fields. */
export async function loadApprovalDetail(db, token, request) {
  const [leaveType, requester] = await Promise.all([
    request.leave_type_id
      ? db.select(LEAVE_TYPES_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", request.leave_type_id]],
          single: true,
        })
      : null,
    db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,name_prefix,full_name,department_id",
      filters: [["id", "eq", request.employee_id]],
      single: true,
    }),
  ]);

  const department = requester?.department_id
    ? await db.select(DEPARTMENTS_TABLE, {
        columns: "id,name",
        filters: [["id", "eq", requester.department_id]],
        single: true,
      })
    : null;

  const days = Number(request.days);

  return {
    requestCode: request.request_code ?? null,
    employeeName: displayName(requester?.name_prefix, requester?.full_name) || null,
    employeeCode: requester?.employee_code ?? null,
    departmentName: department?.name ?? null,
    leaveTypeName: leaveType?.name ?? null,
    otherTypeDetail: request.other_type_detail ?? null,
    startDate: request.start_date ?? null,
    endDate: request.end_date ?? null,
    days: Number.isFinite(days) ? days : null,
    returnDate: request.return_date ?? null,
    returnTime: request.return_time ?? null,
    shiftCode: request.shift_option_code ?? null,
    shiftEndOverride: request.shift_end_override ?? null,
    otOption: request.ot_option ?? null,
    reason: request.reason ?? null,
    hasMedicalCertificate: request.has_medical_certificate === true,
    createdAt: request.created_at ?? null,
    expiresAt: token.expires_at ?? null,
  };
}

/**
 * Creates a token and the email job for it. Returns { ok: true, job,
 * expiresAt } or a fixed code. APP_PUBLIC_URL must be configured before a token
 * is written, so a link that cannot be built is never stored.
 */
export async function createApprovalLinkEmail({
  db,
  publicUrl,
  leaveRequestId,
  approverEmployeeId,
  createdBy = null,
  now = new Date(),
  to,
  employeeName,
  employeeCode = null,
  leaveTypeName = null,
  request,
}) {
  const base = approvalLinkBase(publicUrl);
  if (!base) return { ok: false, code: "config" };

  const recipient = typeof to === "string" ? to.trim() : "";
  if (recipient.length === 0) return { ok: false, code: "missing_recipient" };

  const issued = await createApprovalToken(db, {
    leaveRequestId,
    approverEmployeeId,
    createdBy,
    now,
  });
  if (issued.ok !== true) return issued;

  const link = buildApprovalLink(base, issued.rawToken);
  if (!link) return { ok: false, code: "config" };

  const job = buildApprovalEmailJob({
    tokenId: issued.id,
    to: recipient,
    employeeName,
    employeeCode,
    leaveTypeName,
    otherTypeDetail: request?.other_type_detail ?? null,
    startDate: request?.start_date ?? null,
    endDate: request?.end_date ?? null,
    days: request?.days ?? null,
    reason: request?.reason ?? null,
    link,
  });
  if (!job) return { ok: false, code: "invalid_message" };

  return { ok: true, tokenId: issued.id, expiresAt: issued.expiresAt, job };
}
