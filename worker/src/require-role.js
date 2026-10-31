// Role guard. Routes come in a later step.

import { parseCookies, sessionCookieName } from "./cookie.js";
import { readSession } from "./session.js";

const MESSAGE_UNAUTHENTICATED = "ไม่ได้เข้าสู่ระบบ";
const MESSAGE_FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงส่วนนี้";

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

  return { ok: true, session };
}
