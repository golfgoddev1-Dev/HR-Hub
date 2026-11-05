// Router wiring checks that need no browser:
// - HR can reach the employee management page that the menu links to;
// - the router declares no /admin page, so nothing may send a role there.
import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
// Both menus come from one shared config module now.
const NAV_CONFIG = readFileSync(new URL('../src/lib/nav-config.js', import.meta.url), 'utf8')
const ADMIN_PAGE = readFileSync(new URL('../src/pages/AdminPage.vue', import.meta.url), 'utf8')
const ADMIN_NAV = readFileSync(new URL('../src/components/AdminNav.vue', import.meta.url), 'utf8')
// The role allow-lists now live in their own module, which the guard imports.
const ROUTE_ACCESS = readFileSync(
  new URL('../src/lib/route-access.js', import.meta.url),
  'utf8'
)
const HR_PASSWORD_PAGE = readFileSync(
  new URL('../src/pages/HrPasswordPage.vue', import.meta.url),
  'utf8'
)
const CHANGE_PIN_PAGE = readFileSync(new URL('../src/pages/ChangePinPage.vue', import.meta.url), 'utf8')
const SET_PIN_PAGE = readFileSync(new URL('../src/pages/SetPinPage.vue', import.meta.url), 'utf8')
const LOGIN_PAGE = readFileSync(new URL('../src/pages/LoginPage.vue', import.meta.url), 'utf8')
const PENDING_PAGE = readFileSync(new URL('../src/pages/PendingPage.vue', import.meta.url), 'utf8')
const PAGES_DIR = new URL('../src/pages/', import.meta.url)

/** The allow-list array of one role, as written in src/lib/route-access.js. */
function allowListFor(role) {
  const start = ROUTE_ACCESS.indexOf(`${role}: [`)
  if (start === -1) return []
  const end = ROUTE_ACCESS.indexOf(']', start)
  return (ROUTE_ACCESS.slice(start, end).match(/'[^']+'/g) ?? []).map((value) => value.slice(1, -1))
}

describe('HR allow-list', () => {
  it('includes the employee management page that the menu links to', () => {
    expect(allowListFor('hr')).toContain('/hr/employees/manage')
    expect(NAV_CONFIG).toContain("to: '/hr/employees/manage'")
  })

  it('includes every leave tool the HR menu links to', () => {
    const allowList = allowListFor('hr')
    for (const path of [
      '/hr/leave',
      '/hr/leave/backdated',
      '/hr/leave/approvers',
      '/hr/leave/holidays',
      '/hr/leave/settings',
    ]) {
      expect(allowList, path).toContain(path)
    }
  })
})

describe('system_admin landing page', () => {
  it('declares /admin with the admin page', () => {
    expect(ROUTER).toContain("path: '/admin'")
    expect(ROUTER).toContain('AdminPage')
  })

  it('lets only system_admin reach /admin', () => {
    expect(allowListFor('system_admin')).toContain('/admin')
    for (const role of ['employee', 'hr', 'meeting_controller']) {
      expect(allowListFor(role), role).not.toContain('/admin')
    }
  })

  it('shows the overview heading, the stat bar and the admin menu', () => {
    expect(ADMIN_PAGE).toContain('ภาพรวมผู้ดูแล')
    expect(ADMIN_PAGE).not.toContain('AppLayout')
    expect(ADMIN_PAGE).toContain('ADMIN_STATS')
    expect(ADMIN_PAGE).toContain('ADMIN_SHORTCUTS')
    // A card without a number must show a dash, never a substitute value.
    expect(ADMIN_PAGE).toContain('ADMIN_NO_VALUE')
    expect(ADMIN_PAGE).not.toContain('หน้านี้อยู่ระหว่างพัฒนา')
  })

  it('names the one admin menu item ภาพรวมผู้ดูแล and points it at /admin', () => {
    expect(ADMIN_NAV).toContain('ภาพรวมผู้ดูแล')
    expect(ADMIN_NAV).toContain('to="/admin"')
  })

  it('the admin menu links only to the page that exists', () => {
    const targets = [...ADMIN_NAV.matchAll(/to="([^"]+)"/g)].map((match) => match[1])
    expect(targets).toEqual(['/admin'])
    expect(ADMIN_NAV).not.toContain('href=')
  })

  it('marks the unfinished items as disabled without a route', () => {
    // Exactly one real link in the menu, and it is the page that exists.
    expect((ADMIN_NAV.match(/<RouterLink/g) ?? []).length).toBe(1)
    expect((ADMIN_NAV.match(/to="/g) ?? []).length).toBe(1)

    expect(ADMIN_NAV).toContain('aria-disabled="true"')
    expect(ADMIN_NAV).toContain('nav-link-disabled')
    expect(ADMIN_NAV).toContain("label: 'จัดการผู้ใช้'")
    expect(ADMIN_NAV).toContain("label: 'ตั้งค่าระบบ'")
    expect(ADMIN_NAV).toContain('เร็วๆ นี้')

    // The disabled items carry no target of any kind.
    expect(ADMIN_NAV).not.toMatch(/disabledItems[\s\S]*?to:/)
    expect(ADMIN_NAV).not.toContain('href=')
  })

  it('is rendered by the admin page only, so no other role sees it', () => {
    // AppLayout owns the menu component; pages only pick it through the prop.
    expect(ROUTER).toContain("props: { nav: 'admin' }")
    const layout = readFileSync(new URL('../src/components/AppLayout.vue', import.meta.url), 'utf8')
    expect(layout).toContain('<AdminNav')

    const importers = readdirSync(PAGES_DIR)
      .filter((name) => name.endsWith('.vue'))
      .filter((name) => readFileSync(new URL(name, PAGES_DIR), 'utf8').includes('<AdminNav'))
    expect(importers).toEqual([])
  })

  it('still has the catch-all so an unknown path is not a blank screen', () => {
    expect(ROUTER).toContain("path: '/:pathMatch(.*)*'")
  })
})

describe('employee leave landing', () => {
  it('routes /leave to the real leave page, not the placeholder', () => {
    expect(ROUTER).toMatch(/import LeaveHomePage from '\.\/pages\/LeaveHomePage\.vue'/)
    expect(ROUTER).toMatch(/\{ path: '\/leave', component: LeaveHomePage/)
  })

  it('lets the employee role stay on /leave', () => {
    expect(allowListFor('employee')).toContain('/leave')
  })

  it('forwards /pending?to=/leave instead of showing the placeholder', () => {
    // The API still sends employees to /pending?to=%2Fleave, so the placeholder
    // must follow the route table rather than a list that can miss a new page.
    expect(PENDING_PAGE).not.toContain('READY_ROUTES')
    expect(PENDING_PAGE).toMatch(/router\.resolve\(/)
    expect(PENDING_PAGE).toContain('meta?.catchAll')
  })
})

describe('employee change-PIN menu', () => {
  it('allows the employee role to reach /change-pin', () => {
    expect(allowListFor('employee')).toContain('/change-pin')
    expect(ROUTER).toMatch(/path: '\/change-pin'.*requiresAuth: true/)
  })

  it('links it from the employee menu', () => {
    expect(NAV_CONFIG).toContain("to: '/change-pin'")
    expect(NAV_CONFIG).toContain("label: 'เปลี่ยน PIN'")
  })

  it('shows the employee menu on the change-PIN page through the layout route', () => {
    // Content only: the leave layout route mounts the dock around this page.
    expect(CHANGE_PIN_PAGE).not.toContain('LeaveLayout')
    expect(CHANGE_PIN_PAGE).not.toContain('<AppDock')
    expect(CHANGE_PIN_PAGE).toContain('<main class="content">')
  })

  it('is not offered to any other role', () => {
    for (const role of ['hr', 'meeting_controller', 'system_admin']) {
      expect(allowListFor(role), role).not.toContain('/change-pin')
    }
  })
})

describe('set-PIN success flow', () => {
  it('replaces the set-PIN entry so back does not return to it', () => {
    expect(SET_PIN_PAGE).toContain("router.replace('/login?reset=1')")
    expect(SET_PIN_PAGE).not.toContain('router.push')
  })

  it('shows the confirmation banner on the login page without storing anything', () => {
    expect(LOGIN_PAGE).toContain('role="status"')
    expect(LOGIN_PAGE).toContain('ตั้ง PIN สำเร็จ กรุณาเข้าสู่ระบบด้วย PIN ใหม่')
    expect(LOGIN_PAGE).not.toContain('localStorage')
    expect(LOGIN_PAGE).not.toContain('sessionStorage')
  })
})

describe('HR password page', () => {
  it('is reachable for HR and linked from the HR menu', () => {
    expect(allowListFor('hr')).toContain('/hr/employees/password')
    expect(NAV_CONFIG).toContain("to: '/hr/employees/password'")
    expect(NAV_CONFIG).toContain('จัดการรหัสผ่านพนักงาน')
    expect(ROUTER).toContain("path: '/hr/employees/password'")
    expect(ROUTER).toContain('HrPasswordPage')
  })

  it('keeps the one-time values on screen only and warns they are shown once', () => {
    expect(HR_PASSWORD_PAGE).not.toContain('AppLayout')
    expect(HR_PASSWORD_PAGE).toContain('แสดงเพียงครั้งเดียว')
    expect(HR_PASSWORD_PAGE).toContain('onBeforeUnmount')
    expect(HR_PASSWORD_PAGE).not.toContain('localStorage')
    expect(HR_PASSWORD_PAGE).not.toContain('sessionStorage')
  })

  it('is not offered to any other role', () => {
    for (const role of ['employee', 'meeting_controller', 'system_admin']) {
      expect(allowListFor(role), role).not.toContain('/hr/employees/password')
    }
  })
})
