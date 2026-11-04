// Labels and row updates for the approver toggle on the HR screen.
//
// A row is never removed: switching an approver off only sets is_active to
// false, so the list keeps showing it and can switch it back on. These helpers
// hold no Vue state, so the labels and the in-place row update can be tested
// without mounting the page.

export const APPROVER_DEACTIVATE_LABEL = 'ปิดใช้งาน'
export const APPROVER_REACTIVATE_LABEL = 'เปิดใช้งาน'
export const APPROVER_ACTIVE_TEXT = 'ใช้งานอยู่'
export const APPROVER_INACTIVE_TEXT = 'ปิดใช้งาน'

export const APPROVER_ACTION_DEACTIVATE = 'deactivate'
export const APPROVER_ACTION_REACTIVATE = 'reactivate'

/** The button always offers the opposite of the current state. */
export function approverToggleLabel(isActive) {
  return isActive === true ? APPROVER_DEACTIVATE_LABEL : APPROVER_REACTIVATE_LABEL
}

export function approverToggleAction(isActive) {
  return isActive === true ? APPROVER_ACTION_DEACTIVATE : APPROVER_ACTION_REACTIVATE
}

export function approverStatusText(isActive) {
  return isActive === true ? APPROVER_ACTIVE_TEXT : APPROVER_INACTIVE_TEXT
}

/** Endpoint for one row, carrying the scope the row was listed under. */
export function approverTogglePath(id, scope, isActive) {
  const action = approverToggleAction(isActive)
  const rowId = encodeURIComponent(String(id))
  const listScope = encodeURIComponent(String(scope))
  return `/api/leave/hr/approvers/${rowId}/${action}?scope=${listScope}`
}

/** Rows from the API, inactive ones included; junk entries are dropped. */
export function approverRows(results) {
  if (!Array.isArray(results)) return []
  return results.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string')
}

/**
 * Applies a successful toggle reply to the row in place, so the button and the
 * status line change without another round trip. Returns false when the reply
 * cannot be trusted, leaving the row exactly as it was.
 */
export function applyApproverToggle(row, data) {
  if (row === null || typeof row !== 'object') return false
  if (data === null || typeof data !== 'object') return false
  if (data.ok !== true || typeof data.isActive !== 'boolean') return false

  row.isActive = data.isActive
  if (Number.isFinite(data.pendingCount)) row.pendingCount = data.pendingCount
  return true
}

/** Success notice; a deactivation reports the pending leave it leaves behind. */
export function approverToggleNotice(isActive, pendingCount) {
  if (isActive === true) return 'เปิดใช้งานแล้ว'

  const pending = Number.isFinite(pendingCount) ? pendingCount : 0
  if (pending > 0) return `ปิดใช้งานแล้ว · ยังมีใบลาค้าง ${pending} ใบ (เก็บแถวไว้ ไม่ลบ)`
  return 'ปิดใช้งานแล้ว'
}
