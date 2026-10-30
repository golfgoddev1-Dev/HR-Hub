import { describe, expect, it } from 'vitest'
import { STATUS_CODE_BY_LABEL, statusCodeFromLabel } from '../server/attendance-status.js'

describe('statusCodeFromLabel', () => {
  it('maps each attendance label to its attendance_statuses code', () => {
    expect(statusCodeFromLabel('เข้าร่วมประชุม')).toBe('attended')
    expect(statusCodeFromLabel('ไม่เข้าร่วม')).toBe('not_attended')
    expect(statusCodeFromLabel('ติดงานด่วน')).toBe('urgent_busy')
    expect(statusCodeFromLabel('ลาประชุม')).toBe('leave')
  })

  it('exposes the same four labels in the mapping', () => {
    expect(Object.keys(STATUS_CODE_BY_LABEL)).toEqual([
      'เข้าร่วมประชุม',
      'ไม่เข้าร่วม',
      'ติดงานด่วน',
      'ลาประชุม',
    ])
  })

  it('returns null for an unknown label', () => {
    expect(statusCodeFromLabel('มาสาย')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(statusCodeFromLabel('')).toBeNull()
  })
})
