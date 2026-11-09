// Employee self-service profile. Mounted at /api/profile by src/app.js.
//
// Personal data is read-only for the employee. Every edit now lives on the
// HR-only page, so the self-service PATCH is refused at the Worker even if a
// client calls it directly. The PIN change is a separate route and is not
// touched here.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";

const profile = new Hono();

const ALLOWED_ROLES = ["employee", "hr", "meeting_controller", "system_admin"];

const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const POSITIONS_TABLE = "positions";
const PREFIXES_TABLE = "name_prefixes";

const MESSAGE = {
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  readOnly: "ข้อมูลส่วนตัวเป็นแบบอ่านอย่างเดียว กรุณาติดต่อฝ่ายบุคคล (HR)",
};

const EMPLOYEE_COLUMNS =
  "id,employee_code,name_prefix,full_name,email,phone,department_id,position_id,is_active,notify_pending_on_logout,notifications_enabled";

profile.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

/** Logs only the error name and code; never a body or a person's data. */
function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

function textOrNull(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    departmentActive: department ? department.is_active !== false : null,
    positionName: position?.name ?? null,
    isActive: employee.is_active === true,
    notificationsEnabled: employee.notifications_enabled === true,
    notifyPendingOnLogout: employee.notify_pending_on_logout !== false,
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

/** Role check plus a fresh active-employee read. */
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
// Kept as a read-only lookup for older clients. The employee page no longer
// offers a department dropdown.

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

    c.header("Cache-Control", "private, max-age=300");
    return c.json({ ok: true, count: departments.length, departments }, 200);
  } catch (error) {
    logError("profile departments failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/profile/name-prefixes -----------------------------------------
// Kept as a read-only lookup for older clients.

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

    c.header("Cache-Control", "private, max-age=300");
    return c.json({ ok: true, count: prefixes.length, prefixes }, 200);
  } catch (error) {
    logError("profile name prefixes failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- PATCH /api/profile/me ---------------------------------------------------
// Removed from self-service on purpose. HR edits employee personal data from
// the one HR page, which is guarded by requireHrAdmin. A direct call here is
// always forbidden, regardless of the caller's role.

profile.patch("/me", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;
  return c.json({ ok: false, code: "profile_read_only", message: MESSAGE.readOnly }, 403);
});

export default profile;
