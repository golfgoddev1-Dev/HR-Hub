// The phone month grid: one pill per cell, no event dots or "+N" text, short
// weekday labels, and Thai aria-labels built from the visible day counts.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_PILL_COUNT,
  MOBILE_CALENDAR_BREAKPOINT,
  PILL_OVERFLOW_TEXT,
  SHORT_THAI_WEEKDAYS,
  dayAriaLabel,
  dayIndicator,
  dayStatusCounts,
  pillCount,
} from '../src/lib/leave-calendar-mobile.js'

const VIEW = readFileSync(
  new URL('../src/components/LeaveCalendarView.vue', import.meta.url),
  'utf8'
)
const CSS = VIEW.slice(VIEW.indexOf('<style scoped>'))

function event(overrides = {}) {
  return {
    id: 'r1',
    employeeName: 'นาย สมชาย ใจดี',
    departmentName: 'ฝ่ายบุคคล',
    leaveTypeLabel: 'ลาป่วย',
    status: 'approved',
    startDate: '2026-11-06',
    endDate: '2026-11-06',
    ...overrides,
  }
}

describe('the pill count', () => {
  it('is nothing at zero, the number up to nine, then 9+', () => {
    expect(pillCount(0)).toBe('')
    expect(pillCount(1)).toBe('1')
    expect(pillCount(9)).toBe('9')
    expect(pillCount(MAX_PILL_COUNT + 1)).toBe(PILL_OVERFLOW_TEXT)
    expect(pillCount(42)).toBe('9+')
    expect(pillCount(-3)).toBe('')
    expect(pillCount('many')).toBe('')
  })

  it('uses the approved colour when both statuses are present', () => {
    expect(dayIndicator({ approved: 3, pending: 2 })).toEqual({
      pill: { tone: 'approved', text: '3' },
      holiday: false,
    })
  })

  it('uses the pending colour when only pending leave is present', () => {
    expect(dayIndicator({ pending: 2 })).toEqual({
      pill: { tone: 'pending', text: '2' },
      holiday: false,
    })
  })

  it('shows nothing for an empty day, but keeps a holiday marker', () => {
    expect(dayIndicator()).toEqual({ pill: null, holiday: false })
    expect(dayIndicator({ holiday: true })).toEqual({ pill: null, holiday: true })
    expect(dayIndicator({ approved: 1, holiday: true })).toEqual({
      pill: { tone: 'approved', text: '1' },
      holiday: true,
    })
  })
})

describe('the visible day counts', () => {
  it('counts people, not records, and keeps statuses apart', () => {
    const counts = dayStatusCounts(
      [
        event(),
        event({ id: 'r2' }),
        event({ id: 'r3', status: 'pending', employeeName: 'นาง สมหญิง' }),
        event({ id: 'r4', status: 'rejected' }),
      ],
      '2026-11-06'
    )

    expect(counts).toEqual({ approved: 1, pending: 1 })
  })

  it('counts a multi-day request on every day it covers', () => {
    const events = [event({ endDate: '2026-11-08', days: 3 })]

    expect(dayStatusCounts(events, '2026-11-06').approved).toBe(1)
    expect(dayStatusCounts(events, '2026-11-07').approved).toBe(1)
    expect(dayStatusCounts(events, '2026-11-08').approved).toBe(1)
    expect(dayStatusCounts(events, '2026-11-09').approved).toBe(0)
  })

  it('ignores holidays, invalid dates and unusable spans', () => {
    expect(dayStatusCounts([event({ kind: 'holiday', status: undefined })], '2026-11-06')).toEqual({
      approved: 0,
      pending: 0,
    })
    expect(dayStatusCounts([event({ startDate: '2026-11-08', endDate: '2026-11-06' })], '2026-11-07')).toEqual({
      approved: 0,
      pending: 0,
    })
    expect(dayStatusCounts([event()], '2026-02-30')).toEqual({ approved: 0, pending: 0 })
  })
})

describe('the Thai day label', () => {
  it('names the full date and the visible people count', () => {
    expect(dayAriaLabel('2026-11-06', { approved: 3 })).toBe(
      '6 พฤศจิกายน 2569 มีผู้ลา 3 คน'
    )
  })

  it('says nobody is on leave for an empty day', () => {
    expect(dayAriaLabel('2026-11-06', { approved: 0, pending: 0 })).toBe(
      '6 พฤศจิกายน 2569 ไม่มีผู้ลา'
    )
  })

  it('mentions pending leave instead of claiming an empty day', () => {
    expect(dayAriaLabel('2026-11-06', { pending: 2 })).toBe(
      '6 พฤศจิกายน 2569 มีผู้ลารออนุมัติ 2 คน'
    )
  })
})

describe('the phone markup', () => {
  it('uses the short Thai weekday labels', () => {
    expect(SHORT_THAI_WEEKDAYS).toEqual(['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'])
    expect(VIEW).toContain('SHORT_THAI_WEEKDAYS[arg.date.getDay()]')
    expect(MOBILE_CALENDAR_BREAKPOINT).toBe(768)
    expect(VIEW).toContain('width.value < MOBILE_CALENDAR_BREAKPOINT')
  })

  it('turns off event rendering and the "+N" link on phones', () => {
    expect(VIEW).toContain('events: isPhone.value ? [] : events.value')
    expect(VIEW).toContain('dayMaxEvents: isPhone.value ? false : true')
    expect(VIEW).toContain('headerToolbar: isPhone.value ? false')
    expect(VIEW).not.toContain('renderDotEvent')
    expect(VIEW).not.toContain('day-count')
    expect(VIEW).not.toContain('syncDayBadges')
    expect(VIEW).not.toContain('fc-daygrid-more-link')
    expect(VIEW).not.toContain('เพิ่มเติม')
  })

  it('renders one custom cell with a pill and a holiday bar', () => {
    expect(VIEW).toContain('dayCellContent: isPhone.value ? renderPhoneDayCell : undefined')
    expect(VIEW).toContain("wrap.className = 'day-cell'")
    expect(VIEW).toContain('day-pill day-pill--')
    expect(VIEW).toContain("bar.className = 'day-holiday-bar'")
    // The name is not in the cell; the day panel shows it.
    expect(VIEW).toContain('holidayNameOn(key)')
    expect(VIEW).toContain('dayPanel.holiday')
    expect(CSS).toContain(':deep(.day-pill--approved)')
    expect(CSS).toContain(':deep(.day-pill--pending)')
    expect(CSS).toContain(':deep(.fc .fc-day-other .day-pill)')
  })

  it('gives every day a Thai aria-label and keeps the tap handler', () => {
    expect(VIEW).toContain('dayAriaLabel(date, {')
    expect(VIEW).toContain('approved: Number(dayCounts.value[date] ?? 0)')
    expect(VIEW).toContain("el.addEventListener('click', open)")
    expect(VIEW).toContain("el.addEventListener('keydown'")
    expect(VIEW).toContain('navLinks: false')
    expect(VIEW).toContain('openDayPanel(date, el)')
  })

  it('has a single-row toolbar with Thai icon labels and 44px controls', () => {
    expect(VIEW).toContain('aria-label="เดือนก่อนหน้า"')
    expect(VIEW).toContain('aria-label="เดือนถัดไป"')
    expect(VIEW).toContain('>chevron_left<')
    expect(VIEW).toContain('>chevron_right<')
    expect(VIEW).toContain('class="cal-toolbar-today"')
    expect(CSS).toContain('min-height: 44px')
    expect(CSS).toContain('min-height: 56px')
  })

  it('keeps the legend and the reduced-motion rule', () => {
    expect(VIEW).toContain('อนุมัติแล้ว')
    expect(VIEW).toContain('รออนุมัติ')
    expect(VIEW).toContain('วันหยุด')
    expect(CSS).toContain('prefers-reduced-motion: reduce')
    expect(CSS).not.toContain('@import')
  })
})
