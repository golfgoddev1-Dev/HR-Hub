// The leave calendar's day panel: the approved people on one Bangkok calendar
// day, grouped by department, built only from events the month response already
// carries. No fetch, no date shifted through UTC: every key is the YYYY-MM-DD
// string the API sends.

import { addIsoDays, isIsoDate } from './leave-calendar.js'

export const DAY_PANEL_BREAKPOINT = 768
export const DAY_PANEL_EMPTY = 'ไม่มีผู้ลาในวันนี้'
export const EMPTY_DEPARTMENT = 'ไม่ระบุแผนก'
const TIME_ZONE = 'Asia/Bangkok'

const collator = new Intl.Collator('th')

function headingFormatter() {
  try {
    return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      timeZone: TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

const HEADING = headingFormatter()

/**
 * "วันเสาร์ที่ 6 ธันวาคม 2568" for a YYYY-MM-DD Bangkok calendar date. The
 * instant is built at Bangkok midnight, so a machine in another zone cannot
 * move it to the day before.
 */
export function formatThaiDayHeading(date) {
  if (!isIsoDate(date)) return ''
  if (!HEADING) return date
  const instant = new Date(`${date}T00:00:00+07:00`)
  if (Number.isNaN(instant.getTime())) return date
  return HEADING.format(instant)
}

/** "ลาวันนี้ 3 คน" — the panel header count. */
export function dayCountLabel(count) {
  const value = Number(count)
  const safe = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  return `ลาวันนี้ ${safe} คน`
}

function covers(event, date) {
  const start = typeof event?.startDate === 'string' ? event.startDate.slice(0, 10) : ''
  const end =
    typeof event?.endDate === 'string' ? event.endDate.slice(0, 10) : start
  if (!isIsoDate(start) || !isIsoDate(end) || !isIsoDate(date)) return false
  return start <= date && date <= end
}

/**
 * One row per person on approved leave that day. The key is the employee code
 * when the reviewer fields are in scope, otherwise department + name, so two
 * records for one person cannot double the count.
 */
function personKey(event) {
  const code = event?.detail?.employeeCode
  if (typeof code === 'string' && code.length > 0) return `code:${code}`
  const department = typeof event?.departmentName === 'string' ? event.departmentName : ''
  const name = typeof event?.employeeName === 'string' ? event.employeeName : ''
  return `name:${department}\u0000${name}`
}

/** Approved people on one day, from the month's in-memory events. */
export function buildDayRows({ events = [], date } = {}) {
  if (!isIsoDate(date)) return []

  const seen = new Set()
  const rows = []
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.kind === 'holiday') continue
    if (event.status !== 'approved') continue
    if (!covers(event, date)) continue

    const key = personKey(event)
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      id: typeof event.id === 'string' ? event.id : '',
      employeeName: typeof event.employeeName === 'string' ? event.employeeName : '',
      departmentName:
        typeof event.departmentName === 'string' ? event.departmentName : '',
      leaveTypeLabel:
        typeof event.leaveTypeLabel === 'string' ? event.leaveTypeLabel : '',
      startDate: event.startDate,
      endDate: typeof event.endDate === 'string' ? event.endDate : event.startDate,
      status: event.status,
      detail: event.detail && typeof event.detail === 'object' ? event.detail : null,
    })
  }

  return rows.sort(
    (left, right) =>
      collator.compare(left.departmentName, right.departmentName) ||
      collator.compare(left.employeeName, right.employeeName)
  )
}

/** Department groups, sorted with the Thai collator. */
export function groupDayRows(rows) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const department = row.departmentName || EMPTY_DEPARTMENT
    if (!groups.has(department)) groups.set(department, [])
    groups.get(department).push(row)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => collator.compare(left, right))
    .map(([department, list]) => ({
      department,
      rows: [...list].sort((left, right) => collator.compare(left.employeeName, right.employeeName)),
    }))
}

/**
 * The calendar row and the detail endpoint return the same field names. This
 * maps an in-memory calendar row onto that shape, so LeaveRequestDetail is one
 * component for the day panel, the history page and the approvals page.
 */
export function toDetailRequest(row) {
  const detail = row?.detail ?? {}
  return {
    requestCode: detail.requestCode ?? null,
    requester: {
      fullName: row?.employeeName ?? '',
      employeeCode: detail.employeeCode ?? null,
      departmentName: row?.departmentName ?? null,
    },
    leaveTypeName: row?.leaveTypeLabel ?? '',
    otherTypeDetail: detail.otherTypeDetail ?? null,
    startDate: row?.startDate ?? null,
    endDate: row?.endDate ?? null,
    days: detail.days ?? null,
    returnDate: detail.returnDate ?? null,
    returnTime: detail.returnTime ?? null,
    shiftCode: detail.shiftCode ?? null,
    shiftEndOverride: detail.shiftEndOverride ?? null,
    otOption: detail.otOption ?? null,
    reason: detail.reason ?? null,
    hasMedicalCertificate: detail.hasMedicalCertificate === true,
    decisionNote: detail.decisionNote ?? null,
    decidedAt: detail.decidedAt ?? null,
    status: row?.status ?? null,
  }
}

/** The day after `date`, exposed for the tests that pin string-only math. */
export function nextDay(date) {
  return addIsoDays(date, 1)
}
