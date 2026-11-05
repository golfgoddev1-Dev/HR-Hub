// Approver resolution and deactivation rules, shared by the employee route
// (resolve an approver on submit) and the HR route (manage both lists).
//
// Resolution order: employee_approvers for this person first, then
// department_approvers for their department. Lower priority wins, and equal
// priorities mean any one of them may decide. The applicant is always skipped,
// so nobody approves their own leave.
//
// Deactivation never deletes a row: an approver may still be referenced by a
// pending request, so the row stays and is_active becomes false.

export const EMPLOYEE_APPROVERS_TABLE = "employee_approvers";
export const DEPARTMENT_APPROVERS_TABLE = "department_approvers";
export const APPROVER_CANDIDATES = 5;
export const DEFAULT_PRIORITY = 100;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 999;

/**
 * First candidate that is not the applicant and is still an active employee.
 * `rows` must already be ordered by priority ascending, which is how both
 * queries read them. `activeIds` null means "do not check activity".
 */
export function pickApprover(rows, selfId, column, activeIds = null) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.[column];
    if (typeof id !== "string" || id.length === 0 || id === selfId) continue;
    if (activeIds instanceof Set && activeIds.has(id) === false) continue;
    return id;
  }
  return null;
}

/**
 * Pure resolution over already-fetched rows, so the ordering rule can be tested
 * without a database: personal rows win over department rows.
 */
export function resolveApproverRow({ personal, department, selfId, departmentId, activeIds = null }) {
  const fromPersonal = pickApprover(personal, selfId, "approver_id", activeIds);
  if (fromPersonal) return { approverId: fromPersonal, source: "employee" };

  if (!departmentId) return null;
  const fromDepartment = pickApprover(department, selfId, "employee_id", activeIds);
  if (fromDepartment) return { approverId: fromDepartment, source: "department" };

  return null;
}

/** Priority is a positive integer; anything else returns null (the caller decides). */
export function normalizePriority(value, fallback = DEFAULT_PRIORITY) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_PRIORITY || parsed > MAX_PRIORITY) return null;
  return parsed;
}

/**
 * What a deactivate request does. The row is always kept (never deleted) because
 * pending requests still point at it; `pendingCount` is reported so the HR
 * screen and the audit row can show what is left in that person's queue.
 */
export function approverDeactivation({ pendingCount } = {}) {
  const pending = Number.isFinite(pendingCount) ? pendingCount : 0;
  return { patch: { is_active: false }, keepRow: true, pendingCount: pending };
}

/**
 * What a reactivate request does. The row was kept when it was switched off,
 * so switching it back on restores the same approval route; nothing is
 * inserted and nothing is deleted.
 */
export function approverReactivation() {
  return { patch: { is_active: true }, keepRow: true };
}

/**
 * True when `approverId` is an active approver of this employee: either listed
 * personally, or listed for the employee's department. HR may only backdate a
 * leave with someone who really is that person's approver.
 */
export async function isApproverOfEmployee(db, employee, approverId) {
  if (!employee || typeof employee.id !== "string") return false;
  if (typeof approverId !== "string" || approverId.length === 0) return false;
  if (approverId === employee.id) return false;

  // An approver who has left the company is not an approver any more.
  const approver = await db.select("employees", {
    columns: "id,is_active",
    filters: [["id", "eq", approverId]],
    single: true,
  });
  if (!approver || approver.is_active !== true) return false;

  const personal = await db.select(EMPLOYEE_APPROVERS_TABLE, {
    columns: "approver_id",
    filters: [
      ["employee_id", "eq", employee.id],
      ["approver_id", "eq", approverId],
      ["is_active", "eq", true],
    ],
    single: true,
  });
  if (personal) return true;

  if (!employee.department_id) return false;

  const department = await db.select(DEPARTMENT_APPROVERS_TABLE, {
    columns: "employee_id",
    filters: [
      ["department_id", "eq", employee.department_id],
      ["employee_id", "eq", approverId],
      ["is_active", "eq", true],
    ],
    single: true,
  });
  return department !== null;
}

/** Ids of the candidates that are still active employees. */
export async function activeEmployeeIds(db, ids) {
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return new Set();

  const rows = await db.select("employees", {
    columns: "id,is_active",
    filters: [["id", "in", unique]],
  });

  return new Set(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.is_active === true)
      .map((row) => row.id)
      .filter(Boolean)
  );
}

/**
 * Reads both lists and applies the resolution rule above. Candidates whose
 * employee row is inactive are skipped, and the applicant is never chosen, so
 * "no approver" means nobody usable is configured.
 */
export async function findApproverId(db, employee) {
  const personal = await db.select(EMPLOYEE_APPROVERS_TABLE, {
    columns: "approver_id,priority",
    filters: [
      ["employee_id", "eq", employee.id],
      ["is_active", "eq", true],
    ],
    order: "priority.asc",
    limit: APPROVER_CANDIDATES,
  });

  let department = [];
  if (employee.department_id) {
    department = await db.select(DEPARTMENT_APPROVERS_TABLE, {
      columns: "employee_id,priority",
      filters: [
        ["department_id", "eq", employee.department_id],
        ["is_active", "eq", true],
      ],
      order: "priority.asc",
      limit: APPROVER_CANDIDATES,
    });
  }

  const activeIds = await activeEmployeeIds(db, [
    ...personal.map((row) => row.approver_id),
    ...department.map((row) => row.employee_id),
  ]);

  const resolved = resolveApproverRow({
    personal,
    department,
    selfId: employee.id,
    departmentId: employee.department_id ?? null,
    activeIds,
  });
  return resolved ? resolved.approverId : null;
}

/**
 * True when this employee is an active approver in either scope: listed as the
 * approver of someone (employee scope), or listed for a department (department
 * scope). Deactivation keeps the row but switches `is_active` off, so a
 * deactivated approver is no longer an approver at all: no queue, no menu.
 * One list read per scope, no rows from `leave_requests`.
 */
export async function isActiveApprover(db, employeeId) {
  if (typeof employeeId !== "string" || employeeId.length === 0) return false;

  const [personal, department] = await Promise.all([
    db.select(EMPLOYEE_APPROVERS_TABLE, {
      columns: "id",
      filters: [
        ["approver_id", "eq", employeeId],
        ["is_active", "eq", true],
      ],
      single: true,
    }),
    db.select(DEPARTMENT_APPROVERS_TABLE, {
      columns: "id",
      filters: [
        ["employee_id", "eq", employeeId],
        ["is_active", "eq", true],
      ],
      single: true,
    }),
  ]);

  return personal !== null || department !== null;
}
