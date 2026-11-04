// HR backdated entries must produce exactly the values phase 1 computes, with
// status 'approved', source 'hr_backdated' and the HR employee as entered_by_id.
// The certificate is only a checkbox: no file and no link are stored.
import { describe, expect, it } from 'vitest'

import { buildBackdatedRow, normalizeOptionalFields } from '../worker/src/leave-backdated.js'
import { MESSAGES, OT, NO_OT, computeLeave } from '../worker/src/leave-rules.js'

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const APPROVER_ID = '22222222-2222-4222-8222-222222222222'
const HR_ID = '33333333-3333-4333-8333-333333333333'
const TYPE_SICK = '44444444-4444-4444-8444-444444444444'
const TYPE_OTHER = '55555555-5555-4555-8555-555555555555'

const NOW = new Date('2026-11-03T03:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const HOLIDAYS = new Set(['2026-11-04'])

const employee = { id: EMPLOYEE_ID, is_active: true };
const sickType = {
  id: TYPE_SICK,
  name: 'ลาป่วย',
  requires_attachment: true,
  attachment_required_from_days: 3,
}
const otherType = { id: TYPE_OTHER, name: 'อื่นๆ', requires_attachment: false }
const dayShift = { code: 'DAY_FULL', is_half: false }
const nightHalfAm = { code: 'NIGHT_HALF_AM', is_half: true }

// Default input: three sick days with the certificate checkbox ticked.
// A test that passes `input` replaces it entirely.
function build(overrides = {}) {
  return buildBackdatedRow({
    input: overrides.input ?? {
      startDate: '2026-11-02',
      endDate: '2026-11-05',
      hasMedicalCertificate: true,
    },
    employee,
    leaveType: overrides.leaveType ?? sickType,
    shift: overrides.shift ?? dayShift,
    approverId: overrides.approverId ?? APPROVER_ID,
    enteredById: HR_ID,
    holidays: HOLIDAYS,
    now: NOW,
    requestCode: 'LV-20261103-TEST01',
  })
}

describe('backdated full day', () => {
  it('matches computeLeave exactly and marks the request approved', () => {
    const result = build()
    expect(result.ok).toBe(true)

    const computed = computeLeave({
      startDate: '2026-11-02',
      endDate: '2026-11-05',
      shift: dayShift,
      holidays: HOLIDAYS,
    })
    expect(computed.ok).toBe(true)

    // 02, 03 and 05 are working days; 04 is a holiday.
    expect(computed.days).toBe(3)
    expect(result.row.days).toBe(computed.days)
    expect(result.row.return_date).toBe(computed.returnDate)
    expect(result.row.return_time).toBe(computed.returnTime)
    expect(result.row.shift_end_override).toBe(computed.shiftEndOverride)
    expect(result.row.ot_option).toBe(NO_OT)

    expect(result.row.status).toBe('approved')
    expect(result.row.source).toBe('hr_backdated')
    expect(result.row.entered_by_id).toBe(HR_ID)
    expect(result.row.approver_id).toBe(APPROVER_ID)
    expect(result.row.decided_at).toBe(NOW_ISO)
    expect(result.row.employee_id).toBe(EMPLOYEE_ID)
    expect(result.row.request_code).toBe('LV-20261103-TEST01')
  })

  it('records the checkbox and never a file or link', () => {
    const ticked = build({
      input: { startDate: '2026-11-02', endDate: '2026-11-05', hasMedicalCertificate: true },
    })
    expect(ticked.ok).toBe(true)
    expect(ticked.row.has_medical_certificate).toBe(true)
    expect(ticked.row.medical_certificate_url).toBe(null)

    const unticked = build({ input: { startDate: '2026-11-02', endDate: '2026-11-05' } })
    expect(unticked.ok).toBe(true)
    expect(unticked.row.has_medical_certificate).toBe(false)
    expect(unticked.row.medical_certificate_url).toBe(null)
  })

  it('does not force the checkbox by the number of days', () => {
    const twoDays = build({ input: { startDate: '2026-11-02', endDate: '2026-11-03' } })
    expect(twoDays.ok).toBe(true)
    expect(twoDays.row.days).toBe(2)
    expect(twoDays.row.has_medical_certificate).toBe(false)

    const threeDaysSick = build({ input: { startDate: '2026-11-02', endDate: '2026-11-05' } })
    expect(threeDaysSick.ok).toBe(true)
    expect(threeDaysSick.row.days).toBe(3)
    expect(threeDaysSick.row.has_medical_certificate).toBe(false)
  })
})

describe('backdated half day', () => {
  it('keeps the phase 1 return time and the OT shift end', () => {
    const result = build({
      shift: nightHalfAm,
      input: { startDate: '2026-11-06', otOption: OT },
    })
    expect(result.ok).toBe(true)

    const computed = computeLeave({
      startDate: '2026-11-06',
      shift: nightHalfAm,
      otOption: OT,
      holidays: HOLIDAYS,
    })
    expect(result.row.days).toBe(0.5)
    expect(result.row.return_date).toBe(computed.returnDate)
    expect(result.row.return_time).toBe('01:00')
    expect(result.row.shift_end_override).toBe('08:00')
    expect(result.row.ot_option).toBe(OT)
    expect(result.row.end_date).toBe('2026-11-06')
  })

  it('refuses a half day without an OT choice', () => {
    const result = build({ shift: nightHalfAm, input: { startDate: '2026-11-06' } })
    expect(result).toEqual({ ok: false, message: MESSAGES.otRequired })
  })
})

describe('backdated validation', () => {
  it('requires an approver and forbids self approval', () => {
    expect(build({ approverId: '' })).toEqual({ ok: false, message: MESSAGES.approverRequired })
    expect(build({ approverId: EMPLOYEE_ID })).toEqual({
      ok: false,
      message: MESSAGES.selfApproval,
    })
  })

  it('refuses an end date before the start date', () => {
    expect(build({ input: { startDate: '2026-11-05', endDate: '2026-11-03' } })).toEqual({
      ok: false,
      message: MESSAGES.endBeforeStart,
    })
  })

  it('requires the free text only for "อื่นๆ"', () => {
    expect(
      build({ leaveType: otherType, input: { startDate: '2026-11-02', endDate: '2026-11-03' } })
    ).toEqual({ ok: false, message: MESSAGES.otherDetailRequired })

    const filled = build({
      leaveType: otherType,
      input: {
        startDate: '2026-11-02',
        endDate: '2026-11-03',
        otherTypeDetail: '  ลาศึกษาต่อ  ',
      },
    })
    expect(filled.ok).toBe(true)
    expect(filled.row.other_type_detail).toBe('ลาศึกษาต่อ')

    // A normal type drops the field even when the client sends it.
    const sick = build({
      input: { startDate: '2026-11-02', endDate: '2026-11-03', otherTypeDetail: 'ignored' },
    })
    expect(sick.row.other_type_detail).toBe(null)
  })

  it('rejects a checkbox that is not a boolean', () => {
    const result = build({
      input: { startDate: '2026-11-02', endDate: '2026-11-05', hasMedicalCertificate: 'true' },
    })
    expect(result).toEqual({
      ok: false,
      message: MESSAGES.invalidInput ?? 'ข้อมูลไม่ถูกต้อง',
    })
  })

  it('ignores a certificate link instead of storing it', () => {
    const result = build({
      input: {
        startDate: '2026-11-02',
        endDate: '2026-11-05',
        medicalCertificateUrl: 'https://example.test/cert.pdf',
      },
    })
    expect(result.ok).toBe(true)
    expect(result.row.medical_certificate_url).toBe(null)
    expect(result.row.has_medical_certificate).toBe(false)
  })
})

describe('normalizeOptionalFields', () => {
  it('trims the reason and keeps an empty one as null', () => {
    expect(normalizeOptionalFields({ leaveType: sickType, reason: '  ธุระ  ' }).reason).toBe('ธุระ')
    expect(normalizeOptionalFields({ leaveType: sickType, reason: '   ' }).reason).toBe(null)
  })

  it('rejects a reason longer than 1000 characters', () => {
    const result = normalizeOptionalFields({
      leaveType: sickType,
      reason: 'x'.repeat(1001),
    })
    expect(result).toEqual({ ok: false, message: MESSAGES.reasonTooLong })
  })

  it('defaults the checkbox to false and keeps true', () => {
    expect(normalizeOptionalFields({ leaveType: sickType }).hasMedicalCertificate).toBe(false)
    expect(
      normalizeOptionalFields({ leaveType: sickType, hasMedicalCertificate: true })
        .hasMedicalCertificate
    ).toBe(true)
  })
})
