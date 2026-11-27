import { describe, expect, it } from 'vitest'

import { SECURITY_ROWS, SETTINGS_URL, daysText, readSettings } from '../src/lib/admin-settings.js'
import { readSource } from './helpers/read-source.js'

const GOOD = {
  ok: true,
  leave: {
    configured: true,
    certificateRetentionDays: 90,
    leaveRetentionEnabled: true,
    leaveRetentionDays: 1825,
    updatedAt: '2026-11-01T03:00:00Z',
    updatedBy: { employeeCode: 'HR001', fullName: 'เจ้าหน้าที่ HR' },
  },
  holidays: { year: '2026', count: 18, next: { date: '2026-12-05', name: 'วันพ่อแห่งชาติ' } },
  security: { sessionIdleMinutes: 15, maxFailedPins: 5, lockMinutes: 15, sessionRetentionDays: 30, auditRetentionDays: 365 },
}

describe('reading the settings reply', () => {
  it('keeps every part of a good reply', () => {
    const settings = readSettings(GOOD)
    expect(settings.leave.leaveRetentionDays).toBe(1825)
    expect(settings.leave.updatedBy).toEqual({ employeeCode: 'HR001', fullName: 'เจ้าหน้าที่ HR' })
    expect(settings.holidays).toEqual({ count: 18, next: { date: '2026-12-05', name: 'วันพ่อแห่งชาติ' } })
    expect(settings.security.maxFailedPins).toBe(5)
  })

  it('accepts no editor and no next holiday', () => {
    const settings = readSettings({
      ...GOOD,
      leave: { ...GOOD.leave, configured: false, updatedAt: null, updatedBy: null },
      holidays: { year: '2026', count: 0, next: null },
    })
    expect(settings.leave.updatedBy).toBeNull()
    expect(settings.holidays.next).toBeNull()
  })

  it('refuses a reply with a missing or broken part instead of showing defaults', () => {
    expect(readSettings(null)).toBeNull()
    expect(readSettings({ ...GOOD, ok: false })).toBeNull()
    expect(readSettings({ ...GOOD, leave: { ...GOOD.leave, leaveRetentionEnabled: 'yes' } })).toBeNull()
    expect(readSettings({ ...GOOD, holidays: { count: -1 } })).toBeNull()
    expect(readSettings({ ...GOOD, security: { ...GOOD.security, lockMinutes: '15' } })).toBeNull()
  })

  it('has a row for every security value the Worker sends', () => {
    expect(SECURITY_ROWS.map((row) => row.key).sort()).toEqual(Object.keys(GOOD.security).sort())
  })
})

describe('day counts', () => {
  it('says whole years as years and the rest as days', () => {
    expect(daysText(1825)).toBe('5 ปี')
    expect(daysText(365)).toBe('1 ปี')
    expect(daysText(90)).toBe('90 วัน')
    expect(daysText(1000)).toBe('1,000 วัน')
  })
})

describe('settings page', () => {
  const PAGE = readSource('src/pages/AdminSettingsPage.vue')

  it('only reads: one GET and no form', () => {
    expect(SETTINGS_URL).toBe('/api/admin/settings')
    expect(PAGE).toContain("fetch(SETTINGS_URL, { credentials: 'same-origin' })")
    expect(PAGE).not.toMatch(/method:\s*'(PUT|POST|PATCH|DELETE)'/)
    expect(PAGE).not.toContain('<input')
  })

  it('keeps hover inside the precise-pointer query', () => {
    const firstHover = PAGE.indexOf(':hover')
    expect(firstHover).toBeGreaterThan(PAGE.indexOf('@media (hover: hover) and (pointer: fine)'))
    expect(PAGE).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
