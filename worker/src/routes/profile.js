// Employee self-service profile. Mounted at /api/profile by src/app.js.
//
// Scope kept on purpose:
// - the employee id always comes from the session; nothing in the body or the
//   path can point this route at somebody else;
// - PROFILE_EDITABLE_FIELDS is an allow-list, so employee_code, position,
//   is_active and any unknown key are refused with 400 instead of being
//   dropped silently;
// - department_id must be an existing ACTIVE id from the departments table, so
//   a department name or free text can never be stored;
// - one audit row per save, with detail null: no name, email or phone ever
//   reaches the audit trail;
// - national_id is neither selected nor returned. It lives in
//   employee_credentials, not on the employees row this route reads.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";

const profile = new Hono();

// Every route here reads and writes the caller's own employee row (the id always
// comes from the session), so the login role does not open or close it.
const ALLOWED_ROLES = ["employee", "hr", "meeting_controller", "system_admin"];

const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const POSITIONS_TABLE = "positions";
const PREFIXES_TABLE = "name_prefixes";
const AUDIT_TABLE = "audit_logs";

/** The only columns a PATCH may write. Anything else is a 400. */
export const PROFILE_EDITABLE_FIELDS = Object.freeze([
  "name_prefix",
  "full_name",
  "email",
  "phone",
  "department_id",
]);

const ACTION_PROFILE_UPDATED = "profile_updated";
const ACTION_DEPARTMENT_CHANGED = "profile_department_changed";
const ENTITY_EMPLOYEE = "employee";

const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 254;
// The same limit the employee import applies to the prefix cell
// (worker/src/import/validate.js MAX_LENGTHS.prefix).
const PREFIX_MAX_LENGTH = 20;
const MAX_BODY_BYTES = 8 * 1024;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^0\d{9}$/;

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const MESSAGE = {
  invalid: "ข้อมูลไม่ถูกต้อง",
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  unknownField: "มีฟิลด์ที่ไม่สามารถแก้ไขได้",
  nothingToSave: "ไม่มีข้อมูลที่จะบันทึก",
  nameRequired: "กรุณากรอกชื่อ-นามสกุล",
  nameTooLong: "ชื่อ-นามสกุลยาวเกิน 100 ตัวอักษร",
  emailInvalid: "อีเมลไม่ถูกต้อง",
  emailTooLong: "อีเมลยาวเกิน 254 ตัวอักษร",
  phoneInvalid: "เบอร์มือถือไม่ถูกต้อง (ต้องเป็นตัวเลข 10 หลัก เริ่มด้วย 0)",
  prefixRequired: "กรุณาเลือกคำนำหน้า",
  prefixTooLong: "คำนำหน้ายาวเกิน 20 ตัวอักษร",
  prefixUnknown: "ไม่พบคำนำหน้าที่เลือก",
  departmentNotFound: "ไม่พบแผนกที่เลือก",
  departmentInactive: "แผนกที่เลือกปิดใช้งาน กรุณาเลือกแผนกที่ใช้งานอยู่",
};

const EMPLOYEE_COLUMNS =
  "id,employee_code,name_prefix,full_name,email,phone,department_id,position_id,is_active";

profile.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
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
  if (text.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function textOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Digits of a Thai mobile number; dashes and spaces are separators. */
export function mobileDigits(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

export function isThaiMobile(value) {
  return MOBILE_PATTERN.test(mobileDigits(value));
}

function publicProfile({ employee, department, position }) {
  return {
    id: employee.id,
    employeeCode: employee.employee_code ?? null,
    namePrefix: employee.name_prefix ?? null,
    fullName: employee.full_name ?? null,
    email: textOrNull(employee.email),
    phone: textOrNull(employee.phone),
    departmentId: employee.department_id ?? null,
    departmentName: department?.name ?? null,
    // true/false only when a department is set, so the page can flag an
    // inactive current department without a second request.
    departmentActive: department ? department.is_active !== false : null,
    positionName: position?.name ?? null,
    isActive: employee.is_active === true,
  };
}

/** The caller's own row plus its department and position names. */
async function loadProfile(db, employeeId) {
  const employee = await db.select(EMPLOYEES_TABLE, {
    columns: EMPLOYEE_COLUMNS,
    filters: [["id", "eq", employeeId]],
    single: true,
  });
  if (!employee) return null;

  const [department, position] = await Promise.all([
    employee.department_id
      ? db.select(DEPARTMENTS_TABLE, {
          columns: "id,name,is_active",
          filters: [["id", "eq", employee.department_id]],
          single: true,
        })
      : Promise.resolve(null),
    employee.position_id
      ? db.select(POSITIONS_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", employee.position_id]],
          single: true,
        })
      : Promise.resolve(null),
  ]);

  return { employee, department, position };
}

/** Role check plus a fresh active-employee read, like the leave guard. */
async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, ALLOWED_ROLES);
  if (auth.status) {
    return { response: c.json({ ok: false, message: auth.message }, auth.status) };
  }

  try {
    const db = createDb(c.env);
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,is_active",
      filters: [["id", "eq", auth.session.employeeId]],
      single: true,
    });
    if (!employee || employee.is_active !== true) {
      return { response: c.json({ ok: false, message: MESSAGE.forbidden }, 403) };
    }

    c.set("profileDb", db);
    c.set("profileSession", auth.session);
    return null;
  } catch (error) {
    logError("profile guard failed", error);
    return { response: c.json({ ok: false, message: MESSAGE.saveError }, 500) };
  }
}

// --- GET /api/profile/me -----------------------------------------------------

profile.get("/me", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const loaded = await loadProfile(c.get("profileDb"), c.get("profileSession").employeeId);
    if (!loaded) return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    return c.json({ ok: true, profile: publicProfile(loaded) }, 200);
  } catch (error) {
    logError("profile read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/profile/departments -------------------------------------------
// The only source for the dropdown: active departments, id and name only.

profile.get("/departments", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const rows = await c.get("profileDb").select(DEPARTMENTS_TABLE, {
      columns: "id,name",
      filters: [["is_active", "eq", true]],
      order: "name.asc",
    });

    const departments = rows
      .filter((row) => row.id && typeof row.name === "string" && row.name.length > 0)
      .map((row) => ({ id: row.id, name: row.name }));

    // Active departments, id and name only: the same list for every employee.
    c.header("Cache-Control", "private, max-age=300");
    return c.json({ ok: true, count: departments.length, departments }, 200);
  } catch (error) {
    logError("profile departments failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/profile/name-prefixes -------------------------------------------
// The prefix dropdown source: active rows of name_prefixes, names only.

profile.get("/name-prefixes", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const rows = await c.get("profileDb").select(PREFIXES_TABLE, {
      columns: "name",
      filters: [["is_active", "eq", true]],
      order: "name.asc",
    });

    const prefixes = [
      ...new Set(
        rows
          .map((row) => (typeof row.name === "string" ? row.name.replace(/\s+/g, " ").trim() : ""))
          .filter((name) => name.length > 0)
      ),
    ];

    // Prefix names only, identical for every signed-in employee.
    c.header("Cache-Control", "private, max-age=300");
    return c.json({ ok: true, count: prefixes.length, prefixes }, 200);
  } catch (error) {
    logError("profile name prefixes failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- PATCH /api/profile/me ---------------------------------------------------

profile.patch("/me", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const body = await readStrictJson(c);
  if (!body) return c.json({ ok: false, message: MESSAGE.invalid, errors: {} }, 400);

  // Unknown keys are refused, never ignored: employee_code, position, role and
  // is_active must not look like they were accepted.
  if (Object.keys(body).some((key) => !PROFILE_EDITABLE_FIELDS.includes(key))) {
    return c.json({ ok: false, message: MESSAGE.unknownField, errors: {} }, 400);
  }
  if (Object.keys(body).length === 0) {
    return c.json({ ok: false, message: MESSAGE.nothingToSave, errors: {} }, 400);
  }

  const errors = {};
  const candidate = {};

  if (Object.prototype.hasOwnProperty.call(body, "name_prefix")) {
    if (typeof body.name_prefix !== "string") {
      errors.name_prefix = MESSAGE.prefixRequired;
    } else {
      const value = body.name_prefix.replace(/\s+/g, " ").trim();
      if (value.length === 0) errors.name_prefix = MESSAGE.prefixRequired;
      else if (Array.from(value).length > PREFIX_MAX_LENGTH) {
        errors.name_prefix = MESSAGE.prefixTooLong;
      } else candidate.name_prefix = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "full_name")) {
    if (typeof body.full_name !== "string") {
      errors.full_name = MESSAGE.nameRequired;
    } else {
      const value = body.full_name.replace(/\s+/g, " ").trim();
      if (value.length === 0) errors.full_name = MESSAGE.nameRequired;
      else if (Array.from(value).length > NAME_MAX_LENGTH) errors.full_name = MESSAGE.nameTooLong;
      else candidate.full_name = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "email")) {
    if (body.email === null) {
      candidate.email = null;
    } else if (typeof body.email !== "string") {
      errors.email = MESSAGE.emailInvalid;
    } else {
      const value = body.email.trim();
      if (value.length === 0) candidate.email = null;
      else if (value.length > EMAIL_MAX_LENGTH) errors.email = MESSAGE.emailTooLong;
      else if (!EMAIL_PATTERN.test(value)) errors.email = MESSAGE.emailInvalid;
      else candidate.email = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "phone")) {
    if (body.phone === null) {
      candidate.phone = null;
    } else if (typeof body.phone !== "string") {
      errors.phone = MESSAGE.phoneInvalid;
    } else {
      const digits = mobileDigits(body.phone);
      if (digits.length === 0) candidate.phone = null;
      else if (!MOBILE_PATTERN.test(digits)) errors.phone = MESSAGE.phoneInvalid;
      else candidate.phone = digits;
    }
  }

  const departmentGiven = Object.prototype.hasOwnProperty.call(body, "department_id");
  if (departmentGiven && !isUuid(body.department_id)) {
    // A department name or any free text lands here: only an id is accepted.
    errors.department_id = MESSAGE.departmentNotFound;
  }

  if (Object.keys(errors).length > 0) {
    return c.json({ ok: false, message: MESSAGE.invalid, errors }, 400);
  }

  try {
    const db = c.get("profileDb");
    const session = c.get("profileSession");

    const loaded = await loadProfile(db, session.employeeId);
    if (!loaded) return c.json({ ok: false, message: MESSAGE.forbidden }, 403);

    // A prefix is a lookup value, never free text: it must be an active row of
    // name_prefixes, the same list the HR import validates against.
    if (candidate.name_prefix !== undefined) {
      const prefix = await db.select(PREFIXES_TABLE, {
        columns: "name",
        filters: [
          ["name", "eq", candidate.name_prefix],
          ["is_active", "eq", true],
        ],
        single: true,
      });
      if (!prefix) {
        return c.json(
          { ok: false, message: MESSAGE.invalid, errors: { name_prefix: MESSAGE.prefixUnknown } },
          400
        );
      }
    }

    if (departmentGiven) {
      const department = await db.select(DEPARTMENTS_TABLE, {
        columns: "id,name,is_active",
        filters: [["id", "eq", body.department_id]],
        single: true,
      });
      if (!department) {
        return c.json(
          { ok: false, message: MESSAGE.invalid, errors: { department_id: MESSAGE.departmentNotFound } },
          400
        );
      }
      if (department.is_active === false) {
        return c.json(
          { ok: false, message: MESSAGE.invalid, errors: { department_id: MESSAGE.departmentInactive } },
          400
        );
      }
      candidate.department_id = body.department_id;
    }

    // Only changed columns are written; an identical submit writes nothing.
    const changes = {};
    for (const [column, value] of Object.entries(candidate)) {
      const current =
        column === "email" || column === "phone"
          ? textOrNull(loaded.employee[column])
          : column === "department_id"
            ? loaded.employee.department_id ?? null
            : loaded.employee[column] ?? null;
      if (current !== value) changes[column] = value;
    }

    if (Object.keys(changes).length === 0) {
      return c.json({ ok: true, changed: false, profile: publicProfile(loaded) }, 200);
    }

    const updated = ensureOk(
      await db.update(EMPLOYEES_TABLE, changes, [["id", "eq", loaded.employee.id]], {
        returning: true,
        columns: "id",
      })
    );
    if (!Array.isArray(updated.data) || updated.data.length === 0) {
      return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
    }

    // One audit row, detail null: the action says what changed, never a value.
    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: session.employeeId,
        action:
          changes.department_id === undefined ? ACTION_PROFILE_UPDATED : ACTION_DEPARTMENT_CHANGED,
        entity: ENTITY_EMPLOYEE,
        entity_id: loaded.employee.id,
        detail: null,
      })
    );

    const refreshed = await loadProfile(db, session.employeeId);
    return c.json(
      {
        ok: true,
        changed: true,
        profile: publicProfile(refreshed ?? loaded),
      },
      200
    );
  } catch (error) {
    logError("profile update failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default profile;
