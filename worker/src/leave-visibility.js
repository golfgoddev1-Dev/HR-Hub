// Server-only helpers that turn a session into the set of leave records it may
// read. Routes call these; no client ever supplies a grant or a department.
//
// The rule itself lives in leave-scope.js. This file loads the inputs for it:
// the active grants of an approver, and the requester's current department.

import { readApproverGrants } from "./leave-approvers.js";
import { canSeeLeaveRequest } from "./leave-scope.js";

const EMPLOYEES_TABLE = "employees";
const VISIBLE_EMPLOYEE_LIMIT = 5000;

/** The viewer's role, employee id, own department and active grants. */
export async function loadViewerScope(
  db,
  { role, employeeId, departmentId = null } = {}
) {
  if (role === "hr") {
    return { role, employeeId, departmentId, grants: null };
  }
  const grants = await readApproverGrants(db, employeeId);
  return { role, employeeId, departmentId, grants };
}

/** The shared row rule, using the scope loaded above. */
export function viewerCanSee(scope, request, requesterDepartmentId = null) {
  return canSeeLeaveRequest({
    role: scope?.role,
    employeeId: scope?.employeeId,
    departmentId: scope?.departmentId ?? null,
    grants: scope?.grants,
    request,
    requesterDepartmentId,
  });
}

/**
 * Every employee id whose leave this viewer may see, or null for HR (no filter).
 *
 * - An approver: granted named employees, every employee currently in a granted
 *   department, and themselves.
 * - A non-approver employee: their own department (existing visibility), or
 *   only themselves when they have no department.
 */
export async function loadVisibleEmployeeIds(
  db,
  scope,
  { limit = VISIBLE_EMPLOYEE_LIMIT } = {}
) {
  if (scope?.role === "hr") return null;

  const ids = new Set();
  if (typeof scope?.employeeId === "string" && scope.employeeId.length > 0) {
    ids.add(scope.employeeId);
  }

  if (scope?.grants?.isApprover === true) {
    for (const id of scope.grants.employeeIds ?? []) {
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
    const departmentIds = [...(scope.grants.departmentIds ?? [])].filter(Boolean);
    if (departmentIds.length > 0) {
      const rows = await db.select(EMPLOYEES_TABLE, {
        columns: "id",
        filters: [["department_id", "in", departmentIds]],
        limit,
      });
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id) ids.add(row.id);
      }
    }
    return ids;
  }

  if (typeof scope?.departmentId !== "string" || scope.departmentId.length === 0) {
    return new Set();
  }
  const rows = await db.select(EMPLOYEES_TABLE, {
    columns: "id",
    filters: [["department_id", "eq", scope.departmentId]],
    limit,
  });
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.id) ids.add(row.id);
  }
  return ids;
}

/** employee_id -> current department_id for the given ids. */
export async function loadRequesterDepartments(db, employeeIds) {
  const ids = [...new Set((employeeIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const rows = await db.select(EMPLOYEES_TABLE, {
    columns: "id,department_id",
    filters: [["id", "in", ids]],
  });
  return new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [row.id, row.department_id ?? null])
  );
}

/**
 * Filters rows of leave_requests down to the ones this viewer may see. Used by
 * the pending queue, whose query is already limited to the caller's own rows,
 * so the extra reads are small.
 */
export async function filterVisibleRequests(db, scope, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (scope?.role === "hr") return list;

  const departments = await loadRequesterDepartments(
    db,
    list.map((row) => row?.employee_id)
  );
  return list.filter((row) =>
    viewerCanSee(scope, row, departments.get(row?.employee_id) ?? null)
  );
}
