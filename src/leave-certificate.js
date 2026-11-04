// Certificate status and expiry shown on every leave page.
//
// `has_medical_certificate` is the source of truth. A stored object path means
// the file can be opened through the signed-URL endpoint; a backdated entry can
// carry the flag without a file; an employee entry whose file the retention job
// has removed is expired. The retention window always comes from
// leave_settings.certificate_retention_days — never hardcoded here.

import { formatThaiDate } from './leave-print.js'

export const CERTIFICATE_OPEN_LABEL = 'เปิดไฟล์แนบ (ต้องล็อกอิน)'
export const CERTIFICATE_RECORDED_LABEL = 'มีใบรับรองแพทย์ (บันทึกโดย HR)'
export const CERTIFICATE_EXPIRED_LABEL = 'ไฟล์หมดอายุแล้ว'
export const CERTIFICATE_EXPIRES_TODAY_LABEL = 'จะหมดอายุในวันนี้'

const DAY_MS = 86400000

/** Days since the epoch for the Bangkok calendar date of `value`. */
function bangkokDayNumber(value) {
  if (value === null || value === undefined || value === '') return Number.NaN
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return Number.NaN

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

  const [year, month, day] = parts.split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Date.UTC(year, month - 1, day) / DAY_MS
}

/**
 * Certificate expiry from the request's created_at and the retention setting.
 * The window always starts on the submission date, never on an upload date.
 *
 * @returns {{ expiresOn: string, daysLeft: number, expired: boolean, label: string } | null}
 */
export function certificateExpiry(createdAt, retentionDays, now = new Date()) {
  if (retentionDays === null || retentionDays === undefined || retentionDays === '') return null
  const days = Number(retentionDays)
  if (!Number.isFinite(days) || days < 0) return null

  const startDay = bangkokDayNumber(createdAt)
  const todayDay = bangkokDayNumber(now)
  if (!Number.isFinite(startDay) || !Number.isFinite(todayDay)) return null

  const expiresDay = startDay + days
  const daysLeft = expiresDay - todayDay
  const expiresOn = formatThaiDate(new Date(expiresDay * DAY_MS))

  if (daysLeft < 0) {
    return { expiresOn, daysLeft, expired: true, label: CERTIFICATE_EXPIRED_LABEL }
  }
  if (daysLeft === 0) {
    return { expiresOn, daysLeft, expired: false, label: CERTIFICATE_EXPIRES_TODAY_LABEL }
  }
  return {
    expiresOn,
    daysLeft,
    expired: false,
    label: `หมดอายุ: ${expiresOn} (เหลือ ${daysLeft} วัน)`,
  }
}

/** "ไฟล์ใบรับรองแพทย์จะเก็บไว้ N วัน…" with N from the settings row. */
export function retentionNotice(retentionDays) {
  const days = Number(retentionDays)
  if (!Number.isFinite(days) || days <= 0) return ''
  return `ไฟล์ใบรับรองแพทย์จะเก็บไว้ ${days} วันนับจากวันที่ยื่นใบลา หลังจากนั้นไฟล์จะหมดอายุและลบออกจากระบบ`
}

/**
 * @returns {{ has: boolean, canOpen: boolean, state: 'none'|'stored'|'hr_recorded'|'expired', label: string, expiry: object|null }}
 */
export function certificateStatus(request, { retentionDays = null } = {}) {
  if (request?.hasMedicalCertificate !== true) {
    return { has: false, canOpen: false, state: 'none', label: '', expiry: null }
  }

  const path = typeof request?.attachmentPath === 'string' ? request.attachmentPath.trim() : ''
  if (path.length > 0) {
    return {
      has: true,
      canOpen: true,
      state: 'stored',
      label: CERTIFICATE_OPEN_LABEL,
      expiry: certificateExpiry(request.createdAt, retentionDays),
    }
  }

  // A backdated entry never had a file; an employee entry did and it expired.
  if (request?.source === 'hr_backdated') {
    return {
      has: true,
      canOpen: false,
      state: 'hr_recorded',
      label: CERTIFICATE_RECORDED_LABEL,
      expiry: null,
    }
  }

  return {
    has: true,
    canOpen: false,
    state: 'expired',
    label: CERTIFICATE_EXPIRED_LABEL,
    expiry: certificateExpiry(request.createdAt, retentionDays),
  }
}
