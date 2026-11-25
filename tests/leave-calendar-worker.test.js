// Direct tests of the worker's pure calendar helpers and the date primitives
// they rely on (isDateString, spanDays), plus holiday row normalisation.
import { describe, expect, it } from 'vitest'

import {
  CALENDAR_MAX_RANGE_DAYS,
  CALENDAR_MESSAGES,
  addCalendarDays,
  buildDayCounts,
  chunksOf,
  displayName,
  parseCalendarRange,
  publicCalendarEvent,
} from '../worker/src/leave-calendar.js'
import { holidayRowOf, holidaySetOf, readHolidayRows } from '../worker/src/leave-holidays.js'
import { isDateString, spanDays } from '../worker/src/leave-rules.js'

const range = (query) => parseCalendarRange(new URLSearchParams(query))

describe('isDateString / spanDays', () => {
  it('accepts real dates, including a leap day', () => {
    expect(isDateString('2026-11-02')).toBe(true)
    expect(isDateString('2028-02-29')).toBe(true)
  })

  it('rejects impossible, malformed and non-string values', () => {
    for (const value of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-31', '2026-1-2', '2026/11/02', '', null, undefined, 20261102]) {
      expect(isDateString(value)).toBe(false)
    }
  })

  it('counts inclusively', () => {
    expect(spanDays('2026-11-02', '2026-11-02')).toBe(1)
    expect(spanDays('2026-11-02', '2026-11-08')).toBe(7)
    expect(spanDays('2026-02-28', '2026-03-01')).toBe(2)
    expect(spanDays('2026-11-05', '2026-11-04')).toBe(0)
  })
})

describe('parseCalendarRange', () => {
  it('reads from, to and a trimmed department', () => {
    expect(range('from=2026-11-01&to=2026-11-30&departmentId=%20d1%20')).toEqual({
      ok: true, from: '2026-11-01', to: '2026-11-30', departmentId: 'd1',
    })
    expect(range('from=2026-11-01&to=2026-11-30').departmentId).toBeNull()
  })

  it('refuses missing or invalid dates', () => {
    for (const query of ['', 'from=2026-11-01', 'to=2026-11-01', 'from=2026-02-30&to=2026-03-01', 'from=x&to=y']) {
      expect(range(query)).toEqual({ ok: false, message: CALENDAR_MESSAGES.dateFormat })
    }
  })

  it('refuses an end before the start', () => {
    expect(range('from=2026-11-05&to=2026-11-04').message).toBe(CALENDAR_MESSAGES.endBeforeStart)
  })

  it('allows exactly 62 days and refuses 63', () => {
    expect(CALENDAR_MAX_RANGE_DAYS).toBe(62)
    expect(range('from=2026-11-01&to=2027-01-01').ok).toBe(true) // 62 days inclusive
    expect(range('from=2026-11-01&to=2027-01-02').message).toBe(CALENDAR_MESSAGES.rangeTooLong)
  })
})

describe('calendar helpers', () => {
  it('addCalendarDays crosses month and year, and refuses bad input', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addCalendarDays('nope', 1)).toBe('')
    expect(addCalendarDays('2026-11-01', 1.5)).toBe('')
  })

  it('buildDayCounts counts distinct approved people per day', () => {
    const counts = buildDayCounts([
      { employee_id: 'a', status: 'approved', start_date: '2026-11-02', end_date: '2026-11-03' },
      { employee_id: 'a', status: 'approved', start_date: '2026-11-03', end_date: '2026-11-03' },
      { employee_id: 'b', status: 'approved', start_date: '2026-11-03', end_date: '2026-11-03' },
      { employee_id: 'c', status: 'pending', start_date: '2026-11-03', end_date: '2026-11-03' },
      { employee_id: 'd', status: 'approved', start_date: '2026-11-05', end_date: '2026-11-04' },
      { employee_id: '', status: 'approved', start_date: '2026-11-03', end_date: '2026-11-03' },
      null,
    ])
    expect(counts).toEqual({ '2026-11-02': 1, '2026-11-03': 2 })
    expect(buildDayCounts(undefined)).toEqual({})
  })

  it('buildDayCounts stops a malformed multi-year row at 64 days', () => {
    const counts = buildDayCounts([{ employee_id: 'a', status: 'approved', start_date: '2020-01-01', end_date: '2030-01-01' }])
    expect(Object.keys(counts)).toHaveLength(64)
  })

  it('chunksOf splits and falls back to 100 for a bad size', () => {
    expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunksOf(Array.from({ length: 101 }, (_, i) => i), 0)).toHaveLength(2)
    expect(chunksOf(null)).toEqual([])
  })

  it('displayName joins prefix and name, and is empty without a name', () => {
    expect(displayName(' นาย ', ' สมชาย ')).toBe('นาย สมชาย')
    expect(displayName(null, 'สมชาย')).toBe('สมชาย')
    expect(displayName('นาย', '  ')).toBe('')
  })

  it('publicCalendarEvent exposes only the allowed keys', () => {
    const event = publicCalendarEvent({
      id: 1, employeeName: 'x', status: 'approved', startDate: '2026-11-02', endDate: '2026-11-02', reason: 'secret',
    })
    expect(Object.keys(event).sort()).toEqual(['departmentName', 'employeeName', 'endDate', 'id', 'leaveTypeLabel', 'startDate', 'status'])
    expect(publicCalendarEvent({ id: 1, detail: { days: 1 } }).detail).toEqual({ days: 1 })
  })
})

describe('leave-holidays rows', () => {
  it('holidayRowOf trims timestamps, collapses names and drops bad dates', () => {
    expect(holidayRowOf({ holiday_date: '2026-12-05T00:00:00+00:00', name: '  วัน   พ่อ ' })).toEqual({ date: '2026-12-05', name: 'วัน พ่อ' })
    expect(holidayRowOf({ holiday_date: '2026-12-05' })).toEqual({ date: '2026-12-05', name: null })
    expect(holidayRowOf({ holiday_date: '2026-02-30' })).toBeNull()
    expect(holidayRowOf(null)).toBeNull()
  })

  it('holidaySetOf drops invalid values and tolerates non-arrays', () => {
    expect([...holidaySetOf(['2026-12-05', 'x', '2026-02-30', 5])]).toEqual(['2026-12-05'])
    expect(holidaySetOf(undefined).size).toBe(0)
  })

  it('readHolidayRows applies only valid range bounds and a row limit', async () => {
    const calls = []
    const db = {
      select: async (table, options) => {
        calls.push([table, options])
        return [{ holiday_date: '2026-12-05', name: 'a' }, { holiday_date: 'bad' }]
      },
    }

    const rows = await readHolidayRows(db, { from: '2026-12-01', to: 'nope' })
    expect(rows).toEqual([{ date: '2026-12-05', name: 'a' }])
    expect(calls[0][0]).toBe('holidays')
    expect(calls[0][1].filters).toEqual([['holiday_date', 'gte', '2026-12-01']])
    expect(calls[0][1].limit).toBe(400)

    await readHolidayRows(db)
    expect(calls[1][1].filters).toEqual([])
  })
})
