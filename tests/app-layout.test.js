// One shell, mounted by the router. These checks pin the structure that keeps a
// signed-in user inside one navigation: RoleShell owns the shell for the session
// role, the routed page renders below it, and pages are content only.
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
const ROLE_SHELL = readFileSync(join(COMPONENTS, 'RoleShell.vue'), 'utf8')
const CONTROLLER_SHELL = readFileSync(join(COMPONENTS, 'ControllerShell.vue'), 'utf8')

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

const MEETING_PATHS = [
  '/meeting/controller',
  '/meeting/controller/qr',
  '/meeting/controller/roster',
  '/meeting/controller/dashboard',
  '/meeting/controller/registrants',
  '/meeting/controller/employees',
  '/meeting/controller/backfill',
  '/meeting/controller/backfill/import',
]

/** Every path string the router declares, in source order, de-duplicated. */
const DECLARED_PATHS = [...new Set([...ROUTER.matchAll(/path: '([^']*)'/g)].map((m) => m[1]))]

/** The one shell parent and its children, up to the shell-less print page. */
const SHELL_BLOCK = ROUTER.slice(
  ROUTER.indexOf('component: RoleShell'),
  ROUTER.indexOf("path: '/leave/hr/requests/:id/print'")
)

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
      expect(source, name).not.toMatch(/<ControllerLayout/)
    }
  })

  it('gives every page content only: no layout wrapper, no layout import', () => {
    for (const name of PAGE_FILES) {
      const source = page(name)
      expect(source, name).not.toMatch(/<AppLayout|<LeaveLayout|<ControllerLayout/)
      expect(source, name).not.toMatch(/<\/AppLayout>|<\/LeaveLayout>|<\/ControllerLayout>/)
      expect(source, name).not.toMatch(
        /import (AppLayout|LeaveLayout|ControllerLayout|LeaveNav|HrNav) from/
      )
    }
  })
})

describe('persistent shell route', () => {
  it('declares one shell parent that chooses the nav from the session role', () => {
    expect((ROUTER.match(/component: RoleShell,/g) ?? []).length).toBe(1)
    expect(ROLE_SHELL).toContain("role === 'meeting_controller'")
    expect(ROLE_SHELL).toContain('<ControllerShell')
    expect(ROLE_SHELL).toContain('<AppLayout')
    // The shell never mounts a menu itself: it delegates to the one real nav.
    expect(ROLE_SHELL).not.toContain('<AppDock')
    expect(ROLE_SHELL).not.toContain('<AdminNav')
  })

  it('keeps the employee/approver pages under the shell', () => {
    for (const path of LEAVE_PATHS) {
      expect(SHELL_BLOCK, path).toContain(`path: '${path}'`)
      expect(DECLARED_PATHS, path).toContain(path)
    }
  })

  it('keeps every HR page under the same shell', () => {
    for (const path of HR_PATHS) {
      expect(SHELL_BLOCK, path).toContain(`path: '${path}'`)
      expect(DECLARED_PATHS, path).toContain(path)
    }
  })

  it('keeps every meeting page under the same shell, not a per-page wrapper', () => {
    for (const path of MEETING_PATHS) {
      expect(SHELL_BLOCK, path).toContain(`path: '${path}'`)
      expect(DECLARED_PATHS, path).toContain(path)
    }
    expect(CONTROLLER_SHELL).toContain('<RouterView />')
  })

  it('keeps /admin and its permission child under the shell', () => {
    expect(SHELL_BLOCK).toContain("path: '/admin'")
    expect(SHELL_BLOCK).toContain('AdminPage')
    expect(SHELL_BLOCK).toContain("path: '/admin/permissions'")
    expect(SHELL_BLOCK).toContain("meta: { requiresAuth: true, role: 'system_admin' }")
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
      '/admin/permissions',
      '/:pathMatch(.*)*',
    ]
    expect(DECLARED_PATHS.sort()).toEqual(expected.sort())
  })

  it('keeps every child reachable for the role the shell serves', () => {
    for (const path of LEAVE_PATHS) {
      expect(canOpenPath('employee', path), path).toBe(true)
    }

    for (const path of HR_PATHS) {
      const concrete = path.replace(':id', 'emp-1')
      expect(canOpenPath('hr', concrete), path).toBe(true)
    }

    for (const path of MEETING_PATHS) {
      expect(canOpenPath('meeting_controller', path), path).toBe(true)
    }

    // A meeting session reaches the shared leave pages through its employee row.
    const meeting = { role: 'meeting_controller', hasEmployee: true }
    for (const path of LEAVE_PATHS) {
      if (path === '/leave/approvals') continue
      expect(canOpenPath('meeting_controller', path, meeting), path).toBe(true)
    }
    // The queue itself follows the approver row.
    expect(
      canOpenPath('meeting_controller', '/leave/approvals', {
        ...meeting,
        isApprover: true,
      })
    ).toBe(true)
  })
})
