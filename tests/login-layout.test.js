// The login page on a phone: centred in the dynamic viewport, never wider than
// the narrowest supported screen, 16px inputs that do not trigger iOS zoom, and
// 44px controls. These read the scoped CSS because the rules are the contract.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../src/pages/LoginPage.vue', import.meta.url), 'utf8')
const GLOBAL = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const CSS = PAGE.slice(PAGE.indexOf('<style scoped>'))

/** The declarations of the first rule whose selector matches exactly. */
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = CSS.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  expect(match, `missing rule ${selector}`).not.toBeNull()
  return match[1]
}

function px(body, property) {
  const match = body.match(new RegExp(`${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`))
  expect(match, `missing ${property} in px`).not.toBeNull()
  return Number(match[1])
}

const PHONE_START = CSS.indexOf('@media (max-width: 767px)')
const PHONE_SHORT_START = CSS.indexOf('@media (max-width: 767px) and (max-height: 720px)')
const PHONE = CSS.slice(PHONE_START, PHONE_SHORT_START)
const PHONE_SHORT = CSS.slice(PHONE_SHORT_START)

describe('the login page viewport', () => {
  it('is centred by layout, with dvh and a 100vh fallback', () => {
    const page = rule('.page')
    expect(page).toContain('min-height: 100vh;')
    expect(page).toContain('min-height: 100dvh;')
    // The fallback must come first so dvh wins where it exists.
    expect(page.indexOf('100vh')).toBeLessThan(page.indexOf('100dvh'))

    expect(rule('.page-main')).toContain('display: flex;')
    expect(rule('.page-main')).toContain('flex-direction: column;')
    // Auto block margins centre the card, and fall back to the start when the
    // card is taller than the screen instead of clipping its top.
    expect(rule('.shell')).toContain('margin: auto;')
    expect(rule('.login-panel')).toContain('justify-content: center;')
  })

  it('keeps the form in normal flow so the keyboard cannot cover it', () => {
    for (const selector of ['.page-main', '.login-inner', '.input-wrap', '.form']) {
      expect(rule(selector), selector).not.toContain('position: fixed')
    }
  })

  it('reserves safe areas at the top, sides and bottom', () => {
    expect(rule('.topbar')).toContain('env(safe-area-inset-top)')
    expect(rule('.page-main')).toContain('env(safe-area-inset-left)')
    expect(rule('.page-main')).toContain('env(safe-area-inset-right)')
    expect(PHONE).toContain('env(safe-area-inset-bottom)')
  })
})

describe('the login page on a phone', () => {
  it('drops the marketing panel so the card is the only panel to centre', () => {
    expect(PHONE).toContain('.brand-panel,')
    expect(PHONE).toMatch(/\.brand-panel,[\s\S]*?display: none;/)
  })

  it('uses the full width with a 16px gutter and a flexible grid', () => {
    expect(PHONE).toContain('max(16px, env(safe-area-inset-left))')
    expect(PHONE).toContain('repeat(2, minmax(0, 1fr))')
    expect(rule('.login-inner')).toContain('width: 100%;')
    expect(rule('.login-inner')).toContain('max-width: 576px;')
  })

  it('sets inputs at 16px so iOS Safari does not zoom on focus', () => {
    const input = rule('.input')
    expect(input).toContain('font-size: 16px;')
    expect(px(input, 'font-size')).toBeGreaterThanOrEqual(16)
    // No later phone rule may shrink the field text below 16px.
    expect(PHONE).not.toMatch(/\.input\b[^}]*font-size:\s*(1[0-5]|[0-9])px/)
  })

  it('keeps every control at least 44px tall', () => {
    expect(px(rule('.input'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(px(rule('.toggle'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(px(rule('.success-close'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(px(rule('.error-close'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(px(rule('.submit'), 'height')).toBeGreaterThanOrEqual(44)
  })

  it('has no fixed width wider than 320px minus the two 16px gutters', () => {
    const widths = [...CSS.matchAll(/(?<![\w-])width:\s*(\d+(?:\.\d+)?)px/g)].map((match) =>
      Number(match[1])
    )
    expect(widths.length).toBeGreaterThan(0)
    for (const width of widths) expect(width).toBeLessThanOrEqual(288)
    expect(CSS).not.toMatch(/(?<![\w-])width:\s*100vw/)
    // The global reset keeps padding inside that width.
    expect(GLOBAL).toContain('box-sizing: border-box')
  })

  it('drops optional lines on a short screen before it scrolls', () => {
    expect(PHONE_SHORT).toContain('.login-sub,')
    expect(PHONE_SHORT).toContain('.field-hint,')
    expect(PHONE_SHORT).toContain('.security-row')
  })
})

describe('accessibility on the login page', () => {
  it('shows a focus ring on every control', () => {
    expect(CSS).toMatch(/\.input:focus-visible,[\s\S]*?outline: 3px solid/)
    expect(CSS).toContain('.toggle:focus-visible')
    expect(CSS).toContain('.role-option:focus-within')
  })

  it('respects reduced motion', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(CSS).toMatch(/animation-duration: 0\.01ms !important/)
  })
})
