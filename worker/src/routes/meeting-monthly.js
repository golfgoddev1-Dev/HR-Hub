// Controller monthly session routes, ported from server/routes/meeting-monthly.js.
// Mounted at /api/meeting/monthly-session by src/app.js.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { validateWindow } from "../meeting-window.js";
import { bangkokToday } from "../register-window.js";

const monthlySession = new Hono();

const SAVE_ERROR_MESSAGE = "ไม่สามารถบันทึกได้ กรุณาลองใหม่";
const TYPE_ERROR_MESSAGE = "ประเภทการประชุมไม่ถูกต้อง";
const INVALID_BODY_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const PAST_DATE_MESSAGE = "เลือกวันที่ตั้งแต่วันนี้เป็นต้นไป";

const TYPES_TABLE = "meeting_types";
const SESSIONS_TABLE = "meeting_sessions";
const AUDIT_TABLE = "audit_logs";
const SESSION_CONFLICT = "meeting_type_id,session_date";
const LIST_LIMIT = 12;
const MAX_BODY_BYTES = 4 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ROLE = "meeting_controller";

monthlySession.use("*", async (c, next) => {
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
 * Strict body: exactly the given keys, no extras, every value a string.
 * Same result as the Express zod .strict() schema for these fields.
 */
function isStrictStringBody(value, keys) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === "string"
  );
}

/** Logs only the error name and code; never a body or message detail. */
function logError(error) {
  console.error("meeting monthly failed", { name: error?.name, code: error?.code });
}

/** Keeps only HH:mm; anything shorter than five characters is unusable. */
function toHm(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
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

/** Confirms a YYYY-MM-DD string is a real calendar date (UTC round-trip). */
function isCalendarDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
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

async function findMonthlyTypeId(db) {
  const type = await db.select(TYPES_TABLE, {
    columns: "id",
    filters: [["code", "eq", "monthly"]],
    single: true,
  });
  return type ? type.id : null;
}

// --- GET /api/meeting/monthly-session ---------------------------------------

monthlySession.get("/", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const db = createDb(c.env);
    const typeId = await findMonthlyTypeId(db);
    if (!typeId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);

    const rows = await db.select(SESSIONS_TABLE, {
      columns: "id,session_date,open_time,cutoff_time",
      filters: [
        ["meeting_type_id", "eq", typeId],
        ["session_date", "gte", bangkokToday()],
      ],
      order: "session_date.asc",
      limit: LIST_LIMIT,
    });

    const sessions = rows.map((row) => ({
      id: row.id,
      sessionDate: row.session_date,
      openTime: toHm(row.open_time),
      cutoffTime: toHm(row.cutoff_time),
    }));
    return c.json({ ok: true, sessions }, 200);
  } catch (error) {
    logError(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- PUT /api/meeting/monthly-session ---------------------------------------

monthlySession.put("/", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const body = await readStrictJson(c);
  if (!isStrictStringBody(body, ["sessionDate", "openTime", "cutoffTime"])) {
    return invalidBody(c);
  }
  if (!DATE_PATTERN.test(body.sessionDate) || !isCalendarDate(body.sessionDate)) {
    return invalidBody(c);
  }

  const validation = validateWindow({ openTime: body.openTime, cutoffTime: body.cutoffTime });
  if (!validation.ok) return c.json({ ok: false, message: validation.message }, 400);

  if (body.sessionDate < bangkokToday()) {
    return c.json({ ok: false, message: PAST_DATE_MESSAGE }, 400);
  }

  try {
    const db = createDb(c.env);
    const typeId = await findMonthlyTypeId(db);
    if (!typeId) return c.json({ ok: false, message: TYPE_ERROR_MESSAGE }, 400);

    const { data: saved, error } =
      (await db.upsert(
        SESSIONS_TABLE,
        {
          meeting_type_id: typeId,
          session_date: body.sessionDate,
          cycle_key: `monthly-${body.sessionDate}`,
          open_time: body.openTime,
          cutoff_time: body.cutoffTime,
        },
        { conflict: SESSION_CONFLICT, columns: "id" }
      )) ?? {};
    if (error) {
      const upsertError = new Error("database write failed");
      upsertError.code = error.code;
      throw upsertError;
    }
    if (!saved || !saved.id) throw new Error("session upsert returned no row");

    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: authSession(c).employeeId,
        action: "meeting_monthly_session_set",
        entity: "meeting_session",
        entity_id: saved.id,
        detail: JSON.stringify({
          sessionDate: body.sessionDate,
          openTime: body.openTime,
          cutoffTime: body.cutoffTime,
        }),
      })
    );

    return c.json({ ok: true }, 200);
  } catch (error) {
    logError(error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

export default monthlySession;
