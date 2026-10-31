// Phase 3b: POST /api/meeting/dashboard/reason, ported from the Express
// router (server/routes/meeting-dashboard.js, POST /reason). Contract kept:
// same Thai messages, same statuses, same field names; the PIN check runs the
// approved HMAC core (draft section 5, owner decision 3 in section 10) — the
// one implementation shared with Phase 1 login, see src/pin-verify.js. A
// stored bcrypt-style pin_hash must be reset via /api/auth/set-pin and answers
// 401 until then. The reason value is only ever returned to the verified
// controller here; it never reaches any log line or the audit row, and no
// PIN/hash/token is ever logged or returned.

import { Hono } from "hono";

import { requireRole } from "../require-role.js";
import { createDb } from "../db.js";
import {
  PIN_INVALID_MESSAGE,
  verifyPinAttempt,
} from "../pin-verify.js";
import { latestPerEmployee } from "../meeting-dashboard.js";
import { STATUS_LABEL_BY_CODE } from "../meeting-overview.js";
// Same context loader the five GET routes use, so the cycle/row rules stay
// identical across the group.
import { loadContext } from "./meeting-dashboard.js";

const INVALID_INPUT_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const TYPE_ERROR_MESSAGE = "ประเภทการประชุมไม่ถูกต้อง";
const SERVER_ERROR_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const NO_ROW_MESSAGE = "ไม่พบข้อมูลของคนนี้ในรอบนี้";
const NO_REASON_MESSAGE = "สถานะนี้ไม่มีเหตุผล";

/** Logs only the error name and code; never a message detail or a body. */
function logError(error) {
  console.error("[dashboard-reason-error]", error?.name ?? error?.code);
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

const CREDENTIALS_TABLE = "employee_credentials";
const AUDIT_TABLE = "audit_logs";
const MAX_BODY_BYTES = 4 * 1024;

// Same set as Express's z.uuid(): versions 1-8 with an RFC variant, plus the
// nil and max UUIDs, case-insensitive (the Phase 2c rule).
const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

const VALID_CODES = new Set(["sup", "monthly"]);
const CYCLE_PATTERN = /^\d{4}-\d{2}(-\d{2})?$/;
const PIN_BODY_PATTERN = /^\d{6}$/;
const REASON_STATUS_CODES = ["urgent_busy", "leave"];
const ROLE = "meeting_controller";

const reason = new Hono();

reason.use("*", async (c, next) => {
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
 * Body preflight, same pattern as the Phase 2 routes: JSON content type, at
 * most 4 KB, valid JSON object. Returns null when any check fails.
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

/**
 * Strict body like the Express z.object(...).strict(): exactly the four
 * string keys pin/code/cycle/employeeId; an extra field is rejected.
 */
function isStrictReasonBody(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 4
  ) {
    return false;
  }
  const keys = ["pin", "code", "cycle", "employeeId"];
  return keys.every((key) => typeof value[key] === "string");
}

function validReasonBody(value) {
  return (
    PIN_BODY_PATTERN.test(value.pin) &&
    VALID_CODES.has(value.code) &&
    CYCLE_PATTERN.test(value.cycle) &&
    UUID_PATTERN.test(value.employeeId)
  );
}

reason.post("/reason", async (c) => {
  const guardResult = await requireRole(c.env, c.req.raw, [ROLE]);
  if (!guardResult.ok) {
    return c.json({ ok: false, error: guardResult.message }, guardResult.status);
  }

  const body = await readStrictJson(c);
  if (!body || !isStrictReasonBody(body) || !validReasonBody(body)) {
    return c.json({ ok: false, error: INVALID_INPUT_MESSAGE }, 400);
  }

  const db = createDb(c.env);
  try {
    // Step 1 — PIN check for the logged-in controller. Credential lookup by
    // the session's employee_id; missing row, inactive employee or null
    // pin_hash answers the generic 401 without touching any counter.
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "employee_id,pin_hash,failed_attempts,locked_until",
      filters: [["employee_id", "eq", guardResult.session.employeeId]],
      single: true,
    });
    const employee = credential
      ? await db.select("employees", {
          columns: "id,is_active",
          filters: [["id", "eq", credential.employee_id]],
          single: true,
        })
      : null;

    if (!credential || !employee || employee.is_active !== true || credential.pin_hash == null) {
      return c.json({ ok: false, error: PIN_INVALID_MESSAGE }, 401);
    }

    const verification = await verifyPinAttempt(c.env, db, new Date(), {
      pin: body.pin,
      credential,
      employee,
      role: ROLE,
    });
    if (!verification.ok) {
      const payload = { ok: false, error: verification.message };
      if (verification.lockedUntil) payload.lockedUntil = verification.lockedUntil;
      return c.json(payload, verification.status);
    }

    // Step 2 — same loadContext the GET routes use, then only this cycle's
    // rows for the requested employee, latest row per employee. HTTP stays
    // 200 for both ok:false cases and no audit row is written.
    const context = await loadContext(db, body.code);
    if (context.typeNotFound) {
      return c.json({ ok: false, error: TYPE_ERROR_MESSAGE }, 400);
    }

    const cycleRows = (context.rowsByCycle.get(body.cycle) ?? []).filter(
      (row) => row.employee_id === body.employeeId,
    );
    if (cycleRows.length === 0) {
      return c.json({ ok: false, error: NO_ROW_MESSAGE }, 200);
    }

    const [row] = latestPerEmployee(cycleRows);
    if (!row) {
      return c.json({ ok: false, error: NO_ROW_MESSAGE }, 200);
    }

    if (!REASON_STATUS_CODES.includes(row.status_code)) {
      return c.json({ ok: false, error: NO_REASON_MESSAGE }, 200);
    }

    // Step 3 — exactly one audit row: no employee name, no reason text, no
    // per-person identifiers beyond the attendance row id.
    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: guardResult.session.employeeId,
        action: "dashboard_reason_viewed",
        entity: "meeting_attendance",
        entity_id: row.id,
        detail: null,
      })
    );

    return c.json({
      ok: true,
      status: STATUS_LABEL_BY_CODE[row.status_code],
      reason: row.reason ?? "",
    });
  } catch (error) {
    logError(error);
    return c.json({ ok: false, error: SERVER_ERROR_MESSAGE }, 500);
  }
});

export default reason;
