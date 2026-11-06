// The phone month grid's cell model, kept out of the component so the mapping
// from dayCounts to a pill (and the Thai aria-label) can be tested without a
// browser.
//
// Every date is the YYYY-MM-DD string the API sends. Nothing goes through UTC,
// and the counts are of people, not records: a multi-day request covers each of
// its days, two requests by one person still count once.

import { isIsoDate } from './leave-calendar.js'
import { formatThaiDateNumericLong } from './thai-date.js'

export const MOBILE_CALENDAR_BREAKPOINT = 768
export const SHORT_THAI_WEEKDAYS = Object.freeze(['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'])
export const MAX_PILL_COUNT = 9
export const PILL_OVERFLOW_TEXT = '9+'

function safeCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/** "1".."9", "9+" from ten up, and '' for nothing. */
export function pillCount(value) {
  const count = safeCount(value)
  if (count === 0) return ''
  return count > MAX_PILL_COUNT ? PILL_OVERFLOW_TEXT : String(count)
}

/**
 * One indicator per day cell:
 * - approved leave wins over pending (the pending count stays in the panel);
 * - pending alone gets its own colour;
 * - a holiday adds a separate marker, never a pill by itself.
 */
export function dayIndicator({ approved = 0, pending = 0, holiday = false } = {}) {
  const approvedCount = safeCount(approved)
  const pendingCount = safeCount(pending)
  const isHoliday = holiday === true

  if (approvedCount > 0) {
    return { pill: { tone: 'approved', text: pillCount(approvedCount) }, holiday: isHoliday }
  }
  if (pendingCount > 0) {
    return { pill: { tone: 'pending', text: pillCount(pendingCount) }, holiday: isHoliday }
  }
  return { pill: null, holiday: isHoliday }
}

function personKey(event) {
  const code = event?.detail?.employeeCode
  if (typeof code === 'string' && code.length > 0) return `code:${code}`
  const department = typeof event?.departmentName === 'string' ? event.departmentName : ''
  const name = typeof event?.employeeName === 'string' ? event.employeeName : ''
  return `name:${department}\u0000${name}`
}

function datesOf(event) {
  const start = typeof event?.startDate === 'string' ? event.startDate.slice(0, 10) : ''
  const end =
    typeof event?.endDate === 'string' ? event.endDate.slice(0, 10) : start
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return null
  return { start, end }
}

/** Distinct visible people on approved and pending leave for one day. */
export function dayStatusCounts(events, date) {
  if (!isIsoDate(date)) return { approved: 0, pending: 0 }

  const approved = new Set()
  const pending = new Set()
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.kind === 'holiday') continue
    if (event.status !== 'approved' && event.status !== 'pending') continue

    const span = datesOf(event)
    if (!span || date < span.start || date > span.end) continue
    ;(event.status === 'approved' ? approved : pending).add(personKey(event))
  }

  return { approved: approved.size, pending: pending.size }
}

/**
 * "6 พฤศจิกายน 2569 มีผู้ลา 3 คน" / "... ไม่มีผู้ลา". A pending-only day says so
 * instead of claiming nobody is on leave.
 */
export function dayAriaLabel(date, { approved = 0, pending = 0 } = {}) {
  const label = formatThaiDateNumericLong(date)
  const approvedCount = safeCount(approved)
  const pendingCount = safeCount(pending)

  if (approvedCount > 0) return `${label} มีผู้ลา ${approvedCount} คน`
  if (pendingCount > 0) return `${label} มีผู้ลารออนุมัติ ${pendingCount} คน`
  return `${label} ไม่มีผู้ลา`
}
