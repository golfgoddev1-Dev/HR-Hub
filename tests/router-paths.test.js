// Router wiring checks that need no browser:
// - HR can reach the employee management page that the menu links to;
// - the router declares no /admin page, so nothing may send a role there.
import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
const HR_NAV = readFileSync(new URL('../src/components/HrNav.vue', import.meta.url), 'utf8')
const ADMIN_PAGE = readFileSync(new URL('../src/pages/AdminPage.vue', import.meta.url), 'utf8')
const ADMIN_NAV = readFileSync(new URL('../src/components/AdminNav.vue', import.meta.url), 'utf8')
const HR_PASSWORD_PAGE = readFileSync(
  new URL('../src/pages/HrPasswordPage.vue', import.meta.url),
  'utf8'
)
const LEAVE_NAV = readFileSync(new URL('../src/components/LeaveNav.vue', import.meta.url), 'utf8')
const CHANGE_PIN_PAGE = readFileSync(new URL('../src/pages/ChangePinPage.vue', import.meta.url), 'utf8')
const SET_PIN_PAGE = readFileSync(new URL('../src/pages/SetPinPage.vue', import.meta.url), 'utf8')
const LOGIN_PAGE = readFileSync(new URL('../src/pages/LoginPage.vue', import.meta.url), 'utf8')
const PAGES_DIR = new URL('../src/pages/', import.meta.url)

/** The allow-list array of one role, as written in src/router.js. */
function allowListFor(role) {
  const start = ROUTER.indexOf(`${role}: [`)
  if (start === -1) return []
  const end = ROUTER.indexOf(']', start)
  return (ROUTER.slice(start, end).match(/'[^']+'/g) ?? []).map((value) => value.slice(1, -1))
}

describe('HR allow-list', () => {
  it('includes the employee management page that the menu links to', () => {
    expect(allowListFor('hr')).toContain('/hr/employees/manage')
    expect(HR_NAV).toContain("to: '/hr/employees/manage'")
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

  it('shows the title, the in-progress notice and the admin menu', () => {
    expect(ADMIN_PAGE).toContain('ผู้ดูแลระบบ')
    expect(ADMIN_PAGE).toContain('หน้านี้อยู่ระหว่างพัฒนา')
    expect(ADMIN_PAGE).toContain('AdminNav')
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
    const importers = readdirSync(PAGES_DIR)
      .filter((name) => name.endsWith('.vue'))
      .filter((name) => readFileSync(new URL(name, PAGES_DIR), 'utf8').includes('AdminNav'))
    expect(importers).toEqual(['AdminPage.vue'])
  })

  it('still has the catch-all so an unknown path is not a blank screen', () => {
    expect(ROUTER).toContain("path: '/:pathMatch(.*)*'")
  })
})

describe('employee change-PIN menu', () => {
  it('allows the employee role to reach /change-pin', () => {
    expect(allowListFor('employee')).toContain('/change-pin')
    expect(ROUTER).toMatch(/path: '\/change-pin'.*requiresAuth: true/)
  })

  it('links it from the employee menu', () => {
    expect(LEAVE_NAV).toContain("to: '/change-pin'")
    expect(LEAVE_NAV).toContain("label: 'เปลี่ยน PIN'")
  })

  it('renders the employee menu on the change-PIN page', () => {
    expect(CHANGE_PIN_PAGE).toContain("import LeaveNav from '../components/LeaveNav.vue'")
    expect(CHANGE_PIN_PAGE).toContain('<LeaveNav />')
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
    expect(HR_NAV).toContain("to: '/hr/employees/password'")
    expect(HR_NAV).toContain('จัดการรหัสผ่านพนักงาน')
    expect(ROUTER).toContain("path: '/hr/employees/password'")
    expect(ROUTER).toContain('HrPasswordPage')
  })

  it('keeps the one-time values on screen only and warns they are shown once', () => {
    expect(HR_PASSWORD_PAGE).toContain('HrNav')
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
