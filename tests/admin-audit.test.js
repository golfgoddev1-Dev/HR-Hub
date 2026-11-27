import { describe, expect, it } from 'vitest'

import {
  AUDIT_ACTION_OPTIONS,
  auditActionLabel,
  auditHeadline,
  bangkokDayKey,
  buildAuditUrl,
  groupByDay,
  isRangeReversed,
  personLabel,
  readAuditPage,
} from '../src/lib/admin-audit.js'
import { readSource } from './helpers/read-source.js'

describe('audit url', () => {
  it('leaves empty filters out and encodes the rest', () => {
    expect(buildAuditUrl()).toBe('/api/admin/audit')
    expect(buildAuditUrl({ action: 'pin_set', from: '2026-11-01', before: '42' })).toBe(
      '/api/admin/audit?action=pin_set&from=2026-11-01&before=42'
    )
  })

  it('detects a reversed range', () => {
    expect(isRangeReversed('2026-12-01', '2026-11-01')).toBe(true)
    expect(isRangeReversed('2026-11-01', '2026-11-01')).toBe(false)
    expect(isRangeReversed('', '2026-11-01')).toBe(false)
  })
})

describe('labels', () => {
  it('names known actions and shows an unknown one as stored', () => {
    expect(auditActionLabel('leave_approved')).toBe('อนุมัติใบลา')
    expect(auditActionLabel('brand_new_action')).toBe('brand_new_action')
    expect(auditActionLabel(null)).toBe('—')
  })

  it('adds the permission name to a permission row only', () => {
    expect(auditHeadline({ action: 'permission_revoked', permission: 'hr_admin' })).toBe(
      'ถอดสิทธิ์ ผู้ดูแล HR'
    )
    expect(auditHeadline({ action: 'pin_set', permission: null })).toBe('ตั้ง PIN')
  })

  it('offers every labelled action as a filter option', () => {
    expect(AUDIT_ACTION_OPTIONS.length).toBeGreaterThan(30)
    expect(AUDIT_ACTION_OPTIONS.every((o) => o.value && o.label)).toBe(true)
  })

  it('joins name and code, and returns null for nobody', () => {
    expect(personLabel({ fullName: 'สมชาย', employeeCode: 'E01' })).toBe('สมชาย E01')
    expect(personLabel({ fullName: null, employeeCode: 'E01' })).toBe('E01')
    expect(personLabel(null)).toBeNull()
  })
})

describe('reading a reply', () => {
  it('returns null for anything that is not an ok page', () => {
    expect(readAuditPage(null)).toBeNull()
    expect(readAuditPage({ ok: false })).toBeNull()
    expect(readAuditPage({ ok: true, items: 'x' })).toBeNull()
  })

  it('drops rows without an id or a time and keeps the cursor', () => {
    const page = readAuditPage({
      ok: true,
      items: [{ id: '2', createdAt: '2026-11-02T01:00:00Z' }, { id: 3 }, null],
      nextBefore: '2',
    })
    expect(page.items).toHaveLength(1)
    expect(page.nextBefore).toBe('2')
    expect(readAuditPage({ ok: true, items: [], nextBefore: null }).nextBefore).toBeNull()
  })
})

describe('day groups', () => {
  it('uses the Bangkok calendar, not UTC', () => {
    // 18:30 UTC on the 1st is 01:30 on the 2nd in Bangkok.
    expect(bangkokDayKey('2026-11-01T18:30:00Z')).toBe('2026-11-02')
  })

  it('splits consecutive rows into days and keeps their order', () => {
    const groups = groupByDay([
      { id: '4', createdAt: '2026-11-02T05:00:00Z' },
      { id: '3', createdAt: '2026-11-02T01:00:00Z' },
      { id: '2', createdAt: '2026-11-01T05:00:00Z' },
    ])
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['2026-11-02', 2],
      ['2026-11-01', 1],
    ])
  })
})

describe('audit page source', () => {
  const PAGE = readSource('src/pages/AdminAuditPage.vue')
  const STYLE = PAGE.slice(PAGE.indexOf('<style'))

  const channel = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  it('checks its contrast maths against known pairs first', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(ratio('#475569', '#ffffff')).toBeCloseTo(7.58, 1)
    expect(ratio('#1e1b4b', '#ffffff')).toBeCloseTo(15.99, 1)
    expect(ratio('#ffffff', '#4f46e5')).toBeCloseTo(6.29, 1)
  })

  it('keeps every page ink at AA on white and the control border at 3:1', () => {
    for (const ink of ['#1e1b4b', '#334155', '#475569', '#4338ca', '#a01b1b']) {
      expect(STYLE).toContain(ink)
      expect(ratio(ink, '#ffffff'), ink).toBeGreaterThanOrEqual(4.5)
    }
    expect(ratio('#a01b1b', '#fdecec')).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#64748b', '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('puts hover behind a precise-pointer query and sizes controls to the tap token', () => {
    expect(STYLE.indexOf(':hover')).toBeGreaterThan(STYLE.indexOf('@media (hover: hover) and (pointer: fine)'))
    expect(STYLE).toContain('--tap-target: 44px')
    expect(STYLE.match(/min-height: var\(--tap-target\)/g)).toHaveLength(2)
    expect(STYLE).toContain('@media (prefers-reduced-motion: reduce)')
    expect(STYLE).not.toMatch(/transition:[^;]*(width|height|top|left|margin|padding)/)
  })

  it('never renders audit detail', () => {
    expect(PAGE).not.toMatch(/\.detail\b/)
  })
})
