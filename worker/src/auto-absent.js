// Auto-absent on a Cron Trigger, ported from server/auto-absent.js and
// server/auto-absent-job.js. The helpers are 1:1 with Express; the job is
// batched for the Workers free plan (worker/reports/phase4-spec-draft.md).
//
// Approved differences from Express:
// - Cron owns the schedule: no timers and no lastStartedAt / runInProgress state.
// - One meeting_attendance upsert and one audit_logs insert per run instead of
//   one of each per session. With N pending sessions a run costs
//   5 + 2 * ceil(N / 100) subrequests, plus one when it reads the skip dates and
//   one more when it creates the sup session (so 7 for N <= 10 on a tick where
//   the sup rule cannot fire, 9 when it creates the session).
// - Phase 4c reads meeting_skip_dates only when the sup rule can act on them
//   (supRulePossible): another weekday, a passed cutoff or no sup type makes the
//   read irrelevant, so an idle tick costs two reads (types, sessions) instead
//   of three. Nothing else is skipped, and no write depends on that read then.
// - The sup upsert is skipped when the window read this tick already performed
//   contains today's sup session: with resolution=ignore-duplicates that write
//   can never change such a row, so it is a guaranteed no-op. Only an exact
//   (meeting_type_id, session_date) match on loaded data counts as proof; any
//   doubt keeps the upsert. A row created by the upsert is returned back and
//   added to the due list, so it is still marked by the same run.
// - The audit marker is written only after the attendance write succeeded, so an
//   interrupted run leaves its sessions pending for the next tick. ignoreDuplicates
//   keeps every rewrite from creating or overwriting rows.
//
// No I/O besides PostgREST, no secrets, no response bodies in logs.

import { createDb } from "./db.js";
import { bangkokToday, normalizeTime } from "./register-window.js";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 48 * 60 * 60 * 1000;
const WINDOW_DAYS = 2;
const MEETING_CODES = ["sup", "monthly"];
const ABSENT_STATUS_CODE = "not_attended";
const AUDIT_ACTION = "auto_absent_done";
const AUDIT_ENTITY = "meeting_session";

/** Sessions handled per run; the rest carry over to the next cron tick. */
export const BATCH_LIMIT = 10;
/** The approved trigger; the entry module keeps it out of its own exports. */
export const AUTO_ABSENT_CRON = "* * * * *";
/** PostgREST `in.(...)` lists stay at 100 ids per call. */
const IN_CHUNK_SIZE = 100;

function logError(error) {
  console.error("[auto-absent-error]", error?.code ?? error?.name);
}

function parseDayKey(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dayKey === "string" ? dayKey : "");
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function parseTime(timeText) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof timeText === "string" ? timeText : "");
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function cutoffMomentMs(dayMs, time) {
  return dayMs + time.hours * 60 * 60 * 1000 + time.minutes * 60 * 1000 - BANGKOK_OFFSET_MS;
}

export function isDueSession({ now, cutoffTime, sessionDate, todayKey }) {
  const sessionMs = parseDayKey(sessionDate);
  const todayMs = parseDayKey(todayKey);
  const time = parseTime(cutoffTime);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (sessionMs === null || todayMs === null || time === null) return false;
  if (!Number.isFinite(nowMs)) return false;
  if (sessionMs > todayMs) return false;

  const cutoffMs = cutoffMomentMs(sessionMs, time);
  if (nowMs < cutoffMs) return false;
  return nowMs - cutoffMs <= WINDOW_MS;
}

export function missingEmployees(rosterEmployeeIds, attendedEmployeeIds) {
  const attended = new Set(attendedEmployeeIds ?? []);
  return (rosterEmployeeIds ?? []).filter(
    (employeeId) =>
      typeof employeeId === "string" && employeeId.length > 0 && !attended.has(employeeId),
  );
}

export function isSkipDate(dayKey, skipDateSet) {
  if (typeof dayKey !== "string" || dayKey.length === 0) return false;
  if (skipDateSet instanceof Set) return skipDateSet.has(dayKey);
  if (Array.isArray(skipDateSet)) return skipDateSet.includes(dayKey);
  return false;
}

export function shouldEnsureSupSession({ now, weekday, cutoffTime, todayKey, skipDateSet }) {
  if (weekday === null || weekday === undefined) return false;
  const todayMs = parseDayKey(todayKey);
  const time = parseTime(cutoffTime);
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (todayMs === null || time === null) return false;
  if (!Number.isFinite(nowMs)) return false;
  if (new Date(todayMs).getUTCDay() !== Number(weekday)) return false;
  if (isSkipDate(todayKey, skipDateSet)) return false;
  return nowMs >= cutoffMomentMs(todayMs, time);
}

export function dayKeyBefore(dayKey, days) {
  const todayMs = parseDayKey(dayKey);
  if (todayMs === null) return "";
  const shifted = new Date(todayMs - Number(days) * DAY_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Subrequests one run may spend under the approved batching formula:
 * types + sessions + marker chunks + roster + attendance chunks + attendance
 * upsert + marker insert, plus the gated skip-date read and the sup upsert.
 * `readsSkipDates` defaults to `createsSupSession`, which is exactly when the
 * gate reads them.
 */
export function subrequestBudget(
  pendingCount,
  { createsSupSession = false, readsSkipDates = createsSupSession } = {},
) {
  return (
    5 +
    2 * Math.ceil(pendingCount / IN_CHUNK_SIZE) +
    (readsSkipDates ? 1 : 0) +
    (createsSupSession ? 1 : 0)
  );
}

function chunk(list, size) {
  const parts = [];
  for (let index = 0; index < list.length; index += size) {
    parts.push(list.slice(index, index + size));
  }
  return parts;
}

/** Writes answer { error } instead of throwing; turn that back into a throw. */
function failOnWrite(result) {
  if (result.error) {
    const error = new Error("postgrest write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}

/** Reads `columns` from `table` where `column` is in `ids`, 100 ids per call. */
async function selectInChunks(db, table, columns, column, ids, filters = []) {
  const rows = [];
  for (const part of chunk(ids, IN_CHUNK_SIZE)) {
    const partRows = await db.select(table, {
      columns,
      filters: [[column, "in", part], ...filters],
    });
    rows.push(...partRows);
  }
  return rows;
}

function byOldestFirst(a, b) {
  const dateA = typeof a.session_date === "string" ? a.session_date : "";
  const dateB = typeof b.session_date === "string" ? b.session_date : "";
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const idA = String(a.id ?? "");
  const idB = String(b.id ?? "");
  if (idA === idB) return 0;
  return idA < idB ? -1 : 1;
}

/**
 * Can the sup-session rule fire today, ignoring skip dates? False means
 * meeting_skip_dates cannot change any write, so that read is dropped. A value
 * the rule could not interpret is treated as "maybe", which keeps the read.
 */
export function supRulePossible({ now, supType, todayKey }) {
  if (!supType) return false;
  try {
    if (supType.weekday === null || supType.weekday === undefined) return false;
    const todayMs = parseDayKey(todayKey);
    const time = parseTime(normalizeTime(supType.default_cutoff_time));
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    // Unknown input: keep the read rather than risk dropping a creation.
    if (todayMs === null || time === null || !Number.isFinite(nowMs)) return true;
    if (new Date(todayMs).getUTCDay() !== Number(supType.weekday)) return false;
    return nowMs >= cutoffMomentMs(todayMs, time);
  } catch {
    return true;
  }
}

/**
 * Everything a tick needs up to the due-session test.
 * `hasSupSession` answers whether today's sup session is in a window read.
 * Only an exact match on two loaded string fields counts, so a missing id, a
 * missing field or no row at all answers "not proven" and keeps the upsert.
 */
function hasSupSession(sessions, supType, todayKey) {
  if (!supType || typeof supType.id !== "string" || supType.id.length === 0) return false;
  if (typeof todayKey !== "string" || todayKey.length === 0) return false;
  return sessions.some(
    (session) =>
      session !== null &&
      typeof session === "object" &&
      session.meeting_type_id === supType.id &&
      session.session_date === todayKey,
  );
}

/**
 * Everything a tick needs up to the due-session test.
 * `write` also issues the sup upsert, and adds the created row to the due list,
 * so a session created now is still processed in the same run as Express does.
 * `gate: false` forces the pre-4c sequence (skip dates always read, the sup
 * upsert always issued) for the parity test.
 * `stopped` ends the tick without writing: an unusable window, or a failed
 * skip-date read (fail closed, so a cancelled session is never created).
 */
async function gatherRunInputs(env, at, { write, gate }) {
  const db = createDb(env);
  const todayKey = bangkokToday(at);
  const fromKey = dayKeyBefore(todayKey, WINDOW_DAYS);
  if (!fromKey) return { stopped: true, reason: "window" };

  // 1. Meeting types.
  const types = await db.select("meeting_types", {
    columns: "id, code, weekday, default_open_time, default_cutoff_time",
    filters: [["code", "in", MEETING_CODES]],
  });
  const supType = types.find((row) => row.code === "sup") ?? null;

  // 2. Skip dates, only when the sup rule could act on them.
  let supRuleFires = false;
  const readsSkipDates = gate ? supRulePossible({ now: at, supType, todayKey }) : true;
  if (readsSkipDates) {
    let skipDates;
    try {
      const rows = await db.select("meeting_skip_dates", {
        columns: "skip_date",
        filters: [
          ["skip_date", "gte", fromKey],
          ["skip_date", "lte", todayKey],
        ],
      });
      skipDates = new Set(rows.map((row) => row.skip_date));
    } catch (error) {
      logError(error);
      return { stopped: true, reason: "skip-dates" };
    }

    supRuleFires = Boolean(
      supType &&
        shouldEnsureSupSession({
          now: at,
          weekday: supType.weekday,
          cutoffTime: normalizeTime(supType.default_cutoff_time),
          todayKey,
          skipDateSet: skipDates,
        }),
    );
  }

  // 3. Sessions inside the window. Read before the sup write, because this read
  //    is what proves whether today's sup session is already there.
  const sessions = await db.select("meeting_sessions", {
    columns: "id, meeting_type_id, session_date, cutoff_time",
    filters: [
      ["session_date", "gte", fromKey],
      ["session_date", "lte", todayKey],
    ],
  });

  // 4. Create today's sup session when it is due, never touching a manual row.
  //    ignore-duplicates never changes a row that already holds this
  //    (meeting_type_id, session_date), so when the read above has it the upsert
  //    is a proven no-op and is skipped; anything unproven keeps the write.
  const supPresent = hasSupSession(sessions, supType, todayKey);
  const createsSupSession = supRuleFires && !(gate && supPresent);
  if (createsSupSession && write) {
    const saved = failOnWrite(
      await db.upsert(
        "meeting_sessions",
        {
          meeting_type_id: supType.id,
          session_date: todayKey,
          cycle_key: `sup-${todayKey}`,
          open_time: normalizeTime(supType.default_open_time),
          cutoff_time: normalizeTime(supType.default_cutoff_time),
        },
        {
          conflict: "meeting_type_id,session_date",
          columns: "id, meeting_type_id, session_date, cutoff_time",
          ignoreDuplicates: true,
        },
      ),
    ).data;
    // A newly created row cannot be in the read above, so add it to keep the
    // same-run marking Express does. No usable row back (the insert was ignored
    // as a duplicate) means the next tick picks the session up from its read.
    if (
      saved &&
      typeof saved.id === "string" &&
      saved.id.length > 0 &&
      saved.session_date === todayKey &&
      !hasSupSession(sessions, supType, todayKey)
    ) {
      sessions.push(saved);
    }
  }

  const typeById = new Map(types.map((row) => [row.id, row]));
  const dueSessions = [];
  for (const session of sessions) {
    const type = typeById.get(session.meeting_type_id);
    if (!type) continue;
    const cutoffTime = normalizeTime(session.cutoff_time) ?? normalizeTime(type.default_cutoff_time);
    if (!cutoffTime) continue;
    if (!isDueSession({ now: at, cutoffTime, sessionDate: session.session_date, todayKey })) {
      continue;
    }
    dueSessions.push(session);
  }
  dueSessions.sort(byOldestFirst);
  return { db, types, dueSessions, createsSupSession };
}

/**
 * Read-only verdict for the cheap idle path: can this tick end without writing?
 * It runs the same reads in the same order and the same rules as a real tick,
 * but never issues the sup upsert, so `nothingToDo: true` is exactly the case
 * where the run writes nothing. It may only be conservative (answer false when
 * the run would also write nothing), never optimistic.
 */
export async function precheckAutoAbsent(env, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) return { nothingToDo: true, reason: "clock" };

  const inputs = await gatherRunInputs(env, at, { write: false, gate: true });
  if (inputs.stopped) return { nothingToDo: true, reason: inputs.reason };
  if (inputs.dueSessions.length > 0) return { nothingToDo: false, reason: "due-session" };
  // A sup session this tick would create is itself a due session: that is work.
  if (inputs.createsSupSession) return { nothingToDo: false, reason: "sup-session" };
  return { nothingToDo: true, reason: "no-due-session" };
}

/**
 * One cron tick. `now` is event.scheduledTime in production and a fixed Date in
 * tests. Returns { processed }: the number of sessions fully written this run.
 * `skipDateGate: false` exists only so a test can compare the writes against the
 * pre-4c read and write sequence; production always uses both gates.
 */
export async function runAutoAbsentOnce(env, now = new Date(), { skipDateGate = true } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) return { processed: 0 };

  const inputs = await gatherRunInputs(env, at, { write: true, gate: skipDateGate });
  if (inputs.stopped) return { processed: 0 };

  const { db, dueSessions } = inputs;
  if (dueSessions.length === 0) return { processed: 0 };

  // 5. Skip the sessions a previous run already closed with an audit marker.
  const dueIds = dueSessions
    .map((session) => session.id)
    .filter((id) => typeof id === "string" && id.length > 0);
  const marked = await selectInChunks(db, "audit_logs", "entity_id", "entity_id", dueIds, [
    ["action", "eq", AUDIT_ACTION],
    ["entity", "eq", AUDIT_ENTITY],
  ]);
  const done = new Set(marked.map((row) => row.entity_id));

  // 6. Cap the batch; everything left stays pending for the next tick.
  const pending = dueSessions
    .filter((session) => !done.has(session.id))
    .slice(0, BATCH_LIMIT);
  if (pending.length === 0) return { processed: 0 };

  // 7. Roster of the types in this batch, with the employee's department/position.
  const rosterRows = await db.select("meeting_roster", {
    columns:
      "meeting_type_id, employee_id, employees!meeting_roster_employee_id_fkey!inner(department_id, position_id)",
    filters: [
      ["meeting_type_id", "in", [...new Set(pending.map((session) => session.meeting_type_id))]],
      ["is_active", "eq", true],
    ],
  });

  const rosterByType = new Map();
  const employeeById = new Map();
  for (const row of rosterRows) {
    const list = rosterByType.get(row.meeting_type_id) ?? [];
    list.push(row.employee_id);
    rosterByType.set(row.meeting_type_id, list);
    employeeById.set(row.employee_id, {
      departmentId: row.employees?.department_id ?? null,
      positionId: row.employees?.position_id ?? null,
    });
  }

  // 8. Who already has a row of any status for these sessions.
  const pendingIds = pending.map((session) => session.id);
  const attendedRows = await selectInChunks(
    db,
    "meeting_attendance",
    "session_id, employee_id",
    "session_id",
    pendingIds,
  );
  const attendedBySession = new Map();
  for (const row of attendedRows) {
    const list = attendedBySession.get(row.session_id) ?? [];
    list.push(row.employee_id);
    attendedBySession.set(row.session_id, list);
  }

  // 9. One row per missing employee, one marker per session.
  const stamp = new Date().toISOString();
  const attendanceRows = [];
  const markers = [];
  for (const session of pending) {
    const rosterIds = rosterByType.get(session.meeting_type_id) ?? [];
    const missing = missingEmployees(rosterIds, attendedBySession.get(session.id) ?? []);
    for (const employeeId of missing) {
      attendanceRows.push({
        session_id: session.id,
        employee_id: employeeId,
        status_code: ABSENT_STATUS_CODE,
        reason: null,
        shift: null,
        department_id: employeeById.get(employeeId)?.departmentId ?? null,
        position_id: employeeById.get(employeeId)?.positionId ?? null,
        registered_at: stamp,
      });
    }
    markers.push({
      actor_id: null,
      action: AUDIT_ACTION,
      entity: AUDIT_ENTITY,
      entity_id: session.id,
      detail: JSON.stringify({ count: missing.length }),
    });
  }

  if (attendanceRows.length > 0) {
    failOnWrite(
      await db.upsert("meeting_attendance", attendanceRows, {
        conflict: "session_id,employee_id",
        columns: null,
        ignoreDuplicates: true,
      }),
    );
  }

  // Only after the attendance write: a marker written first would drop the session.
  failOnWrite(await db.insert("audit_logs", markers));

  return { processed: pending.length };
}
