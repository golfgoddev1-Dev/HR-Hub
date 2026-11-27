// The sessions screen: its endpoints, the wording of each outcome, and how a reply
// is read. A failed or malformed reply is null so the page says it could not load
// instead of showing "nobody is signed in".

export const SESSIONS_URL = '/api/admin/sessions'

/** Must match SESSION_IDLE_MS in worker/src/session.js (15 minutes). */
export const IDLE_MINUTES = 15

export const SESSIONS_LOAD_ERROR = 'โหลดรายชื่อไม่สำเร็จ กรุณาลองใหม่'
export const REVOKE_ERROR = 'ออกจากระบบให้ผู้ใช้ไม่สำเร็จ กรุณาลองใหม่'
export const UNLOCK_ERROR = 'ปลดล็อกบัญชีไม่สำเร็จ กรุณาลองใหม่'

export function revokeUrl(sessionId) {
  return `${SESSIONS_URL}/${encodeURIComponent(sessionId)}/revoke`
}

export function unlockUrl(employeeId) {
  return `/api/admin/accounts/${encodeURIComponent(employeeId)}/unlock`
}

/** "สมชาย ใจดี (EMP001)"; whichever part exists, or "ไม่ทราบชื่อ". */
export function personName(person) {
  const name = typeof person?.fullName === 'string' ? person.fullName : ''
  const code = typeof person?.employeeCode === 'string' ? person.employeeCode : ''
  if (name && code) return `${name} (${code})`
  return name || code || 'ไม่ทราบชื่อ'
}

function validSession(row) {
  return (
    row &&
    typeof row.id === 'string' &&
    typeof row.employeeId === 'string' &&
    typeof row.lastActiveAt === 'string' &&
    typeof row.createdAt === 'string'
  )
}

function validLocked(row) {
  return row && typeof row.employeeId === 'string' && typeof row.lockedUntil === 'string'
}

/** { sessions, locked, sessionsLimit } or null when the reply is unusable. */
export function readSessions(payload) {
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
  if (!Array.isArray(payload.sessions) || !Array.isArray(payload.locked)) return null
  return {
    sessions: payload.sessions.filter(validSession),
    locked: payload.locked.filter(validLocked),
    sessionsLimit: Number.isInteger(payload.sessionsLimit) ? payload.sessionsLimit : null,
  }
}

/** True when the list was cut at the server's limit, so more may be signed in. */
export function isListTruncated(data) {
  return Boolean(data) && data.sessionsLimit !== null && data.sessions.length >= data.sessionsLimit
}
