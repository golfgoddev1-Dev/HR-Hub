// One shell for every signed-in page. These checks pin the rule that fixes the
// menu swap: the route parent chooses the navigation from the session role, so a
// meeting controller on /leave keeps the meeting sidebar.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { NAV_SECTION_LABELS, leaveNavItems, navSections } from '../src/lib/nav-config.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const ROUTER = read('src/router.js')
const ROLE_SHELL = read('src/components/RoleShell.vue')
const CONTROLLER_SHELL = read('src/components/ControllerShell.vue')
const CONTROLLER_LAYOUT = read('src/components/ControllerLayout.vue')

const SHELL_BLOCK = ROUTER.slice(
  ROUTER.indexOf('component: RoleShell'),
  ROUTER.indexOf("path: '/leave/hr/requests/:id/print'")
)

const LEAVE_PAGES = [
  'LeaveHomePage.vue',
  'LeaveRequestPage.vue',
  'LeaveCalendarPage.vue',
  'LeaveApprovalsPage.vue',
  'ProfilePage.vue',
  'ChangePinPage.vue',
]

const CONTROLLER_PAGES = [
  'ControllerOverviewPage.vue',
  'ControllerQrPage.vue',
  'ControllerRosterPage.vue',
  'ControllerDashboardPage.vue',
  'RegistrantsPage.vue',
  'ControllerEmployeeDataPage.vue',
  'MeetingBackfillHistoryPage.vue',
  'MeetingBackfillImportPage.vue',
]

const ROLES = ['employee', 'hr', 'meeting_controller', 'system_admin']

describe('role shell routing', () => {
  it('declares exactly one shell parent and every page inside it', () => {
    expect((ROUTER.match(/component: RoleShell,/g) ?? []).length).toBe(1)
    expect(ROUTER).not.toContain('component: AppLayout,')

    for (const path of [
      '/leave',
      '/leave/new',
      '/leave/calendar',
      '/leave/approvals',
      '/profile',
      '/change-pin',
      '/hr',
      '/meeting/controller',
      '/meeting/controller/qr',
      '/admin',
    ]) {
      expect(SHELL_BLOCK, path).toContain(`path: '${path}'`)
    }
  })

  it('chooses the meeting controller shell for a meeting session, the dock otherwise', () => {
    expect(ROLE_SHELL).toContain("role === 'meeting_controller'")
    expect(ROLE_SHELL).toContain('<ControllerShell')
    expect(ROLE_SHELL).toContain('<AppLayout')
    expect(ROLE_SHELL).not.toContain('AppDock')
    expect(ROLE_SHELL).toContain("employee: 'leave'")
    expect(ROLE_SHELL).toContain("hr: 'hr'")
    expect(ROLE_SHELL).toContain("system_admin: 'admin'")
  })

  it('keeps the controller frame mounted with RouterView across pages', () => {
    expect(CONTROLLER_SHELL).toContain('<ControllerLayout>')
    expect(CONTROLLER_SHELL).toContain('<RouterView />')
    expect(CONTROLLER_SHELL).not.toContain('<slot')
    // ControllerLayout still owns the one content wrapper and its slot.
    expect(CONTROLLER_LAYOUT).toContain('<slot')
    expect(CONTROLLER_LAYOUT).not.toContain('<RouterView')
  })

  it('uses the controller content wrapper for shared pages, with no second padding', () => {
    expect(CONTROLLER_LAYOUT).toContain('.controller-content :deep(.content)')
    expect(CONTROLLER_LAYOUT).toContain('padding: 0 0 48px')
  })

  it('lifts every nav path into the one shell, for every role', () => {
    for (const role of ROLES) {
      const items = navSections({ role, isApprover: true, pendingCount: 1 }).flatMap(
        (section) => section.items
      )

      for (const item of items) {
        if (item.disabled) {
          expect(item.to, role).toBeUndefined()
          continue
        }
        expect(SHELL_BLOCK, `${role} ${item.to}`).toContain(`path: '${item.to}'`)
      }
    }
  })

  it('shows the my-work section once in every shell with that role\'s items', () => {
    for (const role of ROLES) {
      const mine = navSections({ role, isApprover: role === 'employee' }).filter(
        (section) => section.id === 'mine'
      )

      expect(mine, role).toHaveLength(1)
      expect(mine[0].label).toBe(NAV_SECTION_LABELS.mine)
      const expected =
        role === 'system_admin'
          ? ['/leave', '/leave/new', '/profile']
          : ['/leave', '/leave/new', '/leave/calendar', '/profile']
      expect(mine[0].items.map((item) => item.to), role).toEqual(expected)
    }
  })

  it('puts the approvals badge in the approver section only', () => {
    const sections = navSections({ role: 'hr', isApprover: true, pendingCount: 7 })

    expect(sections.at(-1).id).toBe('approver')
    expect(sections.at(-1).items[0]).toMatchObject({
      to: '/leave/approvals',
      badge: 7,
    })

    for (const section of sections.slice(0, -1)) {
      expect(section.items.every((item) => item.badge === undefined), section.id).toBe(true)
    }
  })

  it('keeps navigation out of the pages', () => {
    for (const name of LEAVE_PAGES) {
      const source = read(`src/pages/${name}`)
      expect(source, name).not.toMatch(/AppDock|AdminNav|ControllerNav|ControllerLayout|AppLayout/)
    }

    for (const name of CONTROLLER_PAGES) {
      expect(read(`src/pages/${name}`), name).not.toContain('ControllerLayout')
    }
  })
})
