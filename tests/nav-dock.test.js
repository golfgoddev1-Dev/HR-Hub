// The shared dock. These checks pin the behaviour the restyle must not lose:
// real routes, a real pending badge, the real logout call, one indicator that
// follows the router, and an entrance that only plays on the first mount.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const DOCK = readFileSync(new URL('../src/components/AppDock.vue', import.meta.url), 'utf8')
const LAYOUT = readFileSync(new URL('../src/components/AppLayout.vue', import.meta.url), 'utf8')
const NAV_CONFIG = readFileSync(new URL('../src/lib/nav-config.js', import.meta.url), 'utf8')
const ENTRANCE = readFileSync(new URL('../src/lib/dock-entrance.js', import.meta.url), 'utf8')

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
    expect(DOCK).toContain('translateX(${dot.value.x}px)')
    // No fixed pixel offset anywhere: the x must come from the measurement.
    expect(DOCK).not.toMatch(/translateX\(\s*-?\d+px/)
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

  it('logs out through the real endpoint before navigating', () => {
    const post = DOCK.indexOf("fetch('/api/auth/logout'")
    const go = DOCK.indexOf("window.location.assign('/login')")
    expect(post).toBeGreaterThan(-1)
    expect(go).toBeGreaterThan(post)
    expect(DOCK).not.toMatch(/กำลังออก|logging out/i)
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

  it('sits in a scrolling rail on narrow screens', () => {
    expect(DOCK).toContain('overflow-x: auto')
    expect(DOCK).toContain('scroll-snap-type')
    expect(DOCK).toContain('prefers-reduced-motion')
  })

  it('is fed by the shared item lists and the layout approvals logic', () => {
    expect(NAV_CONFIG).toContain('export function leaveNavItems()')
    expect(NAV_CONFIG).toContain('export function hrNavItems()')
    expect(LAYOUT).toContain('leaveNavItems()')
    expect(LAYOUT).toContain('hrNavItems()')
    expect(LAYOUT).toContain("import { approvalsMenuItem } from '../lib/leave-nav-items.js'")
  })
})
