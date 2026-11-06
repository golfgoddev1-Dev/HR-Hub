// The leave calendar's view switch: default by width, a remembered choice, and
// the day-grouped list built from the responses the grid already loads.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CALENDAR_STATUSES,
  VIEW_BREAKPOINT,
  VIEW_CALENDAR,
  VIEW_LIST,
  VIEW_STORAGE_KEY,
  buildLeaveList,
  defaultLeaveView,
  initialLeaveView,
  readStoredLeaveView,
  storeLeaveView,
} from '../src/lib/leave-calendar-view.js'

const VIEW = readFileSync(
  new URL('../src/components/LeaveCalendarView.vue', import.meta.url),
  'utf8'
)

const LEAVE_FIELDS = [
  'departmentName',
  'employeeName',
  'endDate',
  'id',
  'kind',
  'leaveTypeLabel',
  'startDate',
  'status',
]

function memoryStorage(value) {
  const writes = []
  return {
    writes,
    getItem(key) {
      return value
    },
    setItem(key, next) {
      writes.push([key, next])
    },
  }
}

describe('the default view', () => {
  it('is the list at 720px and below, the calendar above it', () => {
    expect(VIEW_BREAKPOINT).toBe(720)
    expect(defaultLeaveView(360)).toBe(VIEW_LIST)
    expect(defaultLeaveView(390)).toBe(VIEW_LIST)
    expect(defaultLeaveView(720)).toBe(VIEW_LIST)
    expect(defaultLeaveView(721)).toBe(VIEW_CALENDAR)
    expect(defaultLeaveView(1440)).toBe(VIEW_CALENDAR)
  })

  it('falls back to the list for an unusable width', () => {
    expect(defaultLeaveView('wide')).toBe(VIEW_LIST)
    expect(defaultLeaveView(undefined)).toBe(VIEW_LIST)
    expect(defaultLeaveView(null)).toBe(VIEW_LIST)
  })

  it('lets a stored choice override the width on this device', () => {
    expect(initialLeaveView({ width: 1440, storage: memoryStorage(VIEW_LIST) })).toBe(VIEW_LIST)
    expect(initialLeaveView({ width: 360, storage: memoryStorage(VIEW_CALENDAR) })).toBe(
      VIEW_CALENDAR
    )
  })

  it('ignores an invalid or unreadable stored value', () => {
    expect(initialLeaveView({ width: 360, storage: memoryStorage('grid') })).toBe(VIEW_LIST)
    expect(initialLeaveView({ width: 1440, storage: memoryStorage('') })).toBe(VIEW_CALENDAR)
    expect(readStoredLeaveView(null)).toBeNull()

    const throwing = {
      getItem() {
        throw new Error('storage blocked')
      },
    }
    expect(initialLeaveView({ width: 1440, storage: throwing })).toBe(VIEW_CALENDAR)
  })

  it('stores only the two real views, and survives a blocked storage', () => {
    const storage = memoryStorage(null)
    expect(storeLeaveView(VIEW_LIST, storage)).toBe(true)
    expect(storage.writes).toEqual([[VIEW_STORAGE_KEY, VIEW_LIST]])
    expect(storeLeaveView('grid', storage)).toBe(false)
    expect(storage.writes).toHaveLength(1)

    const throwing = {
      setItem() {
        throw new Error('quota')
      },
    }
    expect(storeLeaveView(VIEW_CALENDAR, throwing)).toBe(false)
  })
})

describe('the list grouping', () => {
  const events = [
    {
      id: 'leave-b',
      employeeName: 'นาย ข',
      leaveTypeLabel: 'ลากิจ',
      status: 'approved',
      startDate: '2026-11-06',
      endDate: '2026-11-06',
    },
    {
      id: 'leave-a',
      employeeName: 'นาง ก',
      leaveTypeLabel: 'ลาป่วย',
      status: 'pending',
      startDate: '2026-11-05',
      endDate: '2026-11-07',
    },
  ]
  const holidays = [{ date: '2026-11-04', name: 'วันลอยกระทง' }]

  it('groups by date in chronological order and omits empty days', () => {
    const groups = buildLeaveList({ events, holidays })

    expect(groups.map((group) => group.date)).toEqual([
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
    ])
    expect(groups.every((group) => group.rows.length > 0)).toBe(true)
    // The 7th is the end of a multi-day leave, not a group of its own.
    expect(groups.some((group) => group.date === '2026-11-07')).toBe(false)
  })

  it('keeps holidays as their own row type, first inside the day', () => {
    const [first] = buildLeaveList({ events, holidays })

    expect(first.rows[0]).toMatchObject({ kind: 'holiday', name: 'วันลอยกระทง' })
    const leave = buildLeaveList({ events, holidays })[1].rows[0]
    expect(leave.kind).toBe('leave')
  })

  it('uses only fields the calendar already shows', () => {
    const rows = buildLeaveList({ events, holidays })
      .flatMap((group) => group.rows)
      .filter((row) => row.kind === 'leave')

    expect(Object.keys(rows[0]).sort()).toEqual(LEAVE_FIELDS)
    // departmentName was previously excluded from list rows, but the list now
    // shows the same department the day panel and detail view already show.
    for (const forbidden of ['note', 'reason', 'nationalId', 'email', 'phone']) {
      expect(rows[0], forbidden).not.toHaveProperty(forbidden)
    }
  })

  it('keeps the same event order the API sent within a day', () => {
    const sameDay = [
      { id: 'z', startDate: '2026-11-09', endDate: '2026-11-09', status: 'approved' },
      { id: 'a', startDate: '2026-11-09', endDate: '2026-11-09', status: 'pending' },
    ]

    expect(buildLeaveList({ events: sameDay })[0].rows.map((row) => row.id)).toEqual(['z', 'a'])
  })

  it('survives missing or unusable input', () => {
    expect(buildLeaveList()).toEqual([])
    expect(buildLeaveList({ events: null, holidays: null })).toEqual([])
    expect(buildLeaveList({ events: [{ id: 'x' }], holidays: [{ name: 'no date' }] })).toEqual([])
  })

  it('is built from the same statuses and the same events as the grid', () => {
    expect(CALENDAR_STATUSES).toEqual(['pending', 'approved'])
    // One array feeds the grid events and the list grouping: switching views
    // cannot change what is visible.
    expect(VIEW).toContain('leaveEvents.value = Array.isArray(calendarData.events)')
    expect(VIEW).toContain('leaveEvents.value.map(toCalendarEvent)')
    expect(VIEW).toContain('buildLeaveList({ events: leaveEvents.value, holidays: holidays.value })')
  })
})

describe('the switch and the list markup', () => {
  it('marks the selected view for assistive technology', () => {
    expect(VIEW).toContain(':aria-pressed="view === VIEW_CALENDAR"')
    expect(VIEW).toContain(':aria-pressed="view === VIEW_LIST"')
    expect(VIEW).toContain('>ปฏิทิน<')
    expect(VIEW).toContain('>รายการ<')
  })

  it('uses a heading per day and a semantic list', () => {
    expect(VIEW).toContain('<ul v-else class="day-list">')
    expect(VIEW).toContain('<h3 class="day-heading">{{ formatThaiDate(group.date) }}</h3>')
    expect(VIEW).toContain('ไม่มีรายการการลาในช่วงนี้')
  })

  it('adds no new fetch URL', () => {
    const urls = [...VIEW.matchAll(/\/api\/[a-z/]+/g)].map((match) => match[0])
    expect(urls).toEqual(['/api/leave/calendar'])
  })

  it('shares one range: list navigation drives the same calendar', () => {
    expect(VIEW).toContain("moveRange('prev')")
    expect(VIEW).toContain("moveRange('next')")
    expect(VIEW).toContain("moveRange('today')")
    expect(VIEW).toContain('api[action]()')
    // Switching only changes view; it never calls load().
    const select = VIEW.slice(VIEW.indexOf('function selectView'), VIEW.indexOf('function openDay'))
    expect(select).not.toContain('load(')
  })
})
