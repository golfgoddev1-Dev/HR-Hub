// The decision hook: after a leave is approved or rejected, queue one email per
// active shift lead in the requester's department, plus one report email to the
// employee. The employee report exists for both decisions; the rejection one
// carries the reason and no link.
//
// Rules kept here:
// - the hook only enqueues; a slow or unconfigured relay never reaches the
//   decision response, and every failure is swallowed after a fixed-code log;
// - the queue dedupes on (leave_request_id, recipient, kind, decision), so a
//   repeated hook for the same decision inserts nothing and sends nothing;
// - shift leads never get an approve/reject action, and no decision email ever
//   carries an approval link: the one optional link is the app's login page;
// - a rejection reaches the employee too, but without any link.

import { approvalLinkBase } from "./approval-token.js";
import {
  DECISION_EMAIL_KINDS,
  buildDecisionEmailMessage,
} from "./email/decision-email.js";
import {
  DECISION_EMAIL_JOBS_TABLE,
  dispatchDecisionEmails,
  enqueueDecisionEmails,
} from "./email/decision-queue.js";
import { displayName } from "./leave-calendar.js";
import { SHIFT_LEADS_TABLE } from "./shift-leads.js";

const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const LEAVE_TYPES_TABLE = "leave_types";

const REQUEST_COLUMNS =
  "id,request_code,employee_id,approver_id,leave_type_id,other_type_detail,start_date,end_date,days,return_date,return_time,status,ot_option,shift_option_code,reason,has_medical_certificate,decision_note,decided_at";

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** The app login link, or null when APP_PUBLIC_URL is missing or unusable. */
export function decisionEmailLink(publicUrl) {
  const base = approvalLinkBase(publicUrl);
  return base ? `${base}/login` : null;
}

function jobKey(job) {
  // The in-memory job uses camelCase; an inserted row uses snake_case.
  const requestId = job.leaveRequestId ?? job.leave_request_id;
  const recipientId = job.recipientEmployeeId ?? job.recipient_employee_id;
  return `${requestId}|${recipientId}|${job.kind}|${job.decision}`;
}

/** The message for one row, rebuilt from the request and its people. */
function messageFor({ row, kind, decision, request, requester, departmentName, leaveTypeName, approverName, link }) {
  const input = {
    kind,
    decision,
    requestCode: request.request_code ?? null,
    employeeName: displayName(requester?.name_prefix, requester?.full_name),
    employeeCode: requester?.employee_code ?? null,
    departmentName,
    leaveTypeName,
    otherTypeDetail: request.other_type_detail ?? null,
    startDate: request.start_date ?? null,
    endDate: request.end_date ?? null,
    days: request.days ?? null,
    returnDate: request.return_date ?? null,
    returnTime: request.return_time ?? null,
    shiftCode: request.shift_option_code ?? null,
    otOption: request.ot_option ?? null,
    reason: request.reason ?? null,
    hasMedicalCertificate: request.has_medical_certificate === true,
    decidedAt: request.decided_at ?? null,
    decisionNote: request.decision_note ?? null,
    approverName,
    link,
  };

  const message = buildDecisionEmailMessage(input);
  if (!message) return null;
  return {
    row,
    message: {
      to: row.recipient_email,
      subject: message.subject,
      text: message.text,
    },
  };
}

/**
 * Reads the request, its department and the active shift leads, inserts the
 * deduped jobs, and hands delivery to the request's background task.
 */
export async function notifyLeaveDecision(env, db, ctx, { leaveRequestId, decision } = {}) {
  if (typeof leaveRequestId !== "string" || leaveRequestId.length === 0) {
    return { ok: false, code: "missing_request" };
  }
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, code: "invalid_decision" };
  }

  const request = await db.select("leave_requests", {
    columns: REQUEST_COLUMNS,
    filters: [["id", "eq", leaveRequestId]],
    single: true,
  });
  if (!request) return { ok: false, code: "request_not_found" };
  if (request.status !== decision) return { ok: false, code: "not_decided" };

  const requester = await db.select(EMPLOYEES_TABLE, {
    columns: "id,employee_code,name_prefix,full_name,email,department_id,is_active",
    filters: [["id", "eq", request.employee_id]],
    single: true,
  });
  if (!requester) return { ok: false, code: "requester_not_found" };

  const [department, leaveType, approver, shiftLeadRows] = await Promise.all([
    requester.department_id
      ? db.select(DEPARTMENTS_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", requester.department_id]],
          single: true,
        })
      : null,
    request.leave_type_id
      ? db.select(LEAVE_TYPES_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", request.leave_type_id]],
          single: true,
        })
      : null,
    request.approver_id
      ? db.select(EMPLOYEES_TABLE, {
          columns: "id,name_prefix,full_name",
          filters: [["id", "eq", request.approver_id]],
          single: true,
        })
      : null,
    requester.department_id
      ? db.select(SHIFT_LEADS_TABLE, {
          columns: "id,employee_id,shift_label",
          filters: [["department_id", "eq", requester.department_id]],
          order: "created_at.asc",
        })
      : [],
  ]);

  const leadIds = (Array.isArray(shiftLeadRows) ? shiftLeadRows : [])
    .map((row) => row.employee_id)
    .filter((id) => typeof id === "string" && id.length > 0);
  const leadPeople =
    leadIds.length > 0
      ? await db.select(EMPLOYEES_TABLE, {
          columns: "id,employee_code,name_prefix,full_name,email,is_active",
          filters: [["id", "in", [...new Set(leadIds)]]],
        })
      : [];
  const leadById = new Map((leadPeople ?? []).map((person) => [person.id, person]));

  const link = decisionEmailLink(env?.APP_PUBLIC_URL);
  const base = {
    decision,
    request,
    requester,
    departmentName: department?.name ?? null,
    leaveTypeName: leaveType?.name ?? null,
    approverName: displayName(approver?.name_prefix, approver?.full_name) || null,
    link,
  };

  const jobs = [];
  const kind = decision === "approved"
    ? DECISION_EMAIL_KINDS.SHIFT_APPROVED
    : DECISION_EMAIL_KINDS.SHIFT_REJECTED;

  for (const row of Array.isArray(shiftLeadRows) ? shiftLeadRows : []) {
    const person = leadById.get(row.employee_id);
    // Only an active person with an address can be notified.
    if (!person || person.is_active !== true) continue;
    const email = textOf(person.email);
    if (email.length === 0) continue;
    jobs.push({
      leaveRequestId: request.id,
      recipientEmployeeId: person.id,
      kind,
      decision,
      recipient_email: email,
    });
  }

  // The employee hears about both decisions; the rejection report carries the
  // reason and has no link.
  if (requester.is_active === true) {
    const email = textOf(requester.email);
    if (email.length > 0) {
      jobs.push({
        leaveRequestId: request.id,
        recipientEmployeeId: requester.id,
        kind:
          decision === "approved"
            ? DECISION_EMAIL_KINDS.EMPLOYEE_APPROVED
            : DECISION_EMAIL_KINDS.EMPLOYEE_REJECTED,
        decision,
        recipient_email: email,
      });
    }
  }

  if (jobs.length === 0) return { ok: true, queued: 0, sent: 0 };

  const inserted = await enqueueDecisionEmails(db, jobs);
  if (inserted.ok !== true) return { ok: false, code: inserted.code };
  if (inserted.data.length === 0) return { ok: true, queued: 0, sent: 0, duplicate: true };

  const byKey = new Map(jobs.map((job) => [jobKey(job), job]));
  const entries = [];
  for (const row of inserted.data) {
    const job = byKey.get(
      `${row.leave_request_id}|${row.recipient_employee_id}|${row.kind}|${row.decision}`
    );
    if (!job) continue;
    const entry = messageFor({
      row: { ...row, recipient_email: job.recipient_email },
      kind: row.kind,
      decision: row.decision,
      ...base,
    });
    if (entry) entries.push(entry);
  }

  await dispatchDecisionEmails(env, ctx, db, entries);
  return { ok: true, queued: inserted.data.length, sent: entries.length };
}

/**
 * The hook the decision routes call. It never throws, never changes a response
 * and never waits for the relay: a failure here is one fixed-code log line.
 */
export async function notifyLeaveDecisionSafely(env, db, ctx, options) {
  try {
    return await notifyLeaveDecision(env, db, ctx, options);
  } catch (error) {
    console.error("[decision-notify]", {
      name: error?.name ?? "Error",
      code: error?.code ?? null,
    });
    return { ok: false, code: "notify_failed" };
  }
}

/** Exposed for the tests that assert the table name in one place. */
export { DECISION_EMAIL_JOBS_TABLE };
