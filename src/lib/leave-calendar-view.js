// The view switch on the leave calendar: which view this device opens with and
// the day-grouped rows the list shows. Kept out of the component so the rules
// can be tested without a browser.
//
// The list is built from the responses the grid already loads
// (/api/leave/calendar events and /api/leave/holidays): no new field, endpoint
// or personal data. A row carries only the fields the calendar already shows
// (the same name, department, type and dates the day panel renders).

export const VIEW_CALENDAR = 'calendar'
export const VIEW_LIST = 'list'
export const VIEW_STORAGE_KEY = 'hrhub:leave-calendar-view'
// Phones and small tablets open the list; wider screens open the month grid.
export const VIEW_BREAKPOINT = 720

// The only statuses /api/leave/calendar returns, and both views read the same
// events array, so the list cannot show a status the grid hides.
export const CALENDAR_STATUSES = Object.freeze(['pending', 'approved'])

/** List at 720px and below, calendar above it; unusable widths use the phone default. */
export function defaultLeaveView(width) {
  const value = Number(width)
  return Number.isFinite(value) && value > VIEW_BREAKPOINT ? VIEW_CALENDAR : VIEW_LIST
}

/** The stored choice, or null when it is missing, invalid or unreadable. */
export function readStoredLeaveView(storage) {
  try {
    const value = storage?.getItem?.(VIEW_STORAGE_KEY)
    return value === VIEW_CALENDAR || value === VIEW_LIST ? value : null
  } catch {
    return null
  }
}

/** A stored choice wins; otherwise the width decides. */
export function initialLeaveView({ width, storage } = {}) {
  const stored = readStoredLeaveView(storage)
  return stored ?? defaultLeaveView(width)
}

/** Remember the choice on this device. A storage failure is ignored. */
export function storeLeaveView(view, storage) {
  if (view !== VIEW_CALENDAR && view !== VIEW_LIST) return false
  try {
    storage?.setItem?.(VIEW_STORAGE_KEY, view)
    return true
  } catch {
    return false
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * One group per day that has something to show, in chronological order from the
 * range start. A multi-day leave is listed on its start date only, exactly like
 * a grid cell that starts it; empty days never get a group. Holidays come first
 * inside a day and keep their own row type.
 */
export function buildLeaveList({ events = [], holidays = [] } = {}) {
  const groups = new Map()
  const push = (date, row) => {
    if (typeof date !== 'string' || !DATE_ONLY.test(date)) return
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date).push(row)
  }

  for (const holiday of Array.isArray(holidays) ? holidays : []) {
    if (!holiday || typeof holiday.date !== 'string') continue
    push(holiday.date, {
      kind: 'holiday',
      id: `holiday-${holiday.date}`,
      name: typeof holiday.name === 'string' ? holiday.name : '',
      date: holiday.date,
    })
  }

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event.startDate !== 'string') continue
    push(event.startDate, {
      kind: 'leave',
      id: typeof event.id === 'string' ? event.id : '',
      employeeName: typeof event.employeeName === 'string' ? event.employeeName : '',
      departmentName:
        typeof event.departmentName === 'string' ? event.departmentName : '',
      leaveTypeLabel: typeof event.leaveTypeLabel === 'string' ? event.leaveTypeLabel : '',
      status: event.status,
      startDate: event.startDate,
      endDate: typeof event.endDate === 'string' ? event.endDate : event.startDate,
    })
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, rows]) => ({ date, rows }))
}
