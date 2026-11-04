// Leave rules: working days, the 365-day cap, every half-day shift, OT, Sundays
// and holidays, and the sick-leave attachment threshold.
// 2026-11-01 is a Sunday, so 2026-11-02 is a Monday.
import { describe, expect, it } from 'vitest'

import {
  MAX_SPAN_DAYS,
  MESSAGES,
  OT,
  NO_OT,
  addDays,
  attachmentRequiredFor,
  computeLeave,
  countWorkingDays,
  isOtherType,
  nextWorkingDay,
  weekdayOf,
} from '../worker/src/leave-rules.js'

const FULL = { code: 'DAY_FULL', is_half: false }
const NIGHT_FULL = { code: 'NIGHT_FULL', is_half: false }
const HALF_AM = { code: 'DAY_HALF_AM', is_half: true }
const HALF_PM = { code: 'DAY_HALF_PM', is_half: true }
const NIGHT_HALF_AM = { code: 'NIGHT_HALF_AM', is_half: true }
const NIGHT_HALF_PM = { code: 'NIGHT_HALF_PM', is_half: true }

describe('working days', () => {
  it('counts Monday to Saturday and never a Sunday', () => {
    // 2026-11-01 (Sun) .. 2026-11-07 (Sat) = 6 working days.
    expect(countWorkingDays('2026-11-01', '2026-11-07')).toBe(6)
    expect(weekdayOf('2026-11-01')).toBe(0)
    expect(countWorkingDays('2026-11-01', '2026-11-01')).toBe(0)
  })

  it('skips a date from the holiday set', () => {
    const holidays = new Set(['2026-11-04'])
    expect(countWorkingDays('2026-11-02', '2026-11-07', holidays)).toBe(5)
    // Tuesday 03 is a working day; Wednesday 04 is the holiday, so the next
    // working day after Tuesday is Thursday 05.
    expect(nextWorkingDay('2026-11-03', holidays)).toBe('2026-11-05')
    expect(nextWorkingDay('2026-11-02', holidays)).toBe('2026-11-03')
  })

  it('moves the return date past Sunday', () => {
    expect(nextWorkingDay('2026-11-07')).toBe('2026-11-09')
    expect(addDays('2026-11-07', 1)).toBe('2026-11-08')
  })

  it('rejects a range that holds no working day', () => {
    const result = computeLeave({ startDate: '2026-11-01', endDate: '2026-11-01', shift: FULL })
    expect(result).toEqual({ ok: false, message: MESSAGES.noWorkingDay })
  })

  it('rejects an end date before the start date', () => {
    const result = computeLeave({ startDate: '2026-11-05', endDate: '2026-11-03', shift: FULL })
    expect(result).toEqual({ ok: false, message: MESSAGES.endBeforeStart })
  })

  it('caps the range at 365 days and allows exactly 365', () => {
    const tooLong = computeLeave({ startDate: '2026-01-01', endDate: '2027-01-02', shift: FULL })
    expect(tooLong).toEqual({ ok: false, message: MESSAGES.spanTooLong })

    const atLimit = computeLeave({ startDate: '2026-01-01', endDate: '2026-12-31', shift: FULL })
    expect(atLimit.ok).toBe(true)
    expect(MAX_SPAN_DAYS).toBe(365)
  })
})

describe('full day', () => {
  it('counts days, sets the return date and 08:00 for a day shift', () => {
    const result = computeLeave({ startDate: '2026-11-02', endDate: '2026-11-03', shift: FULL })
    expect(result).toEqual({
      ok: true,
      days: 2,
      returnDate: '2026-11-04',
      returnTime: '08:00',
      shiftEndOverride: null,
      otOption: NO_OT,
    })
  })

  it('returns at 20:00 for the full night shift', () => {
    const result = computeLeave({ startDate: '2026-11-02', endDate: '2026-11-02', shift: NIGHT_FULL })
    expect(result.ok).toBe(true)
    expect(result.returnTime).toBe('20:00')
    expect(result.shiftEndOverride).toBe(null)
    expect(result.days).toBe(1)
  })

  it('forces "ไม่ OT" on a full day even when the body says OT', () => {
    const result = computeLeave({ startDate: '2026-11-02', endDate: '2026-11-02', shift: FULL, otOption: OT })
    expect(result.otOption).toBe(NO_OT)
  })
})

describe('half day', () => {
  it('DAY_HALF_AM returns the same day at 13:00 and ends 17:00 (OT 20:00)', () => {
    const withoutOt = computeLeave({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      shift: HALF_AM,
      otOption: NO_OT,
    })
    expect(withoutOt).toEqual({
      ok: true,
      days: 0.5,
      returnDate: '2026-11-02',
      returnTime: '13:00',
      shiftEndOverride: '17:00',
      otOption: NO_OT,
    })

    const withOt = computeLeave({
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      shift: HALF_AM,
      otOption: OT,
    })
    expect(withOt.shiftEndOverride).toBe('20:00')
  })

  it('DAY_HALF_PM returns the next working day at 08:00', () => {
    // Friday 2026-11-06 -> Saturday 07 is a working day.
    expect(
      computeLeave({ startDate: '2026-11-06', shift: HALF_PM, otOption: NO_OT })
    ).toMatchObject({
      ok: true,
      days: 0.5,
      returnDate: '2026-11-07',
      returnTime: '08:00',
      shiftEndOverride: '17:00',
    })

    // Saturday 2026-11-07 -> Sunday is skipped, so Monday 09.
    expect(
      computeLeave({ startDate: '2026-11-07', shift: HALF_PM, otOption: NO_OT }).returnDate
    ).toBe('2026-11-09')
  })

  it('NIGHT_HALF_AM returns the next calendar day at 01:00 and ends 05:00 (OT 08:00)', () => {
    expect(
      computeLeave({ startDate: '2026-11-06', shift: NIGHT_HALF_AM, otOption: NO_OT })
    ).toMatchObject({
      ok: true,
      returnDate: '2026-11-07',
      returnTime: '01:00',
      shiftEndOverride: '05:00',
    })

    expect(
      computeLeave({ startDate: '2026-11-06', shift: NIGHT_HALF_AM, otOption: OT })
        .shiftEndOverride
    ).toBe('08:00')
  })

  it('NIGHT_HALF_PM returns the same day at 20:00 and ends 05:00 (OT 08:00)', () => {
    expect(
      computeLeave({ startDate: '2026-11-02', shift: NIGHT_HALF_PM, otOption: NO_OT })
    ).toMatchObject({
      ok: true,
      returnDate: '2026-11-02',
      returnTime: '20:00',
      shiftEndOverride: '05:00',
    })

    expect(
      computeLeave({ startDate: '2026-11-02', shift: NIGHT_HALF_PM, otOption: OT })
        .shiftEndOverride
    ).toBe('08:00')
  })

  it('requires one date only', () => {
    const result = computeLeave({
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      shift: HALF_AM,
      otOption: NO_OT,
    })
    expect(result).toEqual({ ok: false, message: MESSAGES.halfDayRange })
  })

  it('refuses a half day on a Sunday or a holiday', () => {
    expect(
      computeLeave({ startDate: '2026-11-01', shift: HALF_AM, otOption: NO_OT })
    ).toEqual({ ok: false, message: MESSAGES.halfDayNotWorking })

    expect(
      computeLeave({
        startDate: '2026-11-04',
        shift: HALF_AM,
        otOption: NO_OT,
        holidays: new Set(['2026-11-04']),
      })
    ).toEqual({ ok: false, message: MESSAGES.halfDayNotWorking })
  })

  it('requires an OT choice', () => {
    expect(computeLeave({ startDate: '2026-11-02', shift: HALF_AM })).toEqual({
      ok: false,
      message: MESSAGES.otRequired,
    })
    expect(computeLeave({ startDate: '2026-11-02', shift: HALF_AM, otOption: 'maybe' })).toEqual({
      ok: false,
      message: MESSAGES.otRequired,
    })
  })
})

describe('sick leave attachment', () => {
  const sick = { name: 'ลาป่วย', requires_attachment: true, attachment_required_from_days: 3 }
  const personal = { name: 'ลากิจธุระ', requires_attachment: false, attachment_required_from_days: 0 }

  it('needs a certificate from three days, not from two', () => {
    expect(attachmentRequiredFor(sick, 2)).toBe(false)
    expect(attachmentRequiredFor(sick, 3)).toBe(true)
    expect(attachmentRequiredFor(sick, 5)).toBe(true)
    expect(attachmentRequiredFor(sick, 0.5)).toBe(false)
  })

  it('never requires one for a type that does not need it', () => {
    expect(attachmentRequiredFor(personal, 10)).toBe(false)
    expect(attachmentRequiredFor(null, 3)).toBe(false)
  })

  it('falls back to three days when the threshold is missing', () => {
    expect(attachmentRequiredFor({ requires_attachment: true }, 3)).toBe(true)
    expect(attachmentRequiredFor({ requires_attachment: true }, 2)).toBe(false)
  })

  it('reads the camelCase shape the browser list uses', () => {
    const camel = { name: 'ลาป่วย', requiresAttachment: true, attachmentRequiredFromDays: 3 }
    expect(attachmentRequiredFor(camel, 2)).toBe(false)
    expect(attachmentRequiredFor(camel, 3)).toBe(true)
  })
})

describe('leave types', () => {
  it('treats only "อื่นๆ" as the free-text type', () => {
    expect(isOtherType({ name: 'อื่นๆ' })).toBe(true)
    expect(isOtherType({ name: ' อื่นๆ ' })).toBe(true)
    expect(isOtherType({ name: 'ลาป่วย' })).toBe(false)
    expect(isOtherType(null)).toBe(false)
  })
})
