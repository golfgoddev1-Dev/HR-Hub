// Closing a meeting cycle: mark every active roster member who has no row for
// the cycle's session as not attended.
//
// Ported 1:1 from server/cycle-close.js so both stacks apply the same rules:
// one session per cycle, the session's Bangkok cutoff must have passed, a row
// that already exists is never touched, a second click inserts nothing, and
// every click writes exactly one audit row with { inserted }.
// The data access is injected so the Hono route owns the queries while the
// rules live here.

import { bangkokToday } from "./register-window.js";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";

export const ABSENT_STATUS_CODE = "not_attended";
export const CLOSE_ACTION = "meeting_cycle_closed";
export const CLOSE_AUDIT_ENTITY = "meeting_sessions";
export const INVALID_INPUT_MESSAGE = "ข้อมูลไม่ถูกต้อง";
export const NOT_CLOSED_MESSAGE = "ยังไม่ถึงเวลาปิดลงทะเบียน";
export const NO_CYCLE_MESSAGE = "ไม่พบรอบประชุมนี้";
export const SERVER_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";

const CYCLE_PATTERN = /^\d{4}-\d{2}(-\d{2})?$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function logError(error) {
  console.error("[meeting-dashboard-error]", error?.code ?? error?.name);
}

function asDate(now) {
  if (now instanceof Date) return now;
  const parsed = new Date(now);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

/** Keeps only HH:mm; anything shorter than five characters is unusable. */
export function normalizeCutoffTime(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}

/** Current Asia/Bangkok wall-clock time as HH:mm, comparable as a string. */
export function bangkokNowTime(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BANGKOK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(asDate(now));
}

/**
 * true when the session's cutoff moment (Asia/Bangkok) has passed, false when
 * it is still ahead, null when the date or the cutoff time cannot be read.
 */
export function isCutoffPassed({ now, sessionDate, cutoffTime }) {
  const time = normalizeCutoffTime(cutoffTime);
  if (!time || typeof sessionDate !== "string" || !DAY_PATTERN.test(sessionDate)) return null;
  const today = bangkokToday(asDate(now));
  if (sessionDate < today) return true;
  if (sessionDate > today) return false;
  return bangkokNowTime(now) >= time;
}

/** Roster members with no row yet, in roster order, without duplicates. */
export function missingEmployeeIds(rosterEmployeeIds, existingEmployeeIds) {
  const existing = new Set(existingEmployeeIds ?? []);
  const seen = new Set();
  const missing = [];
  for (const employeeId of rosterEmployeeIds ?? []) {
    if (typeof employeeId !== "string" || employeeId.length === 0) continue;
    if (existing.has(employeeId) || seen.has(employeeId)) continue;
    seen.add(employeeId);
    missing.push(employeeId);
  }
  return missing;
}

/** Strict body: exactly { code: 'sup' | 'monthly', cycle: <old /registrants form> }. */
export function isCloseCycleBody(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2) return false;
  if (!keys.includes("code") || !keys.includes("cycle")) return false;
  if (value.code !== "sup" && value.code !== "monthly") return false;
  return typeof value.cycle === "string" && CYCLE_PATTERN.test(value.cycle);
}

/** Audit detail carries a count only: no name, no employee id, no reason text. */
export function closeAuditDetail(inserted) {
  const count = Number(inserted);
  return JSON.stringify({ inserted: Number.isFinite(count) ? count : 0 });
}

/**
 * The absent rows to write. registered_at is the click time, reason and shift
 * stay null, and department/position come from the roster member so the row has
 * the same shape the auto-absent job writes.
 */
export function absentRows(missing, { sessionId, registeredAt, memberById }) {
  return missing.map((employeeId) => ({
    session_id: sessionId,
    employee_id: employeeId,
    status_code: ABSENT_STATUS_CODE,
    reason: null,
    shift: null,
    department_id: memberById?.get(employeeId)?.departmentId ?? null,
    position_id: memberById?.get(employeeId)?.positionId ?? null,
    registered_at: registeredAt,
  }));
}

/**
 * Runs one close-cycle click. Loaders receive plain arguments, so the caller
 * owns the queries while the rules live here.
 *   loadSessions({ code, cycle })  -> [{ id, session_date, meeting_type_id, cutoff_time }]
 *   loadRoster(session)            -> [{ employeeId, departmentId, positionId }]
 *   loadAttendance(session.id)     -> [{ employee_id }]
 *   insertAbsent(rows)             -> number of rows actually inserted
 *   writeAudit({ actorId, entityId, detail })
 * Returns { status, body } with a message the route answers verbatim.
 */
export async function closeCycle({
  body,
  now = new Date(),
  actorId,
  loadSessions,
  loadRoster,
  loadAttendance,
  insertAbsent,
  writeAudit,
}) {
  if (!isCloseCycleBody(body)) {
    return { status: 400, body: { ok: false, message: INVALID_INPUT_MESSAGE } };
  }

  try {
    const sessions = await loadSessions({ code: body.code, cycle: body.cycle });
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return { status: 404, body: { ok: false, message: NO_CYCLE_MESSAGE } };
    }
    // A cycle that resolves to several sessions cannot be closed by this one
    // button: the status is written per session and the audit row names one id.
    if (sessions.length > 1) {
      return { status: 400, body: { ok: false, message: INVALID_INPUT_MESSAGE } };
    }

    const session = sessions[0];
    const passed = isCutoffPassed({
      now,
      sessionDate: session?.session_date,
      cutoffTime: session?.cutoff_time,
    });
    if (passed === false) {
      return { status: 400, body: { ok: false, message: NOT_CLOSED_MESSAGE } };
    }
    if (passed === null) {
      return { status: 400, body: { ok: false, message: INVALID_INPUT_MESSAGE } };
    }

    const roster = await loadRoster(session);
    const members = Array.isArray(roster) ? roster : [];
    const memberById = new Map(members.map((member) => [member.employeeId, member]));

    const existingRows = await loadAttendance(session.id);
    const existingIds = (Array.isArray(existingRows) ? existingRows : []).map(
      (row) => row?.employee_id,
    );
    const missing = missingEmployeeIds(
      members.map((member) => member.employeeId),
      existingIds,
    );

    // Nothing missing means no attendance write at all: a second click is a
    // guaranteed no-op instead of a rewrite.
    let inserted = 0;
    if (missing.length > 0) {
      const rows = absentRows(missing, {
        sessionId: session.id,
        registeredAt: asDate(now).toISOString(),
        memberById,
      });
      const written = await insertAbsent(rows);
      inserted = Number.isFinite(Number(written)) ? Number(written) : rows.length;
    }

    await writeAudit({
      actorId,
      entityId: session.id,
      detail: closeAuditDetail(inserted),
    });

    return { status: 200, body: { ok: true, inserted } };
  } catch (error) {
    logError(error);
    return { status: 500, body: { ok: false, message: SERVER_ERROR_MESSAGE } };
  }
}
