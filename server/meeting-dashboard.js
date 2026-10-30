import { STATUS_CODE_BY_LABEL } from './attendance-status.js'

const BANGKOK_TIME_ZONE = 'Asia/Bangkok'
const DASH = '-'
const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_DAYS = 12
const HISTORY_MONTHS = 12
const TOP_STATUSES = ['not_attended', 'urgent_busy', 'leave']

export const EMPTY_MESSAGE = 'ยังไม่มีข้อมูลในระบบ'
export const STATUS_CODES = Object.values(STATUS_CODE_BY_LABEL)

function partsInBangkok(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

export function bangkokDayKey(date) {
  const { year, month, day } = partsInBangkok(date instanceof Date ? date : new Date())
  return `${year}-${month}-${day}`
}

function dayKeyToDate(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof dayKey === 'string' ? dayKey : '')
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
}

function monthKeyToDate(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(typeof monthKey === 'string' ? monthKey : '')
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12))
}

function thaiPart(date, options) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: BANGKOK_TIME_ZONE, ...options }).format(date)
}

export function thaiDateLabel(dayKey) {
  const date = dayKeyToDate(dayKey)
  if (!date) return ''
  const weekday = thaiPart(date, { weekday: 'long' })
  const day = thaiPart(date, { day: 'numeric' })
  return `${weekday} ${day} ${thaiPart(date, { month: 'short', year: 'numeric' })}`
}

export function thaiShortDateLabel(dayKey) {
  const date = dayKeyToDate(dayKey)
  if (!date) return ''
  return `${thaiPart(date, { day: 'numeric' })} ${thaiPart(date, { month: 'short' })}`
}

export function thaiMonthLabel(monthKey) {
  const date = monthKeyToDate(monthKey)
  if (!date) return ''
  return thaiPart(date, { month: 'short', year: 'numeric' })
}

function registeredTime(row) {
  const time = new Date(row?.registered_at ?? 0).getTime()
  return Number.isFinite(time) ? time : 0
}

export function latestPerEmployee(rows) {
  const latest = new Map()
  for (const row of rows ?? []) {
    const employeeId = row?.employee_id
    if (typeof employeeId !== 'string' || employeeId.length === 0) continue
    const current = latest.get(employeeId)
    if (!current || registeredTime(row) >= registeredTime(current)) latest.set(employeeId, row)
  }
  return [...latest.values()]
}

export function countByStatus(rows) {
  const counts = { attended: 0, not_attended: 0, urgent_busy: 0, leave: 0, total: 0 }
  for (const row of rows ?? []) {
    const code = row?.status_code
    if (typeof code !== 'string' || code.length === 0) continue
    counts.total += 1
    if (STATUS_CODES.includes(code)) counts[code] += 1
  }
  return counts
}

export function rateOf(attended, total) {
  const attendedCount = Number(attended)
  const totalCount = Number(total)
  if (!Number.isFinite(attendedCount) || !Number.isFinite(totalCount) || totalCount <= 0) return 0
  const rate = attendedCount / totalCount
  if (rate < 0) return 0
  if (rate > 1) return 1
  return rate
}

function parseDayKey(dayKey) {
  const date = dayKeyToDate(dayKey)
  if (!date) return null
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function formatUtcDay(timestamp) {
  const date = new Date(timestamp)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

function addDays(dayKey, days) {
  const timestamp = parseDayKey(dayKey)
  if (timestamp === null) return ''
  return formatUtcDay(timestamp + days * DAY_MS)
}

function tuesdayOnOrBefore(dayKey) {
  const timestamp = parseDayKey(dayKey)
  if (timestamp === null) return ''
  let cursor = timestamp
  for (let step = 0; step < 7; step += 1) {
    if (new Date(cursor).getUTCDay() === 2) return formatUtcDay(cursor)
    cursor -= DAY_MS
  }
  return ''
}

function shiftMonth(monthKey, delta) {
  const date = monthKeyToDate(monthKey)
  if (!date) return ''
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 15, 12))
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}`
}

function monthKeyOf(key) {
  return typeof key === 'string' ? key.slice(0, 7) : ''
}

function sortedKeys(availableKeys) {
  const keys = (availableKeys ?? []).filter(
    (key) => typeof key === 'string' && key.length >= 7,
  )
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b))
}

export function historyKeys({ code, mode, value, availableKeys } = {}) {
  const keys = sortedKeys(availableKeys)
  const latest = keys.length > 0 ? keys[keys.length - 1] : ''
  const requested = typeof value === 'string' ? value.trim() : ''

  if (mode === 'year') {
    const basis = (requested.length >= 4 ? requested : latest).slice(0, 4)
    if (!/^\d{4}$/.test(basis)) return []
    return [...new Set(keys.map(monthKeyOf))].filter((key) => key.startsWith(basis)).sort((a, b) => a.localeCompare(b))
  }

  if (mode === 'month') {
    const months = [...new Set(keys.map(monthKeyOf))].sort((a, b) => a.localeCompare(b))
    const upTo = monthKeyOf(requested)
    const filtered = upTo ? months.filter((key) => key <= upTo) : months
    return filtered.slice(-HISTORY_MONTHS)
  }

  if (code === 'sup') {
    const anchor = requested || latest
    const end = anchor ? tuesdayOnOrBefore(anchor) : ''
    if (!end) return []
    const start = addDays(end, -7 * (HISTORY_DAYS - 1))
    const out = []
    for (let index = 0; index < HISTORY_DAYS; index += 1) out.push(addDays(start, index * 7))
    return out
  }

  const endMonth = monthKeyOf(requested) || monthKeyOf(latest)
  if (!endMonth) return []
  const out = []
  for (let index = HISTORY_MONTHS - 1; index >= 0; index -= 1) out.push(shiftMonth(endMonth, -index))
  return out
}

function deptNameOf(value) {
  return typeof value === 'string' && value.length > 0 ? value : DASH
}

export function deptSummary(roster, latestRows) {
  const latestById = new Map()
  for (const row of latestRows ?? []) {
    if (typeof row?.employee_id === 'string') latestById.set(row.employee_id, row)
  }

  const groups = new Map()
  for (const member of roster ?? []) {
    const name = deptNameOf(member?.departmentName)
    const group = groups.get(name) ?? { name, total: 0, registered: 0, attended: 0 }
    group.total += 1
    const row = latestById.get(member?.employeeId)
    if (row) {
      group.registered += 1
      if (row.status_code === 'attended') group.attended += 1
    }
    groups.set(name, group)
  }

  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      total: group.total,
      registered: group.registered,
      notYet: group.total - group.registered,
      attended: group.attended,
      rate: rateOf(group.attended, group.total),
    }))
    .sort((a, b) => b.notYet - a.notYet || a.name.localeCompare(b.name, 'th'))
}

export function topAbsentPerDept(rows) {
  const grouped = new Map()
  for (const row of rows ?? []) {
    const dept = row?.dept
    const status = row?.status
    if (typeof dept !== 'string' || dept.length === 0) continue
    if (!TOP_STATUSES.includes(status)) continue
    const name = typeof row?.name === 'string' ? row.name : ''
    const count = Number.isFinite(Number(row?.count)) ? Number(row.count) : 0

    const perStatus = grouped.get(dept) ?? new Map()
    const current = perStatus.get(status)
    const better =
      !current ||
      count > current.count ||
      (count === current.count && name.localeCompare(current.name, 'th') < 0)
    if (better) perStatus.set(status, { name, count })
    grouped.set(dept, perStatus)
  }

  const out = []
  const departments = [...grouped.keys()].sort((a, b) => a.localeCompare(b, 'th'))
  for (const dept of departments) {
    const perStatus = grouped.get(dept)
    for (const status of TOP_STATUSES) {
      const best = perStatus.get(status)
      const count = best?.count ?? 0
      out.push({ dept, status, name: count > 0 ? best.name : '', count })
    }
  }
  return out
}
