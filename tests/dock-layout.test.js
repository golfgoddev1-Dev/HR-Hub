// The dock must never need a sideways scroll. The wide bar wraps its labelled
// groups and keeps logout on the right; phones get four primary tabs plus a
// full-height sheet that lists every item and the logout button. These are
// source checks because no DOM library is installed.

import { describe, expect, it } from 'vitest'

import { dockPrimaryItems, navSections } from '../src/lib/nav-config.js'

import { readSource } from './helpers/read-source.js'

const DOCK = readSource(new URL('../src/components/AppDock.vue', import.meta.url))
const LAYOUT = readSource(new URL('../src/components/AppLayout.vue', import.meta.url))

const CSS = DOCK.slice(DOCK.indexOf('<style scoped>'))
const DESKTOP = DOCK.slice(DOCK.indexOf('<header'), DOCK.indexOf('<nav class="dock-tabs"'))
const TABS = DOCK.slice(DOCK.indexOf('<nav class="dock-tabs"'), DOCK.indexOf('<Transition name="dock-sheet">'))
const SHEET = DOCK.slice(DOCK.indexOf('<Transition name="dock-sheet">'), DOCK.indexOf('</template>'))

/** The declaration block of one selector, whatever its nesting. */
function styleBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`\\n\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(CSS)
  return match ? match[1] : ''
}

describe('no horizontal rail', () => {
  it('has no sideways scroll, snap, scroll handler or edge fade left', () => {
    expect(DOCK).not.toContain('overflow-x')
    expect(DOCK).not.toContain('scroll-snap')
    expect(DOCK).not.toContain('scrollIntoView')
    expect(DOCK).not.toContain('scrollLeft')
    expect(DOCK).not.toContain('dock-fade')
    expect(DOCK).not.toContain("addEventListener('scroll'")
    // The only scroll left is the sheet body scrolling down.
    expect(styleBlock('.dock-sheet-body')).toContain('overflow-y: auto')
  })
})

describe('wide bar', () => {
  it('renders brand, labelled menu groups and logout in one row', () => {
    expect(DESKTOP).toContain('class="dock-brand"')
    expect(DESKTOP).toContain('<nav ref="rail" class="dock-menu"')
    expect(DESKTOP).toContain('v-for="section in sections"')
    expect(DESKTOP).toContain('class="dock-section-label"')
    expect(DESKTOP).toContain('{{ section.label }}')
    expect(DESKTOP).toContain('class="dock-item dock-logout"')
    expect(DESKTOP).toContain('@click="logout"')
  })

  it('keeps the logout button outside the menu, so it is always on screen', () => {
    const menuEnd = DESKTOP.indexOf('</nav>')
    const logout = DESKTOP.indexOf('class="dock-item dock-logout"')

    expect(menuEnd).toBeGreaterThan(-1)
    expect(logout).toBeGreaterThan(menuEnd)
    expect(DESKTOP.slice(0, menuEnd)).not.toContain('dock-logout')
  })

  it('wraps the groups and the items inside them', () => {
    expect(styleBlock('.dock-menu')).toContain('flex-wrap: wrap')
    expect(styleBlock('.dock-section-items')).toContain('flex-wrap: wrap')
    expect(styleBlock('.dock-inner')).toContain('display: flex')
    // Active state keeps aria-current through RouterLink and the mint indicator.
    expect(DOCK).toContain('active-class="dock-item-active"')
    expect(DOCK).toContain('dock-indicator')
    expect(DOCK).toContain('linear-gradient(90deg, #10504e, #85f8c4)')
  })
})

describe('phone tab bar', () => {
  it('is a nav landmark with the four primary items and a menu tab', () => {
    expect(DESKTOP).not.toContain('dock-tabs')
    expect(TABS).toContain('<nav class="dock-tabs" aria-label="เมนูหลัก">')
    expect(TABS).toContain('v-for="item in primaryItems"')
    expect(TABS).toContain('active-class="dock-tab-active"')
    expect(TABS).toContain('ref="menuTab"')
    expect(TABS).toContain('aria-haspopup="dialog"')
    expect(TABS).toContain(':aria-expanded="sheetOpen ? \'true\' : \'false\'"')
    expect(TABS).toContain('>เมนู<')
  })

  it('takes the primary items from that role\'s own menu, in order', () => {
    const employee = dockPrimaryItems('employee', navSections({ role: 'employee' }))
    expect(employee.map((item) => item.to)).toEqual(['/leave', '/leave/new', '/profile'])
    expect(employee.map((item) => item.label)).toEqual([
      'ใบลาของฉัน',
      'ยื่นใบลา',
      'ข้อมูลส่วนตัว',
    ])

    const approver = dockPrimaryItems(
      'employee',
      navSections({ role: 'employee', isApprover: true })
    )
    expect(approver.map((item) => item.to)).toEqual([
      '/leave',
      '/leave/new',
      '/leave/calendar',
      '/profile',
    ])

    const hr = dockPrimaryItems('hr', navSections({ role: 'hr' }))
    expect(hr.map((item) => item.to)).toEqual([
      '/hr',
      '/hr/employees',
      '/hr/leave',
      '/hr/leave/holidays',
    ])
    expect(hr.map((item) => item.label)).toEqual([
      'หน้าหลัก',
      'รายชื่อพนักงาน',
      'ใบลาทั้งหมด',
      'วันหยุด',
    ])
  })

  it('shows the bar only on phones and hides the wide bar there', () => {
    expect(styleBlock('.dock-tabs')).toContain('display: none')

    const phone = CSS.slice(CSS.indexOf('@media (max-width: 720px)'))
    expect(phone).toContain('.dock {\n    display: none;')
    expect(phone).toContain('position: fixed')
    expect(phone).toContain('env(safe-area-inset-bottom)')
  })

  it('gives every tab a 44px tap target', () => {
    expect(styleBlock('.dock-tab')).toContain('min-height: 44px')
    expect(styleBlock('.dock-tab')).toContain('flex: 1 1 0')
  })
})

describe('phone menu sheet', () => {
  it('is a modal dialog with an accessible name', () => {
    expect(SHEET).toContain('role="dialog"')
    expect(SHEET).toContain('aria-modal="true"')
    expect(SHEET).toContain('aria-label="เมนูทั้งหมด"')
    expect(SHEET).toContain('v-if="sheetOpen"')
  })

  it('lists every section and item, then logout at the bottom', () => {
    expect(SHEET).toContain('v-for="section in sections"')
    expect(SHEET).toContain('{{ section.label }}')
    expect(SHEET).toContain('v-for="item in section.items"')
    expect(SHEET).toContain('class="dock-sheet-link"')

    const logout = SHEET.indexOf('class="dock-sheet-logout"')
    const body = SHEET.indexOf('class="dock-sheet-body"')
    expect(logout).toBeGreaterThan(body)
    expect(SHEET.slice(logout)).toContain('@click="logout"')
  })

  it('closes on the close button, the backdrop, Escape, and an item', () => {
    expect(SHEET).toContain('aria-label="ปิดเมนู"')
    expect(SHEET).toContain('@click="closeSheet"')
    expect(SHEET).toContain('class="dock-sheet-backdrop"')
    expect(SHEET).toContain('@click="closeSheet"')
    expect(DOCK).toContain("if (event.key === 'Escape') closeSheet()")
    expect(DOCK).toContain("window.addEventListener('keydown', onKeydown)")
    expect(DOCK).toContain("window.removeEventListener('keydown', onKeydown)")
    // Selecting a link closes the sheet; the route watch is the safety net.
    expect(SHEET).toContain('@click="closeSheet"')
    expect(DOCK).toContain('if (sheetOpen.value) closeSheet()')
  })

  it('moves focus into the sheet and back to the menu tab', () => {
    expect(DOCK).toContain('nextTick(() => sheetClose.value?.focus())')
    expect(DOCK).toContain('nextTick(() => menuTab.value?.focus())')
  })

  it('respects the safe area and keeps 44px targets', () => {
    expect(styleBlock('.dock-sheet')).toContain('env(safe-area-inset-bottom)')
    expect(styleBlock('.dock-sheet-foot')).toContain('env(safe-area-inset-bottom)')
    expect(styleBlock('.dock-sheet-link')).toContain('min-height: 44px')
    expect(styleBlock('.dock-sheet-close')).toContain('height: 44px')
    expect(styleBlock('.dock-sheet-logout')).toContain('min-height: 48px')
  })
})

describe('logout and layout', () => {
  it('uses the one logout flow from both positions', () => {
    expect((DOCK.match(/@click="logout"/g) ?? []).length).toBe(2)
    expect(DOCK).toContain('const logout = createLogoutFlow({')
    expect(DOCK).toContain("fetch('/api/auth/logout'")
    expect(DOCK).toContain('navigate: () => completeLogout({ keepPushSubscription })')
    expect(DOCK).toContain('class="logout-ripple"')
    expect(DOCK).toContain('กำลังออก...')
  })

  it('reserves the bar height in the page container on phones', () => {
    const phone = LAYOUT.slice(LAYOUT.indexOf('@media (max-width: 720px)'))
    expect(phone).toContain('.app-layout-inner')
    expect(phone).toContain('padding-bottom: calc(64px + env(safe-area-inset-bottom) + 16px)')
  })

  it('disables the sheet and indicator transitions for reduced motion', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.dock-sheet-enter-active .dock-sheet')
    expect(reduced).toContain('.dock-indicator')
    expect(reduced).toContain('transition: none !important')
  })
})
