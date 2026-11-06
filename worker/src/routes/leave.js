// Leave routes, phase 1. Mounted at /api/leave by src/app.js.
//
// Scope kept on purpose:
// - employee_id always comes from the session, never from the body;
// - days, the return date/time and the shift end override are computed here
//   with src/leave-rules.js, so a client value is never trusted;
// - holidays are required: a failed read refuses the submission instead of
//   counting days without them;
// - the approver is resolved employee_approvers -> department_approvers, skipping
//   inactive employees and the applicant, and "no approver configured" is 409;
// - the medical certificate is uploaded to the private bucket and only the object
//   path is stored; a signed URL (60s) is issued per viewer;
// - a decision is a conditional update (status = 'pending'), so two approvers
//   clicking at once cannot both win;
// - every submit/approve/reject writes one audit_logs row.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import {
  DECISION_NOTE_MAX_LENGTH,
  MESSAGES,
  attachmentRequiredFor,
  computeLeave,
  isDateString,
  isOtherType,
} from "../leave-rules.js";
import { activeEmployeeIds, findApproverId, isActiveApprover } from "../leave-approvers.js";
import { normalizeOptionalFields } from "../leave-backdated.js";
import { readLeaveSettings } from "../leave-settings.js";
import { HOLIDAYS_UNAVAILABLE, readHolidays } from "../leave-holidays.js";
import {
  ATTACHMENT_MESSAGES,
  MAX_ATTACHMENT_BYTES,
  SIGNED_URL_EXPIRES_IN,
  attachmentPath,
  isCertificatePath,
  safeAttachmentName,
  validateAttachment,
} from "../leave-attachment.js";
import {
  createCertificateSignedUrl,
  deleteCertificate,
  uploadCertificate,
} from "../leave-storage.js";
import { insertWithRequestCode } from "../leave-request-code.js";
import { dispatchQueuedNotifications, enqueueNotificationSafely } from "../push/queue.js";
import { NOTIFICATION_KINDS } from "../push/payload.js";
import { CALENDAR_MAX_RANGE_DAYS, CALENDAR_MESSAGES, chunksOf, displayName } from "../leave-calendar.js";
import { canViewLeaveRequest } from "../leave-scope.js";
import {
  HISTORY_MAX_SCAN_ROWS,
  HISTORY_SEARCH_LIMIT,
  historyFilters,
  parseHistoryQuery,
  publicHistoryRow,
  sortHistoryRows,
} from "../leave-history.js";
import { isDateString as isCalendarDate, spanDays as calendarSpanDays } from "../leave-rules.js";
import { readHolidayRows } from "../leave-holidays.js";

const leave = new Hono();

// HR and meeting controllers are employees too, so they may file their own leave.
// Own leave is not a role feature. These routes authorize the session and its
// active employee row; an approver queue is guarded by the approver row in the
// route itself, and HR tools live in their own app with their own role check.
const SESSION_ROLES = ["employee", "hr", "meeting_controller", "system_admin"];

const LEAVE_REQUESTS_TABLE = "leave_requests";
const LEAVE_TYPES_TABLE = "leave_types";
const SHIFTS_TABLE = "shift_options";
const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const HR_ADMINS_TABLE = "hr_admins";
const AUDIT_TABLE = "audit_logs";

const ACTION_REQUESTED = "leave_requested";
const ACTION_APPROVED = "leave_approved";
const ACTION_REJECTED = "leave_rejected";
const ENTITY = "leave_request";

const LIST_LIMIT = 50;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_MULTIPART_BYTES = MAX_ATTACHMENT_BYTES + 1024 * 1024;
const SECRET_HEADER = "Cache-Control";

const MESSAGE = {
  invalid: "ข้อมูลไม่ถูกต้อง",
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  typeUnknown: "ไม่พบประเภทการลาที่เลือก",
  requestNotFound: "ไม่พบใบลานี้",
  notApprover: "คุณไม่ใช่ผู้อนุมัติของใบลานี้",
  alreadyDecided: "ใบลานี้ถูกดำเนินการแล้ว",
  noApprover: "ยังไม่ได้กำหนดผู้อนุมัติ",
  duplicateCode: "รหัสใบลาซ้ำ กรุณายื่นใหม่อีกครั้ง",
};

// `medicalCertificateUrl` is deliberately absent: a client-supplied public URL
// is never stored. The certificate arrives as a multipart file instead.
const ALLOWED_KEYS = [
  "leaveTypeId",
  "shiftCode",
  "startDate",
  "endDate",
  "otOption",
  "otherTypeDetail",
  "reason",
];

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

leave.use("*", async (c, next) => {
  c.header(SECRET_HEADER, "no-store");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

function isMultipartContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "multipart/form-data";
}

/** Logs only the error name and code; never a body or a person's data. */
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

/**
 * Sends the rows just queued after the response, through the request's
 * ExecutionContext. No context (a test call) runs the pass here, bounded to
 * three seconds, so the leave response is still never failed by it.
 */
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

/** JSON object body, at most 8 KB, no other content type accepted. */
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

/**
 * Multipart body: text fields plus at most one file field named `certificate`.
 * Returns { ok, fields, file } or { ok: false, reason }.
 */
async function readMultipartRequest(c) {
  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return { ok: false, reason: "tooLarge" };
  }

  let form;
  try {
    form = await c.req.formData();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const fields = {};
  let file = null;

  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      if (Object.prototype.hasOwnProperty.call(fields, key)) return { ok: false, reason: "invalid" };
      fields[key] = value;
      continue;
    }
    if (key !== "certificate" || file !== null) return { ok: false, reason: "invalid" };
    file = value;
  }

  return { ok: true, fields, file };
}

function invalidBody(c) {
  return c.json({ ok: false, message: MESSAGE.invalid }, 400);
}

/** Role check plus a fresh employee read, so department_id is current. */
async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, SESSION_ROLES);
  if (auth.status) {
    return { response: c.json({ ok: false, message: auth.message }, auth.status) };
  }

  try {
    const db = createDb(c.env);
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,full_name,employee_code,department_id,is_active",
      filters: [["id", "eq", auth.session.employeeId]],
      single: true,
    });
    if (!employee || employee.is_active !== true) {
      return { response: c.json({ ok: false, message: MESSAGE.forbidden }, 403) };
    }

    c.set("leaveDb", db);
    c.set("leaveEmployee", employee);
    c.set("leaveSession", auth.session);
    return null;
  } catch (error) {
    logError("leave guard failed", error);
    return { response: c.json({ ok: false, message: MESSAGE.saveError }, 500) };
  }
}

function typeMapOf(rows) {
  const map = new Map();
  for (const row of rows) if (row?.id) map.set(row.id, row);
  return map;
}

async function loadTypes(db) {
  return db.select(LEAVE_TYPES_TABLE, {
    columns: "id,name,requires_attachment,is_active,attachment_required_from_days",
    order: "name.asc",
  });
}

function publicType(row) {
  return {
    id: row.id,
    name: row.name ?? "",
    requiresAttachment: row.requires_attachment === true,
    attachmentRequiredFromDays:
      row.attachment_required_from_days === null || row.attachment_required_from_days === undefined
        ? null
        : Number(row.attachment_required_from_days),
    isOther: isOtherType(row),
    isActive: row.is_active !== false,
  };
}

function publicRequest(row, types) {
  const type = types.get(row.leave_type_id) ?? null;
  const stored = typeof row.medical_certificate_url === "string" ? row.medical_certificate_url : null;
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
    attachmentPath: stored,
    status: row.status ?? null,
    decisionNote: row.decision_note ?? null,
    decidedAt: row.decided_at ?? null,
    createdAt: row.created_at ?? null,
  };
}

// --- GET /api/leave/types ----------------------------------------------------

leave.get("/types", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const db = c.get("leaveDb");
    const [rows, settings] = await Promise.all([loadTypes(db), readLeaveSettings(db)]);
    const types = rows.filter((row) => row.is_active !== false).map(publicType);
    return c.json(
      {
        ok: true,
        count: types.length,
        certificateRetentionDays: settings.certificateRetentionDays,
        types,
      },
      200
    );
  } catch (error) {
    logError("leave types failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/shifts ---------------------------------------------------

leave.get("/shifts", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const rows = await c.get("leaveDb").select(SHIFTS_TABLE, {
      columns: "code,label,time_from,time_to,is_half,sort_order",
      order: "sort_order.asc",
    });

    const shifts = rows
      .filter((row) => typeof row.code === "string" && row.code.length > 0)
      .map((row) => ({
        code: row.code,
        label: row.label ?? row.code,
        timeFrom: row.time_from ?? null,
        timeTo: row.time_to ?? null,
        isHalf: row.is_half === true,
      }));

    return c.json({ ok: true, count: shifts.length, shifts }, 200);
  } catch (error) {
    logError("leave shifts failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/holidays -------------------------------------------------

leave.get("/holidays", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  // ?from=&to= is optional (the leave form asks for the whole list). When
  // present both dates are required, so a half-range never looks like "all".
  const params = new URL(c.req.raw.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const ranged = (from !== null && from !== "") || (to !== null && to !== "");

  if (ranged) {
    if (isCalendarDate(from) === false || isCalendarDate(to) === false) {
      return c.json({ ok: false, message: MESSAGES.dateFormat }, 400);
    }
    if (from > to) {
      return c.json({ ok: false, message: MESSAGES.endBeforeStart }, 400);
    }
    if (calendarSpanDays(from, to) > CALENDAR_MAX_RANGE_DAYS) {
      return c.json({ ok: false, message: CALENDAR_MESSAGES.rangeTooLong }, 400);
    }
  }

  try {
    // Date and name only: no id, creator or any other column is read here.
    const holidays = await readHolidayRows(c.get("leaveDb"), ranged ? { from, to } : {});
    // Date and name only, identical for every signed-in employee: the browser
    // may reuse the answer for five minutes.
    c.header(SECRET_HEADER, "private, max-age=300");
    return c.json(
      {
        ok: true,
        count: holidays.length,
        holidays,
        // Kept for the leave form, which only needs the set of dates.
        dates: holidays.map((row) => row.date),
      },
      200
    );
  } catch (error) {
    logError("leave holidays failed", error);
    return c.json({ ok: false, message: HOLIDAYS_UNAVAILABLE }, 503);
  }
});

// --- POST /api/leave/requests ------------------------------------------------

leave.post("/requests", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const multipart = isMultipartContentType(c.req.header("Content-Type"));

  let fields;
  let file = null;
  if (multipart) {
    const parsed = await readMultipartRequest(c);
    if (parsed.ok !== true) {
      return parsed.reason === "tooLarge"
        ? c.json({ ok: false, message: ATTACHMENT_MESSAGES.sizeTooLarge }, 413)
        : invalidBody(c);
    }
    fields = parsed.fields;
    file = parsed.file;
  } else {
    fields = await readStrictJson(c);
  }

  if (!hasOnlyKeys(fields, ALLOWED_KEYS)) return invalidBody(c);
  if (!isUuid(fields.leaveTypeId)) return invalidBody(c);
  if (
    typeof fields.shiftCode !== "string" ||
    fields.shiftCode.length === 0 ||
    fields.shiftCode.length > 40
  ) {
    return invalidBody(c);
  }

  const db = c.get("leaveDb");
  const employee = c.get("leaveEmployee");

  try {
    const leaveType = await db.select(LEAVE_TYPES_TABLE, {
      columns: "id,name,requires_attachment,is_active,attachment_required_from_days",
      filters: [["id", "eq", fields.leaveTypeId]],
      single: true,
    });
    if (!leaveType || leaveType.is_active === false) {
      return c.json({ ok: false, message: MESSAGE.typeUnknown }, 400);
    }

    const shift = await db.select(SHIFTS_TABLE, {
      columns: "code,label,is_half",
      filters: [["code", "eq", fields.shiftCode]],
      single: true,
    });
    if (!shift) return c.json({ ok: false, message: MESSAGES.shiftUnknown }, 400);

    const startDate = fields.startDate;
    if (!isDateString(startDate)) return c.json({ ok: false, message: MESSAGES.dateFormat }, 400);

    // Holidays are mandatory: without them the day count would be wrong, so the
    // submission is refused rather than calculated.
    let holidays;
    try {
      holidays = await readHolidays(db);
    } catch (error) {
      logError("leave holidays read failed", error);
      return c.json({ ok: false, message: HOLIDAYS_UNAVAILABLE }, 503);
    }

    const computed = computeLeave({
      startDate,
      endDate: fields.endDate === undefined || fields.endDate === null ? startDate : fields.endDate,
      shift,
      otOption: fields.otOption,
      holidays: new Set(holidays.dates),
    });
    if (computed.ok !== true) return c.json({ ok: false, message: computed.message }, 400);

    // Same normalisation the HR backdated route uses (src/leave-backdated.js),
    // minus the attachment URL: the certificate is a file in this route.
    const optional = normalizeOptionalFields({
      leaveType,
      days: computed.days,
      otherTypeDetail: fields.otherTypeDetail,
      reason: fields.reason,
      requireAttachment: false,
    });
    if (optional.ok !== true) {
      return c.json({ ok: false, message: optional.message }, 400);
    }

    if (attachmentRequiredFor(leaveType, computed.days) && file === null) {
      return c.json({ ok: false, message: MESSAGES.attachmentRequired }, 400);
    }

    let upload = null;
    if (file !== null) {
      if (typeof file.size === "number" && file.size > MAX_ATTACHMENT_BYTES) {
        return c.json({ ok: false, message: ATTACHMENT_MESSAGES.sizeTooLarge }, 413);
      }
      let bytes;
      try {
        bytes = await file.arrayBuffer();
      } catch {
        return c.json({ ok: false, message: ATTACHMENT_MESSAGES.empty }, 400);
      }
      const validated = validateAttachment({
        contentType: file.type,
        size: bytes.byteLength,
        bytes,
      });
      if (validated.ok !== true) {
        return c.json({ ok: false, message: validated.message }, 400);
      }
      upload = {
        bytes,
        contentType: validated.contentType,
        fileName: safeAttachmentName(file.name, validated.contentType),
      };
    }

    const approverId = await findApproverId(db, employee);
    if (!approverId) return c.json({ ok: false, message: MESSAGE.noApprover }, 409);

    const now = new Date();
    const nowIso = now.toISOString();

    const baseRow = {
      employee_id: employee.id,
      leave_type_id: leaveType.id,
      other_type_detail: optional.otherTypeDetail,
      ot_option: computed.otOption,
      start_date: startDate,
      end_date: computed.days === 0.5 ? startDate : fields.endDate ?? startDate,
      days: computed.days,
      return_date: computed.returnDate,
      return_time: computed.returnTime,
      reason: optional.reason,
      status: "pending",
      has_medical_certificate: false,
      approver_id: approverId,
      shift_option_code: shift.code,
      shift_end_override: computed.shiftEndOverride,
      source: "employee",
      entered_by_id: employee.id,
      created_at: nowIso,
      updated_at: nowIso,
    };

    let uploadedPath = null;

    const result = await insertWithRequestCode(
      db,
      (requestCode) => ({
        ...baseRow,
        request_code: requestCode,
        medical_certificate_url: uploadedPath,
      }),
      {
        now,
        beforeInsert: async (row) => {
          if (upload === null) return { ok: true };

          const path = attachmentPath({
            employeeId: employee.id,
            requestCode: row.request_code,
            fileName: upload.fileName,
          });
          if (path === null) {
            return { ok: false, message: ATTACHMENT_MESSAGES.invalidTarget };
          }

          const stored = await uploadCertificate(c.env, path, upload.bytes, upload.contentType);
          if (stored.ok !== true) {
            console.error("[leave-cert-upload]", { status: stored.status });
            return { ok: false, message: ATTACHMENT_MESSAGES.uploadFailed, failed: true, error: { code: "storage" } };
          }

          row.medical_certificate_url = path;
          row.has_medical_certificate = true;
          uploadedPath = path;
          return {
            ok: true,
            rollback: async () => {
              // The row was not saved, so the object must not stay behind.
              await deleteCertificate(c.env, path);
              uploadedPath = null;
            },
          };
        },
      }
    );

    if (result.ok !== true) {
      if (result.duplicate) return c.json({ ok: false, message: MESSAGE.duplicateCode }, 409);
      if (typeof result.message === "string") {
        return c.json({ ok: false, message: result.message }, result.failed ? 502 : 400);
      }
      throw Object.assign(new Error("leave insert failed"), { code: result.error?.code });
    }

    const row = result.row;
    const inserted = result.inserted;

    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: employee.id,
        action: ACTION_REQUESTED,
        entity: ENTITY,
        entity_id: inserted.data?.id ?? null,
        detail: JSON.stringify({
          requestCode: row.request_code,
          leaveType: leaveType.name ?? null,
          days: computed.days,
          shift: shift.code,
          hasAttachment: row.medical_certificate_url !== null,
        }),
      })
    );

    // The approver gets a push. A queue failure is logged, never returned: the
    // leave itself is already saved and must not look broken.
    const queued = await enqueueNotificationSafely(db, {
      employeeId: approverId,
      leaveRequestId: inserted.data?.id ?? null,
      kind: NOTIFICATION_KINDS.SUBMITTED,
    });
    // The response does not wait for the push; the cron retries a failure.
    await dispatchQueued(c, queued, now);

    return c.json(
      {
        ok: true,
        request: {
          id: inserted.data?.id ?? null,
          requestCode: row.request_code,
          leaveTypeName: leaveType.name ?? null,
          startDate: row.start_date,
          endDate: row.end_date,
          days: row.days,
          returnDate: row.return_date,
          returnTime: row.return_time,
          shiftCode: row.shift_option_code,
          shiftEndOverride: row.shift_end_override,
          otOption: row.ot_option,
          hasAttachment: row.medical_certificate_url !== null,
          status: row.status,
        },
      },
      201
    );
  } catch (error) {
    logError("leave submit failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/requests/mine -------------------------------------------

leave.get("/requests/mine", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const db = c.get("leaveDb");
    const employee = c.get("leaveEmployee");

    const [rows, typeRows, settings] = await Promise.all([
      db.select(LEAVE_REQUESTS_TABLE, {
        columns:
          "id,request_code,leave_type_id,other_type_detail,start_date,end_date,days,return_date,return_time,status,ot_option,shift_option_code,shift_end_override,reason,has_medical_certificate,medical_certificate_url,decision_note,decided_at,created_at",
        filters: [["employee_id", "eq", employee.id]],
        order: "created_at.desc",
        limit: LIST_LIMIT,
      }),
      loadTypes(db),
      readLeaveSettings(db),
    ]);

    const types = typeMapOf(typeRows);
    const results = rows.map((row) => publicRequest(row, types));
    return c.json(
      {
        ok: true,
        limit: LIST_LIMIT,
        count: results.length,
        certificateRetentionDays: settings.certificateRetentionDays,
        results,
      },
      200
    );
  } catch (error) {
    logError("leave mine failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/requests/:id ---------------------------------------------
// The read-only detail the approvals page shows. The scope is the one shared
// rule (worker/src/leave-scope.js): HR, or the request's own active approver.
// Opening a calendar row reuses this shape; no calendar row can read a request
// its caller may not read here.

leave.get("/requests/:id", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  try {
    const db = c.get("leaveDb");
    const employee = c.get("leaveEmployee");
    const session = c.get("leaveSession");

    const row = await db.select(LEAVE_REQUESTS_TABLE, {
      columns:
        "id,request_code,employee_id,approver_id,leave_type_id,other_type_detail,start_date,end_date,days,return_date,return_time,status,ot_option,shift_option_code,shift_end_override,reason,has_medical_certificate,medical_certificate_url,decision_note,decided_at,created_at,source,entered_by_id",
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!row) return c.json({ ok: false, message: MESSAGE.requestNotFound }, 404);

    const isApprover =
      session.role === "hr" ? false : await isActiveApprover(db, employee.id);
    if (
      !canViewLeaveRequest({
        role: session.role,
        employeeId: employee.id,
        isApprover,
        request: row,
      })
    ) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }

    const [typeRow, requester] = await Promise.all([
      row.leave_type_id
        ? db.select(LEAVE_TYPES_TABLE, {
            columns: "id,name",
            filters: [["id", "eq", row.leave_type_id]],
            single: true,
          })
        : null,
      db.select(EMPLOYEES_TABLE, {
        columns: "id,employee_code,name_prefix,full_name,department_id",
        filters: [["id", "eq", row.employee_id]],
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

    const types = typeMapOf(typeRow ? [typeRow] : []);
    return c.json(
      {
        ok: true,
        request: {
          ...publicRequest(row, types),
          requester: {
            id: row.employee_id ?? null,
            employeeCode: requester?.employee_code ?? null,
            namePrefix: requester?.name_prefix ?? null,
            fullName: displayName(requester?.name_prefix, requester?.full_name) || null,
            departmentName: department?.name ?? null,
          },
        },
      },
      200
    );
  } catch (error) {
    logError("leave detail failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/requests/:id/attachment ---------------------------------
// The certificate is private: the viewer gets a signed URL that lives for 60
// seconds. Allowed: the owner, the approver of that request, and HR.

leave.get("/requests/:id/attachment", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  try {
    const db = c.get("leaveDb");
    const employee = c.get("leaveEmployee");
    const session = c.get("leaveSession");

    const row = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: "id,employee_id,approver_id,medical_certificate_url",
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!row) return c.json({ ok: false, message: MESSAGE.requestNotFound }, 404);

    let allowed = row.employee_id === employee.id || row.approver_id === employee.id;

    if (!allowed && session?.role === "hr") {
      const member = await db.select(HR_ADMINS_TABLE, {
        columns: "employee_id",
        filters: [["employee_id", "eq", employee.id]],
        single: true,
      });
      allowed = member !== null;
    }

    if (!allowed) return c.json({ ok: false, message: MESSAGE.forbidden }, 403);

    const stored = row.medical_certificate_url;
    if (typeof stored !== "string" || stored.trim().length === 0) {
      return c.json({ ok: false, message: ATTACHMENT_MESSAGES.notFound }, 404);
    }
    if (isCertificatePath(stored) === false) {
      return c.json({ ok: false, message: ATTACHMENT_MESSAGES.notStored }, 404);
    }

    const signed = await createCertificateSignedUrl(c.env, stored.trim(), SIGNED_URL_EXPIRES_IN);
    if (signed.ok !== true) {
      console.error("[leave-cert-sign]", { status: signed.status });
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }

    return c.json(
      { ok: true, url: signed.url, expiresIn: signed.expiresIn ?? SIGNED_URL_EXPIRES_IN },
      200
    );
  } catch (error) {
    logError("leave attachment failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/approvals/count ------------------------------------------
// The dock badge refreshes with one tiny read: the caller's own pending count
// and an ETag. An unchanged queue answers 304 with no body, so the 2-minute
// check costs a header round-trip and nothing else.

leave.get("/approvals/count", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const db = c.get("leaveDb");
    const employee = c.get("leaveEmployee");

    // Same guard as the queue: only an active approver has a count.
    if (!(await isActiveApprover(db, employee.id))) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }

    const filters = [
      ["approver_id", "eq", employee.id],
      ["status", "eq", "pending"],
    ];

    // The count is exact; the newest change in this approver's queue is the
    // timestamp half of the tag, so a swap of requests also moves it.
    const [count, newest] = await Promise.all([
      db.count(LEAVE_REQUESTS_TABLE, { filters }),
      db.select(LEAVE_REQUESTS_TABLE, {
        columns: "updated_at,created_at",
        filters,
        order: "updated_at.desc.nullslast",
        limit: 1,
      }),
    ]);

    const latest = Array.isArray(newest) && newest[0] ? newest[0] : null;
    const changedAt = latest?.updated_at ?? latest?.created_at ?? "";
    const etag = `W/"${count}-${Date.parse(changedAt) || 0}"`;

    c.header("Cache-Control", "private, no-cache");
    c.header("ETag", etag);

    if (c.req.header("If-None-Match") === etag) {
      return c.body(null, 304);
    }

    return c.json({ ok: true, count }, 200);
  } catch (error) {
    logError("leave approvals count failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/approvals ------------------------------------------------

leave.get("/approvals", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const db = c.get("leaveDb");
    const employee = c.get("leaveEmployee");

    // Only an active approver has a queue. A non-approver, or an approver whose
    // row was deactivated, is refused here: the menu is a convenience, this is
    // the control.
    if (!(await isActiveApprover(db, employee.id))) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }

    const rows = await db.select(LEAVE_REQUESTS_TABLE, {
      columns:
        "id,request_code,employee_id,leave_type_id,other_type_detail,start_date,end_date,days,return_date,return_time,status,ot_option,shift_option_code,reason,has_medical_certificate,medical_certificate_url,created_at",
      filters: [
        ["approver_id", "eq", employee.id],
        ["status", "eq", "pending"],
      ],
      order: "created_at.asc",
      limit: LIST_LIMIT,
    });

    const employeeIds = [...new Set(rows.map((row) => row.employee_id).filter(Boolean))];
    const typeRows = await loadTypes(db);
    const requesters = employeeIds.length
      ? await db.select(EMPLOYEES_TABLE, {
          columns: "id,employee_code,name_prefix,full_name,department_id",
          filters: [["id", "in", employeeIds]],
        })
      : [];

    const departmentIds = [
      ...new Set(requesters.map((row) => row.department_id).filter(Boolean)),
    ];
    const departments = departmentIds.length
      ? await db.select(DEPARTMENTS_TABLE, {
          columns: "id,name",
          filters: [["id", "in", departmentIds]],
        })
      : [];

    const departmentNames = new Map(departments.map((row) => [row.id, row.name ?? null]));
    const requesterById = new Map(requesters.map((row) => [row.id, row]));
    const types = typeMapOf(typeRows);

    const results = rows.map((row) => {
      const requester = requesterById.get(row.employee_id) ?? null;
      return {
        ...publicRequest(row, types),
        requester: {
          id: row.employee_id ?? null,
          employeeCode: requester?.employee_code ?? null,
          namePrefix: requester?.name_prefix ?? null,
          fullName: requester?.full_name ?? null,
          departmentName: requester?.department_id
            ? departmentNames.get(requester.department_id) ?? null
            : null,
        },
      };
    });

    return c.json({ ok: true, limit: LIST_LIMIT, count: results.length, results }, 200);
  } catch (error) {
    logError("leave approvals failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/leave/approvals/history ----------------------------------------
// The decision log. An active approver sees only requests they decided; an HR
// member (role hr plus the hr_admins row) sees every decision. The list has no
// reason and no note: only the scoped detail read can show those.

leave.get("/approvals/history", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const parsed = parseHistoryQuery(new URL(c.req.raw.url).searchParams);
  if (parsed.ok !== true) {
    return c.json({ ok: false, message: parsed.message }, 400);
  }

  try {
    const db = c.get("leaveDb");
    const employee = c.get("leaveEmployee");
    const session = c.get("leaveSession");
    const isHr = session.role === "hr";

    if (isHr) {
      const member = await db.select(HR_ADMINS_TABLE, {
        columns: "employee_id",
        filters: [["employee_id", "eq", employee.id]],
        single: true,
      });
      if (!member) return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    } else if (!(await isActiveApprover(db, employee.id))) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }

    const filters = historyFilters({
      employeeId: isHr ? null : employee.id,
      from: parsed.from,
      to: parsed.to,
      decision: parsed.decision,
    });
    const offset = (parsed.page - 1) * parsed.pageSize;

    let rows = [];
    let hasMore = false;

    if (parsed.search) {
      // The name lives in employees, so resolve ids first, then read the
      // decided requests for them in id chunks. Bounded by HISTORY_MAX_SCAN_ROWS.
      const matches = await db.select(EMPLOYEES_TABLE, {
        columns: "id",
        filters: [
          ["is_active", "eq", true],
          ["full_name", "ilike", `%${parsed.search}%`],
        ],
        limit: HISTORY_SEARCH_LIMIT,
      });
      const ids = (Array.isArray(matches) ? matches : [])
        .map((row) => row.id)
        .filter(Boolean);

      const collected = [];
      for (const chunk of chunksOf(ids, 100)) {
        const part = await db.select(LEAVE_REQUESTS_TABLE, {
          columns: "id,employee_id,leave_type_id,start_date,end_date,days,status,decided_at",
          filters: [...filters, ["employee_id", "in", chunk]],
          order: "decided_at.desc",
          limit: HISTORY_MAX_SCAN_ROWS,
        });
        collected.push(...part);
        if (collected.length >= HISTORY_MAX_SCAN_ROWS) break;
      }

      const sorted = sortHistoryRows(collected).slice(0, HISTORY_MAX_SCAN_ROWS);
      rows = sorted.slice(offset, offset + parsed.pageSize);
      hasMore = sorted.length > offset + parsed.pageSize;
    } else {
      rows = await db.select(LEAVE_REQUESTS_TABLE, {
        columns: "id,employee_id,leave_type_id,start_date,end_date,days,status,decided_at",
        filters,
        order: "decided_at.desc",
        limit: parsed.pageSize + 1,
        extra: [`offset=${offset}`],
      });
      hasMore = rows.length > parsed.pageSize;
      rows = rows.slice(0, parsed.pageSize);
    }

    const employeeIds = [...new Set(rows.map((row) => row.employee_id).filter(Boolean))];
    const typeIds = [...new Set(rows.map((row) => row.leave_type_id).filter(Boolean))];

    const [requesters, typeRows] = await Promise.all([
      employeeIds.length
        ? db.select(EMPLOYEES_TABLE, {
            columns: "id,employee_code,name_prefix,full_name,department_id",
            filters: [["id", "in", employeeIds]],
          })
        : [],
      typeIds.length
        ? db.select(LEAVE_TYPES_TABLE, {
            columns: "id,name",
            filters: [["id", "in", typeIds]],
          })
        : [],
    ]);

    const departmentIds = [
      ...new Set(requesters.map((row) => row.department_id).filter(Boolean)),
    ];
    const departments = departmentIds.length
      ? await db.select(DEPARTMENTS_TABLE, {
          columns: "id,name",
          filters: [["id", "in", departmentIds]],
        })
      : [];

    const requesterById = new Map(requesters.map((row) => [row.id, row]));
    const typeNameById = new Map(typeRows.map((row) => [row.id, row.name ?? ""]));
    const departmentNameById = new Map(departments.map((row) => [row.id, row.name ?? null]));

    const results = rows.map((row) => {
      const requester = requesterById.get(row.employee_id) ?? null;
      return publicHistoryRow({
        row,
        requesterName: displayName(requester?.name_prefix, requester?.full_name),
        departmentName: requester?.department_id
          ? departmentNameById.get(requester.department_id) ?? null
          : null,
        leaveTypeName: typeNameById.get(row.leave_type_id) ?? "",
      });
    });

    return c.json(
      {
        ok: true,
        page: parsed.page,
        pageSize: parsed.pageSize,
        hasMore,
        count: results.length,
        results,
      },
      200
    );
  } catch (error) {
    logError("leave approval history failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/leave/requests/:id/approve and /reject ------------------------

async function decide(c, status) {
  const denied = await guard(c);
  if (denied) return denied.response;

  const id = c.req.param("id");
  if (!isUuid(id)) return invalidBody(c);

  const db = c.get("leaveDb");
  const employee = c.get("leaveEmployee");

  let note = null;
  if (status === "rejected") {
    const body = await readStrictJson(c);
    if (!hasOnlyKeys(body, ["reason"]) || typeof body.reason !== "string") {
      return invalidBody(c);
    }
    note = body.reason.replace(/\s+/g, " ").trim();
    if (note.length === 0) {
      return c.json({ ok: false, message: MESSAGES.decisionNoteRequired }, 400);
    }
    if (Array.from(note).length > DECISION_NOTE_MAX_LENGTH) {
      return c.json({ ok: false, message: MESSAGES.decisionNoteTooLong }, 400);
    }
  }

  try {
    const request = await db.select(LEAVE_REQUESTS_TABLE, {
      columns: "id,request_code,employee_id,approver_id,status",
      filters: [["id", "eq", id]],
      single: true,
    });
    if (!request) return c.json({ ok: false, message: MESSAGE.requestNotFound }, 404);
    if (request.approver_id !== employee.id) {
      return c.json({ ok: false, message: MESSAGE.notApprover }, 403);
    }
    if (request.status !== "pending") {
      return c.json({ ok: false, message: MESSAGE.alreadyDecided }, 409);
    }

    const nowIso = new Date().toISOString();
    const updated = await db.update(
      LEAVE_REQUESTS_TABLE,
      {
        status,
        decided_at: nowIso,
        decision_note: note,
        updated_at: nowIso,
      },
      [
        ["id", "eq", id],
        ["status", "eq", "pending"],
        ["approver_id", "eq", employee.id],
      ],
      { returning: true, columns: "id,status,decided_at" }
    );
    if (updated.error) {
      throw Object.assign(new Error("leave decision failed"), { code: updated.error.code });
    }
    // Zero rows matched: someone else decided first, or the status changed.
    if (!Array.isArray(updated.data) || updated.data.length === 0) {
      return c.json({ ok: false, message: MESSAGE.alreadyDecided }, 409);
    }

    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: employee.id,
        action: status === "approved" ? ACTION_APPROVED : ACTION_REJECTED,
        entity: ENTITY,
        entity_id: id,
        detail: JSON.stringify({
          requestCode: request.request_code ?? null,
          employeeId: request.employee_id ?? null,
          note,
        }),
      })
    );

    const queued = await enqueueNotificationSafely(db, {
      employeeId: request.employee_id,
      leaveRequestId: id,
      kind: NOTIFICATION_KINDS.DECIDED,
      status,
    });
    await dispatchQueued(c, queued, new Date(nowIso));

    return c.json({ ok: true, id, status, decidedAt: nowIso }, 200);
  } catch (error) {
    logError("leave decision failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
}

leave.post("/requests/:id/approve", (c) => decide(c, "approved"));
leave.post("/requests/:id/reject", (c) => decide(c, "rejected"));

export default leave;
