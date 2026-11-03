export const STATUS_CODE_BY_LABEL = {
  'เข้าร่วมประชุม': 'attended',
  'ไม่เข้าร่วม': 'not_attended',
  'ติดงานด่วน': 'urgent_busy',
  'ลาประชุม': 'leave',
}

// The four codes that may be stored in meeting_attendance.status_code. A manual
// status change is validated against this list; the browser never decides.
export const STATUS_CODES = Object.values(STATUS_CODE_BY_LABEL)

// Statuses that store a reason at all. The dialog shows the reason box for
// these only.
export const REASON_STATUS_CODES = ['urgent_busy', 'leave']
// Only urgent_busy makes the reason mandatory. A leave can be recorded without
// typing anything, but a reason that is typed must still fit the length limit.
export const REASON_REQUIRED_STATUS_CODES = ['urgent_busy']
export const SHIFT_STATUS_CODES = ['leave']
export const SHIFT_VALUES = ['กะ A', 'กะ B']
export const REASON_MAX_LENGTH = 200

export function statusCodeFromLabel(label) {
  if (typeof label !== 'string') return null
  return STATUS_CODE_BY_LABEL[label] ?? null
}

export function requiresReason(statusCode) {
  return REASON_STATUS_CODES.includes(statusCode)
}

export function requiresReasonText(statusCode) {
  return REASON_REQUIRED_STATUS_CODES.includes(statusCode)
}

export function requiresShift(statusCode) {
  return SHIFT_STATUS_CODES.includes(statusCode)
}

/**
 * Validates a manual status change and normalises the reason/shift pair: a
 * shift only for leave, a reason for urgent_busy (mandatory) and leave
 * (optional, at most REASON_MAX_LENGTH characters), and neither for the other
 * two statuses (they are cleared to null). Returns { ok: true, value } with the
 * database column names, or { ok: false } for anything the routes would reject.
 */
export function normalizeStatusUpdate({ statusCode, reason, shift } = {}) {
  if (!STATUS_CODES.includes(statusCode)) return { ok: false }

  const columnShift = shift ?? null
  if (requiresShift(statusCode)) {
    if (!SHIFT_VALUES.includes(columnShift)) return { ok: false }
  } else if (columnShift !== null) {
    return { ok: false }
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : ''
  if (requiresReason(statusCode)) {
    if (trimmedReason.length > REASON_MAX_LENGTH) return { ok: false }
    if (requiresReasonText(statusCode) && trimmedReason.length === 0) return { ok: false }
  } else if (trimmedReason.length > 0) {
    return { ok: false }
  }

  const keepsReason = requiresReason(statusCode) && trimmedReason.length > 0
  return {
    ok: true,
    value: {
      status_code: statusCode,
      reason: keepsReason ? trimmedReason : null,
      shift: requiresShift(statusCode) ? columnShift : null,
    },
  }
}
