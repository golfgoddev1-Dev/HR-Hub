// Session layer, mirroring the Express helpers. Routes come in a later step.

import { sha256Hex } from "./crypto.js";
import { createDb } from "./db.js";

const SESSION_HOURS = 12;
const SESSION_IDLE_MS = 15 * 60 * 1000;
const SESSIONS_TABLE = "auth_sessions";

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base path per login role. Accepts the legacy aliases controller and system. */
export function landingPathFor(loginRole, hasPending) {
  if (loginRole === "employee") return hasPending ? "/leave/approvals" : "/leave";
  if (loginRole === "hr") return "/hr/employees/import";
  if (loginRole === "meeting_controller" || loginRole === "controller") return "/meeting/controller";
  if (loginRole === "system_admin" || loginRole === "system") return "/admin";
  return "/login";
}

/**
 * Allowed login types for an employee. Priority: hr_admins, then meeting_admins,
 * then system_admins; first match wins. Everyone else is an employee.
 */
export async function allowedLoginTypesFor(env, employeeId) {
  const db = createDb(env);
  const one = async (table) => {
    const row = await db.select(table, {
      columns: "employee_id",
      filters: [["employee_id", "eq", employeeId]],
      single: true,
    });
    return row !== null;
  };

  if (await one("hr_admins")) return ["hr"];
  if (await one("meeting_admins")) return ["meeting_controller"];
  if (await one("system_admins")) return ["system_admin"];
  return ["employee"];
}

/** Revokes a session by id. Rows already revoked are left alone. */
export async function revokeSession(env, id) {
  const db = createDb(env);
  return db.update(
    SESSIONS_TABLE,
    { revoked_at: new Date().toISOString() },
    [
      ["id", "eq", id],
      ["revoked_at", "is", null],
    ]
  );
}

/** Creates a session for the employee and returns the raw token. */
export async function createSession(env, employeeId, loginRole) {
  const db = createDb(env);

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000).toISOString();

  const { error } = await db.insert(SESSIONS_TABLE, {
    token_hash: await sha256Hex(token),
    employee_id: employeeId,
    login_role: loginRole,
    created_at: nowIso,
    last_active_at: nowIso,
    expires_at: expiresIso,
  });

  if (error) throw new Error("failed to create session");
  return token;
}

/**
 * Resolves a raw session token. Every failure is { ok: false }; this function
 * never throws. Sessions are revoked when idle, inactive, or no longer allowed.
 */
export async function readSession(env, token) {
  if (!token) return { ok: false };

  try {
    const db = createDb(env);
    const now = new Date();

    const session = await db.select(SESSIONS_TABLE, {
      columns: "*",
      filters: [
        ["token_hash", "eq", await sha256Hex(token)],
        ["revoked_at", "is", null],
        ["expires_at", "gt", now.toISOString()],
      ],
      single: true,
    });
    if (!session) return { ok: false };

    const lastActiveMs = new Date(session.last_active_at).getTime();
    if (!Number.isFinite(lastActiveMs) || now.getTime() - lastActiveMs > SESSION_IDLE_MS) {
      await revokeSession(env, session.id);
      return { ok: false };
    }

    const employee = await db.select("employees", {
      columns: "*",
      filters: [["id", "eq", session.employee_id]],
      single: true,
    });
    if (!employee || employee.is_active !== true) {
      await revokeSession(env, session.id);
      return { ok: false };
    }

    const allowed = await allowedLoginTypesFor(env, employee.id);
    if (!allowed.includes(session.login_role)) {
      await revokeSession(env, session.id);
      return { ok: false };
    }

    await db.update(
      SESSIONS_TABLE,
      { last_active_at: now.toISOString() },
      [
        ["id", "eq", session.id],
        ["revoked_at", "is", null],
      ]
    );

    const role = session.login_role;
    if (role === "employee") {
      const pending = await db.select("leave_requests", {
        columns: "id",
        filters: [
          ["approver_id", "eq", employee.id],
          ["status", "eq", "pending"],
        ],
        single: true,
      });
      const target = landingPathFor(role, pending !== null);
      return {
        ok: true,
        employeeId: employee.id,
        role,
        redirectTo: "/pending?to=" + encodeURIComponent(target),
      };
    }

    return {
      ok: true,
      employeeId: employee.id,
      role,
      redirectTo: landingPathFor(role, false),
    };
  } catch {
    return { ok: false };
  }
}
