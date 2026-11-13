// Certificate status on the leave pages: stored, recorded by HR, expired or
// none, plus the retention window read from leave_settings.

import { describe, expect, it } from 'vitest'

import {
  CERTIFICATE_EXPIRED_LABEL,
  CERTIFICATE_OPEN_LABEL,
  CERTIFICATE_RECORDED_LABEL,
  certificateExpiry,
  certificateStatus,
  retentionNotice,
} from '../src/leave-certificate.js'

import { readSource } from './helpers/read-source.js'

const STORED = {
  hasMedicalCertificate: true,
  attachmentPath: 'leave/1111/LV-20261103-001/cert.pdf',
  source: 'employee',
  createdAt: '2026-01-01T02:00:00.000Z',
}

const readPage = (path) => readSource(new URL(`../${path}`, import.meta.url))

describe('certificateStatus', () => {
  it('shows nothing when the request has no certificate', () => {
    expect(certificateStatus({ hasMedicalCertificate: false }).state).toBe('none')
    expect(certificateStatus({}).has).toBe(false)
    expect(certificateStatus(null).has).toBe(false)
  })

  it('offers the file when it is stored in the bucket', () => {
    const status = certificateStatus(
      // A file submitted ten days ago: still inside the 90-day window.
      { ...STORED, createdAt: new Date(Date.now() - 10 * 86400000).toISOString() },
      { retentionDays: 90 }
    )
    expect(status.state).toBe('stored')
    expect(status.canOpen).toBe(true)
    expect(status.label).toBe(CERTIFICATE_OPEN_LABEL)
    expect(status.expiry.daysLeft).toBeGreaterThan(0)
  })

  it('shows the HR note for a backdated entry without a file', () => {
    const status = certificateStatus(
      { hasMedicalCertificate: true, attachmentPath: null, source: 'hr_backdated' },
      { retentionDays: 90 }
    )
    expect(status.state).toBe('hr_recorded')
    expect(status.canOpen).toBe(false)
    expect(status.label).toBe(CERTIFICATE_RECORDED_LABEL)
    expect(status.expiry).toBe(null)
  })

  it('says the file expired for an employee entry whose path is gone', () => {
    const status = certificateStatus(
      { hasMedicalCertificate: true, attachmentPath: null, source: 'employee' },
      { retentionDays: 90 }
    )
    expect(status.state).toBe('expired')
    expect(status.canOpen).toBe(false)
    expect(status.label).toBe(CERTIFICATE_EXPIRED_LABEL)
    expect(CERTIFICATE_EXPIRED_LABEL).toBe('ไฟล์หมดอายุแล้ว')
  })

  it('never opens a file when the boolean is false', () => {
    expect(certificateStatus({ ...STORED, hasMedicalCertificate: false }).canOpen).toBe(false)
  })
})

describe('certificateExpiry', () => {
  const now = new Date('2026-01-01T03:00:00.000Z')

  it('counts the days left from created_at and the setting', () => {
    expect(certificateExpiry('2026-01-01', 30, now)).toEqual({
      expiresOn: '31 ม.ค. 2569',
      daysLeft: 30,
      expired: false,
      label: 'หมดอายุ: 31 ม.ค. 2569 (เหลือ 30 วัน)',
    })

    expect(certificateExpiry('2026-01-01', 365, now)).toEqual({
      expiresOn: '1 ม.ค. 2570',
      daysLeft: 365,
      expired: false,
      label: 'หมดอายุ: 1 ม.ค. 2570 (เหลือ 365 วัน)',
    })
  })

  it('says it expires today on the last day', () => {
    const expiry = certificateExpiry('2026-01-01', 30, new Date('2026-01-31T03:00:00.000Z'))
    expect(expiry.daysLeft).toBe(0)
    expect(expiry.expired).toBe(false)
    expect(expiry.label).toBe('จะหมดอายุในวันนี้')
  })

  it('reports an already expired file', () => {
    const expiry = certificateExpiry('2026-01-01', 30, new Date('2026-02-01T03:00:00.000Z'))
    expect(expiry.daysLeft).toBe(-1)
    expect(expiry.expired).toBe(true)
    expect(expiry.label).toBe(CERTIFICATE_EXPIRED_LABEL)
  })

  it('returns null for unusable input instead of throwing', () => {
    expect(certificateExpiry(null, 90, now)).toBe(null)
    expect(certificateExpiry('not-a-date', 90, now)).toBe(null)
    expect(certificateExpiry('2026-01-01', null, now)).toBe(null)
    expect(certificateExpiry('2026-01-01', -1, now)).toBe(null)
  })
})

describe('retentionNotice', () => {
  it('reads the number from the setting instead of hardcoding it', () => {
    expect(retentionNotice(30)).toBe(
      'ไฟล์ใบรับรองแพทย์จะเก็บไว้ 30 วันนับจากวันที่ยื่นใบลา หลังจากนั้นไฟล์จะหมดอายุและลบออกจากระบบ'
    )
    expect(retentionNotice(365)).toBe(
      'ไฟล์ใบรับรองแพทย์จะเก็บไว้ 365 วันนับจากวันที่ยื่นใบลา หลังจากนั้นไฟล์จะหมดอายุและลบออกจากระบบ'
    )
    expect(retentionNotice(90)).toBe(
      'ไฟล์ใบรับรองแพทย์จะเก็บไว้ 90 วันนับจากวันที่ยื่นใบลา หลังจากนั้นไฟล์จะหมดอายุและลบออกจากระบบ'
    )
    expect(retentionNotice(0)).toBe('')
    expect(retentionNotice(null)).toBe('')
  })
})

describe('pages use the setting from the API', () => {
  it('the submit page shows the notice from certificateRetentionDays', () => {
    const page = readPage('src/pages/LeaveRequestPage.vue')
    expect(page).toContain('certificateRetentionDays')
    expect(page).toContain('retentionNotice(retentionDays)')
    expect(page).not.toMatch(/เก็บไว้ 90 วัน/)
  })

  it('my leave and the HR pages read certificateRetentionDays too', () => {
    for (const path of ['src/pages/LeaveHomePage.vue', 'src/pages/HrLeaveRequestsPage.vue']) {
      const page = readPage(path)
      expect(page, path).toContain('certificateRetentionDays')
      expect(page, path).toContain('certificateStatus(')
    }

    expect(readPage('src/pages/HrLeaveRequestsPage.vue')).toContain(
      'retentionNotice(retentionDays)'
    )
  })
})
