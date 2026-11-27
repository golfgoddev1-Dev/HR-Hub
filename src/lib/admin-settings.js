// The read-only system settings screen: the one endpoint, how a reply is read,
// and how day counts are said. A malformed reply is null, so the page says it
// could not load instead of showing made-up defaults.

export const SETTINGS_URL = '/api/admin/settings'

export const SETTINGS_LOAD_ERROR = 'โหลดค่าตั้งค่าระบบไม่สำเร็จ กรุณาลองใหม่'

const SECURITY_KEYS = ['sessionIdleMinutes', 'maxFailedPins', 'lockMinutes', 'sessionRetentionDays', 'auditRetentionDays']

/** Rows of the sign-in section, in reading order. */
export const SECURITY_ROWS = [
  { key: 'sessionIdleMinutes', label: 'ออกจากระบบเองเมื่อไม่ได้ใช้งาน', unit: 'นาที' },
  { key: 'maxFailedPins', label: 'ล็อกบัญชีเมื่อใส่ PIN ผิดติดกัน', unit: 'ครั้ง' },
  { key: 'lockMinutes', label: 'ล็อกบัญชีนาน', unit: 'นาที' },
  { key: 'sessionRetentionDays', label: 'เก็บประวัติการเข้าสู่ระบบ', unit: 'วัน' },
  { key: 'auditRetentionDays', label: 'เก็บประวัติการใช้งาน', unit: 'วัน' },
]

function whole(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

/** "5 ปี" for whole years, otherwise "90 วัน". */
export function daysText(days) {
  if (days > 0 && days % 365 === 0) return `${days / 365} ปี`
  return `${days.toLocaleString('th-TH')} วัน`
}

function readLeave(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const certificateRetentionDays = whole(raw.certificateRetentionDays)
  const leaveRetentionDays = whole(raw.leaveRetentionDays)
  if (certificateRetentionDays === null || leaveRetentionDays === null) return null
  if (typeof raw.leaveRetentionEnabled !== 'boolean') return null
  const by = raw.updatedBy && typeof raw.updatedBy === 'object' ? raw.updatedBy : null
  return {
    configured: raw.configured === true,
    certificateRetentionDays,
    leaveRetentionEnabled: raw.leaveRetentionEnabled,
    leaveRetentionDays,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    updatedBy: by
      ? { employeeCode: String(by.employeeCode ?? ''), fullName: String(by.fullName ?? '') }
      : null,
  }
}

function readHolidays(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const count = whole(raw.count)
  if (count === null) return null
  const next =
    raw.next && typeof raw.next.date === 'string'
      ? { date: raw.next.date, name: String(raw.next.name ?? '') }
      : null
  return { count, next }
}

function readSecurity(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const security = {}
  for (const key of SECURITY_KEYS) {
    security[key] = whole(raw[key])
    if (security[key] === null) return null
  }
  return security
}

/** { leave, holidays, security } or null when any part is unusable. */
export function readSettings(payload) {
  if (payload === null || typeof payload !== 'object' || payload.ok !== true) return null
  const leave = readLeave(payload.leave)
  const holidays = readHolidays(payload.holidays)
  const security = readSecurity(payload.security)
  return leave && holidays && security ? { leave, holidays, security } : null
}
