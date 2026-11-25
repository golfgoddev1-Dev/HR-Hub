// The leave form previews days with computeLeave() in the browser; the worker
// recomputes them on submit. Both must give the same answer for the same input,
// so the preview can never promise a day count the server then changes.
// 2026-11-01 is a Sunday; 2026-11-02 is a Monday.
import { describe, expect, it } from 'vitest'

import { NO_OT, OT, computeLeave } from '../worker/src/leave-rules.js'

// Page: shift rows from the API (camelCase isHalf), holidays a Set, endDate
// collapsed to the start for a half day (LeaveRequestPage.vue preview).
function asPage({ startDate, endDate, shift, otOption, holidayDates }) {
  const half = shift.isHalf === true
  return computeLeave({
    startDate,
    endDate: half ? startDate : endDate || startDate,
    shift,
    otOption,
    holidays: new Set(holidayDates),
  })
}

// Worker: shift rows from the database (snake_case is_half), holidays a Set built
// from readHolidays().dates (routes/leave.js POST).
function asWorker({ startDate, endDate, shift, otOption, holidayDates }) {
  return computeLeave({
    startDate,
    endDate: endDate === undefined || endDate === null ? startDate : endDate,
    shift: { code: shift.code, is_half: shift.isHalf === true },
    otOption,
    holidays: new Set(holidayDates),
  })
}

const SHIFTS = [
  { code: 'DAY_FULL', isHalf: false },
  { code: 'NIGHT_FULL', isHalf: false },
  { code: 'DAY_HALF_AM', isHalf: true },
  { code: 'DAY_HALF_PM', isHalf: true },
  { code: 'NIGHT_HALF_AM', isHalf: true },
  { code: 'NIGHT_HALF_PM', isHalf: true },
]

describe('page and worker compute the same leave', () => {
  for (const shift of SHIFTS) {
    for (const otOption of [OT, NO_OT]) {
      it(`${shift.code} / ${otOption}`, () => {
        const input = { startDate: '2026-11-02', endDate: '2026-11-02', shift, otOption, holidayDates: [] }
        const page = asPage(input)
        expect(page.ok).toBe(true)
        expect(asWorker(input)).toEqual(page)
      })
    }
  }

  it('multi-day range over a Sunday and a holiday', () => {
    const input = {
      startDate: '2026-11-02',
      endDate: '2026-11-09',
      shift: SHIFTS[0],
      otOption: NO_OT,
      holidayDates: ['2026-11-04'],
    }
    const page = asPage(input)
    // Mon..Sat minus the Wednesday holiday = 5, plus the next Monday = 6.
    expect(page.days).toBe(6)
    expect(asWorker(input)).toEqual(page)
  })

  it('holiday days are excluded and moved past for the return date', () => {
    const base = { startDate: '2026-11-02', endDate: '2026-11-03', shift: SHIFTS[0], otOption: NO_OT }
    const without = asPage({ ...base, holidayDates: [] })
    const withHoliday = asPage({ ...base, holidayDates: ['2026-11-03'] })
    expect(without.days).toBe(2)
    expect(withHoliday.days).toBe(1)
    expect(withHoliday.returnDate).toBe('2026-11-04')
    expect(asWorker({ ...base, holidayDates: ['2026-11-03'] })).toEqual(withHoliday)
  })

  it('a range that is only a holiday is refused the same way', () => {
    const input = { startDate: '2026-11-03', endDate: '2026-11-03', shift: SHIFTS[0], otOption: NO_OT, holidayDates: ['2026-11-03'] }
    const page = asPage(input)
    expect(page.ok).toBe(false)
    expect(asWorker(input)).toEqual(page)
  })

  it('range edge: 365 days is accepted, 366 is refused, on both sides', () => {
    const ok = { startDate: '2026-01-01', endDate: '2026-12-31', shift: SHIFTS[0], otOption: NO_OT, holidayDates: [] }
    const tooLong = { ...ok, endDate: '2027-01-01' }
    expect(asPage(ok).ok).toBe(true)
    expect(asWorker(ok)).toEqual(asPage(ok))
    expect(asPage(tooLong).ok).toBe(false)
    expect(asWorker(tooLong)).toEqual(asPage(tooLong))
  })

  it('end before start is refused on both sides', () => {
    const input = { startDate: '2026-11-05', endDate: '2026-11-04', shift: SHIFTS[0], otOption: NO_OT, holidayDates: [] }
    expect(asPage(input).ok).toBe(false)
    expect(asWorker(input)).toEqual(asPage(input))
  })

  it('a half day on a holiday is refused on both sides', () => {
    const input = { startDate: '2026-11-03', endDate: '2026-11-03', shift: SHIFTS[2], otOption: NO_OT, holidayDates: ['2026-11-03'] }
    expect(asPage(input).ok).toBe(false)
    expect(asWorker(input)).toEqual(asPage(input))
  })
})
