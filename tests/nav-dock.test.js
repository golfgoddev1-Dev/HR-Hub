// The shared dock. These checks pin the behaviour the restyle must not lose:
// real routes, a real pending badge, the real logout call, one indicator that
// follows the router, and an entrance that only plays on the first mount.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const DOCK = readSource(new URL('../src/components/AppDock.vue', import.meta.url))
const LAYOUT = readSource(new URL('../src/components/AppLayout.vue', import.meta.url))
const NAV_CONFIG = readSource(new URL('../src/lib/nav-config.js', import.meta.url))
const ENTRANCE = readSource(new URL('../src/lib/dock-entrance.js', import.meta.url))

/** The declaration block of one selector, up to its closing brace. */
function selectorBlock(source, selector) {
  const start = source.indexOf(`\n${selector} {`)
  if (start === -1) return ''
  const end = source.indexOf('\n}', start)
  return end === -1 ? '' : source.slice(start, end)
}

describe('AppDock', () => {
  it('never links to a hash', () => {
    expect(DOCK).not.toMatch(/href\s*=\s*["']#/)
  })

  it('takes the active state from RouterLink', () => {
    expect(DOCK).toContain('<RouterLink')
    expect(DOCK).toContain('active-class="dock-item-active"')
    expect(DOCK).not.toMatch(/\bisActive\b/)
  })

  it('moves one indicator from measured element state', () => {
    expect(DOCK).toContain('ref="rail"')
    expect(DOCK).toContain('offsetLeft')
    expect(DOCK).toContain('offsetWidth')
    expect(DOCK).toContain(':style="indicatorStyle"')
    // The groups wrap, so the dot follows the column and the row.
    expect(DOCK).toContain('translate(${dot.value.x}px, ${dot.value.y}px)')
    // No fixed pixel offset in the indicator template literal: the x must come
    // from the measurement (the 3px press nudge is styling, not the indicator).
    expect(DOCK).not.toMatch(/`translateX\(\s*-?\d+px/)
  })

  it('renders the brand through props, including the optional HR chip', () => {
    expect(DOCK).toContain('brandIcon')
    expect(DOCK).toContain('brandTitle')
    expect(DOCK).toContain('brandSubtitle')
    expect(DOCK).toContain('showBrandBadge')
    expect(DOCK).toMatch(/v-if="showBrandBadge"[^>]*>HR</)
    expect(LAYOUT).toContain("title: 'ระบบบริการงานบุคคลและสวัสดิการพนักงาน'")
    expect(LAYOUT).toContain("title: 'ระบบใบลา'")
  })

  it('logs out through the real endpoint, then lets the flow navigate', () => {
    const post = DOCK.indexOf("fetch('/api/auth/logout'")
    const go = DOCK.indexOf('navigate: () => completeLogout({ keepPushSubscription })')
    expect(post).toBeGreaterThan(-1)
    expect(go).toBeGreaterThan(post)
    // The click no longer navigates directly: the shared flow enforces the delay.
    expect(DOCK).toContain('const logout = createLogoutFlow({')
    // Navigation still waits for the flow, and every browser copy is dropped
    // first by the shared completion (clearAll, storage, replace).
    expect(DOCK).toContain('navigate: () => completeLogout({ keepPushSubscription })')
    expect(DOCK).not.toContain('window.location.assign')
  })

  it('shows the click ripple, the dock flash and the Thai pending label', () => {
    expect(DOCK).toContain("import { createLogoutFlow, ripplePlacement } from '../lib/logout-flow.js'")
    expect(DOCK).toContain('class="logout-ripple"')
    expect(DOCK).toContain('@animationend="ripple = null"')
    expect(DOCK).toContain("dockEl.classList.add('is-alerting')")
    // Restarting the flash needs a forced reflow between remove and add.
    expect(DOCK).toContain('void dockEl.offsetWidth')
    expect(DOCK).toContain("{{ leaving ? 'sync' : 'logout' }}")
    expect(DOCK).toContain('กำลังออก...')
    expect(DOCK).toContain('.dock-logout.is-leaving .material-symbols-outlined')
    expect(DOCK).toContain('@keyframes logout-ripple')
  })

  it('emits nothing: logout is built in', () => {
    expect(DOCK).not.toContain('defineEmits')
    expect(DOCK).not.toContain("$emit('logout')")
  })

  it('keeps a 3px focus ring and disables motion when asked', () => {
    expect(DOCK).toContain(':focus-visible')
    expect(DOCK).toContain('outline: 3px solid #0f6f63')
    expect(DOCK).toContain('prefers-reduced-motion: reduce')
  })

  it('runs the entrance only on the first mount of the session', () => {
    // The flag is read once at setup and drives a single root class; the stagger
    // hangs off that class, so a second mount cannot replay it.
    expect(DOCK).toContain("import { takeDockEntrance } from '../lib/dock-entrance.js'")
    expect(DOCK).toContain('const entering = ref(takeDockEntrance())')
    expect(DOCK).toContain(":class=\"{ 'is-entering': entering }\"")
    expect(DOCK).toContain('.dock.is-entering .dock-item')
    expect(selectorBlock(DOCK, '.dock-item')).not.toContain('animation')
    expect(ENTRANCE).toContain('let played = false')
  })

  it('renders the pending badge from the item data only', () => {
    expect(DOCK).toContain('v-if="item.badge > 0"')
    expect(DOCK).toContain('{{ item.badge }}')
    expect(DOCK).not.toMatch(/dock-badge[^>]*>\s*\d/)
  })

  it('wraps the wide menu and swaps to a tab bar on phones', () => {
    // No sideways rail anywhere: the menu groups wrap and the phone shell is a
    // separate bottom bar.
    expect(DOCK).not.toContain('overflow-x')
    expect(DOCK).not.toContain('scroll-snap-type')
    expect(DOCK).toContain('<nav class="dock-tabs" aria-label="เมนูหลัก">')
    expect(DOCK).toContain('prefers-reduced-motion')
  })

  it('is fed by the shared section config, not a hard-coded list', () => {
    expect(NAV_CONFIG).toContain('export function leaveNavItems()')
    expect(NAV_CONFIG).toContain('export function hrNavItems()')
    expect(NAV_CONFIG).toContain('export function navSections(')
    expect(LAYOUT).toContain('navSections({')
    expect(LAYOUT).toContain("import { navSections } from '../lib/nav-config.js'")
    // The approvals entry and its badge still come from the approver flag.
    expect(NAV_CONFIG).toContain('approvalsMenuItem(')
  })
})
