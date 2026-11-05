// The leave menu is the same for everyone except one entry: an active approver
// always sees "อนุมัติใบลา", with a badge only while the queue is not empty.
// The server decides who an approver is (/api/auth/me → isApprover), so this
// module only turns that signal into menu data.

export const APPROVALS_LABEL = 'อนุมัติใบลา'
export const APPROVALS_PATH = '/leave/approvals'
export const APPROVALS_ICON = 'fact_check'

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
