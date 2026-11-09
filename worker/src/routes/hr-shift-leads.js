// HR shift-lead setup, mounted at /api/hr/departments by src/app.js.
//
// Rules kept here:
// - the existing HR guard is reused (role hr plus a fresh hr_admins read);
// - one department has at most two leads, and labels are unique inside it;
// - a person must belong to that department and must have an email address,
//   because the notice has nowhere to go otherwise;
// - the list is replaced as a whole: delete the department's rows, then insert
//   the validated list, so a request can never add a third row;
// - the audit row carries the department id and a count only, never a name,
//   an email address, a label or any other personal data.

import { Hono } from "hono";

import { displayName } from "../leave-calendar.js";
import { requireHrAdmin } from "../hr-guard.js";
import {
  SHIFT_LABEL_MAX_LENGTH,
  SHIFT_LEADS_MAX,
  SHIFT_LEADS_TABLE,
  isUuid,
  publicShiftLead,
  shiftLeadPeopleProblem,
  shiftLeadRows,
  validateShiftLeadEntries,
} from "../shift-leads.js";

const DEPARTMENTS_TABLE = "departments";
const EMPLOYEES_TABLE = "employees";
const AUDIT_TABLE = "audit_logs";

const MAX_BODY_BYTES = 16 * 1024;
const ACTION_SHIFT_LEADS_UPDATED = "hr_shift_leads_updated";
const ENTITY_DEPARTMENT = "department";

const INVALID = "ข้อมูลไม่ถูกต้อง";

const MESSAGE = Object.freeze({
  invalid: INVALID,
  too_many: `เพิ่มหัวหน้ากะได้ไม่เกิน ${SHIFT_LEADS_MAX} คน`,
  invalid_employee: "ข้อมูลพนักงานไม่ถูกต้อง",
  duplicate_employee: "มีพนักงานคนนี้ซ้ำในรายการ",
  label_required: "กรุณากรอกชื่อกะ",
  label_too_long: `ชื่อกะต้องไม่เกิน ${SHIFT_LABEL_MAX_LENGTH} ตัวอักษร`,
  duplicate_label: "ชื่อกะซ้ำกันในแผนกนี้",
  employee_not_found: "ไม่พบพนักงานที่เลือก",
  employee_not_in_department: "พนักงานที่เลือกไม่ได้อยู่ในแผนกนี้",
  employee_no_email: "พนักงานคนนี้ไม่มีอีเมล จึงรับแจ้งเตือนไม่ได้",
  department_not_found: "ไม่พบแผนกที่เลือก",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
});

// Fixed code -> Thai message and status. Nothing here echoes a label or a name.
const PROBLEMS = Object.freeze({
  invalid: { message: MESSAGE.invalid, status: 400 },
  too_many: { message: MESSAGE.too_many, status: 400 },
  invalid_employee: { message: MESSAGE.invalid_employee, status: 400 },
  duplicate_employee: { message: MESSAGE.duplicate_employee, status: 400 },
  label_required: { message: MESSAGE.label_required, status: 400 },
  label_too_long: { message: MESSAGE.label_too_long, status: 400 },
  duplicate_label: { message: MESSAGE.duplicate_label, status: 400 },
  employee_not_found: { message: MESSAGE.employee_not_found, status: 400 },
  employee_not_in_department: { message: MESSAGE.employee_not_in_department, status: 400 },
  employee_no_email: { message: MESSAGE.employee_no_email, status: 400 },
  department_not_found: { message: MESSAGE.department_not_found, status: 404 },
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
}

/** Logs a scope, name and code only: never a body, label or address. */
function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code ?? null });
}

function invalidBody(c) {
  return c.json({ ok: false, code: "invalid", message: MESSAGE.invalid }, 400);
}

function problemResponse(c, code) {
  const problem = PROBLEMS[code] ?? PROBLEMS.invalid;
  return c.json({ ok: false, code, message: problem.message }, problem.status);
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

  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadDepartment(db, departmentId) {
  return db.select(DEPARTMENTS_TABLE, {
    columns: "id,name",
    filters: [["id", "eq", departmentId]],
    single: true,
  });
}

/** Employee rows for the given ids, keyed by id. */
async function loadPeople(db, ids) {
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return new Map();

  const rows = await db.select(EMPLOYEES_TABLE, {
    columns: "id,employee_code,name_prefix,full_name,email,department_id,is_active",
    filters: [["id", "in", unique]],
  });
  return new Map(rows.map((row) => [row.id, row]));
}

async function loadLeads(db, departmentId) {
  const rows = await db.select(SHIFT_LEADS_TABLE, {
    columns: "id,department_id,employee_id,shift_label,created_at",
    filters: [["department_id", "eq", departmentId]],
    order: "created_at.asc",
  });
  const people = await loadPeople(db, rows.map((row) => row.employee_id));
  return rows.map((row) => publicShiftLead(row, people.get(row.employee_id)));
}

const shiftLeads = new Hono();

shiftLeads.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

// --- GET /api/hr/departments/:departmentId/shift-leads -----------------------

shiftLeads.get("/:departmentId/shift-leads", async (c) => {
  const auth = await requireHrAdmin(c);
  if (auth.response) return auth.response;

  const departmentId = c.req.param("departmentId");
  if (!isUuid(departmentId)) return invalidBody(c);

  try {
    const db = auth.db;
    const department = await loadDepartment(db, departmentId);
    if (!department) return problemResponse(c, "department_not_found");

    const leads = await loadLeads(db, departmentId);
    return c.json(
      {
        ok: true,
        departmentId,
        departmentName: department.name ?? null,
        max: SHIFT_LEADS_MAX,
        labelMaxLength: SHIFT_LABEL_MAX_LENGTH,
        count: leads.length,
        leads,
      },
      200
    );
  } catch (error) {
    logError("hr shift leads read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- PUT /api/hr/departments/:departmentId/shift-leads ----------------------

shiftLeads.put("/:departmentId/shift-leads", async (c) => {
  const auth = await requireHrAdmin(c);
  if (auth.response) return auth.response;

  const departmentId = c.req.param("departmentId");
  if (!isUuid(departmentId)) return invalidBody(c);

  const body = await readStrictJson(c);
  if (!body || !isPlainObject(body) || Object.keys(body).some((key) => key !== "leads")) {
    return invalidBody(c);
  }

  const validated = validateShiftLeadEntries(body.leads);
  if (validated.ok !== true) return problemResponse(c, validated.code);

  try {
    const db = auth.db;
    const department = await loadDepartment(db, departmentId);
    if (!department) return problemResponse(c, "department_not_found");

    const people = await loadPeople(db, validated.leads.map((lead) => lead.employeeId));
    const peopleProblem = shiftLeadPeopleProblem(validated.leads, people, departmentId);
    if (peopleProblem) return problemResponse(c, peopleProblem);

    // Replace the whole list in one guarded write. The delete-then-insert pair
    // keeps the two-lead limit true by construction; PostgREST has no
    // transaction across the two calls, so a failure between them can leave the
    // department with fewer leads, never with more.
    const removed = await db.remove(SHIFT_LEADS_TABLE, [["department_id", "eq", departmentId]]);
    if (removed?.error) {
      throw Object.assign(new Error("shift lead delete failed"), {
        code: removed.error.code,
      });
    }

    let inserted = [];
    if (validated.leads.length > 0) {
      const result = await db.insertMany(
        SHIFT_LEADS_TABLE,
        shiftLeadRows(validated.leads, {
          departmentId,
          createdBy: auth.session.employeeId,
        }),
        { returning: true }
      );
      if (result.error) {
        if (result.error.code === "23505") return problemResponse(c, "duplicate_label");
        throw Object.assign(new Error("shift lead insert failed"), {
          code: result.error.code,
        });
      }
      inserted = Array.isArray(result.data) ? result.data : [];
    }

    // Department id and a count only: no name, address, label or employee id.
    const audited = await db.insert(AUDIT_TABLE, {
      actor_id: auth.session.employeeId,
      action: ACTION_SHIFT_LEADS_UPDATED,
      entity: ENTITY_DEPARTMENT,
      entity_id: departmentId,
      detail: JSON.stringify({ departmentId, count: validated.leads.length }),
    });
    if (audited.error) {
      throw Object.assign(new Error("shift lead audit failed"), {
        code: audited.error.code,
      });
    }

    const leads = await loadLeads(db, departmentId);
    return c.json(
      {
        ok: true,
        departmentId,
        departmentName: department.name ?? null,
        max: SHIFT_LEADS_MAX,
        labelMaxLength: SHIFT_LABEL_MAX_LENGTH,
        count: leads.length,
        leads,
        inserted: inserted.length,
      },
      200
    );
  } catch (error) {
    logError("hr shift leads write failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default shiftLeads;
