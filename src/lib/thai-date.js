// Thai (Buddhist-era) date display for the leave pages.
//
// Every call pins Asia/Bangkok, so a browser set to another zone can never move
// a leave date by a day. Date-only strings (YYYY-MM-DD — the format the API
// sends and receives) are read as Bangkok calendar dates, which is how
// worker/src/leave-rules.js counts the days.

import { th } from 'date-fns/locale'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const THAI_TIME_ZONE = 'Asia/Bangkok'
export const THAI_LOCALE = th
export const NO_DATE = '—'

const BUDDHIST_YEAR_OFFSET = 543
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** The moment `value` names, or null when it cannot be read. */
function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    const fromMs = new Date(value)
    return Number.isNaN(fromMs.getTime()) ? null : fromMs
  }
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (text.length === 0) return null

  // A calendar date is anchored to Bangkok midnight, so 00:00 in another zone
  // cannot turn it into the day before.
  const parsed = DATE_ONLY.test(text)
    ? fromZonedTime(`${text}T00:00:00`, THAI_TIME_ZONE)
    : new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** 2026-11-05 → "5 พ.ย. 2569" (Buddhist year, Bangkok day). */
export function formatThaiDate(value) {
  const date = toDate(value)
  if (!date) return NO_DATE

  const dayMonth = formatInTimeZone(date, THAI_TIME_ZONE, 'd MMM', { locale: THAI_LOCALE })
  const year = Number(formatInTimeZone(date, THAI_TIME_ZONE, 'yyyy'))
  return `${dayMonth} ${year + BUDDHIST_YEAR_OFFSET}`
}

/** 2026-11-05 → "วันพฤหัสบดีที่ 5 พฤศจิกายน 2569". */
export function formatThaiDateLong(value) {
  const date = toDate(value)
  if (!date) return NO_DATE

  const day = formatInTimeZone(date, THAI_TIME_ZONE, 'EEEEที่ d MMMM', { locale: THAI_LOCALE })
  const year = Number(formatInTimeZone(date, THAI_TIME_ZONE, 'yyyy'))
  return `วัน${day} ${year + BUDDHIST_YEAR_OFFSET}`
}

/** "1 พ.ย. 2569 – 5 พ.ย. 2569"; a single date when the range is one day. */
export function formatThaiDateRange(start, end) {
  const first = formatThaiDate(start)
  if (first === NO_DATE) return NO_DATE

  const last = formatThaiDate(end)
  if (last === NO_DATE || last === first) return first
  return `${first} – ${last}`
}

/** Today's calendar date in Bangkok as YYYY-MM-DD (the API's date format). */
export function todayBangkokIso(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  return formatInTimeZone(safe, THAI_TIME_ZONE, 'yyyy-MM-dd')
}
