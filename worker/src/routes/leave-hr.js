// HR leave routes, phase 2. Mounted at /api/leave/hr by src/app.js.
//
// Rules kept here:
// - role hr is not enough: membership in hr_admins is re-read on every request;
// - HR never changes the status of a decided request (no approve/reject here);
// - a backdated entry is status 'approved' with decided_at = now, entered_by_id
//   = the logged-in HR employee, and the approver HR picked (never the queue);
// - the calculation comes from src/leave-rules.js, so an HR entry and an employee
//   submission produce identical days/return date/shift end;
// - an approver row is never deleted, only deactivated, so a pending request
//   keeps pointing at a real row;
// - every write adds one audit_logs row.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { isMissingTableError } from "../pg-errors.js";
import {
  HOLIDAYS_TABLE,
  HOLIDAY_DATE_COLUMN,
  HOLIDAYS_UNAVAILABLE,
  holidaySetOf,
  readHolidays,
} from "../leave-holidays.js";
import {
  DEPARTMENT_APPROVERS_TABLE,
  EMPLOYEE_APPROVERS_TABLE,
  approverDeactivation,
  approverReactivation,
  isApproverOfEmployee,
  normalizePriority,
} from "../leave-approvers.js";
import { findOverlappingRequest } from "../leave-overlap.js";
import {
  DEFAULT_CERTIFICATE_RETENTION_DAYS,
  MAX_CERTIFICATE_RETENTION_DAYS,
  MIN_CERTIFICATE_RETENTION_DAYS,
  SETTINGS_ROW_ID,
  SETTINGS_TABLE,
  normalizeRetentionDays,
  readLeaveSettings,
} from "../leave-settings.js";
import { buildBackdatedRow } from "../leave-backdated.js";
import { dispatchQueuedNotifications, enqueueNotificationSafely } from "../push/queue.js";
import { NOTIFICATION_KINDS } from "../push/payload.js";
import { MESSAGES, isDateString, isOtherType } from "../leave-rules.js";
import { insertWithRequestCode } from "../leave-request-code.js";
import { createApprovalLinkEmail, invalidateOpenApprovalTokens } from "../approval-link.js";
import { displayName } from "../leave-calendar.js";
import { dispatchApprovalEmails } from "../email/approval-queue.js";

const leaveHr = new Hono();

const ROLE = "hr";
const HR_ADMINS_TABLE = "hr_admins";
const LEAVE_REQUESTS_TABLE = "leave_requests";
const LEAVE_TYPES_TABLE = "leave_types";
const SHIFTS_TABLE = "shift_options";
const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const AUDIT_TABLE = "audit_logs";

const STATUSES = ["pending", "approved", "rejected", "cancelled"];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_SCAN_ROWS = 1000;
const IN_CHUNK = 100;
const MAX_BODY_BYTES = 16 * 1024;
const HOLIDAY_NAME_MAX_LENGTH = 100;
const APPROVER_LIST_LIMIT = 200;

const ACTION_BACKDATED = "leave_backdated_created";
const ACTION_APPROVAL_LINK_RESENT = "leave_approval_link_resent";
const ACTION_APPROVER_ADDED = "leave_approver_added";
const ACTION_APPROVER_DEACTIVATED = "leave_approver_deactivated";
const ACTION_APPROVER_REACTIVATED = "leave_approver_reactivated";
const ACTION_HOLIDAY_ADDED = "leave_holiday_added";
const ACTION_HOLIDAY_DELETED = "leave_holiday_deleted";
const ACTION_SETTINGS_UPDATED = "leave_settings_updated";

const ENTITY_REQUEST = "leave_request";
const ENTITY_APPROVER = "leave_approver";
const ENTITY_HOLIDAY = "holiday";
const ENTITY_SETTINGS = "leave_settings";

const REQUEST_COLUMNS =
  "id,request_code,employee_id,leave_type_id,other_type_detail,start_date,end_date,days,return_date,return_time,status,ot_option,shift_option_code,shift_end_override,reason,has_medical_certificate,medical_certificate_url,decision_note,decided_at,approver_id,source,entered_by_id,created_at";

const BACKDATED_KEYS = [
  "employeeId",
  "leaveTypeId",
  "shiftCode",
  "startDate",
  "endDate",
  "otOption",
  "otherTypeDetail",
  "reason",
  "hasMedicalCertificate",
  "approverId",
];

const MESSAGE = {
  invalid: "ข้อมูลไม่ถูกต้อง",
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  requestNotFound: "ไม่พบใบลานี้",
  alreadyDecided: "ใบลานี้ถูกดำเนินการแล้ว",
  approverEmailMissing: "ผู้อนุมัติยังไม่มีอีเมลในระบบ กรุณาเพิ่มอีเมลก่อนส่งลิงก์",
  duplicateCode: "รหัสใบลาซ้ำ กรุณาบันทึกใหม่",
  approverNotFound: "ไม่พบผู้อนุมัติที่เลือก",
  approverNotEligible: "ผู้อนุมัติที่เลือกไม่ได้เป็นผู้อนุมัติของพนักงานคนนี้",
  approverRowNotFound: "ไม่พบรายการผู้อนุมัตินี้",
  approverDuplicate: "มีรายการผู้อนุมัตินี้อยู่แล้ว",
  departmentNotFound: "ไม่พบแผนกที่เลือก",
  holidayDuplicate: "วันหยุดวันที่นี้มีอยู่แล้ว",
  holidayNotFound: "ไม่พบวันหยุดนี้",
  holidayNotInstalled: "ยังไม่มีตาราง holidays กรุณารันไฟล์ SQL ก่อน",
  settingsNotInstalled: "ยังไม่ได้ติดตั้งตารางตั้งค่า (leave_settings) กรุณารันไฟล์ SQL ก่อน",
  settingsInvalid: `จำนวนวันเก็บไฟล์ต้องอยู่ระหว่าง ${MIN_CERTIFICATE_RETENTION_DAYS} ถึง ${MAX_CERTIFICATE_RETENTION_DAYS} วัน`,
  scopeInvalid: "ต้องระบุขอบเขตเป็น department หรือ employee",
};

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

leaveHr.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isDate(value) {
  return typeof value === "string" && DATE_PATTERN.test(value);
}

function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

function ensureOk(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}

/** Sends the just-queued push after the response; cron retries a failure. */
function dispatchQueued(c, queued, now) {
  const ids = queued?.ok === true && typeof queued.id === "string" ? [queued.id] : [];
  if (ids.length === 0) return false;

  let ctx = null;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = null;
  }
  return dispatchQueuedNotifications(c.env, ctx, ids, now);
}

/** The request's ExecutionContext, or null when the runtime has none. */
function requestContext(c) {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

async function readStrictJson(c) {
  if (!isJsonContentType(c.req.header("Content-Type"))) return null;

  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;

  let text;
  try {
    text = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  if (text.trim().length === 0) return {};

  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function invalidBody(c) {
  return c.json({ ok: false, message: MESSAGE.invalid }, 400);
}

function chunkOf(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

function positiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

/** Role check plus a fresh hr_admins read; both must pass. */
async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) {
    return { response: c.json({ ok: false, message: auth.message }, auth.status) };
  }

  try {
    const db = createDb(c.env);
    const member = await db.select(HR_ADMINS_TABLE, {
      columns: "employee_id",
      filters: [["employee_id", "eq", auth.session.employeeId]],
      single: true,
    });
    if (!member) {
      return { response: c.json({ ok: false, message: MESSAGE.forbidden }, 403) };
    }

    c.set("hrLeaveDb", db);
    c.set("hrLeaveSession", auth.session);
    return null;
  } catch (error) {
    logError("hr leave guard failed", error);
    return { response: c.json({ ok: false, message: MESSAGE.saveError }, 500) };
  }
}

async function writeAudit(db, { actorId, action, entity, entityId = null, detail }) {
  ensureOk(
    await db.insert(AUDIT_TABLE, {
      actor_id: actorId,
      action,
      entity,
      entity_id: entityId,
      detail: JSON.stringify(detail ?? {}),
    })
  );
}

async function loadPeople(db, ids) {
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  const map = new Map();
  for (const chunk of chunkOf(unique, IN_CHUNK)) {
    const rows = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,name_prefix,full_name,department_id,is_active",
      filters: [["id", "in", chunk]],
    });
    for (const row of rows) map.set(row.id, row);
  }
  return map;
}

async function loadDepartments(db, ids) {
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  const map = new Map();
  for (const chunk of chunkOf(unique, IN_CHUNK)) {
    const rows = await db.select(DEPARTMENTS_TABLE, {
      columns: "id,name",
      filters: [["id", "in", chunk]],
    });
    for (const row of rows) map.set(row.id, row.name ?? null);
  }
  return map;
}

async function loadTypes(db) {
  const rows = await db.select(LEAVE_TYPES_TABLE, { columns: "id,name,is_active" });
  const map = new Map();
  for (const row of rows) map.set(row.id, row);
  return map;
}

/** Pending requests per approver, in one query per 100 ids. */
async function pendingCounts(db, approverIds) {
  const unique = [...new Set((approverIds ?? []).filter(Boolean))];
  const counts = new Map();
  for (const chunk of chunkOf(unique, IN_CHUNK)) {
    const rows = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: "approver_id",
      filters: [
        ["status", "eq", "pending"],
        ["approver_id", "in", chunk],
      ],
    });
    for (const row of rows) {
      counts.set(row.approver_id, (counts.get(row.approver_id) ?? 0) + 1);
    }
  }
  return counts;
}

function personOf(person) {
  if (!person) return null;
  return {
    id: person.id ?? null,
    employeeCode: person.employee_code ?? null,
    namePrefix: person.name_prefix ?? null,
    fullName: person.full_name ?? null,
    departmentId: person.department_id ?? null,
    isActive: person.is_active === true,
  };
}

async function employeeIdsOfDepartment(db, departmentId) {
  const rows = await db.select(EMPLOYEES_TABLE, {
    columns: "id",
    filters: [["department_id", "eq", departmentId]],
  });
  return rows.map((row) => row.id).filter(Boolean);
}

/**
 * One page of requests. Without a department filter the page comes straight from
 * the database (limit + 1 to detect another page). With a department filter the
 * matching employee ids are resolved first, so rows are scanned up to
 * MAX_SCAN_ROWS and then sliced; that cap is reported as `scanCapped`.
 */
async function fetchRequestsPage(db, { filters, departmentId, page, pageSize }) {
  const offset = (page - 1) * pageSize;

  if (!departmentId) {
    const rows = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: REQUEST_COLUMNS,
      filters,
      order: "created_at.desc",
      limit: pageSize + 1,
      extra: [`offset=${offset}`],
    });
    return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, scanCapped: false };
  }

  const employeeIds = await employeeIdsOfDepartment(db, departmentId);
  if (employeeIds.length === 0) return { rows: [], hasMore: false, scanCapped: false };

  const collected = [];
  let scanCapped = false;
  for (const chunk of chunkOf(employeeIds, IN_CHUNK)) {
    const rows = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: REQUEST_COLUMNS,
      filters: [...filters, ["employee_id", "in", chunk]],
      order: "created_at.desc",
      limit: MAX_SCAN_ROWS,
    });
    collected.push(...rows);
    if (collected.length >= MAX_SCAN_ROWS) {
      scanCapped = true;
      break;
    }
  }

  collected.sort((left, right) =>
    String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""))
  );

  return {
    rows: collected.slice(offset, offset + pageSize),
    hasMore: collected.length > offset + pageSize,
    scanCapped,
  };
}

function publicRequest(row, { types, people, departments }) {
  const type = types.get(row.leave_type_id) ?? null;
  const requester = people.get(row.employee_id) ?? null;
  const approver = people.get(row.approver_id) ?? null;
  return {
    id: row.id,
    requestCode: row.request_code ?? null,
    leaveTypeId: row.leave_type_id ?? null,
    leaveTypeName: type?.name ?? null,
    otherTypeDetail: row.other_type_detail ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    days: row.days === null || row.days === undefined ? null : Number(row.days),
    returnDate: row.return_date ?? null,
    returnTime: row.return_time ?? null,
    shiftCode: row.shift_option_code ?? null,
    shiftEndOverride: row.shift_end_override ?? null,
    otOption: row.ot_option ?? null,
    reason: row.reason ?? null,
    hasMedicalCertificate: row.has_medical_certificate === true,
    attachmentPath: row.medical_certificate_url ?? null,
    status: row.status ?? null,
    decisionNote: row.decision_note ?? null,
    decidedAt: row.decided_at ?? null,
    createdAt: row.created_at ?? null,
    source: row.source ?? null,
    enteredById: row.entered_by_id ?? null,
    requester: personOf(requester),
    departmentName: requester?.department_id
      ? departments.get(requester.department_id) ?? null
      : null,
    approver: personOf(approver),
  };
}

// --- GET /api/leave/hr/requests ---------------------------------------------

leaveHr.get("/requests", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const url = new URL(c.req.raw.url);
  const status = url.searchParams.get("status");
  const departmentId = url.searchParams.get("departmentId");
  const leaveTypeId = url.searchParams.get("leaveTypeId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const page = positiveInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(positiveInt(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  if (status !== null && !STATUSES.includes(status)) return invalidBody(c);
  if (departmentId !== null && departmentId !== "" && !isUuid(departmentId)) return invalidBody(c);
  if (leaveTypeId !== null && leaveTypeId !== "" && !isUuid(leaveTypeId)) return invalidBody(c);
  if (from !== null && from !== "" && !isDate(from)) return invalidBody(c);
  if (to !== null && to !== "" && !isDate(to)) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");

    // Interval overlap: the request starts before the end of the window and ends
    // after its start.
    const filters = [];
    if (status) filters.push(["status", "eq", status]);
    if (leaveTypeId) filters.push(["leave_type_id", "eq", leaveTypeId]);
    if (from) filters.push(["end_date", "gte", from]);
    if (to) filters.push(["start_date", "lte", to]);

    const pageResult = await fetchRequestsPage(db, {
      filters,
      departmentId: departmentId || null,
      page,
      pageSize,
    });

    const types = await loadTypes(db);
    const people = await loadPeople(db, [
      ...pageResult.rows.map((row) => row.employee_id),
      ...pageResult.rows.map((row) => row.approver_id),
    ]);
    const departments = await loadDepartments(
      db,
      pageResult.rows.map((row) => people.get(row.employee_id)?.department_id)
    );

    const results = pageResult.rows.map((row) => publicRequest(row, { types, people, departments }));

    return c.json(
      {
        ok: true,
        page,
        pageSize,
        hasMore: pageResult.hasMore,
        scanCapped: pageResult.scanCapped,
        count: results.length,
        results,
      },
      200
    );
  } catch (error) {
    logError("hr leave list failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/hr/requests/:id -----------------------------------------

leaveHr.get("/requests/:id", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");
    const row = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: REQUEST_COLUMNS,
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!row) return c.json({ ok: false, message: MESSAGE.requestNotFound }, 404);

    const [types, people] = await Promise.all([
      loadTypes(db),
      loadPeople(db, [row.employee_id, row.approver_id, row.entered_by_id]),
    ]);
    const departments = await loadDepartments(
      db,
      [...people.values()].map((person) => person.department_id)
    );

    const request = publicRequest(row, { types, people, departments });
    request.enteredBy = personOf(people.get(row.entered_by_id) ?? null);

    // The printable form shows the shift name with its times; only this detail
    // read pays for the extra lookup, the list stays as it was.
    request.shift = null;
    if (typeof row.shift_option_code === "string" && row.shift_option_code.length > 0) {
      const shift = await db.select(SHIFTS_TABLE, {
        columns: "code,label,time_from,time_to",
        filters: [["code", "eq", row.shift_option_code]],
        single: true,
      });
      if (shift) {
        request.shift = {
          code: shift.code ?? null,
          label: shift.label ?? null,
          timeFrom: shift.time_from ?? null,
          timeTo: shift.time_to ?? null,
        };
      }
    }

    return c.json({ ok: true, request }, 200);
  } catch (error) {
    logError("hr leave detail failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/leave/hr/requests/:id/approval-link (resend) ------------------
// HR replaces every open link for a pending request with one new 72-hour link,
// then queues the email. The audit row names the channel and the request code
// only: no token, no reason and no name.

leaveHr.post("/requests/:id/approval-link", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");

    const row = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: REQUEST_COLUMNS,
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!row) return c.json({ ok: false, message: MESSAGE.requestNotFound }, 404);
    if (row.status !== "pending") {
      return c.json({ ok: false, message: MESSAGE.alreadyDecided }, 409);
    }
    if (!isUuid(row.approver_id)) {
      return c.json({ ok: false, message: MESSAGE.approverNotFound }, 409);
    }

    const [approver, requester, leaveType] = await Promise.all([
      db.select(EMPLOYEES_TABLE, {
        columns: "id,email,is_active",
        filters: [["id", "eq", row.approver_id]],
        single: true,
      }),
      db.select(EMPLOYEES_TABLE, {
        columns: "id,employee_code,name_prefix,full_name",
        filters: [["id", "eq", row.employee_id]],
        single: true,
      }),
      row.leave_type_id
        ? db.select(LEAVE_TYPES_TABLE, {
            columns: "id,name",
            filters: [["id", "eq", row.leave_type_id]],
            single: true,
          })
        : null,
    ]);

    if (!approver || approver.is_active !== true) {
      return c.json({ ok: false, message: MESSAGE.approverNotFound }, 409);
    }
    const approverEmail = typeof approver.email === "string" ? approver.email.trim() : "";
    if (approverEmail.length === 0) {
      return c.json({ ok: false, message: MESSAGE.approverEmailMissing }, 409);
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const invalidated = await invalidateOpenApprovalTokens(db, id, nowIso);
    if (invalidated.error) {
      throw Object.assign(new Error("approval token invalidate failed"), {
        code: invalidated.error.code,
      });
    }

    const issued = await createApprovalLinkEmail({
      db,
      publicUrl: c.env.APP_PUBLIC_URL,
      leaveRequestId: id,
      approverEmployeeId: row.approver_id,
      createdBy: session.employeeId,
      now,
      to: approverEmail,
      employeeName: displayName(requester?.name_prefix, requester?.full_name) || "",
      employeeCode: requester?.employee_code ?? null,
      leaveTypeName: leaveType?.name ?? "",
      request: row,
    });
    if (issued.ok !== true) {
      console.error("[approval-link-resend]", { code: issued.code });
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_APPROVAL_LINK_RESENT,
      entity: ENTITY_REQUEST,
      entityId: id,
      detail: { channel: "email_resend", requestCode: row.request_code ?? null },
    });

    await dispatchApprovalEmails(c.env, requestContext(c), [issued.job]);

    return c.json({ ok: true, expiresAt: issued.expiresAt }, 200);
  } catch (error) {
    logError("hr approval link resend failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/leave/hr/requests (backdated entry) ---------------------------

leaveHr.post("/requests", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, BACKDATED_KEYS)) return invalidBody(c);
  if (!isUuid(body.employeeId) || !isUuid(body.leaveTypeId) || !isUuid(body.approverId)) {
    return invalidBody(c);
  }
  if (
    typeof body.shiftCode !== "string" ||
    body.shiftCode.length === 0 ||
    body.shiftCode.length > 40
  ) {
    return invalidBody(c);
  }
  // The checkbox is the only certificate input a backdated entry accepts.
  if (body.hasMedicalCertificate !== undefined && typeof body.hasMedicalCertificate !== "boolean") {
    return invalidBody(c);
  }

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");

    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,name_prefix,full_name,department_id,is_active",
      filters: [["id", "eq", body.employeeId]],
      single: true,
    });
    if (!employee) return c.json({ ok: false, message: MESSAGES.employeeRequired }, 404);
    if (employee.is_active !== true) {
      return c.json({ ok: false, message: MESSAGES.employeeInactive }, 400);
    }

    const leaveType = await db.select(LEAVE_TYPES_TABLE, {
      columns: "id,name,requires_attachment,is_active,attachment_required_from_days",
      filters: [["id", "eq", body.leaveTypeId]],
      single: true,
    });
    if (!leaveType || leaveType.is_active === false) {
      return c.json({ ok: false, message: MESSAGES.typeUnknown }, 400);
    }

    const shift = await db.select(SHIFTS_TABLE, {
      columns: "code,label,is_half",
      filters: [["code", "eq", body.shiftCode]],
      single: true,
    });
    if (!shift) return c.json({ ok: false, message: MESSAGES.shiftUnknown }, 400);

    const approver = await db.select(EMPLOYEES_TABLE, {
      columns: "id,is_active",
      filters: [["id", "eq", body.approverId]],
      single: true,
    });
    if (!approver || approver.is_active !== true) {
      return c.json({ ok: false, message: MESSAGE.approverNotFound }, 400);
    }

    // Holidays are mandatory: a failed read refuses the entry instead of
    // producing a wrong day count.
    let holidays;
    try {
      holidays = await readHolidays(db);
    } catch (error) {
      logError("hr backdated holidays read failed", error);
      return c.json({ ok: false, message: HOLIDAYS_UNAVAILABLE }, 503);
    }

    const now = new Date();

    const built = buildBackdatedRow({
      input: body,
      employee,
      leaveType,
      shift,
      approverId: approver.id,
      enteredById: session.employeeId,
      holidays: holidaySetOf(holidays.dates),
      now,
      // Replaced with the sequenced code at insert time.
      requestCode: "LV-00000000-000",
    });
    if (built.ok !== true) return c.json({ ok: false, message: built.message }, 400);

    // HR can only backdate with someone who really approves this employee.
    if (!(await isApproverOfEmployee(db, employee, approver.id))) {
      return c.json({ ok: false, message: MESSAGE.approverNotEligible }, 422);
    }

    // A pending or approved request in the same range is a collision; rejected
    // and cancelled rows never block. The response names the blocking request.
    const candidates = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: "id,request_code,start_date,end_date,status",
      filters: [
        ["employee_id", "eq", employee.id],
        ["status", "in", ["pending", "approved"]],
        ["end_date", "gte", built.row.start_date],
        ["start_date", "lte", built.row.end_date],
      ],
      order: "start_date.asc",
      limit: 20,
    });

    const overlap = findOverlappingRequest(candidates, {
      startDate: built.row.start_date,
      endDate: built.row.end_date,
    });
    if (overlap) {
      return c.json(
        {
          ok: false,
          message: `ช่วงวันที่ทับกับใบลา ${overlap.requestCode ?? "(ไม่ทราบรหัส)"}`,
          conflictRequestCode: overlap.requestCode,
          conflictStatus: overlap.status,
        },
        409
      );
    }

    const saved = await insertWithRequestCode(
      db,
      (requestCode) => ({ ...built.row, request_code: requestCode }),
      { now }
    );
    if (saved.ok !== true) {
      if (saved.duplicate) return c.json({ ok: false, message: MESSAGE.duplicateCode }, 409);
      throw Object.assign(new Error("backdated insert failed"), { code: saved.error?.code });
    }

    const row = saved.row;
    const inserted = saved.inserted;

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_BACKDATED,
      entity: ENTITY_REQUEST,
      entityId: inserted.data?.id ?? null,
      detail: {
        requestCode: row.request_code,
        employeeCode: employee.employee_code ?? null,
        leaveType: leaveType.name ?? null,
        days: row.days,
        shift: row.shift_option_code,
        source: row.source,
        holidayCount: holidays.dates.length,
      },
    });

    const queued = await enqueueNotificationSafely(db, {
      employeeId: employee.id,
      leaveRequestId: inserted.data?.id ?? null,
      kind: NOTIFICATION_KINDS.BACKDATED,
    });
    await dispatchQueued(c, queued, now);

    return c.json(
      {
        ok: true,
        request: {
          id: inserted.data?.id ?? null,
          requestCode: row.request_code,
          employeeId: employee.id,
          leaveTypeName: leaveType.name ?? null,
          startDate: row.start_date,
          endDate: row.end_date,
          days: row.days,
          returnDate: row.return_date,
          returnTime: row.return_time,
          shiftCode: row.shift_option_code,
          shiftEndOverride: row.shift_end_override,
          otOption: row.ot_option,
          hasMedicalCertificate: row.has_medical_certificate === true,
          approverId: row.approver_id,
          status: row.status,
          source: row.source,
          decidedAt: row.decided_at,
        },
      },
      201
    );
  } catch (error) {
    logError("hr backdated failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/hr/approvers --------------------------------------------

function scopeOf(raw) {
  if (raw === "employee") return "employee";
  if (raw === "department") return "department";
  return null;
}

leaveHr.get("/approvers", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const url = new URL(c.req.raw.url);
  const scope = scopeOf(url.searchParams.get("scope") ?? "department");
  if (!scope) return c.json({ ok: false, message: MESSAGE.scopeInvalid }, 400);

  const departmentId = url.searchParams.get("departmentId");
  if (departmentId !== null && departmentId !== "" && !isUuid(departmentId)) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");

    if (scope === "department") {
      const filters = [];
      if (departmentId) filters.push(["department_id", "eq", departmentId]);
      const rows = await db.select(DEPARTMENT_APPROVERS_TABLE, {
        columns: "id,department_id,employee_id,priority,is_active",
        filters,
        order: "priority.asc",
        limit: APPROVER_LIST_LIMIT,
      });

      const [people, departments, counts] = await Promise.all([
        loadPeople(db, rows.map((row) => row.employee_id)),
        loadDepartments(db, rows.map((row) => row.department_id)),
        pendingCounts(db, rows.map((row) => row.employee_id)),
      ]);

      const results = rows.map((row) => ({
        id: row.id ?? null,
        scope: "department",
        departmentId: row.department_id ?? null,
        departmentName: row.department_id ? departments.get(row.department_id) ?? null : null,
        employeeId: row.employee_id ?? null,
        employeeName: people.get(row.employee_id)?.full_name ?? null,
        priority: Number(row.priority),
        isActive: row.is_active !== false,
        pendingCount: counts.get(row.employee_id) ?? 0,
      }));

      return c.json({ ok: true, scope, count: results.length, results }, 200);
    }

    const rows = await db.select(EMPLOYEE_APPROVERS_TABLE, {
      columns: "id,employee_id,approver_id,priority,is_active",
      order: "priority.asc",
      limit: APPROVER_LIST_LIMIT,
    });

    const [people, counts] = await Promise.all([
      loadPeople(db, [...rows.map((row) => row.employee_id), ...rows.map((row) => row.approver_id)]),
      pendingCounts(db, rows.map((row) => row.approver_id)),
    ]);

    const results = rows.map((row) => ({
      id: row.id ?? null,
      scope: "employee",
      employeeId: row.employee_id ?? null,
      employeeName: people.get(row.employee_id)?.full_name ?? null,
      approverId: row.approver_id ?? null,
      approverName: people.get(row.approver_id)?.full_name ?? null,
      priority: Number(row.priority),
      isActive: row.is_active !== false,
      pendingCount: counts.get(row.approver_id) ?? 0,
    }));

    return c.json({ ok: true, scope, count: results.length, results }, 200);
  } catch (error) {
    logError("hr approver list failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/leave/hr/approvers -------------------------------------------

leaveHr.post("/approvers", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, ["scope", "departmentId", "employeeId", "applicantId", "priority"])) {
    return invalidBody(c);
  }

  const scope = scopeOf(body.scope);
  if (!scope) return c.json({ ok: false, message: MESSAGE.scopeInvalid }, 400);
  if (!isUuid(body.employeeId)) return invalidBody(c);

  const priority = normalizePriority(body.priority);
  if (priority === null) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");

    const approver = await db.select(EMPLOYEES_TABLE, {
      columns: "id,full_name,is_active",
      filters: [["id", "eq", body.employeeId]],
      single: true,
    });
    if (!approver || approver.is_active !== true) {
      return c.json({ ok: false, message: MESSAGE.approverNotFound }, 400);
    }

    let table;
    let row;

    if (scope === "department") {
      if (!isUuid(body.departmentId)) return invalidBody(c);
      const department = await db.select(DEPARTMENTS_TABLE, {
        columns: "id,name",
        filters: [["id", "eq", body.departmentId]],
        single: true,
      });
      if (!department) return c.json({ ok: false, message: MESSAGE.departmentNotFound }, 400);

      table = DEPARTMENT_APPROVERS_TABLE;
      row = {
        department_id: department.id,
        employee_id: approver.id,
        priority,
        is_active: true,
      };
    } else {
      if (!isUuid(body.applicantId)) return invalidBody(c);
      if (body.applicantId === approver.id) {
        return c.json({ ok: false, message: MESSAGES.selfApproval }, 400);
      }
      const applicant = await db.select(EMPLOYEES_TABLE, {
        columns: "id,full_name,is_active",
        filters: [["id", "eq", body.applicantId]],
        single: true,
      });
      if (!applicant) return c.json({ ok: false, message: MESSAGES.employeeRequired }, 404);

      table = EMPLOYEE_APPROVERS_TABLE;
      row = {
        employee_id: applicant.id,
        approver_id: approver.id,
        priority,
        is_active: true,
      };
    }

    const inserted = await db.insert(table, row, { returning: true });
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        return c.json({ ok: false, message: MESSAGE.approverDuplicate }, 409);
      }
      throw Object.assign(new Error("approver insert failed"), { code: inserted.error.code });
    }

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_APPROVER_ADDED,
      entity: ENTITY_APPROVER,
      entityId: inserted.data?.id ?? null,
      detail: { scope, ...row, approverName: approver.full_name ?? null },
    });

    return c.json({ ok: true, scope, id: inserted.data?.id ?? null, item: row }, 201);
  } catch (error) {
    logError("hr approver create failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/leave/hr/approvers/:id/deactivate ----------------------------

leaveHr.post("/approvers/:id/deactivate", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  const scope = scopeOf(new URL(c.req.raw.url).searchParams.get("scope") ?? "department");
  if (!scope) return c.json({ ok: false, message: MESSAGE.scopeInvalid }, 400);

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");
    const table = scope === "employee" ? EMPLOYEE_APPROVERS_TABLE : DEPARTMENT_APPROVERS_TABLE;

    const row = await db.select(table, {
      columns:
        scope === "employee"
          ? "id,employee_id,approver_id,priority,is_active"
          : "id,department_id,employee_id,priority,is_active",
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!row) return c.json({ ok: false, message: MESSAGE.approverRowNotFound }, 404);

    const approverId = scope === "employee" ? row.approver_id : row.employee_id;
    const counts = await pendingCounts(db, [approverId]);
    const plan = approverDeactivation({ pendingCount: counts.get(approverId) ?? 0 });

    const updated = await db.update(table, plan.patch, [["id", "eq", id]], {
      returning: true,
      columns: "id,is_active",
    });
    if (updated.error) {
      throw Object.assign(new Error("approver deactivate failed"), { code: updated.error.code });
    }
    if (!Array.isArray(updated.data) || updated.data.length === 0) {
      return c.json({ ok: false, message: MESSAGE.approverRowNotFound }, 404);
    }

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_APPROVER_DEACTIVATED,
      entity: ENTITY_APPROVER,
      entityId: id,
      detail: {
        scope,
        approverId,
        pendingCount: plan.pendingCount,
        rowKept: plan.keepRow,
      },
    });

    return c.json(
      {
        ok: true,
        id,
        scope,
        isActive: false,
        pendingCount: plan.pendingCount,
        rowKept: plan.keepRow,
      },
      200
    );
  } catch (error) {
    logError("hr approver deactivate failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/leave/hr/approvers/:id/reactivate ----------------------------

leaveHr.post("/approvers/:id/reactivate", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  const scope = scopeOf(new URL(c.req.raw.url).searchParams.get("scope") ?? "department");
  if (!scope) return c.json({ ok: false, message: MESSAGE.scopeInvalid }, 400);

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");
    const table = scope === "employee" ? EMPLOYEE_APPROVERS_TABLE : DEPARTMENT_APPROVERS_TABLE;

    const row = await db.select(table, {
      columns:
        scope === "employee"
          ? "id,employee_id,approver_id,priority,is_active"
          : "id,department_id,employee_id,priority,is_active",
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!row) return c.json({ ok: false, message: MESSAGE.approverRowNotFound }, 404);

    const approverId = scope === "employee" ? row.approver_id : row.employee_id;
    const plan = approverReactivation();

    const updated = await db.update(table, plan.patch, [["id", "eq", id]], {
      returning: true,
      columns: "id,is_active",
    });
    if (updated.error) {
      throw Object.assign(new Error("approver reactivate failed"), { code: updated.error.code });
    }
    if (!Array.isArray(updated.data) || updated.data.length === 0) {
      return c.json({ ok: false, message: MESSAGE.approverRowNotFound }, 404);
    }

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_APPROVER_REACTIVATED,
      entity: ENTITY_APPROVER,
      entityId: id,
      detail: { scope, approverId, rowKept: plan.keepRow },
    });

    return c.json({ ok: true, id, scope, isActive: true, rowKept: plan.keepRow }, 200);
  } catch (error) {
    logError("hr approver reactivate failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/hr/catalog ----------------------------------------------
// The HR forms need the same type/shift/holiday data the employee form loads.
// /api/leave/types requires the employee role, so HR gets its own read here.

leaveHr.get("/catalog", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const db = c.get("hrLeaveDb");
    const [typeRows, shiftRows, holidays, settings] = await Promise.all([
      db.select(LEAVE_TYPES_TABLE, {
        columns: "id,name,requires_attachment,is_active,attachment_required_from_days",
        order: "name.asc",
      }),
      db.select(SHIFTS_TABLE, {
        columns: "code,label,is_half,sort_order",
        order: "sort_order.asc",
      }),
      readHolidays(db),
      readLeaveSettings(db),
    ]);

    const types = typeRows
      .filter((row) => row.is_active !== false)
      .map((row) => ({
        id: row.id,
        name: row.name ?? "",
        requiresAttachment: row.requires_attachment === true,
        attachmentRequiredFromDays:
          row.attachment_required_from_days === null ||
          row.attachment_required_from_days === undefined
            ? null
            : Number(row.attachment_required_from_days),
        isOther: isOtherType(row),
      }));

    const shifts = shiftRows
      .filter((row) => typeof row.code === "string" && row.code.length > 0)
      .map((row) => ({ code: row.code, label: row.label ?? row.code, isHalf: row.is_half === true }));

    return c.json(
      {
        ok: true,
        types,
        shifts,
        holidays: holidays.dates,
        certificateRetentionDays: settings.certificateRetentionDays,
      },
      200
    );
  } catch (error) {
    logError("hr leave catalog failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- /api/leave/hr/holidays --------------------------------------------------

leaveHr.get("/holidays", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const year = new URL(c.req.raw.url).searchParams.get("year");
  if (year !== null && year !== "" && /^\d{4}$/.test(year) === false) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");

    const filters = [];
    if (year) {
      filters.push([HOLIDAY_DATE_COLUMN, "gte", `${year}-01-01`]);
      filters.push([HOLIDAY_DATE_COLUMN, "lte", `${year}-12-31`]);
    }

    // The table is holidays (holiday_date primary key, name): holiday_date is
    // the only date column and the key for every read and delete.
    const rows = await db.select(HOLIDAYS_TABLE, {
      columns: `${HOLIDAY_DATE_COLUMN},name`,
      filters,
      order: `${HOLIDAY_DATE_COLUMN}.asc`,
      limit: 400,
    });

    const list = rows
      .map((row) => ({
        holiday_date: String(row.holiday_date ?? "").slice(0, 10),
        name: row.name ?? null,
      }))
      .filter((row) => isDateString(row.holiday_date));

    // Company holidays, not caller-specific data.
    c.header("Cache-Control", "private, max-age=300");
    return c.json({ ok: true, count: list.length, holidays: list }, 200);
  } catch (error) {
    logError("hr holiday list failed", error);
    return c.json({ ok: false, message: HOLIDAYS_UNAVAILABLE }, 503);
  }
});

leaveHr.post("/holidays", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, ["holiday_date", "name"])) return invalidBody(c);
  if (typeof body.holiday_date !== "string" || DATE_PATTERN.test(body.holiday_date) === false) {
    return c.json({ ok: false, message: MESSAGES.dateFormat }, 400);
  }

  let name = null;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") return invalidBody(c);
    const value = body.name.replace(/\s+/g, " ").trim();
    if (Array.from(value).length > HOLIDAY_NAME_MAX_LENGTH) return invalidBody(c);
    name = value.length > 0 ? value : null;
  }

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");

    // No id and no created_by column exists on holidays: holiday_date is the
    // primary key and the audit row records the actor.
    const inserted = await db.insert(
      HOLIDAYS_TABLE,
      { holiday_date: body.holiday_date, name },
      { returning: true }
    );
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        return c.json({ ok: false, message: MESSAGE.holidayDuplicate }, 409);
      }
      if (isMissingTableError(inserted.error)) {
        return c.json({ ok: false, message: MESSAGE.holidayNotInstalled }, 409);
      }
      throw Object.assign(new Error("holiday insert failed"), { code: inserted.error.code });
    }

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_HOLIDAY_ADDED,
      entity: ENTITY_HOLIDAY,
      entityId: null,
      detail: { holiday_date: body.holiday_date, name },
    });

    return c.json({ ok: true, holiday: { holiday_date: body.holiday_date, name } }, 201);
  } catch (error) {
    logError("hr holiday create failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

leaveHr.post("/holidays/:holiday_date/delete", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  // holiday_date is the primary key; there is no id column to address.
  const holidayDate = c.req.param("holiday_date");
  if (typeof holidayDate !== "string" || isDateString(holidayDate) === false) return invalidBody(c);

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");

    const removed = await db.remove(HOLIDAYS_TABLE, [[HOLIDAY_DATE_COLUMN, "eq", holidayDate]], {
      returning: true,
      columns: `${HOLIDAY_DATE_COLUMN},name`,
    });
    if (removed.error) {
      if (isMissingTableError(removed.error)) {
        return c.json({ ok: false, message: MESSAGE.holidayNotInstalled }, 409);
      }
      throw Object.assign(new Error("holiday delete failed"), { code: removed.error.code });
    }
    if (!Array.isArray(removed.data) || removed.data.length === 0) {
      return c.json({ ok: false, message: MESSAGE.holidayNotFound }, 404);
    }

    const deleted = removed.data[0];
    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_HOLIDAY_DELETED,
      entity: ENTITY_HOLIDAY,
      entityId: null,
      detail: {
        holiday_date: deleted.holiday_date ?? holidayDate,
        name: deleted.name ?? null,
      },
    });

    return c.json({ ok: true, holiday_date: deleted.holiday_date ?? holidayDate }, 200);
  } catch (error) {
    logError("hr holiday delete failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- /api/leave/hr/settings --------------------------------------------------

leaveHr.get("/settings", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const settings = await readLeaveSettings(c.get("hrLeaveDb"));
    return c.json(
      {
        ok: true,
        configured: settings.configured,
        certificateRetentionDays: settings.certificateRetentionDays,
        limits: {
          min: MIN_CERTIFICATE_RETENTION_DAYS,
          max: MAX_CERTIFICATE_RETENTION_DAYS,
          default: DEFAULT_CERTIFICATE_RETENTION_DAYS,
        },
      },
      200
    );
  } catch (error) {
    logError("hr settings read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

leaveHr.put("/settings", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, ["certificateRetentionDays"])) return invalidBody(c);

  const days = normalizeRetentionDays(body.certificateRetentionDays);
  if (days === null) return c.json({ ok: false, message: MESSAGE.settingsInvalid }, 400);

  try {
    const db = c.get("hrLeaveDb");
    const session = c.get("hrLeaveSession");
    const before = await readLeaveSettings(db);

    const saved = await db.upsert(
      SETTINGS_TABLE,
      {
        id: SETTINGS_ROW_ID,
        certificate_retention_days: days,
        updated_at: new Date().toISOString(),
        updated_by: session.employeeId,
      },
      { conflict: "id", columns: "id,certificate_retention_days" }
    );
    if (saved.error) {
      if (isMissingTableError(saved.error)) {
        return c.json({ ok: false, message: MESSAGE.settingsNotInstalled }, 409);
      }
      throw Object.assign(new Error("settings save failed"), { code: saved.error.code });
    }

    await writeAudit(db, {
      actorId: session.employeeId,
      action: ACTION_SETTINGS_UPDATED,
      entity: ENTITY_SETTINGS,
      entityId: null,
      detail: {
        before: before.certificateRetentionDays,
        after: days,
      },
    });

    return c.json(
      { ok: true, configured: true, certificateRetentionDays: days },
      200
    );
  } catch (error) {
    logError("hr settings save failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default leaveHr;
