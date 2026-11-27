// Shaping for the admin sessions screen: who is signed in right now, and which
// accounts are locked by failed PIN attempts. Nothing here reads a token hash, a
// PIN hash, a national ID or any credential value; a session is described by its
// id, role and times, and a lock by its end time.

import { SESSION_IDLE_MS } from "./session.js";

export const SESSIONS_LIMIT = 100;
export const LOCKED_LIMIT = 100;

/** A session idle longer than this is already dead; readSession revokes it lazily. */
export function activeSince(now = new Date()) {
  return new Date(now.getTime() - SESSION_IDLE_MS).toISOString();
}

function person(employee) {
  return {
    employeeCode: employee?.employee_code ?? null,
    fullName: employee?.full_name ?? null,
  };
}

/** The ids whose names the screen needs from one batch of rows. */
export function personIds(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter((id) => typeof id === "string" && id))];
}

/** `people` maps employee id to its employees row. */
export function shapeSession(row, people, ownEmployeeId) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    ...person(people.get(row.employee_id)),
    role: row.login_role ?? null,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    isOwn: row.employee_id === ownEmployeeId,
  };
}

export function shapeLocked(row, people) {
  return {
    employeeId: row.employee_id,
    ...person(people.get(row.employee_id)),
    lockedUntil: row.locked_until,
  };
}
