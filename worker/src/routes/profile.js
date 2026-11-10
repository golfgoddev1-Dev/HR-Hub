// Employee self-service profile. Mounted at /api/profile by src/app.js.
//
// Personal data is read-only for the employee. Every edit now lives on the
// HR-only page, so the self-service PATCH is refused at the Worker even if a
// client calls it directly. The PIN change is a separate route and is not
// touched here.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { DEPARTMENT_APPROVERS_TABLE, EMPLOYEE_APPROVERS_TABLE } from "../leave-approvers.js";
import { SHIFT_LEADS_TABLE } from "../shift-leads.js";

const profile = new Hono();

const ALLOWED_ROLES = ["employee", "hr", "meeting_controller", "system_admin"];

const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const POSITIONS_TABLE = "positions";
const PREFIXES_TABLE = "name_prefixes";
const DEPARTMENT_APPROVER_LABEL = "ผู้อนุมัติ";
const SHIFT_LEAD_LABEL = "หัวหน้ากะ";

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

/** The stored name is one full_name; split it the way the HR form edits it. */
function splitEmployeeName(row) {
  let name = typeof row?.full_name === "string" ? row.full_name.replace(/\s+/g, " ").trim() : "";
  const prefix = typeof row?.name_prefix === "string" ? row.name_prefix.trim() : "";
  if (prefix && name.startsWith(prefix)) name = name.slice(prefix.length).trim();
  if (name.length === 0) return { firstName: "", lastName: "" };
  const space = name.indexOf(" ");
  if (space === -1) return { firstName: name, lastName: "" };
  return { firstName: name.slice(0, space), lastName: name.slice(space + 1).trim() };
}

/**
 * A contact card fields only: name, department, position, phone, role label.
 * No employee code, email or national id is ever part of this shape.
 */
function publicContact(person, { departmentName, positionName, roleLabel }) {
  const name = splitEmployeeName(person);
  return {
    firstName: name.firstName,
    lastName: name.lastName,
    departmentName: departmentName ?? null,
    positionName: positionName ?? null,
    phone: textOrNull(person.phone),
    roleLabel,
  };
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

// --- GET /api/profile/my-approvers ------------------------------------------
// The caller's own approval route, read-only. The employee id always comes from
// the session: a query or body id is never read, so one employee cannot ask for
// another employee's contacts. Allowed for any active signed-in employee record,
// matching the own-profile and own-leave reads.

profile.get("/my-approvers", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  try {
    const db = c.get("profileDb");
    const employeeId = c.get("profileSession").employeeId;

    const me = await db.select(EMPLOYEES_TABLE, {
      columns: "id,department_id",
      filters: [["id", "eq", employeeId]],
      single: true,
    });
    if (!me) return c.json({ ok: false, message: MESSAGE.forbidden }, 403);

    const departmentId = me.department_id ?? null;

    const [departmentGrants, personalGrants, shiftRows] = await Promise.all([
      departmentId
        ? db.select(DEPARTMENT_APPROVERS_TABLE, {
            columns: "employee_id,priority",
            filters: [
              ["department_id", "eq", departmentId],
              ["is_active", "eq", true],
            ],
            order: "priority.asc",
            limit: 200,
          })
        : [],
      db.select(EMPLOYEE_APPROVERS_TABLE, {
        columns: "approver_id,priority",
        filters: [
          ["employee_id", "eq", employeeId],
          ["is_active", "eq", true],
        ],
        order: "priority.asc",
        limit: 200,
      }),
      departmentId
        ? db.select(SHIFT_LEADS_TABLE, {
            columns: "employee_id,shift_label",
            filters: [["department_id", "eq", departmentId]],
            order: "created_at.asc",
            limit: 2,
          })
        : [],
    ]);

    // Department grants and named grants are both shown, once per person. The
    // department column holds the approver, while a named row holds the employee
    // in employee_id and the approver in approver_id.
    const approverIds = [];
    const seenApprovers = new Set();
    const addApprover = (id) => {
      if (typeof id !== "string" || id.length === 0 || seenApprovers.has(id)) return;
      seenApprovers.add(id);
      approverIds.push(id);
    };
    for (const row of departmentGrants) addApprover(row.employee_id);
    for (const row of personalGrants) addApprover(row.approver_id);

    const shiftLeadIds = [];
    const seenLeads = new Set();
    for (const row of shiftRows) {
      const id = row.employee_id;
      if (typeof id !== "string" || id.length === 0 || seenLeads.has(id)) continue;
      seenLeads.add(id);
      shiftLeadIds.push(id);
    }

    const peopleIds = [...new Set([...approverIds, ...shiftLeadIds])];
    const people = peopleIds.length
      ? await db.select(EMPLOYEES_TABLE, {
          columns: "id,name_prefix,full_name,phone,department_id,position_id",
          filters: [["id", "in", peopleIds]],
        })
      : [];
    const personById = new Map(people.map((person) => [person.id, person]));

    const departmentIds = [...new Set(people.map((person) => person.department_id).filter(Boolean))];
    const positionIds = [...new Set(people.map((person) => person.position_id).filter(Boolean))];

    const [departments, positions] = await Promise.all([
      departmentIds.length
        ? db.select(DEPARTMENTS_TABLE, {
            columns: "id,name",
            filters: [["id", "in", departmentIds]],
          })
        : [],
      positionIds.length
        ? db.select(POSITIONS_TABLE, {
            columns: "id,name",
            filters: [["id", "in", positionIds]],
          })
        : [],
    ]);
    const departmentById = new Map(departments.map((row) => [row.id, row.name ?? null]));
    const positionById = new Map(positions.map((row) => [row.id, row.name ?? null]));

    const contactOf = (id, roleLabel) => {
      const person = personById.get(id);
      if (!person) return null;
      return publicContact(person, {
        departmentName: person.department_id
          ? departmentById.get(person.department_id) ?? null
          : null,
        positionName: person.position_id ? positionById.get(person.position_id) ?? null : null,
        roleLabel,
      });
    };

    const approvers = approverIds
      .map((id) => contactOf(id, DEPARTMENT_APPROVER_LABEL))
      .filter(Boolean);
    const shiftLeads = shiftLeadIds
      .map((id) => contactOf(id, SHIFT_LEAD_LABEL))
      .filter(Boolean);

    return c.json({ ok: true, approvers, shiftLeads }, 200);
  } catch (error) {
    logError("profile my-approvers failed", error);
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
