// Controller meeting overview routes, ported from server/routes/meeting-overview.js.
// Mounted at /api/meeting/overview by src/app.js. Dashboard routes arrive in
// Phase 3. These are GET-only reads with NO side effects (no auto-absent, no
// writes), and no audit rows.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { normalizeTime } from "../register-window.js";
import {
  countByStatus,
  findPending,
  formatDateText,
  sessionPhase,
  todayOf,
  weekdayOf,
} from "../meeting-overview.js";

const overview = new Hono();

const SERVER_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const TYPE_ERROR_MESSAGE = "ประเภทการประชุมไม่ถูกต้อง";
const DASH = "-";

const TYPES_TABLE = "meeting_types";
const SESSIONS_TABLE = "meeting_sessions";
const ATTENDANCE_TABLE = "meeting_attendance";
const ROSTER_TABLE = "meeting_roster";

const ROLE = "meeting_controller";

const MEMBER_FIELDS =
  "employee_id,employees!meeting_roster_employee_id_fkey!inner(full_name,departments(name),positions(name))";

// Same set as Express z.enum(['sup', 'monthly']).strict().
const VALID_CODES = new Set(["sup", "monthly"]);

overview.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

/** Logs only the error name and code; never a body, token or message detail. */
function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

/** Keeps only HH:mm (normalizeTime from register-window, not duplicated). */
function toHm(value) {
  return normalizeTime(value);
}

/** Reads both type rows with two single-row reads, like the other meeting routes. */
async function findTypes(db) {
  const [sup, monthly] = await Promise.all([
    db.select(TYPES_TABLE, {
      columns: "id,code,name,weekday,default_open_time,default_cutoff_time",
      filters: [["code", "eq", "sup"]],
      single: true,
    }),
    db.select(TYPES_TABLE, {
      columns: "id,code,name,weekday,default_open_time,default_cutoff_time",
      filters: [["code", "eq", "monthly"]],
      single: true,
    }),
  ]);
  return { sup, monthly };
}

/** Today's session row for a type, or null. */
async function findSession(db, typeId, sessionDate) {
  if (!typeId) return null;
  return db.select(SESSIONS_TABLE, {
    columns: "id,open_time,cutoff_time",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["session_date", "eq", sessionDate],
    ],
    single: true,
  });
}

/** Attendance status codes for the session; counts are zeros without a session. */
async function loadCounts(db, sessionId) {
  if (!sessionId) return countByStatus([]);
  const rows = await db.select(ATTENDANCE_TABLE, {
    columns: "status_code",
    filters: [["session_id", "eq", sessionId]],
  });
  return countByStatus(rows);
}

/**
 * Active roster count for a type. The Express route uses a head count with
 * count=exact; this reads the ids and uses the list length, same number.
 */
async function loadRosterCount(db, typeId) {
  if (!typeId) return 0;
  const rows = await db.select(ROSTER_TABLE, {
    columns: "employee_id",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["is_active", "eq", true],
    ],
  });
  return rows.length;
}

/** PostgREST embeds either an object or a one-element array; read the first. */
function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function guard(c) {
  const auth = await requireRole(c.env, c.req.raw, [ROLE]);
  if (auth.status) {
    return c.json({ ok: false, message: auth.message }, auth.status);
  }
  return null;
}

// --- GET /api/meeting/overview ------------------------------------------------

overview.get("/", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const db = createDb(c.env);
    const now = new Date();
    const today = todayOf(now);
    const todayWeekday = weekdayOf(today);
    const { sup: supType, monthly: monthlyType } = await findTypes(db);

    const supRosterCount = await loadRosterCount(db, supType?.id ?? null);
    // sup.hasSession is true on the types' weekday even without a session row:
    // counts are zeros then and times fall back to nulls.
    const isSupDay = supType !== null && supType.weekday === todayWeekday;
    let sup;
    if (!isSupDay) {
      sup = { hasSession: false, rosterCount: supRosterCount };
    } else {
      const session = await findSession(db, supType.id, today);
      // Defaults first, session row fallback, exactly like Express.
      const openTime = toHm(supType?.default_open_time) ?? toHm(session?.open_time);
      const cutoffTime = toHm(supType?.default_cutoff_time) ?? toHm(session?.cutoff_time);
      sup = {
        hasSession: true,
        openTime,
        cutoffTime,
        phase: sessionPhase({ now, openTime, cutoffTime }),
        counts: await loadCounts(db, session?.id ?? null),
        rosterCount: supRosterCount,
      };
    }

    const monthlyRosterCount = await loadRosterCount(db, monthlyType?.id ?? null);
    const monthlySession = await findSession(db, monthlyType?.id ?? null, today);
    // monthly.hasSession only with a session row; the row's own times.
    let monthly;
    if (!monthlySession) {
      monthly = { hasSession: false, rosterCount: monthlyRosterCount };
    } else {
      const openTime = toHm(monthlySession.open_time);
      const cutoffTime = toHm(monthlySession.cutoff_time);
      monthly = {
        hasSession: true,
        openTime,
        cutoffTime,
        phase: sessionPhase({ now, openTime, cutoffTime }),
        counts: await loadCounts(db, monthlySession.id),
        rosterCount: monthlyRosterCount,
      };
    }

    return c.json({ ok: true, today: { dateText: formatDateText(now), sup, monthly } }, 200);
  } catch (error) {
    logError("meeting overview failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
  }
});

// --- GET /api/meeting/overview/pending ----------------------------------------

overview.get("/pending", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  // Strict query: exactly one key 'code' with 'sup' or 'monthly', like the
  // Express z.object({ code: z.enum([...]) }).strict() on req.query. The raw
  // URL is parsed directly because this Hono version leaves query values
  // undecoded; URLSearchParams applies the standard decoding.
  const params = new URL(c.req.raw.url).searchParams;
  const queryKeys = [...params.keys()];
  const code = queryKeys.length === 1 && queryKeys[0] === "code" ? params.get("code") : null;
  if (!VALID_CODES.has(code)) {
    return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    const today = todayOf(new Date());
    const { sup: supType, monthly: monthlyType } = await findTypes(db);
    const type = code === "sup" ? supType : monthlyType;
    if (!type) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);

    const session = await findSession(db, type.id, today);
    if (!session) {
      return c.json({ ok: true, code, sessionDate: null, pending: [] }, 200);
    }

    const rosterRows = await db.select(ROSTER_TABLE, {
      columns: MEMBER_FIELDS,
      filters: [
        ["meeting_type_id", "eq", type.id],
        ["is_active", "eq", true],
      ],
    });

    const attendanceRows = await db.select(ATTENDANCE_TABLE, {
      columns: "employee_id",
      filters: [["session_id", "eq", session.id]],
    });

    const roster = rosterRows.map((row) => {
      const employee = row.employees ?? {};
      return {
        employeeId: row.employee_id,
        fullName: employee.full_name ?? DASH,
        departmentName: firstEmbedded(employee.departments)?.name ?? DASH,
        positionName: firstEmbedded(employee.positions)?.name ?? DASH,
      };
    });

    // employeeId is intentionally dropped from the response, same as Express.
    const pending = findPending(roster, attendanceRows).map((item) => ({
      fullName: item.fullName,
      departmentName: item.departmentName,
      positionName: item.positionName,
    }));

    return c.json({ ok: true, code, sessionDate: today, pending }, 200);
  } catch (error) {
    logError("meeting overview failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
  }
});

export default overview;
