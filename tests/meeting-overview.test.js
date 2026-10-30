import { describe, expect, it } from 'vitest'
import {
  countByStatus,
  findPending,
  sessionPhase,
  STATUS_LABEL_BY_CODE,
} from '../server/meeting-overview.js'

describe('countByStatus', () => {
  it('counts known codes and only totals unknown ones', () => {
    const counts = countByStatus([
      { status_code: 'attended' },
      { status_code: 'attended' },
      { status_code: 'leave' },
      { status_code: 'urgent_busy' },
      { status_code: 'not_attended' },
      { status_code: 'unknown_code' },
      {},
    ])
    expect(counts).toEqual({
      attended: 2,
      not_attended: 1,
      urgent_busy: 1,
      leave: 1,
      total: 6,
    })
  })

  it('returns zeroed counts for no rows', () => {
    expect(countByStatus([])).toEqual({
      attended: 0,
      not_attended: 0,
      urgent_busy: 0,
      leave: 0,
      total: 0,
    })
  })

  it('keeps the Thai labels for every known code', () => {
    expect(STATUS_LABEL_BY_CODE).toEqual({
      attended: 'เข้าร่วมประชุม',
      not_attended: 'ไม่เข้าร่วม',
      urgent_busy: 'ติดงานด่วน',
      leave: 'ลาประชุม',
    })
  })
})

describe('findPending', () => {
  const roster = [
    { employeeId: 'c', fullName: 'สมชาย', departmentName: 'ก', positionName: 'x' },
    { employeeId: 'a', fullName: 'กิตติ', departmentName: 'ข', positionName: 'y' },
    { employeeId: 'b', fullName: 'ปิยะ', departmentName: 'ค', positionName: 'z' },
  ]

  it('excludes registered employees and sorts Thai names', () => {
    const pending = findPending(roster, [{ employee_id: 'a' }])
    expect(pending.map((item) => item.employeeId)).toEqual(['b', 'c'])
    expect(pending.map((item) => item.fullName)).toEqual(['ปิยะ', 'สมชาย'])
  })

  it('returns the full roster when nobody registered', () => {
    expect(findPending(roster, []).map((item) => item.employeeId)).toEqual(['a', 'b', 'c'])
    expect(findPending(roster, null)).toHaveLength(3)
  })
})

describe('sessionPhase', () => {
  it('returns not_open before the open time', () => {
    const now = new Date('2026-10-30T00:30:00Z')
    expect(sessionPhase({ now, openTime: '08:00', cutoffTime: '10:00' })).toBe('not_open')
  })

  it('returns open inside the window', () => {
    const now = new Date('2026-10-30T02:00:00Z')
    expect(sessionPhase({ now, openTime: '08:00', cutoffTime: '10:00' })).toBe('open')
  })

  it('returns closed at the cutoff time', () => {
    const now = new Date('2026-10-30T03:00:00Z')
    expect(sessionPhase({ now, openTime: '08:00', cutoffTime: '10:00' })).toBe('closed')
  })

  it('returns none when a time is missing', () => {
    const now = new Date('2026-10-30T02:00:00Z')
    expect(sessionPhase({ now, openTime: null, cutoffTime: '10:00' })).toBe('none')
    expect(sessionPhase({ now, openTime: '08:00', cutoffTime: null })).toBe('none')
  })
})
