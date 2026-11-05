// Which pages each login role may open, kept in one place so the router guard
// and the pages that link onward agree. `path` is always an exact path here;
// detail pages add their id, which the prefixes below cover.
//
// Own leave and the profile belong to the person, not to the login role: any
// signed-in account with an active employee record may open them (the session
// carries `hasEmployee`). The employee role's list is unchanged.

export const allowedPathsByRole = {
  employee: [
    '/leave',
    '/leave/new',
    '/leave/approvals',
    '/leave/calendar',
    '/change-pin',
    '/profile',
  ],
  // HR landing plus every leave tool; all of them are linked from hrNavItems().
  hr: [
    '/hr',
    '/hr/employees',
    '/hr/employees/import',
    '/hr/employees/manage',
    '/hr/employees/password',
    '/hr/leave',
    '/hr/leave/backdated',
    '/hr/leave/approvers',
    '/hr/leave/holidays',
    '/hr/leave/settings',
    '/leave/calendar',
  ],
  meeting_controller: [
    '/meeting/controller',
    '/meeting/controller/qr',
    '/meeting/controller/roster',
    '/meeting/controller/dashboard',
    '/meeting/controller/registrants',
    '/meeting/controller/employees',
    '/meeting/controller/backfill',
    '/meeting/controller/backfill/import',
  ],
  // The overview and the permission screen; both are system_admin only.
  system_admin: ['/admin', '/admin/permissions'],
}

// Pages any active employee may open with any login role.
export const employeeSelfPaths = ['/leave', '/leave/new', '/change-pin', '/profile']

// Detail pages carry an id in the path, so exact-path matching is not enough.
export const allowedPrefixesByRole = {
  hr: ['/hr/employees/', '/leave/hr/requests/'],
}

// Where a signed-in user goes when a page is not theirs.
export const homePathByRole = {
  employee: '/leave',
  hr: '/hr',
  meeting_controller: '/meeting/controller',
  system_admin: '/admin',
}

function hasEmployeeRecord(session) {
  if (!session) return false
  // The employee role always has one: /api/auth/me only answers for a session
  // whose employee row exists and is active. Other roles carry the flag.
  return session.role === 'employee' || session.hasEmployee === true
}

/** True when this role may open `path`. An unknown role may open nothing. */
export function canOpenPath(role, path, session = null) {
  if (typeof role !== 'string' || typeof path !== 'string') return false

  const allowedPaths = allowedPathsByRole[role] ?? []
  if (allowedPaths.includes(path)) return true

  if (hasEmployeeRecord(session)) {
    if (employeeSelfPaths.includes(path)) return true
    // The approvals queue follows the approver row, not the role.
    if (session.isApprover === true && path === '/leave/approvals') return true
  }

  const allowedPrefixes = allowedPrefixesByRole[role] ?? []
  return allowedPrefixes.some((prefix) => path.startsWith(prefix))
}
