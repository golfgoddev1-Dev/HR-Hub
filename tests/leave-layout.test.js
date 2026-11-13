// The shell no longer wraps each page: one route parent mounts the nav and swaps
// only the routed page, so the nav element cannot remount and flicker when the
// user moves between leave pages.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const ROUTER = readSource(new URL('../src/router.js', import.meta.url))
const APP_LAYOUT = readSource(
  new URL('../src/components/AppLayout.vue', import.meta.url)
)
const ROLE_SHELL = readSource(
  new URL('../src/components/RoleShell.vue', import.meta.url)
)

const LEAVE_PAGES = [
  'ChangePinPage.vue',
  'LeaveApprovalsPage.vue',
  'LeaveHomePage.vue',
  'LeaveRequestPage.vue',
  'ProfilePage.vue',
]

const page = (name) => readSource(new URL(`../src/pages/${name}`, import.meta.url))

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
