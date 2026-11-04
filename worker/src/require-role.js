// Role guard. Routes come in a later step.

import { parseCookies, sessionCookieName } from "./cookie.js";
import { createDb } from "./db.js";
import { readSession } from "./session.js";

const MESSAGE_UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const MESSAGE_FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";
const MESSAGE_PIN_CHANGE_REQUIRED = "ต้องเปลี่ยน PIN ก่อนใช้งานระบบ";

/**
 * true while the current PIN was issued by HR and the employee has not replaced
 * it yet. A read error answers false: a transient database failure must not lock
 * every employee out (the route's own query fails on its own).
 */
async function mustChangePinFor(env, employeeId) {
  try {
    const db = createDb(env);
    const credential = await db.select("employee_credentials", {
      columns: "must_change_pin",
      filters: [["employee_id", "eq", employeeId]],
      single: true,
    });
    return credential ? credential.must_change_pin === true : false;
  } catch {
    return false;
  }
}

/**
 * Reads the session cookie and checks the session role.
 * Returns 401 when there is no valid session, 403 when the role is not allowed,
 * otherwise { ok: true, session }.
 */
export async function requireRole(env, request, roles) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const session = await readSession(env, cookies[sessionCookieName]);

  if (!session.ok) {
    return { status: 401, message: MESSAGE_UNAUTHENTICATED };
  }

  const allowedRoles = Array.isArray(roles) ? roles : [];
  if (!allowedRoles.includes(session.role)) {
    return { status: 403, message: MESSAGE_FORBIDDEN };
  }

  // The role matches, so this is a real caller: a HR-issued PIN that has not been
  // replaced blocks every route that runs through this guard. /api/auth/* has
  // its own rules, and registration is public.
  if (await mustChangePinFor(env, session.employeeId)) {
    return { status: 403, message: MESSAGE_PIN_CHANGE_REQUIRED };
  }

  return { ok: true, session };
}
