// Dashboard reads for the meeting controller (Phase 3a): five GET routes
// ported from server/routes/meeting-dashboard.js. POST /dashboard/reason
// arrives in Phase 3b. No auto-absent helper is reachable from here: GETs
// have no side effects, no audit_logs insert and no attendance writes.

import { Hono } from "hono";

import { requireRole } from "../require-role.js";
import { createDb } from "../db.js";
import {
  STATUS_LABELS,
  EMPTY_MESSAGE,
  NOT_YET_LABEL,
  ATTENDED_LABEL,
  NOT_ATTENDED_LABEL,
  URGENT_BUSY_LABEL,
  LEAVE_LABEL,
  bangkokDayKey,
  timeOfDay,
  thaiMonthLabel,
  cycleLabel,
  cycleFullLabel,
  cycleKeyOf,
  nextMonthKey,
  latestPerEmployee,
  sortByRegisteredAt,
  countByStatus,
  rateOf,
  historyKeys,
  deptSummary,
  topAbsentPerDept,
} from "../meeting-dashboard.js";
import { STATUS_LABEL_BY_CODE } from "../meeting-overview.js";

const INVALID_INPUT_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const TYPE_ERROR_MESSAGE = "ประเภทการประชุมไม่ถูกต้อง";
const SERVER_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";

/** Same as the Express route: only the error name/code, never data or secrets. */
function logError(error) {
  console.error("[meeting-dashboard-error]", error?.code ?? error?.name);
}

const TYPES_TABLE = "meeting_types";
const SESSIONS_TABLE = "meeting_sessions";
const ATTENDANCE_TABLE = "meeting_attendance";
const ROSTER_TABLE = "meeting_roster";
const EMPLOYEES_TABLE = "employees";

// Meeting attendance rows per PostgREST call: the dashboard reads at most 400
// sessions, so 100 per chunk keeps each `in(...)` list small.
const SELECT_CHUNK_SIZE = 100;
const EMPLOYEE_CHUNK_SIZE = 100;
const SESSIONS_LIMIT = 400;

const TYPES_COLUMNS = "id,code,name";
const SESSIONS_COLUMNS = "id,session_date";
const ATTENDANCE_COLUMNS = "id,session_id,employee_id,status_code,reason,shift,registered_at";
const ROSTER_COLUMNS = "employee_id,employees!meeting_roster_employee_id_fkey!inner(full_name,departments(name),positions(name))";
const EMPLOYEE_COLUMNS = "id,full_name,departments(name),positions(name)";
// /registrants also returns employee_code. Kept as its own string so the shared
// EMPLOYEE_COLUMNS (and therefore every other route's query) stays unchanged.
const REGISTRANTS_EMPLOYEE_COLUMNS = `${EMPLOYEE_COLUMNS},employee_code`;

const VALID_CODES = new Set(["sup", "monthly"]);
const VALID_MODES = new Set(["day", "month", "year"]);
const CYCLE_PATTERN = /^\d{4}-\d{2}(-\d{2})?$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DASH = "-";

const dashboard = new Hono();

dashboard.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

function guard(c) {
  return requireRole(c.env, c.req.raw, ["meeting_controller"]);
}

function reject(c, status, message) {
  return c.json({ ok: false, error: message }, status, {
    "Cache-Control": "no-store",
  });
}

/** Non-strict query read: only known keys are considered, unknown fields ignored. */
function readQuery(c, allowed) {
  const params = new URL(c.req.raw.url).searchParams;
  const query = {};
  for (const key of allowed) {
    const value = params.get(key);
    if (value !== null) query[key] = value;
  }
  return query;
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

async function loadType(db, code) {
  return db.select(TYPES_TABLE, {
    columns: TYPES_COLUMNS,
    filters: [["code", "eq", code]],
    single: true,
  });
}

async function loadSessionsAll(db, typeId) {
  return db.select(SESSIONS_TABLE, {
    columns: SESSIONS_COLUMNS,
    filters: [["meeting_type_id", "eq", typeId]],
    order: "session_date.desc",
    limit: SESSIONS_LIMIT,
  });
}

function chunk(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) {
    chunks.push(list.slice(index, index + size));
  }
  return chunks;
}

async function loadAttendance(db, sessionIds) {
  const ids = [...new Set(sessionIds)].filter((id) => typeof id === "string" && id.length > 0);
  const rows = [];
  for (const part of chunk(ids, SELECT_CHUNK_SIZE)) {
    const partRows = await db.select(ATTENDANCE_TABLE, {
      columns: ATTENDANCE_COLUMNS,
      filters: [["session_id", "in", part]],
    });
    rows.push(...partRows);
  }
  return rows;
}

function firstEmbedded(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadRoster(db, typeId) {
  const rows = await db.select(ROSTER_TABLE, {
    columns: ROSTER_COLUMNS,
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["is_active", "eq", true],
    ],
  });
  return rows.map((row) => {
    const employee = firstEmbedded(row.employees);
    return {
      employeeId: row.employee_id,
      fullName: employee?.full_name ?? DASH,
      departmentName: firstEmbedded(employee?.departments)?.name ?? DASH,
      positionName: firstEmbedded(employee?.positions)?.name ?? DASH,
    };
  });
}

async function loadEmployees(db, employeeIds, columns = EMPLOYEE_COLUMNS) {
  const ids = [...new Set(employeeIds)].filter((id) => typeof id === "string" && id.length > 0);
  const loaded = new Map();
  for (const part of chunk(ids, EMPLOYEE_CHUNK_SIZE)) {
    const rows = await db.select(EMPLOYEES_TABLE, {
      columns,
      filters: [["id", "in", part]],
    });
    for (const row of rows) {
      loaded.set(row.id, {
        fullName: row.full_name ?? DASH,
        departmentName: firstEmbedded(row.departments)?.name ?? DASH,
        positionName: firstEmbedded(row.positions)?.name ?? DASH,
        employeeCode: row.employee_code ?? null,
      });
    }
  }
  return loaded;
}

// Exported for the Phase 3b reason route, which loads the same context before
// narrowing to the one requested employee row. Additive only: the five GET
// routes above call it unchanged.
export async function loadContext(db, code) {
  const type = await loadType(db, code);
  if (!type) return { typeNotFound: true };

  const sessions = await loadSessionsAll(db, type.id);
  const sessionIds = sessions.map((row) => row.id);
  const attendance = await loadAttendance(db, sessionIds);

  const rowsByCycle = new Map();
  const availableKeys = new Set();
  for (const row of attendance) {
    const session = sessions.find((item) => item.id === row.session_id);
    if (!session) continue;
    const key = cycleKeyOf(code, session.session_date);
    const bucket = rowsByCycle.get(key) ?? [];
    bucket.push(row);
    rowsByCycle.set(key, bucket);
    if (session.session_date) availableKeys.add(key);
  }

  return {
    type,
    sessions,
    attendance,
    rowsByCycle,
    availableKeys: [...availableKeys].sort((a, b) => String(a).localeCompare(String(b))),
    typeNotFound: false,
  };
}

/* ------------------------------------------------------------------ */
/* Local response builders                                             */
/* ------------------------------------------------------------------ */

function emptyLabelCounts() {
  return {
    [ATTENDED_LABEL]: 0,
    [NOT_ATTENDED_LABEL]: 0,
    [URGENT_BUSY_LABEL]: 0,
    [LEAVE_LABEL]: 0,
  };
}

function statusCountsToLabels(counts) {
  const labels = emptyLabelCounts();
  for (const [code, count] of Object.entries(counts)) {
    if (code === "total") continue;
    const label = STATUS_LABEL_BY_CODE[code];
    if (label) labels[label] = count;
  }
  return labels;
}




dashboard.get("/", async (c) => {
  const guardResult = await guard(c);
  if (!guardResult.ok) return reject(c, guardResult.status, guardResult.message);

  const query = readQuery(c, ["code", "mode", "value"]);
  const code = query.code;
  const mode = query.mode;
  const rawValue = query.value;

  if (!VALID_CODES.has(code)) return reject(c, 400, INVALID_INPUT_MESSAGE);
  if (mode !== undefined && !VALID_MODES.has(mode)) return reject(c, 400, INVALID_INPUT_MESSAGE);
  if (rawValue !== undefined && rawValue.length > 10) return reject(c, 400, INVALID_INPUT_MESSAGE);
  const value = typeof rawValue === "string" ? rawValue.trim() : "";

  const db = createDb(c.env);
  try {
    const context = await loadContext(db, code);
    if (context.typeNotFound) return reject(c, 400, TYPE_ERROR_MESSAGE);

    const roster = await loadRoster(db, context.type.id);
    const currentKey = context.availableKeys.at(-1) ?? "";
    const currentRows = context.rowsByCycle.get(currentKey) ?? [];
    const latest = latestPerEmployee(currentRows);
    const currentCounts = countByStatus(latest);

    const registeredIds = new Set(latest.map((row) => row.employee_id));
    const registeredInRoster = roster.filter((member) => registeredIds.has(member.employeeId)).length;

    const keys = historyKeys({ code, mode: mode ?? "day", value, availableKeys: context.availableKeys });
    const cycles = keys.map((key) => {
      const rows = key === currentKey ? currentRows : (context.rowsByCycle.get(key) ?? []);
      const cycleLatest = key === currentKey ? latest : latestPerEmployee(rows);
      const counts = countByStatus(cycleLatest);
      return {
        key,
        label: cycleLabel(code, key),
        fullLabel: cycleFullLabel(code, key),
        counts,
        total: counts.total,
        rate: rateOf(counts.attended, counts.total),
      };
    });

    return c.json({
      ok: true,
      meeting: {
        code,
        name: context.type.name ?? "",
        // Decision 4: fixed label kept exactly as the Express server.
        periodLabel: code === "sup" ? "รายสัปดาห์ · ทุกวันอังคาร" : "รายเดือน",
      },
      updated: new Date().toISOString(),
      todayKey: bangkokDayKey(new Date()),
      current: {
        key: currentKey,
        label: currentKey ? cycleFullLabel(code, currentKey) : EMPTY_MESSAGE,
      },
      statuses: STATUS_LABELS,
      rosterCount: roster.length,
      today: {
        // Express behaviour kept (decision 2): registered counts every latest
        // row, notYet is filtered against the roster only.
        registered: currentCounts.total,
        byStatus: statusCountsToLabels(currentCounts),
        notYet: Math.max(roster.length - registeredInRoster, 0),
      },
      depts: deptSummary(roster, latest),
      history: {
        // Express defaults an absent mode to the day window.
        mode: mode ?? "day",
        key: value || currentKey,
        options: context.availableKeys.map((key) => ({
          key,
          label: cycleFullLabel(code, key),
        })),
        cycles,
        empty: context.availableKeys.length === 0,
        emptyMessage: EMPTY_MESSAGE,
      },
    });
  } catch (error) {
    logError(error);
    return reject(c, 500, SERVER_ERROR_MESSAGE);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/meeting/dashboard/cycles                                   */
/* ------------------------------------------------------------------ */

dashboard.get("/cycles", async (c) => {
  const guardResult = await guard(c);
  if (!guardResult.ok) return reject(c, guardResult.status, guardResult.message);

  const query = readQuery(c, ["code"]);
  const code = query.code;
  if (!VALID_CODES.has(code)) return reject(c, 400, INVALID_INPUT_MESSAGE);

  const db = createDb(c.env);
  try {
    const context = await loadContext(db, code);
    if (context.typeNotFound) return reject(c, 400, TYPE_ERROR_MESSAGE);

    return c.json({
      ok: true,
      options: context.availableKeys.map((key) => ({
        key,
        label: cycleFullLabel(code, key),
      })),
    });
  } catch (error) {
    logError(error);
    return reject(c, 500, SERVER_ERROR_MESSAGE);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/meeting/dashboard/dept                                     */
/* ------------------------------------------------------------------ */

dashboard.get("/dept", async (c) => {
  const guardResult = await guard(c);
  if (!guardResult.ok) return reject(c, guardResult.status, guardResult.message);

  const query = readQuery(c, ["code", "cycle", "dept"]);
  const code = query.code;
  const cycle = query.cycle;
  const dept = query.dept;

  if (!VALID_CODES.has(code)) return reject(c, 400, INVALID_INPUT_MESSAGE);
  if (typeof cycle !== "string" || !CYCLE_PATTERN.test(cycle)) return reject(c, 400, INVALID_INPUT_MESSAGE);
  if (typeof dept !== "string" || dept.length < 1 || dept.length > 200) return reject(c, 400, INVALID_INPUT_MESSAGE);

  const db = createDb(c.env);
  try {
    const type = await loadType(db, code);
    if (!type) return reject(c, 400, TYPE_ERROR_MESSAGE);

    const roster = await loadRoster(db, type.id);
    const members = roster.filter((member) => member.departmentName === dept);

    const sessions = code === "sup"
      ? await db.select(SESSIONS_TABLE, {
          columns: SESSIONS_COLUMNS,
          filters: [
            ["meeting_type_id", "eq", type.id],
            ["session_date", "eq", cycle],
          ],
        })
      : await db.select(SESSIONS_TABLE, {
          columns: SESSIONS_COLUMNS,
          filters: [
            ["meeting_type_id", "eq", type.id],
            ["session_date", "gte", `${cycle}-01`],
            ["session_date", "lt", `${nextMonthKey(cycle)}-01`],
          ],
        });

    const sessionIds = sessions.map((row) => row.id);
    const cycleRows = await loadAttendance(db, sessionIds);
    const latest = latestPerEmployee(cycleRows);
    const latestByEmployee = new Map(latest.map((row) => [row.employee_id, row]));

    const counts = emptyLabelCounts();
    const people = members.map((member) => {
      const row = latestByEmployee.get(member.employeeId) ?? null;
      const status = row ? (STATUS_LABEL_BY_CODE[row.status_code] ?? DASH) : NOT_YET_LABEL;
      if (STATUS_LABELS.includes(status)) counts[status] += 1;
      return {
        employeeId: member.employeeId,
        name: member.fullName,
        level: member.positionName,
        status,
        shift: row?.shift ?? null,
        time: row ? timeOfDay(row.registered_at) : null,
      };
    });

    people.sort((a, b) => statusOrderIndex(a.status) - statusOrderIndex(b.status) ||
      String(a.name).localeCompare(String(b.name), "th"));

    return c.json({
      ok: true,
      dept,
      cycle: { key: cycle, label: cycleFullLabel(code, cycle) },
      total: members.length,
      counts,
      people,
      notYet: people.filter((person) => person.status === NOT_YET_LABEL).length,
    });
  } catch (error) {
    logError(error);
    return reject(c, 500, SERVER_ERROR_MESSAGE);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/meeting/dashboard/registrants                              */
/* ------------------------------------------------------------------ */

dashboard.get("/registrants", async (c) => {
  const guardResult = await guard(c);
  if (!guardResult.ok) return reject(c, guardResult.status, guardResult.message);

  const query = readQuery(c, ["code", "cycle"]);
  const code = query.code;
  const cycle = query.cycle;
  if (!VALID_CODES.has(code)) return reject(c, 400, INVALID_INPUT_MESSAGE);
  if (typeof cycle !== "string" || !CYCLE_PATTERN.test(cycle)) return reject(c, 400, INVALID_INPUT_MESSAGE);

  const db = createDb(c.env);
  try {
    const type = await loadType(db, code);
    if (!type) return reject(c, 400, TYPE_ERROR_MESSAGE);

    const sessions = code === "sup"
      ? await db.select(SESSIONS_TABLE, {
          columns: SESSIONS_COLUMNS,
          filters: [
            ["meeting_type_id", "eq", type.id],
            ["session_date", "eq", cycle],
          ],
        })
      : await db.select(SESSIONS_TABLE, {
          columns: SESSIONS_COLUMNS,
          filters: [
            ["meeting_type_id", "eq", type.id],
            ["session_date", "gte", `${cycle}-01`],
            ["session_date", "lt", `${nextMonthKey(cycle)}-01`],
          ],
        });

    const sessionIds = sessions.map((row) => row.id);
    const cycleRows = await loadAttendance(db, sessionIds);
    const latest = sortByRegisteredAt(latestPerEmployee(cycleRows));
    const employees = await loadEmployees(
      db,
      latest.map((row) => row.employee_id),
      REGISTRANTS_EMPLOYEE_COLUMNS,
    );

    const items = latest.map((row) => {
      const employee = employees.get(row.employee_id);
      return {
        name: employee?.fullName ?? DASH,
        departmentName: employee?.departmentName ?? DASH,
        positionName: employee?.positionName ?? DASH,
        status: STATUS_LABEL_BY_CODE[row.status_code] ?? DASH,
        shift: row.shift ?? null,
        time: timeOfDay(row.registered_at),
        employeeCode: employee?.employeeCode ?? null,
      };
    });

    return c.json({
      ok: true,
      cycle: { key: cycle, label: cycleFullLabel(code, cycle) },
      total: items.length,
      items,
    });
  } catch (error) {
    logError(error);
    return reject(c, 500, SERVER_ERROR_MESSAGE);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/meeting/dashboard/monthly-summary                          */
/* ------------------------------------------------------------------ */

dashboard.get("/monthly-summary", async (c) => {
  const guardResult = await guard(c);
  if (!guardResult.ok) return reject(c, guardResult.status, guardResult.message);

  const query = readQuery(c, ["month"]);
  const month = query.month;
  if (typeof month !== "string" || !MONTH_PATTERN.test(month)) return reject(c, 400, INVALID_INPUT_MESSAGE);

  const db = createDb(c.env);
  try {
    const context = await loadContext(db, "monthly");
    if (context.typeNotFound) return reject(c, 400, TYPE_ERROR_MESSAGE);

    const roster = await loadRoster(db, context.type.id);
    const monthSessions = context.sessions.filter((row) => String(row.session_date ?? "").slice(0, 7) === month);
    const dateKeys = new Set(monthSessions.map((row) => row.session_date));
    const rows = context.rowsByCycle.get(month) ?? [];
    const employees = await loadEmployees(db, [...new Set(rows.map((row) => row.employee_id))]);

    const deptNames = [...new Set(roster.map((member) => member.departmentName))].sort((a, b) =>
      String(a).localeCompare(String(b), "th")
    );

    const rowsByDept = new Map();
    const personCounts = new Map();
    for (const row of rows) {
      const employee = employees.get(row.employee_id);
      const dept = employee?.departmentName;
      if (!dept) continue;
      const list = rowsByDept.get(dept) ?? [];
      list.push(row);
      rowsByDept.set(dept, list);

      // Express runtime behaviour (owner decision: keep identical to
      // Express): personCounts are keyed with the Thai label, so the
      // aggregated rows carry the label in `status`. topAbsentPerDept filters
      // on the English codes ['not_attended','urgent_busy','leave'], nothing
      // matches, and top is always [] at runtime — with data or without.
      const label = STATUS_LABEL_BY_CODE[row.status_code];
      if (!label) continue;
      const personKey = `${dept}\u0000${employee.fullName}\u0000${label}`;
      personCounts.set(personKey, (personCounts.get(personKey) ?? 0) + 1);
    }

    const depts = deptNames.map((name) => {
      const deptRows = rowsByDept.get(name) ?? [];
      const counts = emptyLabelCounts();
      for (const row of deptRows) {
        const label = STATUS_LABEL_BY_CODE[row.status_code];
        if (label) counts[label] += 1;
      }
      const rates = {};
      for (const label of STATUS_LABELS) rates[label] = rateOf(counts[label], deptRows.length);
      return { name, counts, rows: deptRows.length, rates };
    });

    const aggregated = [...personCounts.entries()].map(([key, count]) => {
      const [dept, name, status] = key.split("\u0000");
      return { dept, name, status, count };
    });
    const totalMeetings = dateKeys.size;
    const top = topAbsentPerDept(aggregated).map((entry) => ({
      ...entry,
      pct: totalMeetings > 0 ? entry.count / totalMeetings : 0,
    }));

    return c.json({
      ok: true,
      month: { key: month, label: thaiMonthLabel(month) },
      totalMeetings,
      depts,
      top,
    });
  } catch (error) {
    logError(error);
    return reject(c, 500, SERVER_ERROR_MESSAGE);
  }
});

/* ------------------------------------------------------------------ */
/* Small helpers used only by the routes above                         */
/* ------------------------------------------------------------------ */

function statusOrderIndex(label) {
  const index = STATUS_LABELS.indexOf(label);
  return index === -1 ? STATUS_LABELS.length : index;
}

export default dashboard;
