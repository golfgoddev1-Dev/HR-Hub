// The shared shell: one box positions every top bar, whichever menu the page
// shows. A page that carries its own wrapper (or a menu with its own margin)
// puts the bar at another x/y, which is what these checks guard against.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const COMPONENTS_DIR = join(SRC, 'components')
const PAGES_DIR = join(SRC, 'pages')

const LAYOUT = readFileSync(join(COMPONENTS_DIR, 'AppLayout.vue'), 'utf8')
const HR_NAV = readFileSync(join(COMPONENTS_DIR, 'HrNav.vue'), 'utf8')
const ADMIN_NAV = readFileSync(join(COMPONENTS_DIR, 'AdminNav.vue'), 'utf8')

/** The HR pages with a top bar; the print page has no menu by design. */
const HR_PAGES = readdirSync(PAGES_DIR).filter(
  (name) => /^Hr.*\.vue$/.test(name) && name !== 'HrLeavePrintPage.vue'
)

function vueFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return vueFiles(full)
    return entry.endsWith('.vue') ? [full] : []
  })
}

const page = (name) => readFileSync(join(PAGES_DIR, name), 'utf8')

describe('shared app layout', () => {
  it('positions the bar with the same box the leave pages used', () => {
    expect(LAYOUT).toContain('max-width: 1120px')
    expect(LAYOUT).toContain('margin: 0 auto')
    expect(LAYOUT).toContain('padding: 16px 20px 0')
  })

  it('renders the nav before the page slot', () => {
    const nav = LAYOUT.indexOf('<component :is="navComponent" />')
    const slot = LAYOUT.indexOf('<slot />')
    expect(nav).toBeGreaterThan(-1)
    expect(slot).toBeGreaterThan(nav)
  })

  it('maps one nav prop to the three menus', () => {
    expect(LAYOUT).toContain('leave: LeaveNav')
    expect(LAYOUT).toContain('hr: HrNav')
    expect(LAYOUT).toContain('admin: AdminNav')
  })

  it('is the only file that imports a top menu', () => {
    const importers = vueFiles(SRC)
      .filter((file) => /import (LeaveNav|HrNav|AdminNav) from/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
    expect(importers).toEqual(['components/AppLayout.vue'])
  })

  it('gives every HR page and the admin page the shared shell', () => {
    expect(HR_PAGES.length).toBe(11)
    for (const name of HR_PAGES) expect(page(name), name).toContain('<AppLayout nav="hr">')
    expect(page('AdminPage.vue')).toContain('<AppLayout nav="admin">')
  })

  it('leaves no page positioning a menu by itself', () => {
    for (const name of readdirSync(PAGES_DIR).filter((entry) => entry.endsWith('.vue'))) {
      expect(page(name), name).not.toMatch(/<HrNav|<AdminNav/)
    }
  })

  it('takes the bar position out of the menus themselves', () => {
    expect(HR_NAV).not.toContain('margin: 16px auto')
    expect(HR_NAV).not.toContain('max-width: 1120px')
    expect(ADMIN_NAV).not.toContain('max-width: 1120px')
    expect(ADMIN_NAV).not.toContain('margin: 0 auto')
  })
})
