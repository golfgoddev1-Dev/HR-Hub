// Pure rules for the system-admin permission page.
//
// The Worker keeps the same escaping rule in worker/src/admin-permissions.js:
// the two bundles cannot import each other, and both copies are small and
// pinned by tests. Nothing here holds Vue state, so the search URL, the flag
// diff and the confirm rule can be tested without mounting the page.

export const PERMISSION_SEARCH_URL = '/api/admin/permissions/search'
export const MIN_SEARCH_LENGTH = 2
export const SEARCH_DEBOUNCE_MS = 300

/** The four flags the screen offers, in display order. */
export const PERMISSION_FIELDS = Object.freeze([
  {
    key: 'hrAdmin',
    label: 'ผู้ดูแล HR',
    description: 'จัดการข้อมูลพนักงานและงานลา',
    icon: 'badge',
  },
  {
    key: 'meetingAdmin',
    label: 'ผู้ดูแลการประชุม',
    description: 'จัดการรอบประชุมและรายชื่อผู้เข้าร่วม',
    icon: 'groups',
  },
  {
    key: 'systemAdmin',
    label: 'ผู้ดูแลระบบ',
    description: 'เข้าถึงหน้าผู้ดูแลและหน้านี้',
    icon: 'shield_person',
  },
  {
    key: 'leaveApprover',
    label: 'ผู้อนุมัติการลา',
    description: 'อนุมัติใบลาของพนักงาน',
    icon: 'fact_check',
  },
])

export const PERMISSION_KEYS = PERMISSION_FIELDS.map((field) => field.key)

export function normalizeQuery(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/** True when the typed text is long enough to search for. */
export function isSearchable(raw) {
  return normalizeQuery(raw).length >= MIN_SEARCH_LENGTH
}

/** Escapes the wildcards PostgREST's ilike reads, so they stay literal. */
export function escapeSearchPattern(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/([%_*])/g, '\\$1')
}

/** One value inside or=(): encoded, so , ( ) . can never act as filter syntax. */
export function encodeSearchValue(value) {
  return encodeURIComponent(value)
    .replace(/\./g, '%2E')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

/** The same or=(...) filter the Worker sends, kept for the escaping checks. */
export function buildSearchFilter(text) {
  const pattern = `%${escapeSearchPattern(normalizeQuery(text))}%`
  const nameClause = `full_name.ilike.${encodeSearchValue(pattern)}`
  const codeClause = `employee_code.ilike.${encodeSearchValue(pattern)}`
  return `or=(${nameClause},${codeClause})`
}

/** The search request the page sends; the escaping happens on the server. */
export function buildPermissionSearchUrl(text) {
  return `${PERMISSION_SEARCH_URL}?q=${encodeURIComponent(normalizeQuery(text))}`
}

export function emptyPermissionFlags() {
  const flags = {}
  for (const key of PERMISSION_KEYS) flags[key] = false
  return flags
}

/** Only the four flags, always booleans, whatever the reply carried. */
export function readPermissionFlags(source) {
  const flags = {}
  for (const key of PERMISSION_KEYS) flags[key] = source?.[key] === true
  return flags
}

/** The flags that differ, in display order: { key, label, granted }. */
export function changedFlags(current, next) {
  const changes = []
  for (const field of PERMISSION_FIELDS) {
    const was = current?.[field.key] === true
    const will = next?.[field.key] === true
    if (was === will) continue
    changes.push({ key: field.key, label: field.label, granted: will })
  }
  return changes
}

export function hasPermissionChanges(current, next) {
  return changedFlags(current, next).length > 0
}

/** Switching the system admin flag off always needs a confirm step. */
export function requiresSystemAdminConfirm(current, next) {
  return current?.systemAdmin === true && next?.systemAdmin === false
}

/** The PUT body: exactly the four booleans, nothing else. */
export function permissionToggleBody(flags) {
  const body = {}
  for (const key of PERMISSION_KEYS) body[key] = flags?.[key] === true
  return body
}

/** Result rows the list may show; junk entries are dropped. */
export function searchResultRows(results) {
  if (!Array.isArray(results)) return []
  return results.filter(
    (row) => row !== null && typeof row === 'object' && typeof row.id === 'string'
  )
}
