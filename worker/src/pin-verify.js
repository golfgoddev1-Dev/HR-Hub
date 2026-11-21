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
// A parallel attempt on the same account is still being checked.
export const PIN_BUSY_MESSAGE = "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";

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
 * The filter that matches the counter exactly as it was read. A claim that
 * filters on it can only succeed once per read value, so parallel attempts
 * cannot all count as the same one.
 */
export function counterFilter(column, value) {
  return value === null || value === undefined ? [column, "is", null] : [column, "eq", value];
}

/**
 * One PIN attempt against an already-loaded credential row and its employee
 * row. Lock window first. Then the attempt is claimed BEFORE the PIN is
 * compared: the counter is bumped with a conditional update on the value that
 * was read (the fifth failure locks for 15 minutes and resets the counter to
 * 0). If another attempt changed the counter in between, nothing is compared
 * and the caller answers 429, so a burst of parallel guesses counts one by
 * one instead of all reading the same count. A wrong PIN, or a right PIN for a
 * role the employee may not use, answers 401 (or 423 on the fifth); success
 * resets the counter and clears the lock.
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

  const nowIso = now.toISOString();
  const attempts = failedAttempts(credential.failed_attempts) + 1;
  const locks = attempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = locks ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString() : null;
  const claimed = ensureOk(
    await db.update(
      CREDENTIALS_TABLE,
      locks
        ? { failed_attempts: 0, locked_until: lockedUntil, updated_at: nowIso }
        : { failed_attempts: attempts, updated_at: nowIso },
      [
        ["employee_id", "eq", employee.id],
        counterFilter("failed_attempts", credential.failed_attempts),
      ],
      { returning: true, columns: "employee_id" }
    )
  );
  if (!Array.isArray(claimed.data) || claimed.data.length === 0) {
    return { ok: false, status: 429, message: PIN_BUSY_MESSAGE };
  }

  const expected = await pinHash(getRequiredEnv(env, "PIN_PEPPER"), employee.id, pin);
  const pinOk = timingSafeEqualHex(expected, credential.pin_hash);

  let roleOk = false;
  if (pinOk) {
    const allowed = await allowedLoginTypesFor(env, employee.id);
    roleOk = allowed.includes(role);
  }

  if (!pinOk || !roleOk) {
    if (locks) return { ok: false, status: 423, message: PIN_LOCKED_MESSAGE, lockedUntil };
    return { ok: false, status: 401, message: PIN_INVALID_MESSAGE };
  }

  ensureOk(
    await db.update(
      CREDENTIALS_TABLE,
      { failed_attempts: 0, locked_until: null, updated_at: nowIso },
      [["employee_id", "eq", employee.id]]
    )
  );
  return { ok: true, employeeId: employee.id };
}
