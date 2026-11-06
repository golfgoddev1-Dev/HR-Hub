// One place for the reads that several pages need: the session, approver
// counts, lookups (departments, name prefixes, holidays, leave types) and the
// page reads that can be painted from cache. The keys are also the invalidation
// handle, so a mutation clears every reader of the affected data.
import {
  getCached,
  invalidate,
  invalidatePrefix,
  patchCached,
  peekCached,
  refreshCached,
} from './data-cache.js'
import { fetchNotificationStatus } from './push.js'
import {
  approvalCount,
  decrementApprovalCount,
  publishApprovalCount,
  setApprovalCount,
} from './approval-count.js'

export const SESSION_TTL_MS = 5 * 60_000
export const SHARED_TTL_MS = 30 * 60_000
export const APPROVALS_TTL_MS = 60_000
export const PAGE_TTL_MS = 60_000

const LOAD_ERROR = 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'

// A loader failure with a message that is safe to show the user. Transport
// failures are wrapped too, so a page never shows the browser's raw error text.
export class SharedDataError extends Error {
  constructor(message) {
    super(message || LOAD_ERROR)
    this.name = 'SharedDataError'
  }
}

export function errorTextOf(error, fallback) {
  return error instanceof SharedDataError ? error.message : fallback
}

export async function requestJson(url, options = {}) {
  let response
  try {
    response = await fetch(url, { credentials: 'same-origin', ...options })
  } catch {
    throw new SharedDataError(LOAD_ERROR)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) {
    throw new SharedDataError(typeof data.message === 'string' ? data.message : LOAD_ERROR)
  }
  return data
}

export const DATA_KEYS = {
  session: 'session',
  approvals: 'leave:approvals',
  myRequests: 'leave:requests:mine',
  hrRequests: 'leave:hr:requests',
  leaveTypes: 'leave:types',
  leaveShifts: 'leave:shifts',
  leaveHolidays: 'leave:holidays',
  hrCatalog: 'leave:hr:catalog',
  hrDepartments: 'leave:hr:departments',
  hrSettings: 'leave:hr:settings',
  hrApprovers: 'leave:hr:approvers',
  hrHolidays: 'leave:hr:holidays',
  directoryCatalog: 'directory:catalog',
  profile: 'profile:me',
  notificationStatus: 'notifications:status',
  profileDepartments: 'profile:departments',
  profilePrefixes: 'profile:name-prefixes',
  adminOverview: 'admin:overview',
}

export const dataKey = {
  leaveHolidays: (from, to) =>
    from || to ? `${DATA_KEYS.leaveHolidays}:${from ?? ''}:${to ?? ''}` : DATA_KEYS.leaveHolidays,
  hrHolidays: (year) => `${DATA_KEYS.hrHolidays}:${year || 'all'}`,
  hrApprovers: (scope, departmentId) =>
    `${DATA_KEYS.hrApprovers}:${scope}:${departmentId || ''}`,
  directoryCatalog: (base) => `${DATA_KEYS.directoryCatalog}:${base}`,
  hrRequests: (queryString) =>
    queryString ? `${DATA_KEYS.hrRequests}?${queryString}` : DATA_KEYS.hrRequests,
}

const holidayUrl = (from, to) => {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const query = params.toString()
  return query ? `/api/leave/holidays?${query}` : '/api/leave/holidays'
}

export const loaders = {
  approvals: () => requestJson('/api/leave/approvals'),
  myRequests: () => requestJson('/api/leave/requests/mine'),
  leaveTypes: () => requestJson('/api/leave/types'),
  leaveShifts: () => requestJson('/api/leave/shifts'),
  leaveHolidays: (from, to) => () => requestJson(holidayUrl(from, to)),
  hrCatalog: () => requestJson('/api/leave/hr/catalog'),
  // The HR directory catalog is the one department list with a role gate; the
  // loader takes the mount base, never a path that already ends in /catalog.
  hrDepartments: () => requestJson('/api/hr/directory/catalog'),
  hrSettings: () => requestJson('/api/leave/hr/settings'),
  hrHolidays: (year) => () =>
    requestJson(year ? `/api/leave/hr/holidays?year=${encodeURIComponent(year)}` : '/api/leave/hr/holidays'),
  hrApprovers: (scope, departmentId) => () => {
    const params = new URLSearchParams({ scope })
    if (departmentId) params.set('departmentId', departmentId)
    return requestJson(`/api/leave/hr/approvers?${params.toString()}`)
  },
  hrRequests: (queryString) => () =>
    requestJson(queryString ? `/api/leave/hr/requests?${queryString}` : '/api/leave/hr/requests'),
  directoryCatalog: (base) => () => requestJson(`${base}/catalog`),
  profile: () => requestJson('/api/profile/me'),
  // Cached for a minute by the switch's background verification.
  notificationStatus: () => fetchNotificationStatus(),
  profileDepartments: () => requestJson('/api/profile/departments'),
  profilePrefixes: () => requestJson('/api/profile/name-prefixes'),
  adminOverview: () => requestJson('/api/admin/overview'),
}

/**
 * Whether this account opted in to leave notifications. The icon badge follows
 * the same switch, so an unreadable answer counts as off and only clears.
 */
export async function notificationSettingEnabled() {
  try {
    const status = await getCached(DATA_KEYS.notificationStatus, loaders.notificationStatus, {
      ttlMs: 60_000,
    })
    return status?.enabled === true
  } catch {
    return false
  }
}

// Stale-while-revalidate: paints a cached value at once, and only when it is
// older than ttlMs asks the server for a newer one in the background. A
// background failure keeps the value on screen instead of clearing the page.
export async function loadShared(key, loader, { ttlMs = SHARED_TTL_MS, onData } = {}) {
  const cached = peekCached(key)
  if (cached) {
    if (onData) onData(cached.value)
    if (Date.now() - cached.at >= ttlMs) {
      refreshCached(key, loader)
        .then((value) => {
          if (onData) onData(value)
        })
        .catch(() => {})
    }
    return { data: cached.value, cached: true }
  }

  const data = await getCached(key, loader, { ttlMs })
  if (onData) onData(data)
  return { data, cached: false }
}

/**
 * The active departments an HR picker offers. One shared value, so the approvers
 * page, the HR request filter and the calendar all read the same list. A failed
 * read is never cached (getCached stores no rejection) and an empty answer is
 * dropped, so a transient failure cannot paint an empty picker for the ttl.
 */
export async function loadHrDepartments() {
  let data
  try {
    data = await getCached(DATA_KEYS.hrDepartments, loaders.hrDepartments, {
      ttlMs: SHARED_TTL_MS,
    })
  } catch (error) {
    invalidate(DATA_KEYS.hrDepartments)
    throw error
  }

  const departments = (Array.isArray(data?.departments) ? data.departments : [])
    .filter(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        typeof row.name === 'string' &&
        row.isActive !== false
    )
    .map((row) => ({ id: row.id, name: row.name }))

  // A successful empty answer is not worth keeping: ask again next visit.
  if (departments.length === 0) invalidate(DATA_KEYS.hrDepartments)
  return departments
}

// --- invalidation after mutations ------------------------------------------

export function invalidateSession() {
  invalidate(DATA_KEYS.session)
}

export function invalidateApprovals() {
  invalidatePrefix(DATA_KEYS.approvals)
}

export function invalidateLeaveRequests() {
  invalidatePrefix('leave:requests')
  invalidatePrefix('leave:hr:requests')
  invalidatePrefix(DATA_KEYS.approvals)
  invalidatePrefix(DATA_KEYS.adminOverview)
}

/**
 * A successful approve/reject, applied locally: the row leaves the cached queue
 * when it is there, the shared count drops by one (never below zero) and the
 * other tabs hear the new number. Nothing is refetched for the count.
 */
export function applyApprovalDecision(requestId) {
  const cached = peekCached(DATA_KEYS.approvals)
  if (cached && Array.isArray(cached.value?.results)) {
    patchCached(DATA_KEYS.approvals, (value) => {
      const results = value.results.filter((row) => row?.id !== requestId)
      return { ...value, results, count: results.length }
    })
  }

  const next = setApprovalCount(decrementApprovalCount(approvalCount.value))
  publishApprovalCount(next)
  return next
}

/** A decision patches its own queue in place, so the queue is not invalidated. */
export function invalidateDecidedLeave() {
  invalidatePrefix('leave:requests')
  invalidatePrefix('leave:hr:requests')
  invalidatePrefix(DATA_KEYS.adminOverview)
}

export function invalidateApproverConfig() {
  invalidatePrefix(DATA_KEYS.hrApprovers)
  invalidatePrefix(DATA_KEYS.hrCatalog)
}

export function invalidateLeaveHolidays() {
  invalidatePrefix(DATA_KEYS.leaveHolidays)
  invalidatePrefix(DATA_KEYS.hrHolidays)
  invalidatePrefix(DATA_KEYS.hrCatalog)
}

export function invalidateLeaveSettings() {
  invalidatePrefix(DATA_KEYS.hrSettings)
  invalidatePrefix(DATA_KEYS.hrCatalog)
}

export function invalidateDirectoryCatalog() {
  invalidatePrefix(DATA_KEYS.directoryCatalog)
  invalidatePrefix(DATA_KEYS.profileDepartments)
}

export function invalidateProfile() {
  invalidate(DATA_KEYS.profile)
}

export function invalidateAdminOverview() {
  invalidatePrefix(DATA_KEYS.adminOverview)
}
