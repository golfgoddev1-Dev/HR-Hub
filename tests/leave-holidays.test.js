// Holidays are read from holidays.holiday_date. A failed read throws, because
// silently counting days without the holidays would over-count leave.
import { describe, expect, it } from 'vitest'

import {
  HOLIDAYS_TABLE,
  HOLIDAYS_UNAVAILABLE,
  holidayDateOf,
  holidaySetOf,
  readHolidays,
} from '../worker/src/leave-holidays.js'

function fakeDb(rows, { error = null } = {}) {
  const calls = []
  return {
    calls,
    async select(table, options) {
      calls.push({ table, options })
      if (error) throw error
      return rows
    },
  }
}

describe('readHolidays', () => {
  it('selects holiday_date and returns the dates', async () => {
    const db = fakeDb([
      { holiday_date: '2026-12-31' },
      { holiday_date: '2026-04-13' },
      { holiday_date: 'not-a-date' },
      { holiday_date: null },
    ])

    const holidays = await readHolidays(db)

    expect(holidays.dates).toEqual(['2026-12-31', '2026-04-13'])
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0].table).toBe(HOLIDAYS_TABLE)
    expect(db.calls[0].options.columns).toBe('holiday_date')
    expect(db.calls[0].options.order).toBe('holiday_date.asc')
    // The old column names must never be requested.
    expect(db.calls[0].options.columns).not.toContain('date,name')
    expect(JSON.stringify(db.calls[0].options)).not.toContain('created_at')
  })

  it('throws when the table cannot be read instead of reporting an empty list', async () => {
    const db = fakeDb([], { error: Object.assign(new Error('boom'), { code: '42P01' }) })
    await expect(readHolidays(db)).rejects.toThrow('boom')
    expect(HOLIDAYS_UNAVAILABLE).toBe('ระบบวันหยุดยังไม่พร้อม กรุณาติดต่อฝ่ายบุคคล')
  })

  it('trims a timestamp-shaped value to its date', async () => {
    const db = fakeDb([{ holiday_date: '2026-12-31T00:00:00+07:00' }])
    const holidays = await readHolidays(db)
    expect(holidays.dates).toEqual(['2026-12-31'])
  })
})

describe('helpers', () => {
  it('drops unusable row values', () => {
    expect(holidayDateOf({ holiday_date: '2026-01-01' })).toBe('2026-01-01')
    expect(holidayDateOf({ holiday_date: '2026-02-30' })).toBe(null)
    expect(holidayDateOf({ holiday_date: 20260101 })).toBe(null)
    expect(holidayDateOf(null)).toBe(null)
  })

  it('builds a set of valid dates only', () => {
    const set = holidaySetOf(['2026-01-01', 'x', '2026-01-02'])
    expect([...set]).toEqual(['2026-01-01', '2026-01-02'])
  })
})
