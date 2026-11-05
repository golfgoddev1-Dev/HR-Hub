// Navigation width stability, checked without a browser:
// - the global stylesheet reserves the scrollbar gutter on <html>, so pages with
//   and without a scrollbar have the same content width;
// - an active nav link never changes its font weight, because a heavier weight
//   is wider and pushes every following item sideways.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const STYLES = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const MAIN = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const NAVS = {
  LeaveNav: readFileSync(new URL('../src/components/LeaveNav.vue', import.meta.url), 'utf8'),
  HrNav: readFileSync(new URL('../src/components/HrNav.vue', import.meta.url), 'utf8'),
  AdminNav: readFileSync(new URL('../src/components/AdminNav.vue', import.meta.url), 'utf8'),
}

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

describe.each(Object.entries(NAVS))('%s', (_name, source) => {
  it('keeps the active link at the same font weight as an inactive one', () => {
    const base = fontWeightOf(blockOf(source, '.nav-link'))
    const active = fontWeightOf(blockOf(source, '.nav-link-active'))

    // No weight in either block is fine; a different one is the shift.
    if (active !== null && base !== null) {
      expect(active).toBe(base)
    }
  })
})
