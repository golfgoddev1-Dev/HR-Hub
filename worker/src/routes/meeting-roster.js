// Controller meeting roster routes, ported from server/routes/meeting-roster.js.
// Mounted at /api/meeting/roster by src/app.js. No audit rows on this group.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import {
  escapeIlike,
  isValidSearchQuery,
  normalizeSearchQuery,
  sortThai,
} from "../meeting-roster.js";

const roster = new Hono();

const SAVE_ERROR_MESSAGE = "ไม่สามารถบันทึกได้ กรุณาลองใหม่";
const TYPE_ERROR_MESSAGE = "ประเภทการประชุมไม่ถูกต้อง";
const EMPLOYEE_ERROR_MESSAGE = "ไม่พบพนักงานที่ใช้งานอยู่";
const ROSTER_MESSAGE = "ไม่พบรายชื่อนี้";
const INVALID_BODY_MESSAGE = "ข้อมูลไม่ถูกต้อง";

const TYPES_TABLE = "meeting_types";
const ROSTER_TABLE = "meeting_roster";
const EMPLOYEES_TABLE = "employees";
const SHARED_CODE = "sup";
const MONTHLY_CODE = "monthly";

const ROLE = "meeting_controller";
const SEARCH_LIMIT = 10;
const ROSTER_CONFLICT = "meeting_type_id,employee_id";
const MAX_BODY_BYTES = 4 * 1024;

const MEMBER_FIELDS =
  "employee_id,employees!meeting_roster_employee_id_fkey!inner(employee_code,full_name,departments(name),positions(name))";
const EMPLOYEE_FIELDS = "id,employee_code,full_name,departments(name),positions(name)";

// Same set as Express's z.uuid(): versions 1-8 with an RFC variant, plus the
// nil and max UUIDs.
const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const DASH = "-";

roster.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  return value.split(";")[0].trim().toLowerCase() === "application/json";
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

function invalidBody(c) {
  return c.json({ ok: false, message: INVALID_BODY_MESSAGE }, 400);
}

/**
 * Strict body: exactly one string employeeId, like the Express
 * z.object({ employeeId: z.uuid() }).strict() for these values.
 */
function isStrictEmployeeBody(value) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    Object.prototype.hasOwnProperty.call(value, "employeeId") &&
    typeof value.employeeId === "string" &&
    UUID_PATTERN.test(value.employeeId)
  );
}

/** Logs only the error name and code; never a body, message detail or query. */
function logError(error) {
  console.error("meeting roster failed", { name: error?.name, code: error?.code });
}

/** Turns a { error: { code } } db result into a throw so the route answers 500. */
function ensureOk(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}

async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) {
    return c.json({ ok: false, message: auth.message }, auth.status);
  }
  c.set("meetingSession", auth.session);
  return null;
}

function authSession(c) {
  return c.get("meetingSession");
}

/** The two shared type ids. Any missing one makes add/remove answer 400. */
async function findTypeIds(db) {
  const [sup, monthly] = await Promise.all([
    db.select(TYPES_TABLE, {
      columns: "id,code",
      filters: [["code", "eq", SHARED_CODE]],
      single: true,
    }),
    db.select(TYPES_TABLE, {
      columns: "id,code",
      filters: [["code", "eq", MONTHLY_CODE]],
      single: true,
    }),
  ]);
  return { supId: sup ? sup.id : null, monthlyId: monthly ? monthly.id : null };
}

/** PostgREST embeds either an object or a one-element array; read the first. */
function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toMember(row) {
  const employee = row.employees ?? {};
  return {
    employeeId: row.employee_id,
    employeeCode: employee.employee_code ?? DASH,
    fullName: employee.full_name ?? DASH,
    departmentName: firstEmbedded(employee.departments)?.name ?? DASH,
    positionName: firstEmbedded(employee.positions)?.name ?? DASH,
  };
}

function toCandidate(row) {
  return {
    employeeId: row.id,
    employeeCode: row.employee_code ?? DASH,
    fullName: row.full_name ?? DASH,
    departmentName: firstEmbedded(row.departments)?.name ?? DASH,
    positionName: firstEmbedded(row.positions)?.name ?? DASH,
  };
}

/**
 * The or filter for name and employee code ilike searches. The pattern is
 * URL-encoded so percent signs, commas and parentheses from the search text
 * cannot break the or=() structure; PostgREST decodes each leaf value itself.
 * encodeURIComponent leaves parentheses raw, so they are encoded explicitly:
 * a raw ( or ) would open or close an or-group inside PostgREST.
 */
function encodeOrValue(value) {
  return encodeURIComponent(value).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

function buildEmployeeSearchFilter(pattern) {
  const nameClause = `full_name.ilike.${encodeOrValue(pattern)}`;
  const codeClause = `employee_code.ilike.${encodeOrValue(pattern)}`;
  return `or=(${nameClause},${codeClause})`;
}

// --- GET /api/meeting/roster --------------------------------------------------

roster.get("/", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const db = createDb(c.env);
    const { supId } = await findTypeIds(db);
    if (!supId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);

    const rows = await db.select(ROSTER_TABLE, {
      columns: MEMBER_FIELDS,
      filters: [
        ["meeting_type_id", "eq", supId],
        ["is_active", "eq", true],
      ],
    });

    const members = sortThai(rows.map(toMember));
    return c.json({ ok: true, count: members.length, members }, 200);
  } catch (error) {
    logError(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- GET /api/meeting/roster/search -------------------------------------------

roster.get("/search", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const rawUrl = new URL(c.req.raw.url);
  const query = normalizeSearchQuery(rawUrl.searchParams.get("q") ?? "");
  if (!isValidSearchQuery(query)) {
    return c.json({ ok: true, results: [] }, 200);
  }

  try {
    const db = createDb(c.env);
    const { supId } = await findTypeIds(db);
    if (!supId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);

    const rosterRows = await db.select(ROSTER_TABLE, {
      columns: "employee_id",
      filters: [
        ["meeting_type_id", "eq", supId],
        ["is_active", "eq", true],
      ],
    });
    const rosterIds = new Set(rosterRows.map((row) => row.employee_id));

    const pattern = `%${escapeIlike(query)}%`;
    const candidates = await db.select(EMPLOYEES_TABLE, {
      columns: EMPLOYEE_FIELDS,
      filters: [["is_active", "eq", true]],
      extra: [buildEmployeeSearchFilter(pattern)],
      limit: SEARCH_LIMIT,
    });

    const merged = new Map();
    for (const row of candidates) {
      if (rosterIds.has(row.id) || merged.has(row.id)) continue;
      merged.set(row.id, toCandidate(row));
    }

    const results = sortThai([...merged.values()]).slice(0, SEARCH_LIMIT);
    return c.json({ ok: true, results }, 200);
  } catch (error) {
    logError(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- POST /api/meeting/roster/add ---------------------------------------------

roster.post("/add", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const body = await readStrictJson(c);
  if (!isStrictEmployeeBody(body)) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const { supId, monthlyId } = await findTypeIds(db);
    if (!supId || !monthlyId) {
      return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
    }

    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,is_active",
      filters: [["id", "eq", body.employeeId]],
      single: true,
    });
    if (!employee || employee.is_active !== true) {
      return c.json({ ok: false, message: EMPLOYEE_ERROR_MESSAGE }, 400);
    }

    // Express upserts both rows in one call and overwrites created_by and
    // created_at on re-add; this loop keeps the same visible result.
    const now = new Date().toISOString();
    for (const typeId of [supId, monthlyId]) {
      ensureOk(
        await db.upsert(
          ROSTER_TABLE,
          {
            meeting_type_id: typeId,
            employee_id: body.employeeId,
            is_active: true,
            created_by: authSession(c).employeeId,
            created_at: now,
          },
          { conflict: ROSTER_CONFLICT }
        )
      );
    }

    return c.json({ ok: true }, 200);
  } catch (error) {
    logError(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- POST /api/meeting/roster/remove ------------------------------------------

roster.post("/remove", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const body = await readStrictJson(c);
  if (!isStrictEmployeeBody(body)) return invalidBody(c);

  try {
    const db = createDb(c.env);
    const { supId, monthlyId } = await findTypeIds(db);
    if (!supId || !monthlyId) {
      return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
    }

    let updatedCount = 0;
    for (const typeId of [supId, monthlyId]) {
      const result = await db.update(
        ROSTER_TABLE,
        { is_active: false },
        [
          ["employee_id", "eq", body.employeeId],
          ["meeting_type_id", "eq", typeId],
        ],
        { returning: true, columns: "meeting_type_id" }
      );
      if (result.error) {
        const updateError = new Error("database write failed");
        updateError.code = result.error.code;
        throw updateError;
      }
      updatedCount += Array.isArray(result.data) ? result.data.length : 0;
    }
    if (updatedCount === 0) {
      return c.json({ ok: false, message: ROSTER_MESSAGE }, 404);
    }

    return c.json({ ok: true }, 200);
  } catch (error) {
    logError(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

export default roster;
