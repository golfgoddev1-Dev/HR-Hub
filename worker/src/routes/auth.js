// Auth routes, mounted at /api/auth by src/app.js.
// PINs are stored as HMAC-SHA256 with the pepper; no bcrypt, no plaintext.

import { Hono } from "hono";

import { getRequiredEnv } from "../env.js";
import { hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "../crypto.js";
import { nationalIdHash, normalizeNationalId } from "../national-id.js";
import {
  parseCookies,
  serializeCookie,
  sessionCookieName,
  sessionCookieOptions,
} from "../cookie.js";
import { pinHash, validatePin } from "../pin-rules.js";
import {
  allowedLoginTypesFor,
  createSession,
  landingPathFor,
  readSession,
} from "../session.js";
// The PIN attempt sequence lives in one shared implementation (login and the
// dashboard reason route both run it verbatim).
import { verifyPinAttempt } from "../pin-verify.js";
import { createDb } from "../db.js";

const auth = new Hono();

// Schema table names kept in one place.
const SESSIONS_TABLE = "auth_sessions";
const CREDENTIALS_TABLE = "employee_credentials";
const RESET_CODES_TABLE = "pin_reset_codes";
const AUDIT_TABLE = "audit_logs";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const LOCK_MS = LOCK_MINUTES * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;

const LOGIN_ROLES = {
  employee: "employee",
  hr: "hr",
  controller: "meeting_controller",
  system: "system_admin",
};

const INVALID_MESSAGE = "ข้อมูลไม่ถูกต้อง";
const LOGIN_INVALID_MESSAGE = "เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง";
const LOCKED_MESSAGE = "บัญชีถูกล็อกชั่วคราว";
const CONNECTION_MESSAGE = "ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่";
const UNAUTHENTICATED_MESSAGE = "ไม่ได้เข้าสู่ระบบ";
const LOGOUT_FAILED_MESSAGE = "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
const SET_PIN_INVALID_MESSAGE = "เลขบัตรประชาชนหรือรหัสจาก HR ไม่ถูกต้อง";
const PIN_CONFIRM_MESSAGE = "PIN ทั้งสองช่องไม่ตรงกัน";
const SET_PIN_FAILED_MESSAGE = "ไม่สามารถตั้ง PIN ได้ กรุณาลองใหม่";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict body check: same keys, no extras, every value a string. */
function hasExactStringKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== keys.length) return false;
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === "string"
  );
}

async function readJson(c) {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/**
 * Cookie secure flag. COOKIE_SECURE=false is only for local .dev.vars testing;
 * never set it in Cloudflare. Any value other than the exact string "false"
 * (including missing) means Secure.
 */
function secureCookie(env) {
  return env.COOKIE_SECURE !== "false";
}

function clearSessionCookie(env) {
  const options = { ...sessionCookieOptions({ secure: secureCookie(env) }), maxAge: 0 };
  return serializeCookie(sessionCookieName, "", options);
}

function setSessionCookie(c, env, token) {
  c.header(
    "Set-Cookie",
    serializeCookie(sessionCookieName, token, sessionCookieOptions({ secure: secureCookie(env) }))
  );
}

/** Logs only the error name and code, never a message or a body. */
function logFailure(scope, error) {
  console.error(scope, { name: error && error.name, code: error && error.code });
}

/** Turns a { error: { code } } db result into a throw, so the route answers 500. */
function ensureOk(result) {
  if (result && result.error) {
    const error = new Error("database write failed");
    error.code = result.error.code;
    throw error;
  }
  return result;
}

function failedAttempts(value) {
  const attempts = Number(value);
  return Number.isFinite(attempts) ? attempts : 0;
}

auth.post("/login", async (c) => {
  try {
    const body = await readJson(c);
    if (!hasExactStringKeys(body, ["loginType", "nationalId", "pin"])) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }
    if (!Object.prototype.hasOwnProperty.call(LOGIN_ROLES, body.loginType)) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }

    const normalized = normalizeNationalId(body.nationalId);
    if (!/^\d{13}$/.test(normalized) || !/^\d{6}$/.test(body.pin)) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }

    const env = c.env;
    const role = LOGIN_ROLES[body.loginType];
    const db = createDb(env);
    const now = new Date();
    const nowIso = now.toISOString();

    const nationalHash = await nationalIdHash(
      normalized,
      getRequiredEnv(env, "NATIONAL_ID_PEPPER")
    );
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "*",
      filters: [["national_id_hash", "eq", nationalHash]],
      single: true,
    });

    const employee = credential
      ? await db.select("employees", {
          columns: "id,full_name,employee_code,is_active",
          filters: [["id", "eq", credential.employee_id]],
          single: true,
        })
      : null;

    if (
      !credential ||
      !employee ||
      employee.is_active !== true ||
      credential.pin_hash === null ||
      credential.pin_hash === undefined
    ) {
      return c.json({ ok: false, message: LOGIN_INVALID_MESSAGE }, 401);
    }

    const lockedUntilMs = credential.locked_until
      ? new Date(credential.locked_until).getTime()
      : NaN;
    // The attempt sequence (lock window, HMAC compare with the pepper, role
    // check only on a PIN match, counter rule 5 / 15 minutes) is shared with
    // the dashboard reason route; see src/pin-verify.js.
    const verification = await verifyPinAttempt(env, db, now, {
      pin: body.pin,
      credential,
      employee,
      role,
    });
    if (!verification.ok) {
      const payload = { ok: false, message: verification.message };
      if (verification.lockedUntil) payload.lockedUntil = verification.lockedUntil;
      return c.json(payload, verification.status);
    }

    const token = await createSession(env, employee.id, role);

    let redirectTo;
    if (role === "employee") {
      const pending = await db.select("leave_requests", {
        columns: "id",
        filters: [
          ["approver_id", "eq", employee.id],
          ["status", "eq", "pending"],
        ],
        single: true,
      });
      redirectTo = "/pending?to=" + encodeURIComponent(landingPathFor(role, pending !== null));
    } else {
      redirectTo = landingPathFor(role, false);
    }

    setSessionCookie(c, env, token);
    return c.json({ ok: true, redirectTo }, 200);
  } catch (error) {
    logFailure("auth login failed", error);
    return c.json({ ok: false, message: CONNECTION_MESSAGE }, 500);
  }
});

auth.get("/me", async (c) => {
  try {
    const token = parseCookies(c.req.header("Cookie"))[sessionCookieName];
    const session = await readSession(c.env, token);
    if (!session.ok) {
      return c.json({ ok: false, message: UNAUTHENTICATED_MESSAGE }, 401);
    }
    return c.json(
      { ok: true, role: session.role, redirectTo: session.redirectTo },
      200
    );
  } catch (error) {
    logFailure("auth me failed", error);
    return c.json({ ok: false, message: CONNECTION_MESSAGE }, 500);
  }
});

auth.post("/logout", async (c) => {
  const env = c.env;
  c.header("Cache-Control", "no-store");

  try {
    const token = parseCookies(c.req.header("Cookie"))[sessionCookieName];
    const nowIso = new Date().toISOString();

    if (token) {
      const db = createDb(env);
      const tokenHash = await sha256Hex(token);
      const session = await db.select(SESSIONS_TABLE, {
        columns: "id,employee_id",
        filters: [
          ["token_hash", "eq", tokenHash],
          ["revoked_at", "is", null],
        ],
        single: true,
      });

      if (session) {
        ensureOk(
          await db.update(
            SESSIONS_TABLE,
            { revoked_at: nowIso },
            [
              ["token_hash", "eq", tokenHash],
              ["revoked_at", "is", null],
            ]
          )
        );

        try {
          await db.insert(AUDIT_TABLE, {
            actor_id: session.employee_id,
            action: "logout",
            entity: "auth_session",
            entity_id: session.id,
            detail: null,
          });
        } catch {
          // Audit failures never block logout.
        }
      }
    }

    c.header("Set-Cookie", clearSessionCookie(env));
    return c.json({ ok: true }, 200);
  } catch (error) {
    logFailure("auth logout failed", error);
    c.header("Set-Cookie", clearSessionCookie(env));
    return c.json({ ok: false, message: LOGOUT_FAILED_MESSAGE }, 500);
  }
});

auth.post("/set-pin", async (c) => {
  try {
    const body = await readJson(c);
    if (!hasExactStringKeys(body, ["nationalId", "code", "pin", "pinConfirm"])) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }

    const normalized = normalizeNationalId(body.nationalId);
    if (!/^\d{13}$/.test(normalized) || !/^\d{8}$/.test(body.code)) {
      return c.json({ ok: false, message: INVALID_MESSAGE }, 400);
    }

    const validation = validatePin(body.pin);
    if (!validation.ok) {
      return c.json({ ok: false, message: validation.message }, 400);
    }
    if (body.pinConfirm !== body.pin) {
      return c.json({ ok: false, message: PIN_CONFIRM_MESSAGE }, 400);
    }

    const env = c.env;
    const db = createDb(env);
    const now = new Date();
    const nowIso = now.toISOString();

    const nationalHash = await nationalIdHash(
      normalized,
      getRequiredEnv(env, "NATIONAL_ID_PEPPER")
    );
    const credential = await db.select(CREDENTIALS_TABLE, {
      columns: "*",
      filters: [["national_id_hash", "eq", nationalHash]],
      single: true,
    });

    const employee = credential
      ? await db.select("employees", {
          columns: "id,is_active",
          filters: [["id", "eq", credential.employee_id]],
          single: true,
        })
      : null;

    if (!credential || !employee || employee.is_active !== true) {
      return c.json({ ok: false, message: SET_PIN_INVALID_MESSAGE }, 401);
    }

    const resetCode = await db.select(RESET_CODES_TABLE, {
      columns: "*",
      filters: [
        ["employee_id", "eq", employee.id],
        ["used_at", "is", null],
        ["expires_at", "gt", nowIso],
        ["attempts", "lt", RESET_CODE_MAX_ATTEMPTS],
      ],
      order: "created_at.desc",
      single: true,
    });
    if (!resetCode) {
      return c.json({ ok: false, message: SET_PIN_INVALID_MESSAGE }, 401);
    }

    const expected = await hmacSha256Hex(
      getRequiredEnv(env, "PIN_RESET_SECRET"),
      `${employee.id}:${body.code}`
    );

    if (!timingSafeEqualHex(expected, resetCode.code_hash)) {
      const attempts = failedAttempts(resetCode.attempts) + 1;
      const patch = { attempts };
      if (attempts >= RESET_CODE_MAX_ATTEMPTS) patch.used_at = nowIso;

      ensureOk(
        await db.update(RESET_CODES_TABLE, patch, [
          ["id", "eq", resetCode.id],
          ["used_at", "is", null],
        ])
      );
      return c.json({ ok: false, message: SET_PIN_INVALID_MESSAGE }, 401);
    }

    const newPinHash = await pinHash(
      getRequiredEnv(env, "PIN_PEPPER"),
      employee.id,
      body.pin
    );

    ensureOk(
      await db.update(
        CREDENTIALS_TABLE,
        {
          pin_hash: newPinHash,
          pin_set_at: nowIso,
          failed_attempts: 0,
          locked_until: null,
          updated_at: nowIso,
        },
        [["employee_id", "eq", employee.id]]
      )
    );

    ensureOk(
      await db.update(RESET_CODES_TABLE, { used_at: nowIso }, [
        ["id", "eq", resetCode.id],
      ])
    );

    ensureOk(
      await db.update(
        SESSIONS_TABLE,
        { revoked_at: nowIso },
        [
          ["employee_id", "eq", employee.id],
          ["revoked_at", "is", null],
        ]
      )
    );

    ensureOk(
      await db.insert(AUDIT_TABLE, {
        actor_id: employee.id,
        action: "pin_set",
        entity: "employee",
        entity_id: employee.id,
        detail: null,
      })
    );

    return c.json({ ok: true }, 200);
  } catch (error) {
    logFailure("auth set-pin failed", error);
    return c.json({ ok: false, message: SET_PIN_FAILED_MESSAGE }, 500);
  }
});

export default auth;
