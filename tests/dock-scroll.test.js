// The dock has to stay usable when the menu is wider than the screen: the rail
// scrolls, the logout button never scrolls away, and the edge fades say which
// way more items hide. These are source checks because no DOM library is installed.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const DOCK = readFileSync(new URL('../src/components/AppDock.vue', import.meta.url), 'utf8')

const RAIL_OPEN = DOCK.indexOf('<nav ref="rail"')
const RAIL_CLOSE = DOCK.indexOf('</nav>')
const RAIL = DOCK.slice(RAIL_OPEN, RAIL_CLOSE)
const LOGOUT = DOCK.indexOf('class="dock-item dock-logout"')
const SCROLL_AREA = DOCK.indexOf('<div class="dock-scroll">')

function block(selector) {
  const start = DOCK.indexOf(`\n${selector} {`)
  if (start === -1) return ''
  const end = DOCK.indexOf('\n}', start)
  return end === -1 ? '' : DOCK.slice(start, end)
}

describe('AppDock scrolling layout', () => {
  it('keeps the logout button outside the scrolling list', () => {
    expect(RAIL_OPEN).toBeGreaterThan(-1)
    expect(RAIL_CLOSE).toBeGreaterThan(RAIL_OPEN)
    expect(SCROLL_AREA).toBeGreaterThan(-1)
    expect(LOGOUT).toBeGreaterThan(RAIL_CLOSE)
    // The scrolling list ends before the button, so the button cannot scroll.
    expect(RAIL).not.toContain('dock-logout')
  })

  it('scrolls the rail sideways with hidden scrollbars', () => {
    const rail = block('.dock-rail')

    expect(rail).toContain('overflow-x: auto')
    expect(rail).toContain('overflow-y: hidden')
    expect(rail).toContain('-webkit-overflow-scrolling: touch')
    expect(rail).toContain('scrollbar-width: none')
    expect(rail).toContain('scroll-snap-type: x proximity')
  })

  it('keeps section headings inside the scrolling list', () => {
    expect(RAIL).toContain('v-for="section in sections"')
    expect(RAIL).toContain('class="dock-section-label"')
    expect(RAIL).toContain('{{ section.label }}')
  })

  it('shows an edge fade only while that side has hidden items', () => {
    expect(DOCK).toContain('class="dock-fade dock-fade-left"')
    expect(DOCK).toContain('class="dock-fade dock-fade-right"')
    expect(DOCK).toContain(":class=\"{ 'is-visible': canScrollLeft }\"")
    expect(DOCK).toContain(":class=\"{ 'is-visible': canScrollRight }\"")
    expect(DOCK).toContain('.dock-fade.is-visible')
    expect(DOCK).toContain('background: linear-gradient(90deg')
    expect(DOCK).toContain('background: linear-gradient(270deg')
  })

  it('updates the fades from scrollLeft and scrollWidth and cleans up', () => {
    expect(DOCK).toContain('railEl.scrollLeft > 2')
    expect(DOCK).toContain('railEl.scrollWidth - railEl.clientWidth - railEl.scrollLeft > 2')
    expect(DOCK).toContain("addEventListener('scroll', onRailScroll, { passive: true })")
    expect(DOCK).toContain("window.addEventListener('resize', updateEdges)")
    expect(DOCK).toContain("window.removeEventListener('resize', updateEdges)")
    expect(DOCK).toContain("removeEventListener('scroll', onRailScroll)")
    // The measurement runs after a scroll, because offsets are scroll-relative.
    expect(block('.dock-scroll')).toContain('position: relative')
  })

  it('brings the active item into view inside the rail, not the page', () => {
    expect(DOCK).toMatch(/active\.scrollIntoView\(\{/)
    expect(DOCK).toContain("inline: 'nearest'")
    expect(DOCK).toContain("block: 'nearest'")
    expect(DOCK).toContain("behavior: prefersReducedMotion() ? 'auto' : 'smooth'")
    expect(DOCK).not.toContain('window.scroll')
    expect(DOCK).not.toContain('scrollIntoView({ inline:')
  })

  it('keeps the rail scrolling and logout pinned at narrow widths', () => {
    const media = DOCK.slice(DOCK.indexOf('@media (max-width: 720px)'))
    const narrow = media.slice(0, media.indexOf('@media (prefers-reduced-motion'))

    expect(narrow).toContain('flex-wrap: nowrap')
    expect(narrow).toContain('overflow-x: auto')
    expect(narrow).not.toContain('overflow-x: hidden')
    expect(narrow).toContain('scroll-snap-type: x proximity')
    expect(narrow).not.toContain('flex-wrap: wrap')
  })

  it('leaves the logout flow and its animation untouched', () => {
    expect(DOCK).toContain('const logout = createLogoutFlow({')
    expect(DOCK).toContain("fetch('/api/auth/logout'")
    expect(DOCK).toContain('navigate: () => completeLogout({ keepPushSubscription })')
    expect(DOCK).toContain('@click="logout"')
    expect(DOCK).toContain('class="logout-ripple"')
    expect(DOCK).toContain('กำลังออก...')
  })
})
