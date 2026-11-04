// Router wiring checks that need no browser:
// - HR can reach the employee management page that the menu links to;
// - the router declares no /admin page, so nothing may send a role there.
import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
const HR_NAV = readFileSync(new URL('../src/components/HrNav.vue', import.meta.url), 'utf8')
const ADMIN_PAGE = readFileSync(new URL('../src/pages/AdminPage.vue', import.meta.url), 'utf8')
const ADMIN_NAV = readFileSync(new URL('../src/components/AdminNav.vue', import.meta.url), 'utf8')
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
