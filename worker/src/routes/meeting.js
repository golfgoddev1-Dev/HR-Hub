// Controller meeting settings routes, ported from server/routes/meeting.js.
// Mounted at /api/meeting by src/app.js. Roster and overview come in later chunks.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { getRequiredEnv } from "../env.js";
import { requireRole } from "../require-role.js";
import { buildRegisterUrl, newQrToken, validateWindow } from "../meeting-window.js";

const meeting = new Hono();

const SAVE_ERROR_MESSAGE = "ไม่สามารถบันทึกได้ กรุณาลองใหม่";
const INVALID_BODY_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const SUP_ONLY_MESSAGE = "แก้ไขได้เฉพาะการประชุมหัวหน้างาน";
const NOT_FOUND_MESSAGE = "ไม่พบประเภทการประชุม";

const TYPES_TABLE = "meeting_types";
const AUDIT_TABLE = "audit_logs";

const MAX_BODY_BYTES = 4 * 1024;

const ROLE = "meeting_controller";

meeting.use("*", async (c, next) => {
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

/** Strict body: exactly the given keys, no extras, no missing. Returns true/false. */
function isStrictBody(value, keys) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/** Logs only the error name and code; never a body, token or message detail. */
function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
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

// --- GET /api/meeting/types -------------------------------------------------

meeting.get("/types", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  try {
    const origin = getRequiredEnv(c.env, "APP_ORIGIN");
    const db = createDb(c.env);
    const types = await db.select(TYPES_TABLE, {
      columns: "code,name,qr_token,weekday,default_open_time,default_cutoff_time",
      order: "code.asc",
    });

    const rows = types.map((type) => ({
      code: type.code,
      name: type.name,
      registerUrl: buildRegisterUrl(origin, type.qr_token),
      weekday:
        type.weekday === null || type.weekday === undefined ? null : type.weekday,
      openTime: toHm(type.default_open_time),
      cutoffTime: toHm(type.default_cutoff_time),
    }));
    return c.json({ ok: true, types: rows }, 200);
  } catch (error) {
    logError("meeting types failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- POST /api/meeting/qr/rotate --------------------------------------------

meeting.post("/qr/rotate", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const body = await readStrictJson(c);
  if (!isStrictBody(body, ["code"])) return invalidBody(c);
  if (body.code !== "sup" && body.code !== "monthly") return invalidBody(c);

  try {
    const origin = getRequiredEnv(c.env, "APP_ORIGIN");
    const token = newQrToken();
    const db = createDb(c.env);

    const type = await db.select(TYPES_TABLE, {
      columns: "id",
      filters: [["code", "eq", body.code]],
      single: true,
    });
    if (!type) return c.json({ ok: false, message: NOT_FOUND_MESSAGE }, 400);

    ensureOk(
      await db.update(TYPES_TABLE, { qr_token: token }, [["code", "eq", body.code]])
    );

    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: authSession(c).employeeId,
        action: "meeting_qr_rotated",
        entity: "meeting_type",
        entity_id: type.id,
        detail: null,
      })
    );

    return c.json({ ok: true, registerUrl: buildRegisterUrl(origin, token) }, 200);
  } catch (error) {
    logError("meeting qr rotate failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

// --- PUT /api/meeting/window ------------------------------------------------

meeting.put("/window", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;

  const body = await readStrictJson(c);
  if (!isPlainObject(body)) return invalidBody(c);

  const allowedKeys = ["openTime", "cutoffTime", "code"];
  const hasRequiredKeys =
    typeof body.openTime === "string" &&
    Object.prototype.hasOwnProperty.call(body, "openTime") &&
    typeof body.cutoffTime === "string" &&
    Object.prototype.hasOwnProperty.call(body, "cutoffTime");
  const codePresent = Object.prototype.hasOwnProperty.call(body, "code");
  const extraKey = Object.keys(body).some((key) => !allowedKeys.includes(key));
  if (!hasRequiredKeys || extraKey) return invalidBody(c);
  if (codePresent && (typeof body.code !== "string" || body.code !== "sup")) {
    return c.json({ ok: false, message: SUP_ONLY_MESSAGE }, 400);
  }

  const { openTime, cutoffTime } = body;
  const validation = validateWindow({ openTime, cutoffTime });
  if (!validation.ok) return c.json({ ok: false, message: validation.message }, 400);

  try {
    const db = createDb(c.env);
    const current = await db.select(TYPES_TABLE, {
      columns: "id,default_open_time,default_cutoff_time",
      filters: [["code", "eq", "sup"]],
      single: true,
    });
    if (!current) return c.json({ ok: false, message: NOT_FOUND_MESSAGE }, 400);

    ensureOk(
      await db.update(
        TYPES_TABLE,
        { default_open_time: openTime, default_cutoff_time: cutoffTime },
        [["id", "eq", current.id]]
      )
    );

    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: authSession(c).employeeId,
        action: "meeting_window_updated",
        entity: "meeting_type",
        entity_id: current.id,
        detail: JSON.stringify({
          old: {
            openTime: toHm(current.default_open_time),
            cutoffTime: toHm(current.default_cutoff_time),
          },
          new: { openTime, cutoffTime },
        }),
      })
    );

    return c.json({ ok: true }, 200);
  } catch (error) {
    logError("meeting window failed", error);
    return c.json({ ok: false, message: SAVE_ERROR_MESSAGE }, 500);
  }
});

export default meeting;
