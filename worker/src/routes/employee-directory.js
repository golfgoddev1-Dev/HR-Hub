// Employee data management: find an employee, change that person's department
// and position, and rename the shared department/position lists.
//
// Mounted twice by src/app.js: /api/hr/directory for HR and
// /api/meeting/directory for meeting controllers. Both mounts use the same
// handlers; only the allowed login role and the membership table differ.
//
// Rules kept on purpose:
// - every request re-checks the login role and the admin table, because a
//   hidden menu item in the browser is never access control;
// - the employee list selects no ID card column and never touches
//   employee_credentials;
// - an employee update sends only department_id and position_id;
// - audit rows carry department/position names only, never an ID card number, a
//   PIN or any other employee field;
// - an identical change writes nothing, so a double submit can neither repeat
//   the write nor double the audit trail.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";

const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const POSITIONS_TABLE = "positions";
const AUDIT_TABLE = "audit_logs";

const MIN_SEARCH_LENGTH = 2;
const LIST_LIMIT = 50;
const NAME_MAX_LENGTH = 100;
const MAX_BODY_BYTES = 4 * 1024;

const ACTION_EMPLOYEE_DEPARTMENT = "employee_department_changed";
const ACTION_EMPLOYEE_POSITION = "employee_position_changed";
const ACTION_DEPARTMENT_RENAMED = "department_renamed";
const ACTION_POSITION_RENAMED = "position_renamed";

const ENTITY_EMPLOYEE = "employee";
const ENTITY_DEPARTMENT = "department";
const ENTITY_POSITION = "position";

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
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
};

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

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
 * Body preflight: JSON content type, at most 4 KB, valid JSON. Returns null when
 * any check fails so the caller can answer 400 immediately.
 */
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

/** Strict body: only the given keys, no extras. Missing keys are checked by the caller. */
function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function invalidBody(c) {
  return c.json({ ok: false, message: MESSAGE.invalid }, 400);
}

function publicEmployee(row) {
  return {
    id: row.id,
    employeeCode: row.employee_code ?? null,
    namePrefix: row.name_prefix ?? null,
    fullName: row.full_name ?? null,
    departmentId: row.department_id ?? null,
    departmentName: firstEmbedded(row.departments)?.name ?? null,
    positionId: row.position_id ?? null,
    positionName: firstEmbedded(row.positions)?.name ?? null,
  };
}

/**
 * Builds the route group for one role. `role` is the session login role and
 * `adminTable` the membership table that must still list the caller.
 */
export function createEmployeeDirectoryRoutes({ role, adminTable }) {
  const routes = new Hono();

  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  /**
   * Role check plus a fresh membership read. A revoked admin keeps a valid
   * session for a few more requests, so the table is re-read here.
   */
  async function guard(c) {
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
  // Search by name or employee code. Only the employees table is read, so an
  // ID card column cannot appear in this response.

  routes.get("/employees", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;

    const query = normalizeSearch(new URL(c.req.raw.url).searchParams.get("q"));
    if (query.length < MIN_SEARCH_LENGTH) {
      return c.json({ ok: false, message: MESSAGE.searchTooShort }, 400);
    }

    try {
      const db = c.get("directoryDb");
      const rows = await db.select(EMPLOYEES_TABLE, {
        columns:
          "id,employee_code,name_prefix,full_name,department_id,position_id,departments(name),positions(name)",
        extra: [buildSearchFilter(`%${query}%`)],
        order: "employee_code.asc",
        limit: LIST_LIMIT,
      });

      const results = rows.map(publicEmployee);
      return c.json(
        { ok: true, query, limit: LIST_LIMIT, count: results.length, results },
        200
      );
    } catch (error) {
      logError("directory employee search failed", error);
      return c.json({ ok: false, message: MESSAGE.saveError }, 500);
    }
  });

  // --- GET /catalog ----------------------------------------------------------
  // The department and position lists used by both the employee form and the
  // rename form.

  routes.get("/catalog", async (c) => {
    const denied = await guard(c);
    if (denied) return denied;

    try {
      const db = c.get("directoryDb");
      const [departments, positions] = await Promise.all([
        db.select(DEPARTMENTS_TABLE, { columns: "id,name", order: "name.asc" }),
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
  // Writes department_id and position_id only. Everything else on the row is
  // left untouched, and the audit row holds names, not ids or personal data.

  routes.patch("/employees/:id", async (c) => {
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

      const employee = await db.select(EMPLOYEES_TABLE, {
        columns:
          "id,employee_code,name_prefix,full_name,department_id,position_id,departments(name),positions(name)",
        filters: [["id", "eq", employeeId]],
        single: true,
      });
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
  });

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
