// Leave calendar helpers, kept out of the component so they can be tested
// without a browser.
//
// FullCalendar's event `end` is exclusive: a one-day event on the 5th ends on
// the 6th. Our API stores an inclusive end_date, so every event passes through
// toExclusiveEnd(), and every month grid range passes back through
// toInclusiveEnd() before it is requested from the Worker.

import { formatThaiYear } from './thai-date.js'

export const MAX_RANGE_DAYS = 62
export const NARROW_VIEW_WIDTH = 640
export const MONTH_VIEW = 'dayGridMonth'

export const APPROVED_COLOR = '#10504e'
export const PENDING_COLOR = '#b45309'
export const PENDING_LABEL = 'รออนุมัติ'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86400000

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function toMs(value) {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** Adds whole days to a YYYY-MM-DD string; '' when the input is unusable. */
export function addIsoDays(value, amount) {
  if (!isIsoDate(value) || !Number.isInteger(amount)) return ''
  const date = new Date(toMs(value) + amount * DAY_MS)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Inclusive end date (API) → exclusive end (FullCalendar). */
export function toExclusiveEnd(endDate) {
  return addIsoDays(typeof endDate === 'string' ? endDate.slice(0, 10) : endDate, 1)
}

/** Exclusive end date (FullCalendar) → inclusive end date (API). */
export function toInclusiveEnd(exclusiveEnd) {
  return addIsoDays(
    typeof exclusiveEnd === 'string' ? exclusiveEnd.slice(0, 10) : exclusiveEnd,
    -1
  )
}

/** Inclusive day count; 0 when either date is unusable. */
export function inclusiveDayCount(from, to) {
  if (!isIsoDate(from) || !isIsoDate(to)) return 0
  return Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1
}

/** The visible grid range, as an inclusive API range, capped at 62 days. */
export function rangeFromView(startStr, endStr) {
  const from = String(startStr ?? '').slice(0, 10)
  const to = toInclusiveEnd(String(endStr ?? '').slice(0, 10))
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  if (to < from) return { from, to: from }
  if (inclusiveDayCount(from, to) > MAX_RANGE_DAYS) {
    return { from, to: addIsoDays(from, MAX_RANGE_DAYS - 1) }
  }
  return { from, to }
}

/**
 * The grid is the month grid at every width: the list is the separate
 * day-grouped view, and the 720px default lives in leave-calendar-view.js.
 */
export function initialCalendarView() {
  return MONTH_VIEW
}

/** "ปฏิทินการลา พ.ศ. 2569" — Buddhist year from thai-date.js. */
export function calendarTitle(value) {
  const year = formatThaiYear(value)
  return year ? `ปฏิทินการลา พ.ศ. ${year}` : 'ปฏิทินการลา'
}

/** The word "รออนุมัติ" is in the label, so colour is never the only signal. */
export function eventTitle(event = {}) {
  const parts = [event.employeeName, event.leaveTypeLabel].filter(
    (value) => typeof value === 'string' && value.trim().length > 0
  )
  const body = parts.join(' · ')
  return event.status === 'pending' ? `${PENDING_LABEL} · ${body}` : body
}

export function eventColors(status) {
  if (status === 'pending') {
    return {
      backgroundColor: '#fef3c7',
      borderColor: '#f59e0b',
      textColor: PENDING_COLOR,
    }
  }
  return {
    backgroundColor: APPROVED_COLOR,
    borderColor: APPROVED_COLOR,
    textColor: '#ffffff',
  }
}

export function statusLabel(status) {
  if (status === 'pending') return PENDING_LABEL
  if (status === 'approved') return 'อนุมัติแล้ว'
  return '—'
}
