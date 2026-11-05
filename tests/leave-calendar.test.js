// Frontend half of the leave calendar: the inclusive→exclusive end date rule,
// the Buddhist year in the title, the view breakpoint, the menu entries and the
// route allow-list.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  APPROVED_COLOR,
  LIST_VIEW,
  MONTH_VIEW,
  PENDING_LABEL,
  addIsoDays,
  calendarTitle,
  eventColors,
  eventTitle,
  initialCalendarView,
  rangeFromView,
  statusLabel,
  toExclusiveEnd,
  toInclusiveEnd,
} from '../src/lib/leave-calendar.js'
import { hrNavItems, leaveNavItems } from '../src/lib/nav-config.js'
import { canOpenPath } from '../src/lib/route-access.js'
import { formatThaiYear } from '../src/lib/thai-date.js'

const PAGE = readFileSync(new URL('../src/pages/LeaveCalendarPage.vue', import.meta.url), 'utf8')
const VIEW = readFileSync(
  new URL('../src/components/LeaveCalendarView.vue', import.meta.url),
  'utf8'
)
const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')

describe('inclusive end date to FullCalendar exclusive end', () => {
  it('adds one day for an ordinary date', () => {
    expect(toExclusiveEnd('2026-11-05')).toBe('2026-11-06')
  })

  it('rolls over the last day of a month', () => {
    expect(toExclusiveEnd('2026-01-31')).toBe('2026-02-01')
    expect(toExclusiveEnd('2026-04-30')).toBe('2026-05-01')
  })

  it('rolls over the last day of the year', () => {
    expect(toExclusiveEnd('2026-12-31')).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(toExclusiveEnd('2028-02-28')).toBe('2028-02-29')
    expect(toExclusiveEnd('2028-02-29')).toBe('2028-03-01')
  })

  it('round-trips back to the inclusive date', () => {
    for (const date of ['2026-01-31', '2026-12-31', '2028-02-29', '2026-11-05']) {
      expect(toInclusiveEnd(toExclusiveEnd(date))).toBe(date)
    }
  })

  it('returns an empty string for unusable input', () => {
    expect(toExclusiveEnd('2026-02-30')).toBe('')
    expect(toExclusiveEnd('')).toBe('')
    expect(addIsoDays('2026-01-01', 1.5)).toBe('')
  })
})

describe('visible range', () => {
  it('converts the grid end to an inclusive API range', () => {
    expect(rangeFromView('2026-10-25', '2026-12-06')).toEqual({
      from: '2026-10-25',
      to: '2026-12-05',
    })
  })

  it('caps a long grid at 62 days', () => {
    const range = rangeFromView('2026-01-01', '2026-04-01')
    expect(range.from).toBe('2026-01-01')
    expect(range.to).toBe('2026-03-03')
  })
})

describe('title and views', () => {
  it('shows the Buddhist year', () => {
    expect(formatThaiYear('2026-11-05')).toBe('2569')
    expect(calendarTitle('2026-11-05')).toBe('ปฏิทินการลา พ.ศ. 2569')
    expect(calendarTitle('2027-01-01')).toContain('2570')
  })

  it('uses a list under 640px and a month grid above it', () => {
    expect(initialCalendarView(360)).toBe(LIST_VIEW)
    expect(initialCalendarView(639)).toBe(LIST_VIEW)
    expect(initialCalendarView(640)).toBe(MONTH_VIEW)
    expect(initialCalendarView(1440)).toBe(MONTH_VIEW)
    expect(initialCalendarView('wide')).toBe(MONTH_VIEW)
  })
})

describe('event presentation', () => {
  it('puts the word รออนุมัติ in the pending label, not only an amber colour', () => {
    const pending = { employeeName: 'นาย ก', leaveTypeLabel: 'ลากิจ', status: 'pending' }
    expect(eventTitle(pending)).toContain(PENDING_LABEL)
    expect(eventTitle(pending)).toContain('ลากิจ')
    expect(eventColors('pending').backgroundColor).toBe('#fef3c7')

    const approved = { employeeName: 'นาย ก', leaveTypeLabel: 'ลากิจ', status: 'approved' }
    expect(eventTitle(approved)).not.toContain(PENDING_LABEL)
    expect(eventColors('approved').backgroundColor).toBe(APPROVED_COLOR)
    expect(eventColors('approved').textColor).toBe('#ffffff')
  })

  it('labels the two statuses in Thai', () => {
    expect(statusLabel('pending')).toBe('รออนุมัติ')
    expect(statusLabel('approved')).toBe('อนุมัติแล้ว')
    expect(statusLabel('rejected')).toBe('—')
  })
})

describe('access and wiring', () => {
  it('is reachable by employee (approver included) and HR only', () => {
    expect(canOpenPath('employee', '/leave/calendar')).toBe(true)
    expect(canOpenPath('hr', '/leave/calendar')).toBe(true)
    expect(canOpenPath('meeting_controller', '/leave/calendar')).toBe(false)
    expect(canOpenPath('system_admin', '/leave/calendar')).toBe(false)
  })

  it('is registered in the router', () => {
    expect(ROUTER).toContain("path: '/leave/calendar'")
    expect(ROUTER).toContain('LeaveCalendarPage')
  })

  it('appears in the employee/approver menu and the HR menu', () => {
    for (const menu of [leaveNavItems(), hrNavItems()]) {
      const item = menu.find((entry) => entry.to === '/leave/calendar')
      expect(item).toBeDefined()
      expect(item.label).toBe('ปฏิทินการลา')
      expect(item.icon).toBe('calendar_month')
    }
  })

  it('is content only: the layout route supplies the dock for the signed-in role', () => {
    // The page no longer chooses a shell. The leave layout route reads meta.hrDock
    // and shows the HR items when the visitor is HR, so behaviour is unchanged.
    expect(PAGE).not.toContain('AppLayout')
    expect(PAGE).not.toContain('AppDock')
    expect(PAGE).toContain('<LeaveCalendarView')
    expect(PAGE).toContain('isHr')
    expect(ROUTER).toContain('hrDock: true')
    expect(VIEW).toContain("from '@fullcalendar/vue3'")
    expect(VIEW).toContain('/api/leave/calendar?')
    // The range URL now comes from the shared cached loader.
    expect(VIEW).toContain('loaders.leaveHolidays(')
    expect(VIEW).toContain('dataKey.leaveHolidays(')
  })
})
