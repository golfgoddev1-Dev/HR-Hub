// The read-scope rules for leave records, in one place.
//
// An approver's visibility follows responsibility, not their own department:
// - an active department_approvers row grants every employee currently in that
//   department;
// - an active employee_approvers row grants that one employee only;
// - a named approver for someone in another department does NOT see that
//   department's other employees.
// HR sees everything. A plain employee keeps the existing department-wide
// calendar visibility, but never gets the review fields (reason) for it.
//
// `grants` must come from readApproverGrants() on the server. A client field is
// never accepted. Department membership is the requester's current
// employees.department_id, the same source the approvals and calendar reads use.

export const LEAVE_SCOPE_ROLES = Object.freeze(["employee", "hr", "meeting_controller", "system_admin"]);

export const EMPTY_GRANTS = Object.freeze({
  isApprover: false,
  employeeIds: new Set(),
  departmentIds: new Set(),
});

function grantedEmployee(grants, employeeId) {
  return (
    grants?.isApprover === true &&
    grants.employeeIds instanceof Set &&
    grants.employeeIds.has(employeeId)
  );
}

function grantedDepartment(grants, departmentId) {
  return (
    grants?.isApprover === true &&
    typeof departmentId === "string" &&
    departmentId.length > 0 &&
    grants.departmentIds instanceof Set &&
    grants.departmentIds.has(departmentId)
  );
}

/**
 * True when this session may read the request's full detail, including its
 * reason, certificate state and decision note. HR, or an approver responsible
 * for the requester (named grant, or department grant for the requester's
 * current department).
 */
export function canViewLeaveRequest({
  role,
  employeeId,
  grants,
  request,
  requesterDepartmentId = null,
} = {}) {
  if (!request || typeof request !== "object") return false;
  if (role === "hr") return true;
  if (typeof employeeId !== "string" || employeeId.length === 0) return false;
  if (grantedEmployee(grants, request.employee_id)) return true;
  return grantedDepartment(grants, requesterDepartmentId);
}

/**
 * True when this session may see the request at all (a calendar event, a list
 * row, a history row).
 *
 * - HR: every request.
 * - An active approver: only requests inside their grants, plus their own.
 *   Their own department is not an implicit grant.
 * - A non-approver employee: their own requests and their department's rows,
 *   as before. Approver responsibility never widens an employee's scope.
 */
export function canSeeLeaveRequest({
  role,
  employeeId,
  departmentId = null,
  grants,
  request,
  requesterDepartmentId = null,
} = {}) {
  if (!request || typeof request !== "object") return false;
  if (canViewLeaveRequest({ role, employeeId, grants, request, requesterDepartmentId })) {
    return true;
  }
  if (role === "hr") return true;
  if (typeof employeeId !== "string" || employeeId.length === 0) return false;
  if (request.employee_id === employeeId) return true;

  // An active approver is scoped by responsibility only: no own-department
  // fallback, so a named approver for one person cannot see their colleagues.
  if (grants?.isApprover === true) return false;

  return (
    typeof departmentId === "string" &&
    departmentId.length > 0 &&
    departmentId === requesterDepartmentId
  );
}
