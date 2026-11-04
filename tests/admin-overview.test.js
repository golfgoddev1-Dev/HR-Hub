// Admin overview rules that need no browser:
// - every number comes from a named existing endpoint, and a card with no usable
//   reply stays "—" instead of showing a made-up value;
// - truncated pages (a full first page) are not reported as totals;
// - the formatting never invents a number either.
import { describe, expect, it } from 'vitest'

import {
  ADMIN_APPROVER_LIST_LIMIT,
  ADMIN_HOLIDAY_LIST_LIMIT,
  ADMIN_NO_VALUE,
  ADMIN_SHORTCUTS,
  ADMIN_STATS,
  adminRoleLabel,
  allStatsUnavailable,
  formatStatValue,
  loadAdminStats,
  readStatValue,
} from '../src/lib/admin-overview.js'
import { allowedPathsByRole } from '../src/lib/route-access.js'

function approverRows(total, active) {
  return Array.from({ length: total }, (_, index) => ({
    id: `row-${index}`,
    isActive: index < active,
  }))
}

describe('stat cards', () => {
  it('has four cards, including the three the brief names', () => {
    expect(ADMIN_STATS).toHaveLength(4)
    const labels = ADMIN_STATS.map((stat) => stat.label)
    expect(labels).toEqual([
      'พนักงานที่ใช้งาน',
      'ใบลารออนุมัติ',
      'ผู้อนุมัติที่ใช้งาน',
      'วันหยุดปีนี้',
    ])
  })

  it('points every card at an existing endpoint or nothing at all', () => {
    for (const stat of ADMIN_STATS) {
      const url = typeof stat.url === 'function' ? stat.url() : stat.url
      if (url === null) continue
      expect(url, stat.key).toMatch(/^\/api\//)
    }
  })

  it('leaves the employee count empty because no endpoint can total it', () => {
    const stat = ADMIN_STATS.find((item) => item.key === 'activeEmployees')
    expect(stat.url).toBe(null)
    expect(stat.caption).toContain('endpoint')
  })

  it('asks for the holiday year from the calendar, not a fixed year', () => {
    const stat = ADMIN_STATS.find((item) => item.key === 'holidays')
    expect(stat.url()).toMatch(/^\/api\/leave\/hr\/holidays\?year=\d{4}$/)
  })
})

describe('readStatValue', () => {
  it('reads the pending-request count only when the page is the whole list', () => {
    expect(readStatValue('requests', { ok: true, count: 3, hasMore: false })).toBe(3)
    expect(readStatValue('requests', { ok: true, count: 0, hasMore: false })).toBe(0)
    expect(readStatValue('requests', { ok: true, count: 50, hasMore: true })).toBe(null)
    expect(readStatValue('requests', { ok: true, count: 50, scanCapped: true })).toBe(null)
  })

  it('counts only active approvers and refuses a list that may be cut off', () => {
    expect(readStatValue('approvers', { ok: true, results: approverRows(5, 3) })).toBe(3)
    expect(readStatValue('approvers', { ok: true, results: [] })).toBe(0)
    expect(
      readStatValue('approvers', {
        ok: true,
        results: approverRows(ADMIN_APPROVER_LIST_LIMIT, 10),
      })
    ).toBe(null)
    expect(readStatValue('approvers', { ok: true, results: [{ isActive: 'true' }] })).toBe(0)
  })

  it('reads the holiday count and refuses the list limit', () => {
    expect(readStatValue('holidays', { ok: true, count: 12 })).toBe(12)
    expect(readStatValue('holidays', { ok: true, count: ADMIN_HOLIDAY_LIST_LIMIT })).toBe(null)
    expect(readStatValue('holidays', { ok: true, count: '12' })).toBe(null)
  })

  it('answers null for a refusal, a failed call or an unknown kind', () => {
    expect(readStatValue('requests', { ok: false, message: 'x' })).toBe(null)
    expect(readStatValue('requests', null)).toBe(null)
    expect(readStatValue('requests', 'nope')).toBe(null)
    expect(readStatValue('none', { ok: true, count: 4 })).toBe(null)
  })
})

describe('formatStatValue', () => {
  it('shows an em dash for anything that is not a whole count', () => {
    expect(formatStatValue(null)).toBe(ADMIN_NO_VALUE)
    expect(formatStatValue(undefined)).toBe('—')
    expect(formatStatValue(-1)).toBe('—')
    expect(formatStatValue(1.5)).toBe('—')
    expect(formatStatValue('42')).toBe('—')
  })

  it('groups thousands without changing the digits', () => {
    expect(formatStatValue(0)).toBe('0')
    expect(formatStatValue(42)).toBe('42')
    expect(formatStatValue(1500)).toBe('1,500')
    expect(formatStatValue(1234567)).toBe('1,234,567')
  })
})

describe('loadAdminStats', () => {
  it('fills each card from its own endpoint', async () => {
    const requested = []
    const values = await loadAdminStats(async (url) => {
      requested.push(url)
      if (url.startsWith('/api/leave/hr/requests')) return { ok: true, count: 2, hasMore: false }
      if (url.startsWith('/api/leave/hr/approvers')) {
        return { ok: true, results: approverRows(4, 1) }
      }
      if (url.startsWith('/api/leave/hr/holidays')) return { ok: true, count: 9 }
      return null
    })

    expect(values).toEqual({
      activeEmployees: null,
      pendingLeave: 2,
      activeApprovers: 1,
      holidays: 9,
    })
    // The card without an endpoint makes no request at all.
    expect(requested).toHaveLength(3)
  })

  it('keeps a card empty when the call is refused or throws', async () => {
    const values = await loadAdminStats(async (url) => {
      if (url.startsWith('/api/leave/hr/requests')) return null // 403 for this role
      throw new Error('network')
    })

    expect(values.pendingLeave).toBe(null)
    expect(values.activeApprovers).toBe(null)
    expect(values.holidays).toBe(null)
  })

  it('survives a missing fetcher', async () => {
    const values = await loadAdminStats(null)
    expect(values).toEqual({
      activeEmployees: null,
      pendingLeave: null,
      activeApprovers: null,
      holidays: null,
    })
  })
})

describe('empty state and labels', () => {
  it('only treats a page with no number at all as empty', () => {
    expect(allStatsUnavailable({})).toBe(true)
    expect(
      allStatsUnavailable({
        activeEmployees: null,
        pendingLeave: null,
        activeApprovers: null,
        holidays: null,
      })
    ).toBe(true)
    expect(
      allStatsUnavailable({
        activeEmployees: null,
        pendingLeave: 0,
        activeApprovers: null,
        holidays: null,
      })
    ).toBe(false)
  })

  it('names the admin role in Thai and falls back to a dash', () => {
    expect(adminRoleLabel('system_admin')).toBe('ผู้ดูแลระบบ')
    expect(adminRoleLabel('hr')).toBe('เจ้าหน้าที่ HR')
    expect(adminRoleLabel('unknown')).toBe('—')
    expect(adminRoleLabel(null)).toBe('—')
  })
})

describe('shortcuts', () => {
  it('only offers HR pages that exist in the router', () => {
    expect(ADMIN_SHORTCUTS.length).toBeGreaterThanOrEqual(3)
    for (const shortcut of ADMIN_SHORTCUTS) {
      expect(allowedPathsByRole.hr, shortcut.to).toContain(shortcut.to)
    }
  })
})
