// Employee data management: find an employee, edit that person's data, and
// rename the shared department/position lists.
//
// Mounted twice by src/app.js: /api/hr/directory for HR and
// /api/meeting/directory for meeting controllers. The meeting controller keeps
// the narrow department/position editor; only the HR mount runs in full mode.
//
// Rules kept on purpose:
// - every request re-checks the login role and membership, because a hidden
//   menu item in the browser is never access control;
// - the full HR mode uses the shared requireHrAdmin guard (role hr plus a fresh
//   hr_admins read);
// - the employee list selects no ID card column; a national ID is returned only
//   masked, and only on the detail endpoint;
// - an HR save writes only the fields the HR page offers, checks employee code
//   and national ID uniqueness in the Worker, and audits field names only;
// - an identical save writes nothing, so a double submit can neither repeat the
//   write nor double the audit trail;
// - audit rows never contain a name, email address, phone number, national ID
//   or any other personal value.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { getRequiredEnv } from "../env.js";
import { requireHrAdmin } from "../hr-guard.js";
import { nationalIdHash } from "../national-id.js";
import {
  isValidNationalId,
  maskNationalId,
  normalizeNationalId,
} from "../import/validate.js";
import { decryptNationalId, encryptNationalId } from "../import/national-id-crypto.js";
import { requireRole } from "../require-role.js";

const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const POSITIONS_TABLE = "positions";
const CREDENTIALS_TABLE = "employee_credentials";
const AUDIT_TABLE = "audit_logs";

const MIN_SEARCH_LENGTH = 2;
const LIST_LIMIT = 50;
const NAME_MAX_LENGTH = 100;
const FIRST_LAST_MAX_LENGTH = 60;
const EMPLOYEE_CODE_MAX_LENGTH = 32;
const EMAIL_MAX_LENGTH = 254;
const MAX_BODY_BYTES = 16 * 1024;

const ACTION_EMPLOYEE_PROFILE = "employee_profile_updated";
const ACTION_EMPLOYEE_DEPARTMENT = "employee_department_changed";
const ACTION_EMPLOYEE_POSITION = "employee_position_changed";
const ACTION_DEPARTMENT_RENAMED = "department_renamed";
const ACTION_POSITION_RENAMED = "position_renamed";

const ENTITY_EMPLOYEE = "employee";
const ENTITY_DEPARTMENT = "department";
const ENTITY_POSITION = "position";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^0\d{9}$/;

const MESSAGE = {
  invalid: "ข้อมูลไม่ถูกต้อง",
  searchTooShort: "กรุณาพิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา",
  employeeNotFound: "ไม่พบพนักงาน",
  departmentNotFound: "ไม่พบแผนกที่เลือก",
  positionNotFound: "ไม่พบตำแหน่งที่เลือก",
  itemNotFound: "ไม่พบรายการนี้",
  nameRequired: "กรุณากรอกชื่อใหม่",
  nameTooLong: "ชื่อยาวเกิน 100 ตัวอักษร",
  nameDuplicate: "ชื่อนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น",
  codeRequired: "กรุณากรอกรหัสพนักงาน",
  codeTooLong: "รหัสพนักงานยาวเกิน 32 ตัวอักษร",
  firstNameRequired: "กรุณากรอกชื่อ",
  namePartTooLong: "ชื่อหรือนามสกุลยาวเกิน 60 ตัวอักษร",
  emailInvalid: "อีเมลไม่ถูกต้อง",
  emailTooLong: "อีเมลยาวเกิน 254 ตัวอักษร",
  phoneInvalid: "เบอร์โทรไม่ถูกต้อง (ต้องเป็นตัวเลข 10 หลัก เริ่มด้วย 0)",
  nationalIdInvalid: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลักและถูกต้อง",
  duplicateCode: "รหัสพนักงานนี้มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น",
  duplicateNationalId: "เลขบัตรประชาชนนี้มีอยู่ในระบบแล้ว กรุณาตรวจสอบอีกครั้ง",
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const FULL_EMPLOYEE_COLUMNS =
  "id,employee_code,name_prefix,full_name,email,phone,department_id,position_id,is_active,departments(name),positions(name)";
const SEARCH_EMPLOYEE_COLUMNS =
  "id,employee_code,name_prefix,full_name,email,phone,department_id,position_id,is_active,departments(name),positions(name)";

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

function text(value) {
  return typeof value === "string" ? value : "";
}

/** Logs only the error name and code; never a body, name or value. */
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

/** First row of a to-one embed, which PostgREST returns as object or array. */
function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** Collapses whitespace and trims. The search text is never logged. */
function normalizeSearch(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The or filter for the name and employee code search. Each value is
 * URL-encoded so a comma or parenthesis in the typed text cannot open or close
 * the or=() group; PostgREST decodes each leaf value itself.
 */
function buildSearchFilter(pattern) {
  const encodeOrValue = (value) =>
    encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
  const nameClause = `full_name.ilike.${encodeOrValue(pattern)}`;
  const codeClause = `employee_code.ilike.${encodeOrValue(pattern)}`;
  return `or=(${nameClause},${codeClause})`;
}

/**
 * Body preflight: JSON content type, at most 16 KB, valid JSON. Returns null
 * when any check fails so the caller can answer 400 immediately.
 */
async function readStrictJson(c) {
  if (!isJsonContentType(c.req.header("Content-Type"))) return null;

  const declaredLength = Number(c.req.header("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;

  let textBody;
  try {
    textBody = await c.req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(textBody).length > MAX_BODY_BYTES) return null;

  try {
    const parsed = JSON.parse(textBody);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Strict body: only the given keys, no extras. Missing keys are checked by the caller. */
function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function invalidBody(c) {
  return c.json({ ok: false, message: MESSAGE.invalid }, 400);
}

function textOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function phoneDigits(value) {
  return String(value ?? "").replace(/[\s-]/g, "");
}

/** Splits the stored full_name into the two fields the HR form edits. */
function splitEmployeeName(row) {
  let name = text(row.full_name).replace(/\s+/g, " ").trim();
  const prefix = text(row.name_prefix).replace(/\s+/g, " ").trim();
  // Older rows already carry the prefix inside full_name; do not repeat it.
  if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length).trim();
  if (name.length === 0) return { firstName: "", lastName: "" };
  const space = name.indexOf(" ");
  if (space === -1) return { firstName: name, lastName: "" };
  return { firstName: name.slice(0, space), lastName: name.slice(space + 1).trim() };
}

/** Stores the prefix inside full_name when the row already uses that shape. */
function joinEmployeeName(namePrefix, firstName, lastName) {
  const prefix = text(namePrefix).replace(/\s+/g, " ").trim();
  const name = [firstName, lastName].filter(Boolean).join(" ");
  return prefix ? `${prefix} ${name}` : name;
}

function publicEmployee(row, { full = false, nationalIdMasked = null } = {}) {
  const name = splitEmployeeName(row);
  const result = {
    id: row.id,
    employeeCode: row.employee_code ?? null,
    namePrefix: row.name_prefix ?? null,
    fullName: row.full_name ?? null,
    departmentId: row.department_id ?? null,
    departmentName: firstEmbedded(row.departments)?.name ?? null,
    // Presence only: a picker can warn that a person cannot receive mail
    // without the address ever leaving the Worker.
    hasEmail: typeof row.email === "string" && row.email.trim().length > 0,
    positionId: row.position_id ?? null,
    positionName: firstEmbedded(row.positions)?.name ?? null,
  };

  if (!full) return result;

  return {
    ...result,
    firstName: name.firstName,
    lastName: name.lastName,
    email: textOrNull(row.email),
    phone: textOrNull(row.phone),
    isActive: row.is_active === true,
    ...(nationalIdMasked ? { nationalIdMasked } : {}),
  };
}

async function loadEmployee(db, employeeId) {
  return db.select(EMPLOYEES_TABLE, {
    columns: FULL_EMPLOYEE_COLUMNS,
    filters: [["id", "eq", employeeId]],
    single: true,
  });
}

async function loadCredential(db, employeeId) {
  return db.select(CREDENTIALS_TABLE, {
    columns: "employee_id,national_id_hash,national_id_enc",
    filters: [["employee_id", "eq", employeeId]],
    single: true,
  });
}

async function maskedStoredNationalId(env, credential) {
  if (!credential) return null;
  const key = getRequiredEnv(env, "NATIONAL_ID_ENC_KEY");
  const digits = await decryptNationalId(key, credential.national_id_enc);
  return digits ? maskNationalId(digits) : null;
}

/**
 * Builds the route group for one role. `role` is the session login role and
 * `adminTable` the membership table that must still list the caller. HR uses
 * `manageAll` for the full employee editor; the meeting controller keeps the
 * department/position-only editor.
 */
export function createEmployeeDirectoryRoutes({ role, adminTable, manageAll = false }) {
  const routes = new Hono();

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  /**
   * Role check plus a fresh membership read. The HR full editor uses the one
   * shared HR guard; the meeting controller path keeps its own table.
   */
  async function guard(c) {
    if (manageAll) {
      const auth = await requireHrAdmin(c);
      if (auth.response) return auth.response;
      c.set("directorySession", auth.session);
      c.set("directoryDb", auth.db);
      return null;
    }

    try {
      const auth = await requireRole(c.env, c.req.raw, [role]);
      if (auth.status) {
        return c.json({ ok: false, message: auth.message }, auth.status);
      }

      const db = createDb(c.env);
      const member = await db.select(adminTable, {
        columns: "employee_id",
        filters: [["employee_id", "eq", auth.session.employeeId]],
        single: true,
      });
      if (!member) {
        return c.json({ ok: false, message: MESSAGE.forbidden }, 403);
      }

      c.set("directorySession", auth.session);
      c.set("directoryDb", db);
      return null;
    } catch (error) {
      logError("directory guard failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  }

  // --- GET /employees?q=... --------------------------------------------------
  // Search by name or employee code. The list reads no national ID column.

  routes.get("/employees", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;

    const params = new URL(c.req.raw.url).searchParams;
    const query = normalizeSearch(params.get("q"));
    if (query.length < MIN_SEARCH_LENGTH) {
      return c.json({ ok: false, message: MESSAGE.searchTooShort }, 400);
    }
    // Optional narrowing for a picker that belongs to one department. It is a
    // plain equality filter, applied before the limit, so a small department
    // still finds its own people.
    const departmentId = params.get("departmentId");
    if (departmentId !== null && departmentId !== "" && !isUuid(departmentId)) {
      return invalidBody(c);
    }

    try {
      const db = c.get("directoryDb");
      const filters = [];
      if (departmentId) filters.push(["department_id", "eq", departmentId]);
      const rows = await db.select(EMPLOYEES_TABLE, {
        columns: SEARCH_EMPLOYEE_COLUMNS,
        filters,
        extra: [buildSearchFilter(`%${query}%`)],
        order: "employee_code.asc",
        limit: LIST_LIMIT,
      });

      const results = rows.map((row) => publicEmployee(row, { full: manageAll }));
      return c.json(
        { ok: true, query, limit: LIST_LIMIT, count: results.length, results },
        200
      );
    } catch (error) {
      logError("directory employee search failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  });

  // --- GET /employees/:id ----------------------------------------------------
  // Full mode only. The HR form needs the stored contact fields and the masked
  // national ID; the raw ID is never returned.

  routes.get("/employees/:id", async (c) => {
    if (!manageAll) return c.json({ ok: false, message: MESSAGE.itemNotFound }, 404);

    const denied = await guard(c);
    if (denied) return denied;

    const employeeId = c.req.param("id");
    if (!isUuid(employeeId)) return invalidBody(c);

    try {
      const db = c.get("directoryDb");
      const employee = await loadEmployee(db, employeeId);
      if (!employee) return c.json({ ok: false, message: MESSAGE.employeeNotFound }, 404);

      const credential = await loadCredential(db, employeeId);
      const nationalIdMasked = await maskedStoredNationalId(c.env, credential);
      return c.json(
        {
          ok: true,
          employee: publicEmployee(employee, { full: true, nationalIdMasked }),
        },
        200
      );
    } catch (error) {
      logError("directory employee read failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  });

  // --- GET /catalog ----------------------------------------------------------
  // The department and position lists used by both the employee form and the
  // rename form.

  routes.get("/catalog", async (c) => {
    // Departments and position names are shared lookups, not caller data.
    c.header("Cache-Control", "private, max-age=300");
    const denied = await guard(c);
    if (denied) return denied;

    try {
      const db = c.get("directoryDb");
      const [departments, positions] = await Promise.all([
        // The same rule the profile dropdown uses: only active departments are
        // offered as a choice, so a deactivated row cannot be picked.
        db.select(DEPARTMENTS_TABLE, {
          columns: "id,name",
          filters: [["is_active", "eq", true]],
          order: "name.asc",
        }),
        db.select(POSITIONS_TABLE, { columns: "id,name", order: "name.asc" }),
      ]);

      const rows = (list) =>
        list
          .filter((row) => row.id && typeof row.name === "string")
          .map((row) => ({ id: row.id, name: row.name }));

      return c.json(
        { ok: true, departments: rows(departments), positions: rows(positions) },
        200
      );
    } catch (error) {
      logError("directory catalog failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  });

  // --- PATCH /employees/:id --------------------------------------------------
  // HR full mode edits every field the HR page offers. The meeting controller
  // keeps the narrow department/position behaviour below.

  async function patchFullEmployee(c) {
    const denied = await guard(c);
    if (denied) return denied;

    const employeeId = c.req.param("id");
    if (!isUuid(employeeId)) return invalidBody(c);

    const body = await readStrictJson(c);
    const keys = [
      "employeeCode",
      "firstName",
      "lastName",
      "nationalId",
      "email",
      "phone",
      "departmentId",
      "positionId",
      "isActive",
    ];
    if (!hasOnlyKeys(body, keys)) return invalidBody(c);
    for (const key of [
      "employeeCode",
      "firstName",
      "lastName",
      "email",
      "phone",
      "departmentId",
      "isActive",
    ]) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) return invalidBody(c);
    }

    const errors = {};
    const employeeCode =
      typeof body.employeeCode === "string" ? body.employeeCode.trim() : "";
    if (employeeCode.length === 0) errors.employeeCode = MESSAGE.codeRequired;
    else if (Array.from(employeeCode).length > EMPLOYEE_CODE_MAX_LENGTH) {
      errors.employeeCode = MESSAGE.codeTooLong;
    }

    const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
    if (firstName.length === 0) errors.firstName = MESSAGE.firstNameRequired;
    if (
      Array.from(firstName).length > FIRST_LAST_MAX_LENGTH ||
      Array.from(lastName).length > FIRST_LAST_MAX_LENGTH
    ) {
      errors.firstName = errors.firstName ?? MESSAGE.namePartTooLong;
      errors.lastName = MESSAGE.namePartTooLong;
    }

    let email = null;
    if (typeof body.email === "string") {
      email = textOrNull(body.email);
      if (email && email.length > EMAIL_MAX_LENGTH) errors.email = MESSAGE.emailTooLong;
      else if (email && !EMAIL_PATTERN.test(email)) errors.email = MESSAGE.emailInvalid;
    } else if (body.email !== null) {
      errors.email = MESSAGE.emailInvalid;
    }

    let phone = null;
    if (typeof body.phone === "string") {
      phone = phoneDigits(body.phone);
      if (phone.length === 0) phone = null;
      else if (!MOBILE_PATTERN.test(phone)) errors.phone = MESSAGE.phoneInvalid;
    } else if (body.phone !== null) {
      errors.phone = MESSAGE.phoneInvalid;
    }

    const departmentId = body.departmentId;
    if (!isUuid(departmentId)) errors.departmentId = MESSAGE.departmentNotFound;

    const positionId =
      body.positionId === undefined || body.positionId === null ? null : body.positionId;
    if (positionId !== null && !isUuid(positionId)) {
      errors.positionId = MESSAGE.positionNotFound;
    }

    if (typeof body.isActive !== "boolean") {
      errors.isActive = "สถานะไม่ถูกต้อง";
    }

    const nationalIdRaw = body.nationalId === undefined || body.nationalId === null
      ? ""
      : typeof body.nationalId === "string"
        ? body.nationalId
        : null;
    const nationalId = nationalIdRaw === null ? "" : normalizeNationalId(nationalIdRaw);
    if (nationalIdRaw !== "" && !isValidNationalId(nationalId)) {
      errors.nationalId = MESSAGE.nationalIdInvalid;
    }

    if (Object.keys(errors).length > 0) {
      return c.json({ ok: false, message: MESSAGE.invalid, errors }, 400);
    }

    try {
      const db = c.get("directoryDb");
      const session = c.get("directorySession");

      const employee = await loadEmployee(db, employeeId);
      if (!employee) return c.json({ ok: false, message: MESSAGE.employeeNotFound }, 404);

      const currentName = splitEmployeeName(employee);
      const currentEmail = textOrNull(employee.email);
      const currentPhone = textOrNull(phoneDigits(employee.phone));
      const currentDepartmentId = employee.department_id ?? null;
      const currentPositionId = employee.position_id ?? null;
      const currentIsActive = employee.is_active === true;

      const firstNameChanged = firstName !== currentName.firstName;
      const lastNameChanged = lastName !== currentName.lastName;
      const nameChanged = firstNameChanged || lastNameChanged;
      const codeChanged = employeeCode !== (employee.employee_code ?? "");
      const emailChanged = email !== currentEmail;
      const phoneChanged = phone !== currentPhone;
      const departmentChanged = departmentId !== currentDepartmentId;
      const positionChanged = positionId !== currentPositionId;
      const statusChanged = body.isActive !== currentIsActive;

      const credential = await loadCredential(db, employeeId);
      const currentHash =
        typeof credential?.national_id_hash === "string"
          ? credential.national_id_hash.toLowerCase()
          : "";
      let nationalHash = null;
      if (nationalId.length > 0) {
        nationalHash = await nationalIdHash(
          nationalId,
          getRequiredEnv(c.env, "NATIONAL_ID_PEPPER")
        );
      }
      const nationalIdChanged =
        nationalHash !== null && nationalHash.toLowerCase() !== currentHash;

      const changedFields = [];
      if (codeChanged) changedFields.push("employee_code");
      if (firstNameChanged) changedFields.push("first_name");
      if (lastNameChanged) changedFields.push("last_name");
      if (nationalIdChanged) changedFields.push("national_id");
      if (emailChanged) changedFields.push("email");
      if (phoneChanged) changedFields.push("phone");
      if (departmentChanged) changedFields.push("department_id");
      if (positionChanged) changedFields.push("position_id");
      if (statusChanged) changedFields.push("is_active");

      if (changedFields.length === 0) {
        return c.json(
          {
            ok: true,
            changed: false,
            employee: publicEmployee(employee, {
              full: true,
              nationalIdMasked: await maskedStoredNationalId(c.env, credential),
            }),
          },
          200
        );
      }

      let department = null;
      if (departmentChanged) {
        department = await db.select(DEPARTMENTS_TABLE, {
          columns: "id,name,is_active",
          filters: [["id", "eq", departmentId]],
          single: true,
        });
        if (!department) {
          return c.json(
            { ok: false, message: MESSAGE.departmentNotFound, errors: { departmentId: MESSAGE.departmentNotFound } },
            400
          );
        }
        if (department.is_active === false) {
          return c.json(
            {
              ok: false,
              message: MESSAGE.departmentNotFound,
              errors: { departmentId: MESSAGE.departmentNotFound },
            },
            400
          );
        }
      }

      let position = null;
      if (positionChanged && positionId !== null) {
        position = await db.select(POSITIONS_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", positionId]],
          single: true,
        });
        if (!position) {
          return c.json(
            { ok: false, message: MESSAGE.positionNotFound, errors: { positionId: MESSAGE.positionNotFound } },
            400
          );
        }
      }

      if (codeChanged) {
        const duplicate = await db.select(EMPLOYEES_TABLE, {
          columns: "id",
          filters: [
            ["employee_code", "eq", employeeCode],
            ["id", "neq", employeeId],
          ],
          single: true,
        });
        if (duplicate) {
          return c.json(
            {
              ok: false,
              code: "duplicate_employee_code",
              message: MESSAGE.duplicateCode,
              errors: { employeeCode: MESSAGE.duplicateCode },
            },
            409
          );
        }
      }

      if (nationalIdChanged) {
        const duplicate = await db.select(CREDENTIALS_TABLE, {
          columns: "employee_id",
          filters: [
            ["national_id_hash", "eq", nationalHash],
            ["employee_id", "neq", employeeId],
          ],
          single: true,
        });
        if (duplicate) {
          return c.json(
            {
              ok: false,
              code: "duplicate_national_id",
              message: MESSAGE.duplicateNationalId,
              errors: { nationalId: MESSAGE.duplicateNationalId },
            },
            409
          );
        }
      }

      const patch = {};
      if (codeChanged) patch.employee_code = employeeCode;
      if (nameChanged) {
        const joined = joinEmployeeName(employee.name_prefix, firstName, lastName);
        if (Array.from(joined).length > NAME_MAX_LENGTH) {
          return c.json(
            { ok: false, message: MESSAGE.invalid, errors: { firstName: MESSAGE.namePartTooLong } },
            400
          );
        }
        patch.full_name = joined;
      }
      if (emailChanged) patch.email = email;
      if (phoneChanged) patch.phone = phone;
      if (departmentChanged) patch.department_id = departmentId;
      if (positionChanged) patch.position_id = positionId;
      if (statusChanged) patch.is_active = body.isActive;

      // A national-ID-only change has no employee columns to write. Do not
      // send an empty PATCH; the credential upsert and audit still run.
      if (Object.keys(patch).length > 0) {
        const updated = await db.update(EMPLOYEES_TABLE, patch, [["id", "eq", employeeId]], {
          returning: true,
          columns: "id",
        });
        if (updated.error) {
          if (updated.error.code === "23505" && codeChanged) {
            return c.json(
              {
                ok: false,
                code: "duplicate_employee_code",
                message: MESSAGE.duplicateCode,
                errors: { employeeCode: MESSAGE.duplicateCode },
              },
              409
            );
          }
          throw Object.assign(new Error("employee update failed"), { code: updated.error.code });
        }
        if (!Array.isArray(updated.data) || updated.data.length === 0) {
          return c.json({ ok: false, message: MESSAGE.employeeNotFound }, 404);
        }
      }

      let maskedNationalId = await maskedStoredNationalId(c.env, credential);
      if (nationalIdChanged) {
        const nowIso = new Date().toISOString();
        ensureOk(
          await db.upsert(
            CREDENTIALS_TABLE,
            {
              employee_id: employeeId,
              national_id_hash: nationalHash,
              national_id_enc: await encryptNationalId(
                getRequiredEnv(c.env, "NATIONAL_ID_ENC_KEY"),
                nationalId
              ),
              updated_at: nowIso,
            },
            { conflict: "employee_id", columns: "employee_id" }
          )
        );
        maskedNationalId = maskNationalId(nationalId);
      }

      ensureOk(
        await db.insert(AUDIT_TABLE, {
          actor_id: session.employeeId,
          action: ACTION_EMPLOYEE_PROFILE,
          entity: ENTITY_EMPLOYEE,
          entity_id: employeeId,
          // Field names only. No old value, new value or personal data.
          detail: JSON.stringify({ fields: changedFields }),
        })
      );

      return c.json(
        {
          ok: true,
          changed: true,
          employee: publicEmployee(
            {
              ...employee,
              ...patch,
              departments: department ? { name: department.name } : employee.departments,
              positions: position ? { name: position.name } : employee.positions,
            },
            { full: true, nationalIdMasked: maskedNationalId }
          ),
        },
        200
      );
    } catch (error) {
      logError("directory employee update failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  }

  async function patchDirectoryEmployee(c) {
    const denied = await guard(c);
    if (denied) return denied;

    const employeeId = c.req.param("id");
    if (!isUuid(employeeId)) return invalidBody(c);

    const body = await readStrictJson(c);
    if (!hasOnlyKeys(body, ["departmentId", "positionId"])) return invalidBody(c);
    if (!Object.prototype.hasOwnProperty.call(body, "departmentId")) return invalidBody(c);
    if (!isUuid(body.departmentId)) return invalidBody(c);

    const positionId =
      body.positionId === undefined || body.positionId === null ? null : body.positionId;
    if (positionId !== null && !isUuid(positionId)) return invalidBody(c);

    try {
      const db = c.get("directoryDb");
      const session = c.get("directorySession");

      const employee = await loadEmployee(db, employeeId);
      if (!employee) return c.json({ ok: false, message: MESSAGE.employeeNotFound }, 404);

      const department = await db.select(DEPARTMENTS_TABLE, {
        columns: "id,name",
        filters: [["id", "eq", body.departmentId]],
        single: true,
      });
      if (!department) {
        return c.json({ ok: false, message: MESSAGE.departmentNotFound }, 400);
      }

      let position = null;
      if (positionId !== null) {
        position = await db.select(POSITIONS_TABLE, {
          columns: "id,name",
          filters: [["id", "eq", positionId]],
          single: true,
        });
        if (!position) {
          return c.json({ ok: false, message: MESSAGE.positionNotFound }, 400);
        }
      }

      const currentDepartmentId = employee.department_id ?? null;
      const currentPositionId = employee.position_id ?? null;
      const departmentChanged = currentDepartmentId !== body.departmentId;
      const positionChanged = currentPositionId !== positionId;

      if (!departmentChanged && !positionChanged) {
        return c.json({ ok: true, changed: false, employee: publicEmployee(employee) }, 200);
      }

      const patch = {};
      if (departmentChanged) patch.department_id = body.departmentId;
      if (positionChanged) patch.position_id = positionId;

      const updated = ensureOk(
        await db.update(EMPLOYEES_TABLE, patch, [["id", "eq", employeeId]], {
          returning: true,
          columns: "id",
        })
      );
      if (!Array.isArray(updated.data) || updated.data.length === 0) {
        return c.json({ ok: false, message: MESSAGE.employeeNotFound }, 404);
      }

      const auditRows = [];
      if (departmentChanged) {
        auditRows.push({
          actor_id: session.employeeId,
          action: ACTION_EMPLOYEE_DEPARTMENT,
          entity: ENTITY_EMPLOYEE,
          entity_id: employeeId,
          detail: JSON.stringify({
            before: { departmentName: firstEmbedded(employee.departments)?.name ?? null },
            after: { departmentName: department.name ?? null },
          }),
        });
      }
      if (positionChanged) {
        auditRows.push({
          actor_id: session.employeeId,
          action: ACTION_EMPLOYEE_POSITION,
          entity: ENTITY_EMPLOYEE,
          entity_id: employeeId,
          detail: JSON.stringify({
            before: { positionName: firstEmbedded(employee.positions)?.name ?? null },
            after: { positionName: position?.name ?? null },
          }),
        });
      }
      ensureOk(await db.insertMany(AUDIT_TABLE, auditRows));

      return c.json(
        {
          ok: true,
          changed: true,
          employee: {
            ...publicEmployee(employee),
            departmentId: body.departmentId,
            departmentName: department.name ?? null,
            positionId,
            positionName: position?.name ?? null,
          },
        },
        200
      );
    } catch (error) {
      logError("directory employee update failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  }

  routes.patch("/employees/:id", (c) =>
    manageAll ? patchFullEmployee(c) : patchDirectoryEmployee(c)
  );

  /**
   * Renames one department or position. The list entry keeps its id, so every
   * employee and every imported file that points at the id follows the new name.
   */
  async function rename(c, table, action, entity) {
    const denied = await guard(c);
    if (denied) return denied;

    const id = c.req.param("id");
    if (!isUuid(id)) return invalidBody(c);

    const body = await readStrictJson(c);
    if (!hasOnlyKeys(body, ["name"]) || !Object.prototype.hasOwnProperty.call(body, "name")) {
      return invalidBody(c);
    }
    if (typeof body.name !== "string") return invalidBody(c);

    const name = body.name.trim();
    if (name.length === 0) return c.json({ ok: false, message: MESSAGE.nameRequired }, 400);
    if (Array.from(name).length > NAME_MAX_LENGTH) {
      return c.json({ ok: false, message: MESSAGE.nameTooLong }, 400);
    }

    try {
      const db = c.get("directoryDb");
      const session = c.get("directorySession");

      const current = await db.select(table, {
        columns: "id,name",
        filters: [["id", "eq", id]],
        single: true,
      });
      if (!current) return c.json({ ok: false, message: MESSAGE.itemNotFound }, 404);

      // A repeat of the same rename (a double submit) writes nothing.
      if (current.name === name) {
        return c.json({ ok: true, changed: false, item: { id, name } }, 200);
      }

      const duplicate = await db.select(table, {
        columns: "id,name",
        filters: [
          ["name", "eq", name],
          ["id", "neq", id],
        ],
        single: true,
      });
      if (duplicate) return c.json({ ok: false, message: MESSAGE.nameDuplicate }, 409);

      const updated = await db.update(table, { name }, [["id", "eq", id]], {
        returning: true,
        columns: "id,name",
      });
      if (updated.error) {
        // The unique constraint is the last line of defence against two
        // simultaneous renames to the same name.
        if (updated.error.code === "23505") {
          return c.json({ ok: false, message: MESSAGE.nameDuplicate }, 409);
        }
        throw Object.assign(new Error("rename failed"), { code: updated.error.code });
      }
      if (!Array.isArray(updated.data) || updated.data.length === 0) {
        return c.json({ ok: false, message: MESSAGE.itemNotFound }, 404);
      }

      ensureOk(
        await db.insert(AUDIT_TABLE, {
          actor_id: session.employeeId,
          action,
          entity,
          entity_id: id,
          detail: JSON.stringify({
            before: { name: current.name ?? null },
            after: { name },
          }),
        })
      );

      return c.json({ ok: true, changed: true, item: { id, name } }, 200);
    } catch (error) {
      logError("directory rename failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  }

  // --- PATCH /departments/:id and PATCH /positions/:id ----------------------

  routes.patch("/departments/:id", (c) =>
    rename(c, DEPARTMENTS_TABLE, ACTION_DEPARTMENT_RENAMED, ENTITY_DEPARTMENT)
  );

  routes.patch("/positions/:id", (c) =>
    rename(c, POSITIONS_TABLE, ACTION_POSITION_RENAMED, ENTITY_POSITION)
  );

  return routes;
}

export default createEmployeeDirectoryRoutes;
