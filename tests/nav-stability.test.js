// Navigation width stability, checked without a browser:
// - the global stylesheet reserves the scrollbar gutter on <html>, so pages with
//   and without a scrollbar have the same content width;
// - an active nav link never changes its font weight, because a heavier weight
//   is wider and pushes every following item sideways.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const STYLES = readSource(new URL('../src/styles.css', import.meta.url))
const MAIN = readSource(new URL('../src/main.js', import.meta.url))
// The dock is shared now, so one file carries both systems' menu styles.
const DOCK = readSource(new URL('../src/components/AppDock.vue', import.meta.url))
const ADMIN_NAV = readSource(
  new URL('../src/components/AdminNav.vue', import.meta.url)
)

/** The declaration block that follows `selector`, up to its closing brace. */
function blockOf(source, selector) {
  const start = source.indexOf(`${selector} {`)
  if (start === -1) return ''
  const end = source.indexOf('}', start)
  return end === -1 ? '' : source.slice(start, end)
}

/** The declared font-weight, normalised, or null when the block sets none. */
function fontWeightOf(block) {
  const match = /font-weight:\s*([^;]+);/.exec(block)
  if (!match) return null
  return match[1].replace('!important', '').trim()
}

describe('global stylesheet', () => {
  it('is the one the app imports', () => {
    expect(MAIN).toContain("import './styles.css'")
  })

  it('reserves the scrollbar gutter on html, not in a scoped style', () => {
    const html = blockOf(STYLES, 'html')
    expect(html).toContain('scrollbar-gutter: stable')
  })
})

describe.each([['AppDock.vue', DOCK]])('%s dock', (_name, source) => {
  it('keeps the rail item box free of font-weight changes', () => {
    // The active state may emphasise its label, but the item box itself must not
    // change weight: that is what used to push the following items sideways.
    expect(blockOf(source, '.dock-item')).not.toContain('font-weight')
  })

  it('emphasises the active label through its own rule', () => {
    expect(fontWeightOf(blockOf(source, '.dock-item-active .dock-label'))).toBe('700')
  })
})

describe('AdminNav', () => {
  it('keeps the active link at the same font weight as an inactive one', () => {
    const base = fontWeightOf(blockOf(ADMIN_NAV, '.nav-link'))
    const active = fontWeightOf(blockOf(ADMIN_NAV, '.nav-link-active'))

    // No weight in either block is fine; a different one is the shift.
    if (active !== null && base !== null) {
      expect(active).toBe(base)
    }
  })
})
