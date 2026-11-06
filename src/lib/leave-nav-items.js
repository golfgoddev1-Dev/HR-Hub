// The leave menu is the same for everyone except one entry: an active approver
// always sees "อนุมัติใบลา", with a badge only while the queue is not empty.
// The server decides who an approver is (/api/auth/me → isApprover), so this
// module only turns that signal into menu data.

export const APPROVALS_LABEL = 'อนุมัติใบลา'
export const APPROVALS_PATH = '/leave/approvals'
export const APPROVALS_ICON = 'fact_check'

export const HISTORY_LABEL = 'ประวัติการอนุมัติ'
export const HISTORY_PATH = '/leave/approvals/history'
export const HISTORY_ICON = 'history'

/** Pending count as a badge number; anything unusable is 0, which means no badge. */
export function badgeCount(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.floor(count)
}

/**
 * The approvals entry, or null when this employee is not an active approver.
 * `isApprover` must come from the server: a deactivated approver row is false.
 */
export function approvalsMenuItem({ isApprover, pendingCount } = {}) {
  if (isApprover !== true) return null

  const badge = badgeCount(pendingCount)
  return {
    label: APPROVALS_LABEL,
    to: APPROVALS_PATH,
    icon: APPROVALS_ICON,
    badge,
    ariaLabel: badge > 0 ? `${APPROVALS_LABEL} (${badge})` : APPROVALS_LABEL,
  }
}

/**
 * The decision log entry: an active approver sees their own decisions, HR sees
 * every decision, and nobody else gets the item. It sits in the approver
 * section and never in the phone tab bar.
 */
export function approvalHistoryMenuItem({ isApprover, role } = {}) {
  if (isApprover !== true && role !== 'hr') return null
  return {
    label: HISTORY_LABEL,
    to: HISTORY_PATH,
    icon: HISTORY_ICON,
  }
}
