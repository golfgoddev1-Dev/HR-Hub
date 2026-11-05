// The shell no longer wraps each page: one route parent mounts the nav and swaps
// only the routed page, so the nav element cannot remount and flicker when the
// user moves between leave pages.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
const APP_LAYOUT = readFileSync(
  new URL('../src/components/AppLayout.vue', import.meta.url),
  'utf8'
)
const ROLE_SHELL = readFileSync(
  new URL('../src/components/RoleShell.vue', import.meta.url),
  'utf8'
)

const LEAVE_PAGES = [
  'ChangePinPage.vue',
  'LeaveApprovalsPage.vue',
  'LeaveHomePage.vue',
  'LeaveRequestPage.vue',
  'ProfilePage.vue',
]

const page = (name) => readFileSync(new URL(`../src/pages/${name}`, import.meta.url), 'utf8')

describe('persistent leave layout', () => {
  it('is the one shell route parent, so the dock mounts once for all leave pages', () => {
    const shell = ROUTER.indexOf('component: RoleShell')
    expect(shell).toBeGreaterThan(-1)
    expect(ROUTER.slice(shell - 120, shell + 60)).toContain('path: \'/\',')
    expect(ROLE_SHELL).toContain("employee: 'leave'")
  })

  it('keeps the five leave pages plus the calendar and change-PIN inside it', () => {
    const block = ROUTER.slice(
      ROUTER.indexOf('component: RoleShell'),
      ROUTER.indexOf("path: '/leave/hr/requests/:id/print'")
    )
    for (const path of ['/change-pin', '/leave', '/leave/new', '/leave/approvals', '/leave/calendar', '/profile']) {
      expect(block, path).toContain(`path: '${path}'`)
    }
  })

  it('leaves every leave page content only', () => {
    for (const name of LEAVE_PAGES) {
      const source = page(name)
      expect(source, name).not.toContain('LeaveLayout')
      expect(source, name).not.toContain('AppLayout')
      expect(source, name).not.toContain('AppDock')
    }
  })

  it('does not bring the menu in anywhere but the layout', () => {
    expect(APP_LAYOUT).toContain("import AppDock from './AppDock.vue'")
    for (const name of LEAVE_PAGES) {
      expect(page(name), name).not.toMatch(/import LeaveNav|import HrNav/)
    }
  })

  it('swaps the page with RouterView so the dock node survives navigation', () => {
    expect(APP_LAYOUT).toContain('<RouterView />')
    expect(APP_LAYOUT).not.toContain('<slot')
  })
})
