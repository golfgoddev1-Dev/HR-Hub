// Which pages each login role may open, kept in one place so the router guard
// and the pages that link onward agree. `path` is always an exact path here;
// detail pages add their id, which the prefixes below cover.

export const allowedPathsByRole = {
  employee: ['/leave', '/leave/new', '/leave/approvals', '/change-pin', '/profile'],
  // HR landing plus every leave tool; all of them are linked from HrNav.
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
  system_admin: ['/admin'],
}

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

/** True when this role may open `path`. An unknown role may open nothing. */
export function canOpenPath(role, path) {
  if (typeof role !== 'string' || typeof path !== 'string') return false

  const allowedPaths = allowedPathsByRole[role] ?? []
  if (allowedPaths.includes(path)) return true

  const allowedPrefixes = allowedPrefixesByRole[role] ?? []
  return allowedPrefixes.some((prefix) => path.startsWith(prefix))
}
