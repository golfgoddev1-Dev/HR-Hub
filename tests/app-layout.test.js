// One dock, mounted by the layout route. These checks pin the structure that
// removes the flicker: AppLayout owns the dock and the routed page renders below
// it, while pages are content only and can never mount a menu themselves.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canOpenPath } from '../src/lib/route-access.js'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const COMPONENTS = join(SRC, 'components')
const PAGES = join(SRC, 'pages')

const LAYOUT = readFileSync(join(COMPONENTS, 'AppLayout.vue'), 'utf8')
const ROUTER = readFileSync(join(SRC, 'router.js'), 'utf8')

const PAGE_FILES = readdirSync(PAGES).filter((name) => name.endsWith('.vue'))

function vueFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return entry.endsWith('.vue') ? [full] : []
  })
}

const page = (name) => readFileSync(join(PAGES, name), 'utf8')

const LEAVE_PATHS = [
  '/change-pin',
  '/leave',
  '/leave/new',
  '/leave/approvals',
  '/leave/calendar',
  '/profile',
]

const HR_PATHS = [
  '/hr',
  '/hr/employees',
  '/hr/employees/manage',
  '/hr/employees/password',
  '/hr/employees/import',
  '/hr/employees/:id',
  '/hr/leave',
  '/hr/leave/backdated',
  '/hr/leave/approvers',
  '/hr/leave/holidays',
  '/hr/leave/settings',
]

/** Every path string the router declares, in source order, de-duplicated. */
const DECLARED_PATHS = [...new Set([...ROUTER.matchAll(/path: '([^']*)'/g)].map((m) => m[1]))]

/** The route record that declares `props: { nav: '...' }`, up to the next one. */
function layoutBlock(nav) {
  const marker = `props: { nav: '${nav}' }`
  const start = ROUTER.indexOf(marker)
  if (start === -1) return ''
  const next = ROUTER.indexOf("props: { nav: '", start + marker.length)
  return ROUTER.slice(start, next === -1 ? ROUTER.length : next)
}

const LEAVE_BLOCK = layoutBlock('leave')
const HR_BLOCK = layoutBlock('hr')
const ADMIN_BLOCK = layoutBlock('admin')

describe('shared app layout', () => {
  it('positions the dock with the same box every page used', () => {
    expect(LAYOUT).toContain('max-width: 1120px')
    expect(LAYOUT).toContain('margin: 0 auto')
    expect(LAYOUT).toContain('padding: 16px 20px 0')
  })

  it('renders the dock once, before the routed page', () => {
    const dock = LAYOUT.indexOf('<AppDock')
    const view = LAYOUT.indexOf('<RouterView />')
    expect(dock).toBeGreaterThan(-1)
    expect(view).toBeGreaterThan(dock)
    expect(LAYOUT).not.toContain('<slot')
  })

  it('keeps the admin menu on the admin layout only', () => {
    expect(LAYOUT).toContain('<AdminNav v-if="nav === \'admin\'"')
    expect(LAYOUT).toContain(':show-brand-badge="brand.badge"')
  })

  it('is the only file that imports the dock or the admin menu', () => {
    const importers = vueFiles(SRC)
      .filter((file) => /import (AppDock|AdminNav) from/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
    expect(importers).toEqual(['components/AppLayout.vue'])
  })

  it('mounts the dock from the layout, never from a page', () => {
    for (const name of PAGE_FILES) {
      const source = page(name)
      expect(source, name).not.toMatch(/<AppDock/)
      expect(source, name).not.toMatch(/<AdminNav/)
    }
  })

  it('gives every page content only: no layout wrapper, no layout import', () => {
    for (const name of PAGE_FILES) {
      const source = page(name)
      expect(source, name).not.toMatch(/<AppLayout|<LeaveLayout/)
      expect(source, name).not.toMatch(/<\/AppLayout>|<\/LeaveLayout>/)
      expect(source, name).not.toMatch(/import (AppLayout|LeaveLayout|LeaveNav|HrNav) from/)
    }
  })
})

describe('persistent layout routes', () => {
  it('declares one layout route per system, with AppLayout as parent', () => {
    expect(LEAVE_BLOCK).not.toBe('')
    expect(HR_BLOCK).not.toBe('')
    expect(ADMIN_BLOCK).not.toBe('')
    expect((ROUTER.match(/component: AppLayout,/g) ?? []).length).toBe(3)
    expect(ROUTER).toContain('props: { nav: \'leave\' }')
    expect(ROUTER).toContain('props: { nav: \'hr\' }')
    expect(ROUTER).toContain('props: { nav: \'admin\' }')
  })

  it('keeps the employee/approver pages under the leave layout', () => {
    for (const path of LEAVE_PATHS) {
      expect(LEAVE_BLOCK, path).toContain(`path: '${path}'`)
      expect(DECLARED_PATHS, path).toContain(path)
    }
    expect(LEAVE_BLOCK).toContain('hrDock: true')
    // The HR calendar branch is chosen by the route, not by the page.
    expect(LEAVE_BLOCK).toContain("meta: { requiresAuth: true, hrDock: true }")
  })

  it('keeps every HR page under the HR layout', () => {
    for (const path of HR_PATHS) {
      expect(HR_BLOCK, path).toContain(`path: '${path}'`)
      expect(DECLARED_PATHS, path).toContain(path)
    }
    expect(HR_BLOCK).not.toContain("path: '/leave'")
    expect(HR_BLOCK).not.toContain("path: '/profile'")
  })

  it('keeps /admin a single child of the admin layout', () => {
    expect(ROUTER).toMatch(/path: '\/admin',\s*component: AppLayout,/)
    expect(ADMIN_BLOCK).toContain('AdminPage')
    expect(ADMIN_BLOCK).toContain("path: ''")
    expect(ADMIN_BLOCK).not.toContain("path: '/leave'")
  })

  it('declares the same path strings as before, plus nothing new', () => {
    const expected = [
      '/login',
      '/pending',
      '/',
      '/set-pin',
      '/change-pin',
      '/leave',
      '/leave/new',
      '/leave/approvals',
      '/leave/calendar',
      '/profile',
      '/hr',
      '/hr/employees',
      '/hr/employees/manage',
      '/hr/employees/password',
      '/hr/employees/import',
      '/hr/employees/:id',
      '/hr/leave',
      '/hr/leave/backdated',
      '/hr/leave/approvers',
      '/hr/leave/holidays',
      '/hr/leave/settings',
      '/meeting/controller',
      '/meeting/controller/qr',
      '/meeting/controller/roster',
      '/meeting/controller/dashboard',
      '/meeting/controller/registrants',
      '/meeting/controller/employees',
      '/meeting/controller/backfill',
      '/meeting/controller/backfill/import',
      '/meeting/register',
      '/leave/hr/requests/:id/print',
      '/admin',
      // ระบบสิทธิ์ผู้ใช้: a second child of the admin layout, added with the page.
      '/admin/permissions',
      '',
      '/:pathMatch(.*)*',
    ]
    expect(DECLARED_PATHS.sort()).toEqual(expected.sort())
  })

  it('keeps every child reachable for the role the layout serves', () => {
    for (const path of LEAVE_PATHS) {
      expect(canOpenPath('employee', path), path).toBe(true)
    }
    expect(canOpenPath('hr', '/leave/calendar')).toBe(true)

    for (const path of HR_PATHS) {
      const concrete = path.replace(':id', 'emp-1')
      expect(canOpenPath('hr', concrete), path).toBe(true)
    }
  })

  it('leaves the meeting controller routes outside both app layouts', () => {
    expect(ROUTER).toContain("path: '/meeting/controller'")
    // The controller shell is still chosen by each page, not by these routes.
    expect(ROUTER).not.toMatch(/meeting\/controller[\s\S]{0,80}AppLayout/)
  })
})
