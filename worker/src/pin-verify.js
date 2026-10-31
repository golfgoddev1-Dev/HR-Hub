// Shared PIN verification core. One implementation, one place: the Phase 1
// login route (src/routes/auth.js) and the Phase 3b dashboard reason route
// both run this exact sequence — lock-window check, HMAC compare with
// timingSafeEqualHex (PIN_PEPPER over `${employeeId}:${pin}`, draft 5 owner
// decision), allowed-login-role check, then the failed-attempt counter with
// the 5-strikes / 15-minute lock. Credential writes always filter on
// employee_id (the table has no id column). Nothing is logged here; callers
// log only the error name and code.

import { getRequiredEnv } from "./env.js";
import { timingSafeEqualHex } from "./crypto.js";
import { pinHash } from "./pin-rules.js";
import { allowedLoginTypesFor } from "./session.js";

const CREDENTIALS_TABLE = "employee_credentials";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export const PIN_INVALID_MESSAGE = "เลขบัตรประชาชนหรือ PIN ไม่ถูกต้อง";
export const PIN_LOCKED_MESSAGE = "บัญชีถูกล็อกชั่วคราว";

/** Turns a { error: { code } } db result into a throw so callers answer 500. */
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

/** A stored locked_until in the future means the account is locked (like Express). */
export function isLockActive(lockedUntil, now) {
  const ms = lockedUntil ? new Date(lockedUntil).getTime() : NaN;
  return Number.isFinite(ms) && ms > now.getTime();
}

/**
 * One PIN attempt against an already-loaded credential row and its employee
 * row. Order stays exactly as the Phase 1 login route built it: lock window
 * first, then the HMAC compare, then the allowed role check only when the
 * PIN matches, then the counter rule (failures below five bump the counter;
 * the fifth failure resets it to 0, sets locked_until to now + 15 minutes and
 * answers 423; the below-5 failures answer 401; success resets the counter,
 * clears the lock and answers ok).
 *
 * Returns { ok: true, employeeId } or
 * { ok: false, status, message, lockedUntil? }. Database write failures throw.
 */
export async function verifyPinAttempt(env, db, now, { pin, credential, employee, role }) {
  if (isLockActive(credential.locked_until, now)) {
    return {
      ok: false,
      status: 423,
      message: PIN_LOCKED_MESSAGE,
      lockedUntil: new Date(new Date(credential.locked_until).getTime()).toISOString(),
    };
  }

  const expected = await pinHash(getRequiredEnv(env, "PIN_PEPPER"), employee.id, pin);
  const pinOk = timingSafeEqualHex(expected, credential.pin_hash);

  let roleOk = false;
  if (pinOk) {
    const allowed = await allowedLoginTypesFor(env, employee.id);
    roleOk = allowed.includes(role);
  }

  if (!pinOk || !roleOk) {
    const attempts = failedAttempts(credential.failed_attempts) + 1;
    const nowIso = now.toISOString();
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS).toISOString();
      ensureOk(
        await db.update(
          CREDENTIALS_TABLE,
          { failed_attempts: 0, locked_until: lockedUntil, updated_at: nowIso },
          [["employee_id", "eq", employee.id]]
        )
      );
      return { ok: false, status: 423, message: PIN_LOCKED_MESSAGE, lockedUntil };
    }

    ensureOk(
      await db.update(
        CREDENTIALS_TABLE,
        { failed_attempts: attempts, updated_at: nowIso },
        [["employee_id", "eq", employee.id]]
      )
    );
    return { ok: false, status: 401, message: PIN_INVALID_MESSAGE };
  }

  ensureOk(
    await db.update(
      CREDENTIALS_TABLE,
      { failed_attempts: 0, locked_until: null, updated_at: now.toISOString() },
      [["employee_id", "eq", employee.id]]
    )
  );
  return { ok: true, employeeId: employee.id };
}
