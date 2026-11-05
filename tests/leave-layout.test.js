// The employee/approver system no longer wraps each page: one layout route mounts
// the dock and swaps only the routed page, so the dock element cannot remount and
// flicker when the user moves between leave pages.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const ROUTER = readFileSync(new URL('../src/router.js', import.meta.url), 'utf8')
const APP_LAYOUT = readFileSync(
  new URL('../src/components/AppLayout.vue', import.meta.url),
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
  it('is a route parent, so the dock mounts once for all leave pages', () => {
    const parent = ROUTER.indexOf("props: { nav: 'leave' }")
    expect(parent).toBeGreaterThan(-1)
    expect(ROUTER.slice(parent - 200, parent)).toContain('component: AppLayout')
  })

  it('keeps the five leave pages plus the calendar and change-PIN inside it', () => {
    const block = ROUTER.slice(
      ROUTER.indexOf("props: { nav: 'leave' }"),
      ROUTER.indexOf("props: { nav: 'hr' }")
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
