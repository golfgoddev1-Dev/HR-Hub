// The calendar day panel: counts are people, not records; a multi-day request
// appears on every day; dates are string-only; the Intl heading is Bangkok; and
// the modal markup carries the required accessibility and responsive pieces.

import { describe, expect, it } from 'vitest'

import {
  DAY_PANEL_EMPTY,
  buildDayRows,
  dayCountLabel,
  formatThaiDayHeading,
  groupDayRows,
  toDetailRequest,
} from '../src/lib/leave-day.js'

import { readSource } from './helpers/read-source.js'

const VIEW = readSource(
  new URL('../src/components/LeaveCalendarView.vue', import.meta.url)
)
const DETAIL = readSource(
  new URL('../src/components/LeaveRequestDetail.vue', import.meta.url)
)

const EVENTS = [
  {
    id: 'r1',
    employeeName: 'นาย สมชาย ใจดี',
    departmentName: 'ฝ่ายบุคคล',
    leaveTypeLabel: 'ลาป่วย',
    status: 'approved',
    startDate: '2026-11-06',
    endDate: '2026-11-08',
  },
  {
    id: 'r2',
    employeeName: 'นาง สมหญิง รักงาน',
    departmentName: 'ฝ่ายขาย',
    leaveTypeLabel: 'ลากิจ',
    status: 'approved',
    startDate: '2026-11-06',
    endDate: '2026-11-06',
  },
  {
    id: 'r3',
    employeeName: 'นาย สมชาย ใจดี',
    departmentName: 'ฝ่ายบุคคล',
    leaveTypeLabel: 'ลาป่วย',
    status: 'approved',
    startDate: '2026-11-06',
    endDate: '2026-11-06',
  },
  {
    id: 'r4',
    employeeName: 'นาย รออนุมัติ',
    departmentName: 'ฝ่ายบุคคล',
    leaveTypeLabel: 'ลากิจ',
    status: 'pending',
    startDate: '2026-11-06',
    endDate: '2026-11-06',
  },
  {
    id: 'holiday',
    kind: 'holiday',
    name: 'วันหยุด',
    startDate: '2026-11-06',
    endDate: '2026-11-06',
  },
]

describe('the day list', () => {
  it('counts distinct people and ignores pending leave and holidays', () => {
    const rows = buildDayRows({ events: EVENTS, date: '2026-11-06' })

    // Two approved people: the duplicate row and the pending row add nobody.
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.employeeName).sort()).toEqual([
      'นาง สมหญิง รักงาน',
      'นาย สมชาย ใจดี',
    ])
    expect(dayCountLabel(rows.length)).toBe('ลาวันนี้ 2 คน')
  })

  it('shows the same person on every day their multi-day leave covers', () => {
    expect(buildDayRows({ events: EVENTS, date: '2026-11-07' })).toHaveLength(1)
    expect(buildDayRows({ events: EVENTS, date: '2026-11-08' })).toHaveLength(1)
    expect(buildDayRows({ events: EVENTS, date: '2026-11-09' })).toHaveLength(0)
  })

  it('groups departments and names with the Thai collator', () => {
    const groups = groupDayRows(buildDayRows({ events: EVENTS, date: '2026-11-06' }))

    expect(groups.map((group) => group.department)).toEqual(['ฝ่ายขาย', 'ฝ่ายบุคคล'])
    expect(groups[1].rows.map((row) => row.employeeName)).toEqual(['นาย สมชาย ใจดี'])
  })

  it('survives missing input and uses the empty-state text', () => {
    expect(buildDayRows()).toEqual([])
    expect(buildDayRows({ events: null, date: '2026-11-06' })).toEqual([])
    expect(buildDayRows({ events: EVENTS, date: '2026-02-30' })).toEqual([])
    expect(DAY_PANEL_EMPTY).toBe('ไม่มีผู้ลาในวันนี้')
  })

  it('keeps a date-only key on the same calendar day at a year boundary', () => {
    const rows = buildDayRows({
      events: [
        {
          id: 'new-year',
          employeeName: 'นาย ก',
          departmentName: 'ฝ่ายบุคคล',
          status: 'approved',
          startDate: '2026-12-31',
          endDate: '2027-01-01',
        },
      ],
      date: '2027-01-01',
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].startDate).toBe('2026-12-31')
  })
})

describe('the Intl heading', () => {
  it('is the full Thai date in the Buddhist year', () => {
    const heading = formatThaiDayHeading('2025-12-06')

    expect(heading).toContain('วันเสาร์')
    expect(heading).toContain('6')
    expect(heading).toContain('ธันวาคม')
    expect(heading).toContain('2568')
    expect(heading).not.toContain('2025')
  })

  it('does not shift 1 January to the previous year', () => {
    const heading = formatThaiDayHeading('2026-01-01')

    expect(heading).toContain('1')
    expect(heading).toContain('มกราคม')
    expect(heading).toContain('2569')
  })

  it('returns an empty string for an unusable date', () => {
    expect(formatThaiDayHeading('2026-02-30')).toBe('')
    expect(formatThaiDayHeading('')).toBe('')
  })
})

describe('the shared detail shape', () => {
  it('maps a calendar row onto the approval-detail field names', () => {
    const event = {
      ...EVENTS[0],
      detail: {
        requestCode: 'LV-0001',
        employeeCode: 'EMP-00001',
        days: 3,
        reason: 'ปวดหัว',
        hasMedicalCertificate: true,
      },
    }
    const request = toDetailRequest(event)

    expect(request.requestCode).toBe('LV-0001')
    expect(request.requester).toMatchObject({
      fullName: 'นาย สมชาย ใจดี',
      employeeCode: 'EMP-00001',
      departmentName: 'ฝ่ายบุคคล',
    })
    expect(request.reason).toBe('ปวดหัว')
    expect(request.leaveTypeName).toBe('ลาป่วย')
  })

  it('shows the reason in the detail only, never in the panel header', () => {
    expect(DETAIL).toContain('request.reason')
    expect(VIEW).not.toContain('selected.reason')
  })
})

describe('the panel markup and behaviour', () => {
  it('is a modal dialog with a sticky header and a scrolling body', () => {
    expect(VIEW).toContain('role="dialog"')
    expect(VIEW).toContain('aria-modal="true"')
    expect(VIEW).toContain('aria-labelledby="day-panel-title"')
    expect(VIEW).toContain('class="day-panel-head"')
    expect(VIEW).toContain('position: sticky')
    expect(VIEW).toContain('max-height: 80vh')
    expect(VIEW).toContain('overflow-y: auto')
  })

  it('is a bottom sheet below 768px and centred above it', () => {
    const css = VIEW.slice(VIEW.indexOf('<style scoped>'))
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'))

    expect(phone).toContain('align-items: flex-end')
    expect(phone).toContain('border-radius: 16px 16px 0 0')
    expect(css.slice(0, css.indexOf('@media (max-width: 767px)'))).toContain(
      'align-items: center'
    )
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(phone).toContain('animation: day-panel-rise')
  })

  it('opens from a day cell without a network request', () => {
    expect(VIEW).toContain('buildDayRows({ events: leaveEvents.value, date: key })')
    expect(VIEW).toContain('openDayPanel(date, el)')
    expect(VIEW).toContain('dayCellDidMount: decorateDayCell')
    // The day panel adds no API call: only the calendar and holiday loaders.
    const urls = [...VIEW.matchAll(/\/api\/[a-z/]+/g)].map((match) => match[0])
    expect(new Set(urls)).toEqual(new Set(['/api/leave/calendar']))
  })

  it('closes on Escape and returns focus to the day cell', () => {
    expect(VIEW).toContain("if (event.key === 'Escape')")
    expect(VIEW).toContain('closeDayPanel()')
    expect(VIEW).toContain('lastDayCell = cell ??')
    expect(VIEW).toContain('target.focus()')
    expect(VIEW).toContain('focus()')
    expect(VIEW).toContain("if (event.key !== 'Tab') return")
  })

  it('renders one phone pill instead of a floating badge or event dots', () => {
    expect(VIEW).toContain('day-pill day-pill--')
    expect(VIEW).toContain('day-holiday-bar')
    expect(VIEW).not.toContain('day-count')
    expect(VIEW).not.toContain('syncDayBadges')
    expect(VIEW).not.toContain('renderDotEvent')
  })

  it('keeps 44px targets and a visible focus ring', () => {
    expect(VIEW).toContain('min-height: 44px')
    expect(VIEW).toContain('outline: 3px solid #10504e')
    expect(VIEW).toContain('.day-panel-close:focus-visible')
  })
})
