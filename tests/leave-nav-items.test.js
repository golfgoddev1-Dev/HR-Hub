// The leave menu entry for approvers. These are the four states the menu must
// get right, worked out on plain data so no browser is needed:
// - a non-approver never sees the item;
// - an active approver sees it even with nothing pending, with no badge;
// - pending requests add a badge with the count;
// - a deactivated approver row means isApprover is false, so no item.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  APPROVALS_LABEL,
  APPROVALS_PATH,
  approvalsMenuItem,
  badgeCount,
} from '../src/lib/leave-nav-items.js'

const APP_LAYOUT = readFileSync(new URL('../src/components/AppLayout.vue', import.meta.url), 'utf8')
const NAV_CONFIG = readFileSync(new URL('../src/lib/nav-config.js', import.meta.url), 'utf8')

describe('approvals menu entry', () => {
  it('is absent for an employee who is not an approver', () => {
    expect(approvalsMenuItem({ isApprover: false, pendingCount: 0 })).toBeNull()
    // A count alone never proves approver status: it comes from the server.
    expect(approvalsMenuItem({ isApprover: false, pendingCount: 3 })).toBeNull()
    expect(approvalsMenuItem({})).toBeNull()
    expect(approvalsMenuItem()).toBeNull()
  })

  it('is present for an active approver with an empty queue, and has no badge', () => {
    const item = approvalsMenuItem({ isApprover: true, pendingCount: 0 })

    expect(item).not.toBeNull()
    expect(item.label).toBe('อนุมัติใบลา')
    expect(item.label).toBe(APPROVALS_LABEL)
    expect(item.to).toBe(APPROVALS_PATH)
    expect(item.icon).toBe('fact_check')
    expect(item.badge).toBe(0)
    expect(item.ariaLabel).toBe('อนุมัติใบลา')
    expect(item.ariaLabel).not.toContain('(')
  })

  it('shows the pending count as a badge, without changing the label', () => {
    const item = approvalsMenuItem({ isApprover: true, pendingCount: 2 })

    expect(item.label).toBe('อนุมัติใบลา')
    expect(item.badge).toBe(2)
    expect(item.ariaLabel).toBe('อนุมัติใบลา (2)')
    expect(item.to).toBe('/leave/approvals')
  })

  it('is absent for a deactivated approver, because the server says false', () => {
    // A deactivated approver record keeps its row but reports isApprover = false.
    expect(approvalsMenuItem({ isApprover: false, pendingCount: 0 })).toBeNull()
    expect(approvalsMenuItem({ isApprover: 'true', pendingCount: 2 })).toBeNull()
  })

  it('never shows a badge for unusable counts', () => {
    expect(badgeCount(0)).toBe(0)
    expect(badgeCount(-1)).toBe(0)
    expect(badgeCount(null)).toBe(0)
    expect(badgeCount(undefined)).toBe(0)
    expect(badgeCount('abc')).toBe(0)
    expect(badgeCount('3')).toBe(3)
    expect(badgeCount(2.7)).toBe(2)
  })
})

describe('AppLayout wiring', () => {
  it('asks the session for isApprover once and builds the entry from it', () => {
    expect(APP_LAYOUT).toContain("import { getSession } from '../api.js'")
    expect(APP_LAYOUT).toContain('isApprover: isApprover.value')
    // The queue is read through the shared cache now; the layout still asks once.
    expect(APP_LAYOUT).toContain('loadShared(DATA_KEYS.approvals')
    // The approvals entry is built by the shared section config from that flag.
    expect(APP_LAYOUT).toContain('navSections({')
  })

  it('places the approver section after the my-work section', () => {
    const mine = NAV_CONFIG.indexOf("id: 'mine'")
    const approval = NAV_CONFIG.indexOf("id: 'approver'")
    expect(mine).toBeGreaterThan(-1)
    expect(approval).toBeGreaterThan(mine)
  })

  it('keeps the five base items, including change PIN, in the shared config', () => {
    expect(NAV_CONFIG).toContain("to: '/change-pin'")
    expect(NAV_CONFIG).toContain("label: 'เปลี่ยน PIN'")
  })
})
