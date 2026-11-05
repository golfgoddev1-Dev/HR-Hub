// The two top menus are a floating dock. These checks pin the behaviour the
// restyle must not lose: real routes, a real pending badge, the real logout call
// and one indicator that follows the router instead of a hardcoded position.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const LEAVE = readFileSync(new URL('../src/components/LeaveNav.vue', import.meta.url), 'utf8')
const HR = readFileSync(new URL('../src/components/HrNav.vue', import.meta.url), 'utf8')
const APPROVAL_ITEMS = readFileSync(
  new URL('../src/lib/leave-nav-items.js', import.meta.url),
  'utf8'
)

const NAVS = [
  ['LeaveNav.vue', LEAVE],
  ['HrNav.vue', HR],
]

const HR_ROUTES = [
  '/hr',
  '/hr/employees',
  '/hr/employees/import',
  '/hr/employees/manage',
  '/hr/employees/password',
  '/hr/leave',
  '/leave/calendar',
  '/hr/leave/backdated',
  '/hr/leave/holidays',
  '/hr/leave/approvers',
  '/hr/leave/settings',
]

const LEAVE_LABELS = [
  "label: 'ใบลาของฉัน'",
  "label: 'ยื่นใบลา'",
  "label: 'ปฏิทินการลา'",
  "label: 'ข้อมูลส่วนตัว'",
  "label: 'เปลี่ยน PIN'",
]

describe.each(NAVS)('%s dock', (_name, source) => {
  it('never links to a hash', () => {
    expect(source).not.toMatch(/href\s*=\s*["']#/)
  })

  it('takes the active state from RouterLink', () => {
    expect(source).toContain('<RouterLink')
    expect(source).toContain('active-class="dock-item-active"')
    expect(source).not.toMatch(/\bisActive\b/)
  })

  it('moves one indicator from measured element state', () => {
    expect(source).toContain('ref="rail"')
    expect(source).toContain('offsetLeft')
    expect(source).toContain('offsetWidth')
    expect(source).toContain(':style="indicatorStyle"')
    expect(source).toContain('translateX(${dot.value.x}px)')
    // No fixed pixel offset anywhere: the x must come from the measurement.
    expect(source).not.toMatch(/translateX\(\s*-?\d+px/)
  })

  it('logs out through the real endpoint before navigating', () => {
    const post = source.indexOf("fetch('/api/auth/logout'")
    const go = source.indexOf("window.location.assign('/login')")
    expect(post).toBeGreaterThan(-1)
    expect(go).toBeGreaterThan(post)
    expect(source).not.toMatch(/กำลังออก|logging out/i)
  })

  it('keeps a 3px focus ring and disables motion when asked', () => {
    expect(source).toContain(':focus-visible')
    expect(source).toContain('outline: 3px solid #0f6f63')
    expect(source).toContain('prefers-reduced-motion: reduce')
  })
})

describe('leave dock badge', () => {
  it('renders the real pending count', () => {
    expect(LEAVE).toContain('pendingCount')
    expect(LEAVE).toContain('{{ item.badge }}')
  })

  it('has no badge at zero', () => {
    expect(LEAVE).toContain('v-if="item.badge > 0"')
    expect(LEAVE).not.toMatch(/dock-badge[^>]*>\s*\d/)
  })
})

describe('leave dock items', () => {
  it('keeps every label and its order, with approvals appended last', () => {
    for (const label of LEAVE_LABELS) expect(LEAVE).toContain(label)

    const positions = LEAVE_LABELS.map((label) => LEAVE.indexOf(label))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(LEAVE.indexOf('const approvals = approvalsMenuItem(')).toBeGreaterThan(
      LEAVE.indexOf("label: 'เปลี่ยน PIN'")
    )
    // The approvals entry, its icon and its badge come from the shared helper.
    expect(APPROVAL_ITEMS).toContain("APPROVALS_ICON = 'fact_check'")
  })
})

describe('HR dock items', () => {
  it('keeps all eleven items and routes, including the leave calendar', () => {
    expect((HR.match(/label: '/g) ?? []).length).toBe(11)
    for (const route of HR_ROUTES) expect(HR, route).toContain(`to: '${route}'`)
    expect(HR).toContain("label: 'ปฏิทินการลา'")
    expect(HR).toContain("icon: 'calendar_month'")
  })
})
