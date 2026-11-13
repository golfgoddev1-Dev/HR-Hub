// Printable leave form (phase 4): every field the template requires, Thai
// Buddhist dates, the half-day wording, the certificate answer and the HR-only
// access rule.

import { describe, expect, it } from 'vitest'

import {
  NO_VALUE,
  canPrintLeave,
  certificateText,
  daysText,
  formatThaiDate,
  formatThaiDateTime,
  formatThaiTime,
  isBackdatedRequest,
  leavePrintModel,
} from '../src/leave-print.js'

import { readSource } from './helpers/read-source.js'

const REQUEST = {
  id: 'leave-1',
  requestCode: 'LV-20261103-001',
  leaveTypeName: 'ลาป่วย',
  otherTypeDetail: null,
  startDate: '2026-11-03',
  endDate: '2026-11-05',
  days: 3,
  returnDate: '2026-11-06',
  returnTime: '08:30:00',
  shiftCode: 'DAY_FULL',
  shiftEndOverride: '16:30',
  otOption: null,
  reason: 'ป่วย',
  hasMedicalCertificate: true,
  attachmentPath: 'leave/1111/LV-20261103-001/cert.pdf',
  status: 'approved',
  decidedAt: '2026-11-03T10:15:00.000Z',
  createdAt: '2026-11-02T02:00:00.000Z',
  source: 'employee',
  departmentName: 'ฝ่ายบุคคล',
  requester: { namePrefix: 'นาย', fullName: 'สมชาย ใจดี', departmentName: 'ฝ่ายบุคคล' },
  approver: { namePrefix: 'นาง', fullName: 'สมหญิง ดูแล' },
  shift: { code: 'DAY_FULL', label: 'เต็มวัน', timeFrom: '08:30:00', timeTo: '16:30:00' },
}

const PRINT_PAGE = readSource(new URL('../src/pages/HrLeavePrintPage.vue', import.meta.url))

describe('leavePrintModel', () => {
  it('fills every field of the form', () => {
    expect(leavePrintModel(REQUEST)).toMatchObject({
      requestCode: 'LV-20261103-001',
      status: 'อนุมัติแล้ว',
      createdAt: '2 พ.ย. 2569',
      requesterName: 'นายสมชาย ใจดี',
      requesterDepartment: 'ฝ่ายบุคคล',
      requesterPhone: '-',
      leaveType: 'ลาป่วย',
      otherTypeDetail: '-',
      shiftText: 'เต็มวัน (08:30 น. – 16:30 น.)',
      ot: '-',
      startDate: '3 พ.ย. 2569',
      endDate: '5 พ.ย. 2569',
      days: '3 วัน',
      returnDate: '6 พ.ย. 2569',
      returnTime: '08:30 น.',
      shiftEndTime: '16:30 น.',
      reason: 'ป่วย',
      approverName: 'นางสมหญิง ดูแล',
      decidedAt: '3 พ.ย. 2569 17:15 น.',
      cc: '-',
      certificate: 'ใช่',
      isBackdated: false,
    })
  })

  it('writes a half day as ครึ่งวัน and keeps empty values as a dash', () => {
    const model = leavePrintModel({
      ...REQUEST,
      days: 0.5,
      shiftEndOverride: null,
      returnTime: null,
      reason: null,
      shift: null,
    })
    expect(model.days).toBe('ครึ่งวัน')
    expect(model.shiftEndTime).toBe(NO_VALUE)
    expect(model.returnTime).toBe(NO_VALUE)
    expect(model.reason).toBe(NO_VALUE)
    expect(model.shiftText).toBe('DAY_FULL')
  })

  it('answers the certificate question from has_medical_certificate', () => {
    // A stored file.
    expect(
      leavePrintModel({ ...REQUEST, hasMedicalCertificate: true }).certificate
    ).toBe('ใช่')
    // Backdated: recorded by HR without a file.
    expect(
      leavePrintModel({
        ...REQUEST,
        hasMedicalCertificate: true,
        attachmentPath: null,
      }).certificate
    ).toBe('ใช่')
    // No certificate at all.
    expect(
      leavePrintModel({ ...REQUEST, hasMedicalCertificate: false }).certificate
    ).toBe('ไม่ใช่')

    expect(certificateText(true)).toBe('ใช่')
    expect(certificateText(false)).toBe('ไม่ใช่')
    expect(certificateText(undefined)).toBe('ไม่ใช่')
  })

  it('marks a backdated entry', () => {
    expect(leavePrintModel({ ...REQUEST, source: 'hr_backdated' }).isBackdated).toBe(true)
    expect(isBackdatedRequest({ source: 'hr_backdated' })).toBe(true)
    expect(isBackdatedRequest({ source: 'employee' })).toBe(false)
    expect(isBackdatedRequest(null)).toBe(false)
  })
})

describe('Thai date, time and day wording', () => {
  it('uses the Buddhist year and the Bangkok day', () => {
    expect(formatThaiDate('2026-01-01')).toBe('1 ม.ค. 2569')
    expect(formatThaiDate('2026-12-31')).toBe('31 ธ.ค. 2569')
    // 2026-11-02T20:00Z is already 3 November in Bangkok.
    expect(formatThaiDate('2026-11-02T20:00:00.000Z')).toBe('3 พ.ย. 2569')
    expect(formatThaiDate(null)).toBe(NO_VALUE)
    expect(formatThaiDate('not-a-date')).toBe(NO_VALUE)
  })

  it('writes times as HH:mm น.', () => {
    expect(formatThaiTime('09:05:00')).toBe('09:05 น.')
    expect(formatThaiTime('18:00')).toBe('18:00 น.')
    expect(formatThaiTime('2026-11-03T01:30:00.000Z')).toBe('08:30 น.')
    expect(formatThaiTime('')).toBe(NO_VALUE)
    expect(formatThaiDateTime('2026-11-03T10:15:00.000Z')).toBe('3 พ.ย. 2569 17:15 น.')
  })

  it('writes days without a trailing .0', () => {
    expect(daysText(3)).toBe('3 วัน')
    expect(daysText('3')).toBe('3 วัน')
    expect(daysText(0.5)).toBe('ครึ่งวัน')
    expect(daysText(null)).toBe(NO_VALUE)
  })
})

describe('printed form template', () => {
  it('shows the header, the four sections and the footers', () => {
    for (const label of [
      'ฝ่ายทรัพยากรบุคคล',
      'ใบขออนุญาตลางาน',
      'Leave Request Form',
      'เลขที่ใบลา',
      'วันที่กรอกใบลา',
      'ชื่อ-นามสกุล',
      'ส่วน/แผนก',
      'เบอร์โทรศัพท์',
      'ประเภทการลา',
      'ระบุประเภทอื่น',
      'เวลาที่ลา',
      'OT',
      'วันที่เริ่มลา',
      'วันที่สิ้นสุด',
      'จำนวนวัน',
      'วันกลับมาทำงาน',
      'เวลาเลิกงานวันนั้น',
      'เหตุผล',
      'ผู้อนุมัติ',
      'วันที่อนุมัติ',
      'แจ้งทราบ (ผู้จัดการ CC)',
      'มีใบรับรองแพทย์แนบ',
      'บันทึกย้อนหลังโดยฝ่ายทรัพยากรบุคคล',
      'เอกสารนี้สร้างโดยระบบอัตโนมัติ การอนุมัติมีผลเมื่อผู้อนุมัติดำเนินการในระบบแล้วเท่านั้น',
      'เอกสารนี้เก็บรักษาตามนโยบาย PDPA',
    ]) {
      expect(PRINT_PAGE, label).toContain(label)
    }
  })

  it('has no signature area and never prints a file link or name', () => {
    expect(PRINT_PAGE).not.toContain('ลายเซ็น')
    expect(PRINT_PAGE.toLowerCase()).not.toContain('signature')
    expect(PRINT_PAGE).not.toContain('<canvas')
    expect(PRINT_PAGE).not.toMatch(/attachmentPath|medical_certificate_url|signedUrl/)
  })

  it('carries the A4 print styles', () => {
    expect(PRINT_PAGE).toContain('@media print')
    expect(PRINT_PAGE).toContain('size: A4')
    expect(PRINT_PAGE).toContain("url('/fonts/Sarabun-Regular.ttf')")
    expect(PRINT_PAGE).toContain("url('/fonts/Sarabun-Bold.ttf')")
    expect(PRINT_PAGE).toContain('break-inside: avoid')
  })
})

describe('print access', () => {
  it('is HR-only', () => {
    expect(canPrintLeave('hr')).toBe(true)
    expect(canPrintLeave('employee')).toBe(false)
    expect(canPrintLeave('meeting_controller')).toBe(false)
    expect(canPrintLeave('system_admin')).toBe(false)
    expect(canPrintLeave(undefined)).toBe(false)
  })
})
