// Admin routes, mounted at /api/admin by src/app.js.
//
// Five parts:
// - /overview, a read-only summary of database counts (no rows, no audit);
// - /audit, a read-only, paged view of audit_logs without its detail column;
// - /health, read-only counts of the push and email send queues;
// - /sessions, who is signed in and which accounts are PIN-locked, with a
//   per-session sign-out and a per-account unlock (each writes one audit row);
// - /permissions, where a system_admin searches one employee and sets the four
//   permission flags that exist in this system: hr_admins, meeting_admins,
//   system_admins, and the leave approver tables the HR approvers page already
//   manages (employee_approvers / department_approvers).
//
// The role always comes from requireRole(), which re-reads the session and the
// caller's membership on every request. No route here trusts a hidden menu item.
// Nothing in the permission responses reads employees.national_id or
// employee_credentials, and no audit row stores a PIN, an ID card number or a
// flag value.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { bangkokToday } from "../register-window.js";
import { HOLIDAYS_TABLE, HOLIDAY_DATE_COLUMN } from "../leave-holidays.js";
import {
  DEFAULT_PRIORITY,
  DEPARTMENT_APPROVERS_TABLE,
  EMPLOYEE_APPROVERS_TABLE,
  activeEmployeeIds,
  approverDeactivation,
  approverReactivation,
} from "../leave-approvers.js";
import { HEALTH_QUEUES, healthCutoffs, queueFilters } from "../admin-health.js";
import { SECURITY_POLICY, shapeLeaveSettings } from "../admin-settings.js";
import { readLeaveSettings } from "../leave-settings.js";
import {
  LOCKED_LIMIT,
  SESSIONS_LIMIT,
  activeSince,
  personIds,
  shapeLocked,
  shapeSession,
} from "../admin-sessions.js";
import { isLockActive } from "../pin-verify.js";
import {
  AUDIT_PAGE_SIZE,
  auditPeopleIds,
  parseAuditQuery,
  shapeAuditRow,
} from "../admin-audit.js";
import {
  MIN_SEARCH_LENGTH,
  SEARCH_LIMIT,
  buildSearchFilter,
  changedFlags,
  emptyFlags,
  normalizeQuery,
  parsePermissionBody,
} from "../admin-permissions.js";

const admin = new Hono();

const ROLE = "system_admin";
const EMPLOYEES_TABLE = "employees";
const DEPARTMENTS_TABLE = "departments";
const LEAVE_REQUESTS_TABLE = "leave_requests";
const HR_ADMINS_TABLE = "hr_admins";
const MEETING_ADMINS_TABLE = "meeting_admins";
const SYSTEM_ADMINS_TABLE = "system_admins";
const AUDIT_TABLE = "audit_logs";

const PENDING_STATUS = "pending";
const MAX_BODY_BYTES = 4 * 1024;
const ADMIN_ROW_LIMIT = 500;
const ID_CHUNK = 100;

const ACTION_PERMISSION_GRANTED = "permission_granted";
const ACTION_PERMISSION_REVOKED = "permission_revoked";
const ENTITY_PERMISSION = "permission";
const ENTITY_EMPLOYEE = "employee";
const ACTION_SESSION_REVOKED = "session_revoked";
const ACTION_ACCOUNT_UNLOCKED = "account_unlocked";
const SESSIONS_TABLE = "auth_sessions";
const CREDENTIALS_TABLE = "employee_credentials";

const MESSAGE = {
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  invalid: "ข้อมูลไม่ถูกต้อง",
  searchTooShort: "กรุณาพิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา",
  notFound: "ไม่พบพนักงาน",
  selfSystemAdmin: "ไม่สามารถถอดสิทธิ์ผู้ดูแลระบบของตนเองได้",
  lastSystemAdmin: "ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อยหนึ่งคน",
  inactiveGrant: "พนักงานที่ปิดใช้งานอยู่ไม่สามารถเพิ่มสิทธิ์ได้",
  noDepartment: "พนักงานคนนี้ยังไม่มีแผนก จึงยังเพิ่มเป็นผู้อนุมัติการลาไม่ได้",
  sessionGone: "ไม่พบเซสชันนี้ หรือออกจากระบบไปแล้ว",
  ownSession: "ไม่สามารถออกจากระบบเซสชันของตนเองจากหน้านี้ได้ กรุณาใช้ปุ่มออกจากระบบ",
  accountGone: "ไม่พบบัญชีนี้",
};

// The flag to the table the existing feature already uses. leaveApprover is
// handled separately because it spans two tables and reuses the approver plan.
const TABLE_BY_FLAG = Object.freeze({
  hrAdmin: HR_ADMINS_TABLE,
  meetingAdmin: MEETING_ADMINS_TABLE,
  systemAdmin: SYSTEM_ADMINS_TABLE,
});

const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

admin.use("*", async (c, next) => {
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

/** JSON object body, at most 4 KB, no other content type accepted. */
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

function invalidBody(c) {
  return c.json({ ok: false, message: MESSAGE.invalid }, 400);
}

function conflict(c, message) {
  return c.json({ ok: false, message }, 409);
}

/** First row of a to-one embed, which PostgREST returns as object or array. */
function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** Role check. requireRole already re-reads the session and its membership. */
async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) {
    return { response: c.json({ ok: false, message: auth.message }, auth.status) };
  }
  c.set("adminSession", auth.session);
  return null;
}

async function writeAudit(db, { actorId, action, employeeId, permission }) {
  ensureOk(
    await db.insert(AUDIT_TABLE, {
      actor_id: actorId,
      action,
      entity: ENTITY_PERMISSION,
      entity_id: employeeId,
      detail: JSON.stringify({ permission, employeeId }),
    })
  );
}

// --- permission flags --------------------------------------------------------
// Four reads in bulk for a list of employees: the three admin tables plus one
// read per approver table. An inactive approver row is not a permission.

function setFlag(flags, employeeId, key) {
  const row = flags.get(employeeId);
  if (row) row[key] = true;
}

async function loadPermissionFlags(db, employeeIds) {
  const ids = [...new Set((employeeIds ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  const flags = new Map(ids.map((id) => [id, emptyFlags()]));
  if (ids.length === 0) return flags;

  const [hrRows, meetingRows, systemRows, personalRows, departmentRows] = await Promise.all([
    db.select(HR_ADMINS_TABLE, {
      columns: "employee_id",
      filters: [["employee_id", "in", ids]],
    }),
    db.select(MEETING_ADMINS_TABLE, {
      columns: "employee_id",
      filters: [["employee_id", "in", ids]],
    }),
    db.select(SYSTEM_ADMINS_TABLE, {
      columns: "employee_id",
      filters: [["employee_id", "in", ids]],
    }),
    db.select(EMPLOYEE_APPROVERS_TABLE, {
      columns: "approver_id",
      filters: [
        ["approver_id", "in", ids],
        ["is_active", "eq", true],
      ],
    }),
    db.select(DEPARTMENT_APPROVERS_TABLE, {
      columns: "employee_id",
      filters: [
        ["employee_id", "in", ids],
        ["is_active", "eq", true],
      ],
    }),
  ]);

  for (const row of hrRows) setFlag(flags, row.employee_id, "hrAdmin");
  for (const row of meetingRows) setFlag(flags, row.employee_id, "meetingAdmin");
  for (const row of systemRows) setFlag(flags, row.employee_id, "systemAdmin");
  for (const row of personalRows) setFlag(flags, row.approver_id, "leaveApprover");
  for (const row of departmentRows) setFlag(flags, row.employee_id, "leaveApprover");

  return flags;
}

/**
 * How many system_admin rows would still belong to an active employee if
 * `excludedId` lost the flag. The three admin tables have no is_active column,
 * so "active" is the employees row, the same rule the session layer uses.
 */
async function remainingActiveSystemAdmins(db, excludedId) {
  const rows = await db.select(SYSTEM_ADMINS_TABLE, {
    columns: "employee_id",
    limit: ADMIN_ROW_LIMIT,
  });
  const ids = rows
    .map((row) => row.employee_id)
    .filter((id) => typeof id === "string" && id.length > 0 && id !== excludedId);

  let remaining = 0;
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const active = await activeEmployeeIds(db, ids.slice(index, index + ID_CHUNK));
    remaining += active.size;
  }
  return remaining;
}

/**
 * Applies one flag change in the table the existing feature uses. A leave
 * approver is an active row in either approver table: granting adds one
 * department row for the person's own department (the same shape the HR
 * approvers page inserts, with the default priority), revoking deactivates every
 * row where this person is the approver. Rows are never deleted, so a pending
 * request keeps pointing at a real row.
 */
async function applyPermissionChange(db, employee, change) {
  if (change.key === "leaveApprover") {
    if (change.granted) {
      const patch = approverReactivation().patch;
      ensureOk(
        await db.insert(DEPARTMENT_APPROVERS_TABLE, {
          department_id: employee.department_id,
          employee_id: employee.id,
          priority: DEFAULT_PRIORITY,
          is_active: patch.is_active,
        })
      );
      return;
    }

    const patch = approverDeactivation().patch;
    ensureOk(
      await db.update(
        EMPLOYEE_APPROVERS_TABLE,
        patch,
        [
          ["approver_id", "eq", employee.id],
          ["is_active", "eq", true],
        ]
      )
    );
    ensureOk(
      await db.update(
        DEPARTMENT_APPROVERS_TABLE,
        patch,
        [
          ["employee_id", "eq", employee.id],
          ["is_active", "eq", true],
        ]
      )
    );
    return;
  }

  const table = TABLE_BY_FLAG[change.key];
  if (!table) throw new Error("unknown permission");

  if (change.granted) {
    ensureOk(await db.insert(table, { employee_id: employee.id }, { ignoreDuplicates: true }));
    return;
  }
  ensureOk(await db.remove(table, [["employee_id", "eq", employee.id]]));
}

function publicEmployee(employee, flags) {
  return {
    id: employee.id,
    employeeCode: employee.employee_code ?? null,
    fullName: employee.full_name ?? null,
    departmentName: firstEmbedded(employee.departments)?.name ?? null,
    isActive: employee.is_active === true,
    flags: { ...emptyFlags(), ...(flags ?? {}) },
  };
}

/**
 * The Bangkok calendar year as "YYYY". Thailand never shifts its offset, and the
 * holiday table stores Gregorian dates, so this is the year the leave rules and
 * the holiday screen already use.
 */
export function bangkokYear(now = new Date()) {
  return bangkokToday(now).slice(0, 4);
}

// --- GET /api/admin/overview -------------------------------------------------

admin.get("/overview", async (c) => {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) return c.json({ ok: false, message: auth.message }, auth.status);

  const year = bangkokYear();

  try {
    const db = createDb(c.env);
    const [activeEmployees, pendingLeave, departmentApprovers, employeeApprovers, holidays] =
      await Promise.all([
        db.count(EMPLOYEES_TABLE, { filters: [["is_active", "eq", true]] }),
        db.count(LEAVE_REQUESTS_TABLE, { filters: [["status", "eq", PENDING_STATUS]] }),
        db.count(DEPARTMENT_APPROVERS_TABLE, { filters: [["is_active", "eq", true]] }),
        db.count(EMPLOYEE_APPROVERS_TABLE, { filters: [["is_active", "eq", true]] }),
        db.count(HOLIDAYS_TABLE, {
          filters: [
            [HOLIDAY_DATE_COLUMN, "gte", `${year}-01-01`],
            [HOLIDAY_DATE_COLUMN, "lte", `${year}-12-31`],
          ],
        }),
      ]);

    return c.json(
      {
        ok: true,
        year,
        counts: {
          activeEmployees,
          pendingLeave,
          // A department row and a personal row are both one assignment, so the
          // total is the sum of the two active lists.
          activeApprovers: departmentApprovers + employeeApprovers,
          holidays,
        },
      },
      200
    );
  } catch (error) {
    logError("admin overview failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/admin/audit?action=&from=&to=&before= --------------------------
// Read-only, newest first, one page of AUDIT_PAGE_SIZE. `nextBefore` is the id to
// pass as `before` for the next page, or null on the last page. detail is never
// returned (see admin-audit.js).

admin.get("/audit", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const filters = parseAuditQuery(new URL(c.req.raw.url).searchParams);
  if (!filters) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const rows = await db.select(AUDIT_TABLE, {
      columns: "id,actor_id,action,entity,entity_id,detail,created_at",
      filters,
      order: "id.desc",
      limit: AUDIT_PAGE_SIZE + 1,
    });

    const page = rows.slice(0, AUDIT_PAGE_SIZE);
    const people = new Map();
    const ids = auditPeopleIds(page);
    for (let index = 0; index < ids.length; index += ID_CHUNK) {
      const found = await db.select(EMPLOYEES_TABLE, {
        columns: "id,employee_code,full_name",
        filters: [["id", "in", ids.slice(index, index + ID_CHUNK)]],
      });
      for (const row of found) people.set(row.id, row);
    }

    return c.json(
      {
        ok: true,
        items: page.map((row) => shapeAuditRow(row, people)),
        nextBefore: rows.length > AUDIT_PAGE_SIZE ? String(page[page.length - 1].id) : null,
      },
      200
    );
  } catch (error) {
    logError("admin audit read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/admin/health ---------------------------------------------------
// Ten small reads (five per queue), well inside the Worker subrequest budget.

async function readQueueHealth(db, table, cutoffs) {
  const filters = queueFilters(cutoffs);
  const [pending, sending, overdue, failed, lastSent] = await Promise.all([
    db.count(table, { filters: filters.pending }),
    db.count(table, { filters: filters.sending }),
    db.count(table, { filters: filters.overdue }),
    db.count(table, { filters: filters.failed }),
    db.select(table, {
      columns: "sent_at",
      filters: filters.lastSent,
      order: "sent_at.desc",
      limit: 1,
    }),
  ]);
  return {
    pending,
    sending,
    overdue,
    failed24h: failed,
    lastSentAt: lastSent[0]?.sent_at ?? null,
  };
}

admin.get("/health", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const now = new Date();
  try {
    const db = createDb(c.env);
    const cutoffs = healthCutoffs(now);
    const results = await Promise.all(
      HEALTH_QUEUES.map((queue) => readQueueHealth(db, queue.table, cutoffs))
    );
    const queues = {};
    HEALTH_QUEUES.forEach((queue, index) => {
      queues[queue.key] = results[index];
    });
    return c.json({ ok: true, checkedAt: now.toISOString(), queues }, 200);
  } catch (error) {
    logError("admin health read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/admin/settings -------------------------------------------------
// Read-only. HR still edits the leave values and holidays on its own pages.

admin.get("/settings", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const today = bangkokToday();
  const year = today.slice(0, 4);
  try {
    const db = createDb(c.env);
    const [settings, holidayCount, nextHoliday] = await Promise.all([
      readLeaveSettings(db),
      db.count(HOLIDAYS_TABLE, {
        filters: [
          [HOLIDAY_DATE_COLUMN, "gte", `${year}-01-01`],
          [HOLIDAY_DATE_COLUMN, "lte", `${year}-12-31`],
        ],
      }),
      db.select(HOLIDAYS_TABLE, {
        columns: `${HOLIDAY_DATE_COLUMN},name`,
        filters: [[HOLIDAY_DATE_COLUMN, "gte", today]],
        order: `${HOLIDAY_DATE_COLUMN}.asc`,
        limit: 1,
      }),
    ]);
    const people = settings.updatedBy ? await loadPeople(db, [settings.updatedBy]) : new Map();
    const next = nextHoliday[0];

    return c.json(
      {
        ok: true,
        leave: shapeLeaveSettings(settings, people.get(settings.updatedBy)),
        holidays: {
          year,
          count: holidayCount,
          next: next ? { date: String(next[HOLIDAY_DATE_COLUMN]).slice(0, 10), name: next.name ?? "" } : null,
        },
        security: SECURITY_POLICY,
      },
      200
    );
  } catch (error) {
    logError("admin settings read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- /api/admin/sessions and /api/admin/accounts/:employeeId/unlock ----------

async function loadPeople(db, ids) {
  const people = new Map();
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const found = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,full_name",
      filters: [["id", "in", ids.slice(index, index + ID_CHUNK)]],
    });
    for (const row of found) people.set(row.id, row);
  }
  return people;
}

async function writeEmployeeAudit(db, { actorId, action, employeeId, detail }) {
  ensureOk(
    await db.insert(AUDIT_TABLE, {
      actor_id: actorId,
      action,
      entity: ENTITY_EMPLOYEE,
      entity_id: employeeId,
      detail: JSON.stringify(detail),
    })
  );
}

admin.get("/sessions", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const now = new Date();
  try {
    const db = createDb(c.env);
    const ownId = c.get("adminSession").employeeId;

    const [sessionRows, lockedRows] = await Promise.all([
      db.select(SESSIONS_TABLE, {
        columns: "id,employee_id,login_role,created_at,last_active_at",
        filters: [
          ["revoked_at", "is", null],
          ["expires_at", "gt", now.toISOString()],
          ["last_active_at", "gt", activeSince(now)],
        ],
        order: "last_active_at.desc",
        limit: SESSIONS_LIMIT,
      }),
      db.select(CREDENTIALS_TABLE, {
        columns: "employee_id,locked_until",
        filters: [["locked_until", "gt", now.toISOString()]],
        order: "locked_until.desc",
        limit: LOCKED_LIMIT,
      }),
    ]);

    const people = await loadPeople(db, [
      ...new Set([...personIds(sessionRows, "employee_id"), ...personIds(lockedRows, "employee_id")]),
    ]);

    return c.json(
      {
        ok: true,
        sessions: sessionRows.map((row) => shapeSession(row, people, ownId)),
        locked: lockedRows.map((row) => shapeLocked(row, people)),
        sessionsLimit: SESSIONS_LIMIT,
      },
      200
    );
  } catch (error) {
    logError("admin sessions read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

admin.post("/sessions/:sessionId/revoke", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const sessionId = c.req.param("sessionId");
  if (!isUuid(sessionId)) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const actorId = c.get("adminSession").employeeId;

    const target = await db.select(SESSIONS_TABLE, {
      columns: "id,employee_id,login_role",
      filters: [
        ["id", "eq", sessionId],
        ["revoked_at", "is", null],
      ],
      single: true,
    });
    if (!target) return c.json({ ok: false, message: MESSAGE.sessionGone }, 404);
    if (target.employee_id === actorId) return conflict(c, MESSAGE.ownSession);

    const result = ensureOk(
      await db.update(
        SESSIONS_TABLE,
        { revoked_at: new Date().toISOString() },
        [
          ["id", "eq", sessionId],
          ["revoked_at", "is", null],
        ],
        { returning: true, columns: "id" }
      )
    );
    if (result.data.length === 0) return c.json({ ok: false, message: MESSAGE.sessionGone }, 404);

    await writeEmployeeAudit(db, {
      actorId,
      action: ACTION_SESSION_REVOKED,
      employeeId: target.employee_id,
      detail: { loginRole: target.login_role ?? null },
    });
    return c.json({ ok: true }, 200);
  } catch (error) {
    logError("admin session revoke failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

admin.post("/accounts/:employeeId/unlock", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const employeeId = c.req.param("employeeId");
  if (!isUuid(employeeId)) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "employee_id,locked_until",
      filters: [["employee_id", "eq", employeeId]],
      single: true,
    });
    if (!credential) return c.json({ ok: false, message: MESSAGE.accountGone }, 404);

    // Not locked: nothing to change and nothing to audit.
    if (!isLockActive(credential.locked_until, new Date())) {
      return c.json({ ok: true, changed: false }, 200);
    }

    ensureOk(
      await db.update(
        CREDENTIALS_TABLE,
        { failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() },
        [["employee_id", "eq", employeeId]]
      )
    );
    await writeEmployeeAudit(db, {
      actorId: c.get("adminSession").employeeId,
      action: ACTION_ACCOUNT_UNLOCKED,
      employeeId,
      detail: {},
    });
    return c.json({ ok: true, changed: true }, 200);
  } catch (error) {
    logError("admin account unlock failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/admin/permissions/search?q=<text> ------------------------------

admin.get("/permissions/search", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const query = normalizeQuery(new URL(c.req.raw.url).searchParams.get("q"));
  if (query.length < MIN_SEARCH_LENGTH) {
    return c.json({ ok: false, message: MESSAGE.searchTooShort }, 400);
  }

  try {
    const db = createDb(c.env);
    const rows = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,full_name,is_active,department_id,departments(name)",
      extra: [buildSearchFilter(query)],
      order: "employee_code.asc",
      limit: SEARCH_LIMIT,
    });

    const flags = await loadPermissionFlags(
      db,
      rows.map((row) => row.id)
    );

    const results = rows.map((row) => publicEmployee(row, flags.get(row.id)));
    return c.json(
      { ok: true, query, limit: SEARCH_LIMIT, count: results.length, results },
      200
    );
  } catch (error) {
    logError("admin permission search failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- GET /api/admin/permissions/:employeeId ----------------------------------

admin.get("/permissions/:employeeId", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const employeeId = c.req.param("employeeId");
  if (!isUuid(employeeId)) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,full_name,is_active,department_id,departments(name)",
      filters: [["id", "eq", employeeId]],
      single: true,
    });
    if (!employee) return c.json({ ok: false, message: MESSAGE.notFound }, 404);

    const flags = await loadPermissionFlags(db, [employee.id]);
    return c.json({ ok: true, employee: publicEmployee(employee, flags.get(employee.id)) }, 200);
  } catch (error) {
    logError("admin permission read failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- PUT /api/admin/permissions/:employeeId ----------------------------------

admin.put("/permissions/:employeeId", async (c) => {
  const denied = await guard(c);
  if (denied) return denied.response;

  const employeeId = c.req.param("employeeId");
  if (!isUuid(employeeId)) return invalidBody(c);

  const body = await readStrictJson(c);
  const nextFlags = parsePermissionBody(body);
  if (!nextFlags) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const session = c.get("adminSession");

    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,employee_code,full_name,is_active,department_id,departments(name)",
      filters: [["id", "eq", employeeId]],
      single: true,
    });
    if (!employee) return c.json({ ok: false, message: MESSAGE.notFound }, 404);

    const currentFlags = (await loadPermissionFlags(db, [employee.id])).get(employee.id);
    const changes = changedFlags(currentFlags, nextFlags);

    if (changes.length === 0) {
      return c.json(
        { ok: true, changed: false, employee: publicEmployee(employee, currentFlags) },
        200
      );
    }

    const revokingSystemAdmin = changes.some(
      (change) => change.key === "systemAdmin" && change.granted === false
    );

    // ("At least one active system_admin must remain" runs before the self rule,
    // so removing the only remaining admin reports that reason instead.)
    if (revokingSystemAdmin && (await remainingActiveSystemAdmins(db, employee.id)) === 0) {
      return conflict(c, MESSAGE.lastSystemAdmin);
    }

    if (employeeId === session.employeeId && revokingSystemAdmin) {
      return conflict(c, MESSAGE.selfSystemAdmin);
    }

    const granting = changes.some((change) => change.granted);
    if (granting && employee.is_active !== true) {
      return conflict(c, MESSAGE.inactiveGrant);
    }

    const grantsApprover = changes.some(
      (change) => change.key === "leaveApprover" && change.granted
    );
    if (grantsApprover && !employee.department_id) {
      return conflict(c, MESSAGE.noDepartment);
    }

    for (const change of changes) {
      await applyPermissionChange(db, employee, change);
    }

    // One row per changed flag, carrying only the permission name and the target
    // employee id. A flag value, a PIN or an ID card number is never stored.
    for (const change of changes) {
      await writeAudit(db, {
        actorId: session.employeeId,
        action: change.granted ? ACTION_PERMISSION_GRANTED : ACTION_PERMISSION_REVOKED,
        employeeId: employee.id,
        permission: change.name,
      });
    }

    const refreshed = await loadPermissionFlags(db, [employee.id]);
    return c.json(
      {
        ok: true,
        changed: true,
        changedFlags: changes.map((change) => ({
          permission: change.name,
          granted: change.granted,
        })),
        employee: publicEmployee(employee, refreshed.get(employee.id)),
      },
      200
    );
  } catch (error) {
    logError("admin permission update failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default admin;
