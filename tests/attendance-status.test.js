import { describe, expect, it } from 'vitest'
import {
  REASON_MAX_LENGTH,
  REASON_STATUS_CODES,
  SHIFT_VALUES,
  STATUS_CODES,
  STATUS_CODE_BY_LABEL,
  normalizeStatusUpdate,
  requiresReason,
  requiresShift,
  statusCodeFromLabel,
} from '../server/attendance-status.js'

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

describe('status rules for a manual status change', () => {
  it('lists exactly the four stored codes', () => {
    expect(STATUS_CODES).toEqual(['attended', 'not_attended', 'urgent_busy', 'leave'])
  })

  it('requires a reason only for urgent_busy and leave', () => {
    expect(REASON_STATUS_CODES).toEqual(['urgent_busy', 'leave'])
    expect(requiresReason('urgent_busy')).toBe(true)
    expect(requiresReason('leave')).toBe(true)
    expect(requiresReason('attended')).toBe(false)
    expect(requiresReason('not_attended')).toBe(false)
  })

  it('requires a shift only for leave', () => {
    expect(requiresShift('leave')).toBe(true)
    expect(requiresShift('urgent_busy')).toBe(false)
    expect(requiresShift('attended')).toBe(false)
    expect(requiresShift('not_attended')).toBe(false)
  })

  it('accepts the two allowed shifts', () => {
    expect(SHIFT_VALUES).toEqual(['กะ A', 'กะ B'])
  })
})

describe('normalizeStatusUpdate', () => {
  it('clears reason and shift for attended', () => {
    expect(normalizeStatusUpdate({ statusCode: 'attended' })).toEqual({
      ok: true,
      value: { status_code: 'attended', reason: null, shift: null },
    })
  })

  it('clears reason and shift for not_attended', () => {
    expect(normalizeStatusUpdate({ statusCode: 'not_attended', reason: '', shift: null })).toEqual({
      ok: true,
      value: { status_code: 'not_attended', reason: null, shift: null },
    })
  })

  it('rejects a reason or shift on the two statuses that do not use them', () => {
    expect(normalizeStatusUpdate({ statusCode: 'attended', reason: 'มีเหตุผล' })).toEqual({ ok: false })
    expect(normalizeStatusUpdate({ statusCode: 'not_attended', shift: 'กะ A' })).toEqual({ ok: false })
  })

  it('trims and keeps the reason for urgent_busy with no shift', () => {
    expect(
      normalizeStatusUpdate({ statusCode: 'urgent_busy', reason: '  ติดงานด่วน  ' }),
    ).toEqual({
      ok: true,
      value: { status_code: 'urgent_busy', reason: 'ติดงานด่วน', shift: null },
    })
  })

  it('rejects urgent_busy without a reason or with a shift', () => {
    expect(normalizeStatusUpdate({ statusCode: 'urgent_busy' })).toEqual({ ok: false })
    expect(normalizeStatusUpdate({ statusCode: 'urgent_busy', reason: '   ' })).toEqual({ ok: false })
    expect(
      normalizeStatusUpdate({ statusCode: 'urgent_busy', reason: 'ติดงานด่วน', shift: 'กะ A' }),
    ).toEqual({ ok: false })
  })

  it('rejects a reason longer than the limit', () => {
    const tooLong = 'ก'.repeat(REASON_MAX_LENGTH + 1)
    expect(normalizeStatusUpdate({ statusCode: 'leave', reason: tooLong, shift: 'กะ A' })).toEqual({
      ok: false,
    })
    const atLimit = 'ก'.repeat(REASON_MAX_LENGTH)
    expect(normalizeStatusUpdate({ statusCode: 'leave', reason: atLimit, shift: 'กะ A' })).toEqual({
      ok: true,
      value: { status_code: 'leave', reason: atLimit, shift: 'กะ A' },
    })
  })

  it('requires a valid shift for leave', () => {
    expect(normalizeStatusUpdate({ statusCode: 'leave', reason: 'ลาป่วย' })).toEqual({ ok: false })
    expect(
      normalizeStatusUpdate({ statusCode: 'leave', reason: 'ลาป่วย', shift: 'กะเช้า' }),
    ).toEqual({ ok: false })
    expect(
      normalizeStatusUpdate({ statusCode: 'leave', reason: 'ลาป่วย', shift: 'กะ B' }),
    ).toEqual({
      ok: true,
      value: { status_code: 'leave', reason: 'ลาป่วย', shift: 'กะ B' },
    })
  })

  it('rejects an unknown status code', () => {
    expect(normalizeStatusUpdate({ statusCode: 'meeting_skipped' })).toEqual({ ok: false })
    expect(normalizeStatusUpdate({ statusCode: 'attended ' })).toEqual({ ok: false })
    expect(normalizeStatusUpdate({})).toEqual({ ok: false })
  })
})
