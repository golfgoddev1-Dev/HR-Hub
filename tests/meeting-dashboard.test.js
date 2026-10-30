import { describe, expect, it } from 'vitest'
import {
  bangkokDayKey,
  countByStatus,
  deptSummary,
  historyKeys,
  latestPerEmployee,
  rateOf,
  thaiDateLabel,
  thaiMonthLabel,
  topAbsentPerDept,
} from '../server/meeting-dashboard.js'

describe('bangkokDayKey', () => {
  it('uses the Bangkok calendar day across midnight UTC', () => {
    expect(bangkokDayKey(new Date('2026-10-30T18:00:00Z'))).toBe('2026-10-31')
  })

  it('keeps the same day late in the Bangkok evening', () => {
    expect(bangkokDayKey(new Date('2026-10-31T16:59:00Z'))).toBe('2026-10-31')
  })
})

describe('thai labels', () => {
  it('formats a day key with the Thai weekday and Buddhist year', () => {
    expect(thaiDateLabel('2026-11-03')).toBe('วันอังคาร 3 พ.ย. 2569')
  })

  it('formats a month key', () => {
    expect(thaiMonthLabel('2026-11')).toBe('พ.ย. 2569')
  })
})

describe('latestPerEmployee', () => {
  it('keeps the newest registration row per employee', () => {
    const rows = [
      { employee_id: 'a', status_code: 'not_attended', registered_at: '2026-10-01T02:00:00Z' },
      { employee_id: 'a', status_code: 'attended', registered_at: '2026-10-01T03:00:00Z' },
      { employee_id: 'b', status_code: 'leave', registered_at: '2026-10-01T01:00:00Z' },
    ]
    const latest = latestPerEmployee(rows)
    expect(latest).toHaveLength(2)
    expect(latest.find((row) => row.employee_id === 'a').status_code).toBe('attended')
    expect(latest.find((row) => row.employee_id === 'b').status_code).toBe('leave')
  })

  it('ignores rows without an employee id', () => {
    expect(latestPerEmployee([{ status_code: 'attended' }])).toEqual([])
    expect(latestPerEmployee(undefined)).toEqual([])
  })
})

describe('countByStatus', () => {
  it('counts only known status codes but counts unknown codes in the total', () => {
    const counts = countByStatus([
      { status_code: 'attended' },
      { status_code: 'attended' },
      { status_code: 'leave' },
      { status_code: 'unknown_code' },
    ])
    expect(counts).toEqual({
      attended: 2,
      not_attended: 0,
      urgent_busy: 0,
      leave: 1,
      total: 4,
    })
  })

  it('returns zeroes for an empty list', () => {
    expect(countByStatus([])).toEqual({
      attended: 0,
      not_attended: 0,
      urgent_busy: 0,
      leave: 0,
      total: 0,
    })
  })
})

describe('rateOf', () => {
  it('returns zero when the total is zero', () => {
    expect(rateOf(0, 0)).toBe(0)
  })

  it('returns a fraction between zero and one', () => {
    expect(rateOf(3, 4)).toBe(0.75)
    expect(rateOf(9, 4)).toBe(1)
  })
})

describe('historyKeys', () => {
  it('returns twelve Tuesdays ending at the selected day, ascending', () => {
    const keys = historyKeys({
      code: 'sup',
      mode: 'day',
      value: '2026-11-03',
      availableKeys: ['2026-11-03'],
    })
    expect(keys).toHaveLength(12)
    expect(keys[0]).toBe('2026-08-18')
    expect(keys[11]).toBe('2026-11-03')
    expect([...keys].sort()).toEqual(keys)
    for (const key of keys) {
      expect(new Date(`${key}T00:00:00Z`).getUTCDay()).toBe(2)
    }
  })

  it('uses the latest cycle with data when no day is selected', () => {
    const keys = historyKeys({
      code: 'sup',
      mode: 'day',
      value: '',
      availableKeys: ['2026-10-13', '2026-10-20'],
    })
    expect(keys[keys.length - 1]).toBe('2026-10-20')
    expect(keys[0]).toBe('2026-08-04')
  })

  it('returns the twelve months ending at the selected month for monthly day mode', () => {
    const keys = historyKeys({
      code: 'monthly',
      mode: 'day',
      value: '2026-03',
      availableKeys: ['2026-03'],
    })
    expect(keys).toHaveLength(12)
    expect(keys[0]).toBe('2025-04')
    expect(keys[11]).toBe('2026-03')
  })

  it('lists only months with data up to the value for month mode', () => {
    const keys = historyKeys({
      code: 'monthly',
      mode: 'month',
      value: '2026-03',
      availableKeys: ['2026-01', '2026-03', '2026-05'],
    })
    expect(keys).toEqual(['2026-01', '2026-03'])
  })

  it('lists the months of the selected year that have data for year mode', () => {
    const keys = historyKeys({
      code: 'monthly',
      mode: 'year',
      value: '2026',
      availableKeys: ['2025-12', '2026-02', '2026-01'],
    })
    expect(keys).toEqual(['2026-01', '2026-02'])
  })

  it('returns nothing when there is no data and no selected value', () => {
    expect(historyKeys({ code: 'monthly', mode: 'month', value: '', availableKeys: [] })).toEqual([])
    expect(historyKeys({ code: 'sup', mode: 'day', value: '', availableKeys: [] })).toEqual([])
  })
})

describe('deptSummary', () => {
  it('sorts by notYet descending and then by department name', () => {
    const roster = [
      { employeeId: 'a', departmentName: 'กอง' },
      { employeeId: 'b', departmentName: 'กอง' },
      { employeeId: 'c', departmentName: 'ขวัญ' },
      { employeeId: 'd', departmentName: 'ขวัญ' },
      { employeeId: 'e', departmentName: 'คง' },
    ]
    const latestRows = [
      { employee_id: 'a', status_code: 'attended' },
      { employee_id: 'c', status_code: 'attended' },
      { employee_id: 'd', status_code: 'not_attended' },
    ]
    const summary = deptSummary(roster, latestRows)
    expect(summary.map((row) => row.name)).toEqual(['กอง', 'คง', 'ขวัญ'])
    expect(summary[0]).toEqual({
      name: 'กอง',
      total: 2,
      registered: 1,
      notYet: 1,
      attended: 1,
      rate: 0.5,
    })
    expect(summary[1].notYet).toBe(1)
    expect(summary[2].notYet).toBe(0)
    expect(summary[2].attended).toBe(1)
    expect(summary[2].rate).toBe(0.5)
  })
})

describe('topAbsentPerDept', () => {
  it('picks the highest count per department and status, breaking ties by name', () => {
    const top = topAbsentPerDept([
      { dept: 'กอง', name: 'กิตติ', status: 'not_attended', count: 2 },
      { dept: 'กอง', name: 'สมชาย', status: 'not_attended', count: 2 },
      { dept: 'กอง', name: 'สมชาย', status: 'leave', count: 1 },
    ])
    expect(top).toHaveLength(3)
    expect(top[0]).toEqual({ dept: 'กอง', status: 'not_attended', name: 'กิตติ', count: 2 })
    expect(top[1]).toEqual({ dept: 'กอง', status: 'urgent_busy', name: '', count: 0 })
    expect(top[2]).toEqual({ dept: 'กอง', status: 'leave', name: 'สมชาย', count: 1 })
  })

  it('shows an empty name when the count is zero', () => {
    const top = topAbsentPerDept([{ dept: 'กอง', name: 'กิตติ', status: 'not_attended', count: 0 }])
    expect(top[0]).toEqual({ dept: 'กอง', status: 'not_attended', name: '', count: 0 })
  })

  it('returns an empty list when there are no rows', () => {
    expect(topAbsentPerDept([])).toEqual([])
    expect(topAbsentPerDept(undefined)).toEqual([])
  })
})
