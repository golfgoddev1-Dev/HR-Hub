// The one read-scope rule for a single leave request.
//
// It is the rule the approvals queue already applies: an active approver may
// read a request only when they are its approver, and HR may read any request.
// The calendar day detail and the read-only detail endpoint both call this, so
// there is no second, slightly different check to keep in sync.
//
// `isApprover` must be the server's isActiveApprover() answer, never a client
// field. `role` is the session login role, also server-side.

export const LEAVE_SCOPE_ROLES = Object.freeze(["employee", "hr", "meeting_controller", "system_admin"]);

/**
 * True when this session may read this request's detail (including its reason).
 * A request row must carry `approver_id`; anything else is refused.
 */
export function canViewLeaveRequest({ role, employeeId, isApprover, request } = {}) {
  if (!request || typeof request !== "object") return false;
  if (role === "hr") return true;
  if (isApprover !== true) return false;
  if (typeof employeeId !== "string" || employeeId.length === 0) return false;
  return request.approver_id === employeeId;
}
