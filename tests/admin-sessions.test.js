import { describe, expect, it } from 'vitest'

import {
  IDLE_MINUTES,
  isListTruncated,
  personName,
  readSessions,
  revokeUrl,
  unlockUrl,
} from '../src/lib/admin-sessions.js'
import { auditActionLabel } from '../src/lib/admin-audit.js'
import { readSource } from './helpers/read-source.js'

const session = (over = {}) => ({
  id: 's1',
  employeeId: 'e1',
  createdAt: '2026-11-27T01:00:00Z',
  lastActiveAt: '2026-11-27T04:00:00Z',
  ...over,
})

describe('urls and names', () => {
  it('encodes ids into the two write urls', () => {
    expect(revokeUrl('a/b')).toBe('/api/admin/sessions/a%2Fb/revoke')
    expect(unlockUrl('e 1')).toBe('/api/admin/accounts/e%201/unlock')
  })

  it('shows name and code, whichever exists', () => {
    expect(personName({ fullName: 'สมชาย', employeeCode: 'E1' })).toBe('สมชาย (E1)')
    expect(personName({ fullName: null, employeeCode: 'E1' })).toBe('E1')
    expect(personName(null)).toBe('ไม่ทราบชื่อ')
  })

  it('matches the Worker idle window', () => {
    expect(IDLE_MINUTES).toBe(15)
  })
})

describe('reading a reply', () => {
  it('returns null for anything unusable', () => {
    expect(readSessions(null)).toBeNull()
    expect(readSessions({ ok: false })).toBeNull()
    expect(readSessions({ ok: true, sessions: [] })).toBeNull()
  })

  it('drops rows missing an id or a time', () => {
    const data = readSessions({
      ok: true,
      sessions: [session(), { id: 'x' }, null],
      locked: [{ employeeId: 'e2', lockedUntil: '2026-11-27T05:00:00Z' }, { employeeId: 'e3' }],
      sessionsLimit: 100,
    })
    expect(data.sessions).toHaveLength(1)
    expect(data.locked).toHaveLength(1)
  })

  it('knows when the list was cut at the limit', () => {
    const rows = Array.from({ length: 2 }, (_, i) => session({ id: `s${i}` }))
    const make = (limit) => readSessions({ ok: true, sessions: rows, locked: [], sessionsLimit: limit })
    expect(isListTruncated(make(2))).toBe(true)
    expect(isListTruncated(make(100))).toBe(false)
    expect(isListTruncated(null)).toBe(false)
  })

  it('has audit wording for both new actions', () => {
    expect(auditActionLabel('session_revoked')).toBe('ออกจากระบบให้ผู้ใช้')
    expect(auditActionLabel('account_unlocked')).toBe('ปลดล็อกบัญชี')
  })
})

describe('sessions page source', () => {
  const PAGE = readSource('src/pages/AdminSessionsPage.vue')
  const STYLE = PAGE.slice(PAGE.indexOf('<style'))

  it('asks twice before signing someone out, and never for the own session', () => {
    expect(PAGE).toContain('confirmId = session.id')
    expect(PAGE).toContain('ยืนยันออกจากระบบ')
    expect(PAGE).toMatch(/v-if="session\.isOwn"/)
  })

  it('uses POST for both writes and reads nothing secret', () => {
    expect(PAGE).toContain("method: 'POST'")
    expect(PAGE).not.toMatch(/token|pin_hash|nationalId/i)
  })

  it('follows the touch, hover and motion rules', () => {
    expect(STYLE.indexOf(':hover')).toBeGreaterThan(STYLE.indexOf('@media (hover: hover) and (pointer: fine)'))
    expect(STYLE).toContain('min-height: var(--tap-target)')
    expect(STYLE).toContain('@media (prefers-reduced-motion: reduce)')
    expect(STYLE).not.toMatch(/transition:[^;]*(width|height|top|left|margin|padding)/)
  })
})
