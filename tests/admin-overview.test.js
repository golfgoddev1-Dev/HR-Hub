// Admin overview frontend rules that need no browser:
// - all four cards come from one read-only endpoint;
// - a failed call, a missing count or a value that is not a whole number leaves
//   the card at "—" (no substitute number);
// - formatting never invents a number either.
import { describe, expect, it } from 'vitest'

import {
  ADMIN_NO_VALUE,
  ADMIN_OVERVIEW_URL,
  ADMIN_SHORTCUTS,
  ADMIN_STATS,
  adminRoleLabel,
  allStatsUnavailable,
  formatStatValue,
  loadAdminStats,
  readOverview,
} from '../src/lib/admin-overview.js'
import { allowedPathsByRole } from '../src/lib/route-access.js'

const FULL = {
  ok: true,
  year: '2026',
  counts: { activeEmployees: 128, pendingLeave: 4, activeApprovers: 7, holidays: 16 },
}

const EMPTY = {
  activeEmployees: null,
  pendingLeave: null,
  activeApprovers: null,
  holidays: null,
}

describe('stat cards', () => {
  it('has the four cards the endpoint answers, in order', () => {
    expect(ADMIN_STATS).toHaveLength(4)
    expect(ADMIN_STATS.map((stat) => stat.key)).toEqual([
      'activeEmployees',
      'pendingLeave',
      'activeApprovers',
      'holidays',
    ])
    expect(ADMIN_STATS.map((stat) => stat.label)).toEqual([
      'พนักงานที่ใช้งาน',
      'ใบลารออนุมัติ',
      'ผู้อนุมัติที่ใช้งาน',
      'วันหยุดปีนี้',
    ])
  })

  it('asks one endpoint, not the HR lists', () => {
    expect(ADMIN_OVERVIEW_URL).toBe('/api/admin/overview')
    for (const stat of ADMIN_STATS) {
      expect(stat).not.toHaveProperty('url')
    }
  })
})

describe('readOverview', () => {
  it('maps the reply onto the four cards', () => {
    expect(readOverview(FULL)).toEqual({
      activeEmployees: 128,
      pendingLeave: 4,
      activeApprovers: 7,
      holidays: 16,
    })
  })

  it('keeps zero, which is a real answer', () => {
    const values = readOverview({
      ok: true,
      counts: { activeEmployees: 0, pendingLeave: 0, activeApprovers: 0, holidays: 0 },
    })
    expect(values).toEqual({
      activeEmployees: 0,
      pendingLeave: 0,
      activeApprovers: 0,
      holidays: 0,
    })
    expect(allStatsUnavailable(values)).toBe(false)
  })

  it('returns only the four cards, ignoring anything else in the reply', () => {
    const values = readOverview({
      ok: true,
      counts: { activeEmployees: 3, fullName: 'สมชาย', nationalId: '1234567890123' },
    })
    expect(Object.keys(values).sort()).toEqual([
      'activeApprovers',
      'activeEmployees',
      'holidays',
      'pendingLeave',
    ])
    expect(values.activeEmployees).toBe(3)
    expect(values.pendingLeave).toBe(null)
  })

  it('blanks a card whose count is not a whole non-negative number', () => {
    const values = readOverview({
      ok: true,
      counts: { activeEmployees: '128', pendingLeave: -1, activeApprovers: 1.5, holidays: 0 },
    })
    expect(values.activeEmployees).toBe(null)
    expect(values.pendingLeave).toBe(null)
    expect(values.activeApprovers).toBe(null)
    expect(values.holidays).toBe(0)
  })

  it('blanks every card for a refusal, a broken body or a failed call', () => {
    expect(readOverview({ ok: false, message: 'ไม่มีสิทธิ์เข้าถึงส่วนนี้' })).toEqual(EMPTY)
    expect(readOverview(null)).toEqual(EMPTY)
    expect(readOverview('nope')).toEqual(EMPTY)
    expect(readOverview({ ok: true })).toEqual(EMPTY)
    expect(readOverview({ ok: true, counts: 'x' })).toEqual(EMPTY)
  })
})

describe('loadAdminStats', () => {
  it('calls the overview endpoint exactly once', async () => {
    const calls = []
    const values = await loadAdminStats(async (url) => {
      calls.push(url)
      return FULL
    })

    expect(calls).toEqual(['/api/admin/overview'])
    expect(values.activeEmployees).toBe(128)
    expect(values.holidays).toBe(16)
  })

  it('shows dashes for every card when the call is refused or throws', async () => {
    const refused = await loadAdminStats(async () => null)
    expect(refused).toEqual(EMPTY)

    const thrown = await loadAdminStats(async () => {
      throw new Error('network')
    })
    expect(thrown).toEqual(EMPTY)

    expect(Object.values(refused).map(formatStatValue)).toEqual(['—', '—', '—', '—'])
  })

  it('survives a missing fetcher without calling anything', async () => {
    expect(await loadAdminStats(null)).toEqual(EMPTY)
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

describe('empty state and labels', () => {
  it('only treats a page with no number at all as empty', () => {
    expect(allStatsUnavailable({})).toBe(true)
    expect(allStatsUnavailable(EMPTY)).toBe(true)
    expect(allStatsUnavailable({ ...EMPTY, pendingLeave: 0 })).toBe(false)
  })

  it('names the admin role in Thai and falls back to a dash', () => {
    expect(adminRoleLabel('system_admin')).toBe('ผู้ดูแลระบบ')
    expect(adminRoleLabel('hr')).toBe('เจ้าหน้าที่ HR')
    expect(adminRoleLabel('unknown')).toBe('—')
    expect(adminRoleLabel(null)).toBe('—')
  })
})

describe('shortcuts', () => {
  it('still offers only HR pages that exist in the router', () => {
    expect(ADMIN_SHORTCUTS.length).toBeGreaterThanOrEqual(3)
    for (const shortcut of ADMIN_SHORTCUTS) {
      expect(allowedPathsByRole.hr, shortcut.to).toContain(shortcut.to)
    }
  })
})
