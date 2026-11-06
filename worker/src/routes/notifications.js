// Notification subscriptions and the VAPID public key.
// Mounted at /api/notifications by src/app.js.
//
// The push endpoint identifies a browser, not a person: employee_id always comes
// from the session, never from the body. A browser that signs in as someone else
// moves its row to that employee, so the old account stops reaching the device.

import { Hono } from "hono";

import { createDb } from "../db.js";
import { requireRole } from "../require-role.js";
import { base64UrlToBytes } from "../push/base64url.js";
import { ENDPOINT_MAX_LENGTH, normalizeEndpoint } from "../push/endpoint.js";

export { normalizeEndpoint };

const notifications = new Hono();

const PUSH_SUBSCRIPTIONS_TABLE = "push_subscriptions";
const EMPLOYEES_TABLE = "employees";

const ANY_ROLE = ["employee", "hr", "meeting_controller", "system_admin"];

const MAX_BODY_BYTES = 4 * 1024;
const USER_AGENT_MAX_LENGTH = 300;
// employeeId is accepted and ignored: the session alone decides the owner.
const SUBSCRIBE_KEYS = ["endpoint", "keys", "userAgent", "employeeId"];

const MESSAGE = {
  invalid: "ข้อมูลไม่ถูกต้อง",
  unauthenticated: "ไม่ได้เข้าสู่ระบบ",
  forbidden: "ไม่มีสิทธิ์เข้าถึงส่วนนี้",
  saveError: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง",
  notConfigured: "ยังไม่ได้เปิดใช้งานการแจ้งเตือน (ไม่พบ VAPID public key)",
  endpointInvalid: "ที่อยู่ปลายทางการแจ้งเตือนไม่ถูกต้อง (ต้องเป็น https)",
  keysInvalid: "ข้อมูลกุญแจของอุปกรณ์ไม่ถูกต้อง",
};

notifications.use("*", async (c, next) => {
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

function hasOnlyKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => keys.includes(key));
}

function logError(scope, error) {
  console.error(scope, { name: error?.name, code: error?.code });
}

/** The account preference is separate from the device subscription row. */
async function setAccountEnabled(db, employeeId, enabled) {
  const updated = await db.update(
    EMPLOYEES_TABLE,
    { notifications_enabled: enabled },
    [["id", "eq", employeeId]]
  );
  if (updated.error) {
    throw Object.assign(new Error("notification preference failed"), {
      code: updated.error.code,
    });
  }
}

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

/** p256dh must be an uncompressed P-256 point (65 bytes); auth is 16 bytes. */
export function validSubscriptionKeys(keys) {
  if (!isPlainObject(keys)) return null;
  if (!hasOnlyKeys(keys, ["p256dh", "auth"])) return null;

  const p256dh = base64UrlToBytes(keys.p256dh);
  const auth = base64UrlToBytes(keys.auth);
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 0x04) return null;
  if (!auth || auth.length !== 16) return null;

  return { p256dh: keys.p256dh, auth: keys.auth };
}

async function sessionOf(c) {
  const auth = await requireRole(c.env, c.req.raw, ANY_ROLE);
  return auth;
}

// --- GET /api/notifications/vapid-public-key --------------------------------

notifications.get("/vapid-public-key", (c) => {
  const publicKey = c.env?.VAPID_PUBLIC_KEY;
  if (typeof publicKey !== "string" || publicKey.trim().length === 0) {
    return c.json({ ok: false, message: MESSAGE.notConfigured }, 503);
  }
  return c.json({ ok: true, publicKey }, 200);
});

// --- GET /api/notifications/status ------------------------------------------
// Reports the account preference and whether THIS browser's endpoint is an
// active row owned by the caller. The endpoint is validated, never echoed.

notifications.get("/status", async (c) => {
  const auth = await sessionOf(c);
  if (auth.status) return c.json({ ok: false, message: auth.message }, auth.status);

  const rawEndpoint = c.req.query("endpoint");
  let endpoint = null;
  if (rawEndpoint !== undefined) {
    endpoint = normalizeEndpoint(rawEndpoint);
    if (!endpoint) return c.json({ ok: false, message: MESSAGE.endpointInvalid }, 400);
  }

  try {
    const db = createDb(c.env);
    const employeeId = auth.session.employeeId;
    const employee = await db.select(EMPLOYEES_TABLE, {
      columns: "id,notifications_enabled",
      filters: [["id", "eq", employeeId]],
      single: true,
    });

    let subscribed = false;
    if (endpoint) {
      const row = await db.select(PUSH_SUBSCRIPTIONS_TABLE, {
        columns: "id",
        filters: [
          ["endpoint", "eq", endpoint],
          ["employee_id", "eq", employeeId],
          ["is_active", "eq", true],
        ],
        single: true,
      });
      subscribed = row !== null;
    }

    return c.json(
      {
        ok: true,
        enabled: employee?.notifications_enabled === true,
        subscribed,
      },
      200
    );
  } catch (error) {
    logError("notification status failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/notifications/subscribe --------------------------------------

notifications.post("/subscribe", async (c) => {
  const auth = await sessionOf(c);
  if (auth.status) return c.json({ ok: false, message: auth.message }, auth.status);

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, SUBSCRIBE_KEYS)) {
    return c.json({ ok: false, message: MESSAGE.invalid }, 400);
  }

  const endpoint = normalizeEndpoint(body.endpoint);
  if (!endpoint) return c.json({ ok: false, message: MESSAGE.endpointInvalid }, 400);

  const keys = validSubscriptionKeys(body.keys);
  if (!keys) return c.json({ ok: false, message: MESSAGE.keysInvalid }, 400);

  const userAgent =
    typeof body.userAgent === "string"
      ? body.userAgent.replace(/\s+/g, " ").trim().slice(0, USER_AGENT_MAX_LENGTH) || null
      : null;

  try {
    const db = createDb(c.env);
    const employeeId = auth.session.employeeId;
    const nowIso = new Date().toISOString();

    const existing = await db.select(PUSH_SUBSCRIPTIONS_TABLE, {
      columns: "id,employee_id,is_active",
      filters: [["endpoint", "eq", endpoint]],
      single: true,
    });

    // One endpoint has one owner: the session that just subscribed. This is
    // also how a shared browser stops receiving the previous user's pushes.
    const saveExisting = async (row) => {
      const updated = await db.update(
        PUSH_SUBSCRIPTIONS_TABLE,
        {
          employee_id: employeeId,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: userAgent,
          is_active: true,
          signed_out: false,
          signed_out_at: null,
          last_seen_at: nowIso,
        },
        [["id", "eq", row.id]]
      );
      if (updated.error) throw Object.assign(new Error("resubscribe failed"), { code: updated.error.code });
      await setAccountEnabled(db, employeeId, true);
      return c.json({ ok: true, subscribed: true, reinstated: true }, 200);
    };

    if (existing) return saveExisting(existing);

    const inserted = await db.insert(
      PUSH_SUBSCRIPTIONS_TABLE,
      {
        employee_id: employeeId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent,
        is_active: true,
        signed_out: false,
        signed_out_at: null,
        created_at: nowIso,
        last_seen_at: nowIso,
      },
      { returning: true }
    );
    if (inserted.error) {
      // A concurrent subscribe for the same endpoint hit the unique index:
      // take that row over for this session's employee as well.
      if (inserted.error.code === "23505") {
        const current = await db.select(PUSH_SUBSCRIPTIONS_TABLE, {
          columns: "id,employee_id,is_active",
          filters: [["endpoint", "eq", endpoint]],
          single: true,
        });
        if (current) return saveExisting(current);
        await setAccountEnabled(db, employeeId, true);
        return c.json({ ok: true, subscribed: true, reinstated: false }, 200);
      }
      throw Object.assign(new Error("subscribe failed"), { code: inserted.error.code });
    }

    await setAccountEnabled(db, employeeId, true);
    return c.json({ ok: true, subscribed: true, reinstated: false }, 201);
  } catch (error) {
    logError("notification subscribe failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

// --- POST /api/notifications/unsubscribe ------------------------------------

notifications.post("/unsubscribe", async (c) => {
  const auth = await sessionOf(c);
  if (auth.status) return c.json({ ok: false, message: auth.message }, auth.status);

  const body = await readStrictJson(c);
  if (!hasOnlyKeys(body, ["endpoint"])) {
    return c.json({ ok: false, message: MESSAGE.invalid }, 400);
  }

  const endpoint = normalizeEndpoint(body.endpoint);
  if (!endpoint) return c.json({ ok: false, message: MESSAGE.endpointInvalid }, 400);

  try {
    const db = createDb(c.env);
    const employeeId = auth.session.employeeId;
    // Clear the account preference first: even if the row delete fails below,
    // the next login will not silently recreate a subscription the user turned
    // off. Then delete exactly this caller's endpoint row.
    await setAccountEnabled(db, employeeId, false);

    const removed = await db.remove(
      PUSH_SUBSCRIPTIONS_TABLE,
      [
        ["endpoint", "eq", endpoint],
        ["employee_id", "eq", employeeId],
      ],
      { returning: true, columns: "id" }
    );
    if (removed.error) {
      throw Object.assign(new Error("unsubscribe failed"), { code: removed.error.code });
    }

    // Idempotent: an endpoint that is already off (or someone else's) answers ok.
    return c.json(
      {
        ok: true,
        unsubscribed: Array.isArray(removed.data) ? removed.data.length > 0 : false,
      },
      200
    );
  } catch (error) {
    logError("notification unsubscribe failed", error);
    return c.json({ ok: false, message: MESSAGE.saveError }, 500);
  }
});

export default notifications;
