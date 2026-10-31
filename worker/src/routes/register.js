// Public registration routes, ported from server/routes/register.js.
// Mounted at /api/register. No session, no PIN, no auto-absent side effect.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { bangkokToday, resolveScanState } from "../register-window.js";
import { STATUS_CODE_BY_LABEL, statusCodeFromLabel } from "../attendance-status.js";
import {
  checkRateLimit,
  clientIp,
  ipRateLimitKey,
  tokenRateLimitKey,
} from "../rate-limit.js";
import { turnstileEnabled, verifyTurnstile } from "../turnstile.js";

const register = new Hono();

const LINK_ERROR_MESSAGE = "ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง";
const SERVER_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const ROSTER_ERROR_MESSAGE = "ไม่พบรายชื่อนี้ในรายชื่อการประชุม";
const DUPLICATE_MESSAGE = "ท่านได้ลงทะเบียนสำหรับประชุมนี้แล้ว";
const INVALID_BODY_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const TURNSTILE_ERROR_MESSAGE = "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่";

const DASH = "-";
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 4 * 1024;
const REASON_MAX_LENGTH = 200;

const STATUSES = Object.keys(STATUS_CODE_BY_LABEL);
const REASON_STATUSES = ["ติดงานด่วน", "ลาประชุม"];
const LEAVE_STATUS = "ลาประชุม";
const SHIFTS = ["กะ A", "กะ B"];

const RATE_LIMIT_CONTEXT_BINDING = "RL_CONTEXT_IP";
const RATE_LIMIT_SUBMIT_IP_BINDING = "RL_SUBMIT_IP";
const RATE_LIMIT_SUBMIT_TOKEN_BINDING = "RL_SUBMIT_TOKEN";

// Same set as Express's z.uuid(): versions 1-8 with an RFC variant, plus the
// nil and max UUIDs.
const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const SESSIONS_TABLE = "meeting_sessions";
const ATTENDANCE_TABLE = "meeting_attendance";
const ROSTER_TABLE = "meeting_roster";

register.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonContentType(value) {
  if (typeof value !== "string") return false;
  const mediaType = value.split(";")[0].trim().toLowerCase();
  return mediaType === "application/json";
}

function logError(scope, error) {
  console.error(scope, {
    name: error?.name,
    code: error?.code,
    constraint: error?.constraint,
  });
}

function toHm(value) {
  if (typeof value !== "string" || value.length < 5) return null;
  return value.slice(0, 5);
}

function formatSavedAt(date) {
  const day = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${day} · ${time} น.`;
}

function firstEmbedded(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function findTypeByToken(db, token) {
  if (typeof token !== "string" || token.length === 0) return null;
  return db.select("meeting_types", {
    columns: "id,code,name,weekday,default_open_time,default_cutoff_time",
    filters: [["qr_token", "eq", token]],
    single: true,
  });
}

async function loadMonthlySessions(db, typeId) {
  const today = bangkokToday();
  const rows = await db.select(SESSIONS_TABLE, {
    columns: "id,session_date,open_time,cutoff_time",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["session_date", "eq", today],
    ],
  });
  return rows.map((row) => ({
    id: row.id,
    sessionDate: row.session_date,
    openTime: toHm(row.open_time),
    cutoffTime: toHm(row.cutoff_time),
  }));
}

async function resolveForType(db, type) {
  const sessions = type.code === "monthly" ? await loadMonthlySessions(db, type.id) : [];
  const state = resolveScanState({
    now: new Date(),
    typeCode: type.code,
    meetingDefaults: {
      weekday: type.weekday,
      openTime: toHm(type.default_open_time),
      cutoffTime: toHm(type.default_cutoff_time),
    },
    sessions,
  });
  return { state, sessions };
}

async function loadActiveEmployees(db, typeId) {
  const rows = await db.select(ROSTER_TABLE, {
    columns:
      "employee_id,employees!meeting_roster_employee_id_fkey!inner(full_name,departments(name),positions(name))",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["is_active", "eq", true],
    ],
  });

  return rows
    .map((row) => {
      const employee = firstEmbedded(row.employees);
      return {
        employeeId: row.employee_id,
        fullName: employee?.full_name ?? DASH,
        departmentName: firstEmbedded(employee?.departments)?.name ?? DASH,
        positionName: firstEmbedded(employee?.positions)?.name ?? DASH,
      };
    })
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "th"));
}

async function findSessionForDay(db, typeId, sessionDate) {
  return db.select(SESSIONS_TABLE, {
    columns: "id",
    filters: [
      ["meeting_type_id", "eq", typeId],
      ["session_date", "eq", sessionDate],
    ],
    single: true,
  });
}

async function ensureSession(db, type, sessions, state) {
  if (type.code === "sup") {
    const today = bangkokToday();
    const existing = await findSessionForDay(db, type.id, today);
    if (existing) return existing;

    const { data: created, error } = await db.insert(
      SESSIONS_TABLE,
      {
        meeting_type_id: type.id,
        session_date: today,
        cycle_key: `sup-${today}`,
        open_time: toHm(type.default_open_time),
        cutoff_time: toHm(type.default_cutoff_time),
      },
      { returning: true }
    );

    if (error) {
      if (error.code !== "23505") throw error;
      const raced = await findSessionForDay(db, type.id, today);
      if (raced) return raced;
      throw error;
    }

    if (!created || !created.id) throw new Error("session insert returned no row");
    return created;
  }

  const session = (sessions ?? []).find(
    (row) => row.sessionDate === state.session?.sessionDate
  );
  return session ? { id: session.id } : null;
}

/**
 * Body preflight: JSON content type, at most 4 KB, valid JSON. Returns null when
 * any check fails so the caller can answer 400 before touching a limiter.
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

async function enforceLimit(c, bindingName, key) {
  const result = await checkRateLimit(c.env, bindingName, key);
  if (result.ok) return null;
  return c.json({ ok: false, message: result.message }, result.status);
}

// --- GET /api/register/context ---------------------------------------------

register.get("/context", async (c) => {
  const token = c.req.query("t");
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);
  }

  const limited = await enforceLimit(
    c,
    RATE_LIMIT_CONTEXT_BINDING,
    ipRateLimitKey("context", clientIp(c.req.raw))
  );
  if (limited) return limited;

  try {
    const db = createDb(c.env);
    const type = await findTypeByToken(db, token);
    if (!type) return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);

    const { state } = await resolveForType(db, type);
    const payload = {
      ok: true,
      meetingName: type.name,
      state: state.state,
      statuses: STATUSES,
      shifts: SHIFTS,
      reasonStatuses: REASON_STATUSES,
      leaveStatus: LEAVE_STATUS,
    };
    if (state.message) payload.message = state.message;
    if (state.state === "before") {
      payload.openTime = state.openTime;
      payload.cutoffTime = state.cutoffTime;
    }
    if (state.state === "open") {
      payload.openTime = state.session.openTime;
      payload.cutoffTime = state.session.cutoffTime;
      payload.employees = await loadActiveEmployees(db, type.id);
    }
    return c.json(payload, 200);
  } catch (error) {
    logError("register context failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
  }
});

// --- POST /api/register/submit ---------------------------------------------

register.post("/submit", async (c) => {
  const body = await readStrictJson(c);
  if (!body) return invalidBody(c);

  // Cheap token check before any limiter or database call.
  if (typeof body.t !== "string" || !TOKEN_PATTERN.test(body.t)) {
    return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);
  }

  const verifyingTurnstile = turnstileEnabled(c.env);
  const allowedKeys = ["t", "employeeId", "statusCode", "shift", "reason"];
  if (verifyingTurnstile) allowedKeys.push("turnstileToken");

  const hasRequiredKeys = ["t", "employeeId", "statusCode"].every((key) =>
    Object.prototype.hasOwnProperty.call(body, key)
  );
  const extraKey = Object.keys(body).some((key) => !allowedKeys.includes(key));
  if (!hasRequiredKeys || extraKey) return invalidBody(c);

  const shiftValue = body.shift === undefined || body.shift === null ? null : body.shift;
  const reasonValue = body.reason === undefined || body.reason === null ? null : body.reason;

  const shapeOk =
    typeof body.employeeId === "string" &&
    UUID_PATTERN.test(body.employeeId) &&
    typeof body.statusCode === "string" &&
    (body.shift === undefined || body.shift === null || typeof body.shift === "string") &&
    (body.reason === undefined || body.reason === null || typeof body.reason === "string");
  if (!shapeOk) return invalidBody(c);

  const statusDbCode = statusCodeFromLabel(body.statusCode);
  if (statusDbCode === null) return invalidBody(c);
  const status = body.statusCode;

  if (status === LEAVE_STATUS) {
    if (!SHIFTS.includes(shiftValue)) return invalidBody(c);
  } else if (shiftValue !== null) {
    return invalidBody(c);
  }

  const needsReason = REASON_STATUSES.includes(status);
  const trimmedReason = typeof reasonValue === "string" ? reasonValue.trim() : "";
  if (needsReason) {
    if (trimmedReason.length === 0 || trimmedReason.length > REASON_MAX_LENGTH) {
      return invalidBody(c);
    }
  } else if (trimmedReason.length > 0) {
    return invalidBody(c);
  }
  const savedReason = needsReason ? trimmedReason : null;
  const savedShift = status === LEAVE_STATUS ? shiftValue : null;

  if (verifyingTurnstile) {
    if (typeof body.turnstileToken !== "string" || body.turnstileToken.length === 0) {
      return c.json({ ok: false, message: TURNSTILE_ERROR_MESSAGE }, 403);
    }
  }

  const ip = clientIp(c.req.raw);
  const ipLimited = await enforceLimit(
    c,
    RATE_LIMIT_SUBMIT_IP_BINDING,
    ipRateLimitKey("submit", ip)
  );
  if (ipLimited) return ipLimited;

  // The limiter key never carries the raw QR token.
  const tokenLimited = await enforceLimit(
    c,
    RATE_LIMIT_SUBMIT_TOKEN_BINDING,
    await tokenRateLimitKey(body.t)
  );
  if (tokenLimited) return tokenLimited;

  if (verifyingTurnstile) {
    try {
      const secret = c.env.TURNSTILE_SECRET_KEY;
      if (typeof secret !== "string" || secret.length === 0) {
        return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 503);
      }
      const verdict = await verifyTurnstile(body.turnstileToken, ip, secret);
      if (!verdict.ok) {
        return c.json({ ok: false, message: TURNSTILE_ERROR_MESSAGE }, 403);
      }
    } catch {
      return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 503);
    }
  }

  try {
    const db = createDb(c.env);
    const type = await findTypeByToken(db, body.t);
    if (!type) return c.json({ ok: false, message: LINK_ERROR_MESSAGE }, 404);

    const { state, sessions } = await resolveForType(db, type);
    if (state.state !== "open") {
      return c.json({ ok: false, message: state.message }, 403);
    }

    const rosterRow = await db.select(ROSTER_TABLE, {
      columns: "employee_id",
      filters: [
        ["meeting_type_id", "eq", type.id],
        ["employee_id", "eq", body.employeeId],
        ["is_active", "eq", true],
      ],
      single: true,
    });
    if (!rosterRow) return c.json({ ok: false, message: ROSTER_ERROR_MESSAGE }, 400);

    const employee = await db.select("employees", {
      columns: "id,full_name,department_id,position_id,departments(name),positions(name)",
      filters: [["id", "eq", body.employeeId]],
      single: true,
    });
    if (!employee) return c.json({ ok: false, message: ROSTER_ERROR_MESSAGE }, 400);

    const session = await ensureSession(db, type, sessions, state);
    if (!session) return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);

    const existing = await db.select(ATTENDANCE_TABLE, {
      columns: "id",
      filters: [
        ["session_id", "eq", session.id],
        ["employee_id", "eq", body.employeeId],
      ],
      single: true,
    });
    if (existing) return c.json({ ok: false, message: DUPLICATE_MESSAGE }, 409);

    const now = new Date();
    const { error: insertError } = await db.insert(ATTENDANCE_TABLE, {
      session_id: session.id,
      employee_id: body.employeeId,
      status_code: statusDbCode,
      reason: savedReason,
      shift: savedShift,
      department_id: employee.department_id ?? null,
      position_id: employee.position_id ?? null,
      registered_at: now.toISOString(),
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return c.json({ ok: false, message: DUPLICATE_MESSAGE }, 409);
      }
      throw insertError;
    }

    return c.json(
      {
        ok: true,
        summary: {
          name: employee.full_name ?? DASH,
          dept: firstEmbedded(employee.departments)?.name ?? DASH,
          level: firstEmbedded(employee.positions)?.name ?? DASH,
          status,
          shift: savedShift,
          meetingName: type.name,
          savedAt: formatSavedAt(now),
        },
      },
      200
    );
  } catch (error) {
    logError("register submit failed", error);
    return c.json({ ok: false, message: SERVER_ERROR_MESSAGE }, 500);
  }
});

export default register;
