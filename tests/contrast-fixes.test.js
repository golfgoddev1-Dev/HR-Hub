// The two contrast items left open on fix/tap-targets-44: the browser's own
// placeholder grey (#757575, 4.43:1 on the employees search fill) and the pale
// control borders (#d8e4de / #cfdcda / #d8e3e1, 1.31 to 1.41:1 on white).
//
// Both fixes are colour-only: the same rules, the same sizes, the same copy.
// These checks pin the declarations, so a later edit cannot quietly put the pale
// value or the browser default back, and they prove the new pair reaches the
// ratio it is there for. The colour maths is self-tested with known pairs first.

import { describe, expect, it } from 'vitest'

import { readSource } from './helpers/read-source.js'

const SEARCH = readSource('src/components/EmployeeDirectoryManager.vue')
const BACKFILL = readSource('src/pages/MeetingBackfillHistoryPage.vue')
const CALENDAR = readSource('src/components/LeaveCalendarView.vue')
const SWITCH = readSource('src/components/NotificationSwitch.vue')
const TOPBAR = readSource('src/components/ControllerTopbar.vue')
const PILLS = [
  'src/pages/ControllerDashboardPage.vue',
  'src/pages/ControllerQrPage.vue',
  'src/pages/ControllerRosterPage.vue',
  'src/pages/RegistrantsPage.vue',
].map((path) => ({ path, css: styles(readSource(path)) }))

// The two links the first pass left out: the export on the backfill page and the
// template download on both import pages.
const LINK_FILES = [
  { path: 'src/pages/MeetingBackfillHistoryPage.vue', selector: '.export-link' },
  { path: 'src/pages/MeetingBackfillImportPage.vue', selector: '.template-link' },
  { path: 'src/pages/HrEmployeeImportPage.vue', selector: '.template-link' },
].map(({ path, selector }) => ({ path, selector, css: styles(readSource(path)) }))

const BORDER = '#6f9085'
const PLACEHOLDER = '#475569'

function styles(source) {
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of every rule whose selector list contains `selector`. */
function ruleBody(css, selector) {
  const wanted = selector.replace(/\s+/g, ' ')
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  return rules
    .filter((rule) => {
      const head = rule.slice(0, rule.indexOf('{'))
      return head
        .split(',')
        .map((part) => part.trim().replace(/\s+/g, ' '))
        .includes(wanted)
    })
    .map((rule) => rule.slice(rule.indexOf('{') + 1))
    .join('\n')
}

// --- colour maths ----------------------------------------------------------

function rgb(hex) {
  const text = hex.trim().replace('#', '')
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
  }
}

function luminance(hex) {
  const { r, g, b } = rgb(hex)
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('the colour maths', () => {
  it('reproduces the known pairs', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#475569', '#ffffff')).toBeCloseTo(7.58, 1)
    expect(contrast('#1e1b4b', '#ffffff')).toBeCloseTo(15.99, 1)
    expect(contrast('#ffffff', '#4f46e5')).toBeCloseTo(6.29, 1)
  })
})

describe('the placeholder ink', () => {
  it('reaches 4.5:1 on the fill it sits on', () => {
    expect(contrast(PLACEHOLDER, '#f8fbfa')).toBeGreaterThanOrEqual(4.5)
    expect(contrast(PLACEHOLDER, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('is set explicitly on the employees search, which both pages share', () => {
    // /hr/employees/manage and /meeting/controller/employees render
    // EmployeeDirectoryManager, so one rule covers both.
    const body = ruleBody(styles(SEARCH), '.search input::placeholder')
    expect(body).toContain(PLACEHOLDER)
    expect(body).toContain('opacity: 1')
  })

  it('is set explicitly on the backfill filters', () => {
    const css = styles(BACKFILL)
    expect(ruleBody(css, '.field input::placeholder')).toContain(PLACEHOLDER)
    expect(ruleBody(css, '.search-row input::placeholder')).toContain(PLACEHOLDER)
  })
})

describe('the control borders', () => {
  it('reach 3:1 on every light background they sit on', () => {
    for (const background of ['#ffffff', '#f8fbfa', '#f0f7f6']) {
      expect(contrast(BORDER, background)).toBeGreaterThanOrEqual(3)
    }
  })

  it('are what the pale values were not', () => {
    for (const pale of ['#cfdcda', '#d8e4de', '#d8e3e1']) {
      expect(contrast(pale, '#ffffff')).toBeLessThan(3)
    }
  })

  it('are on the backfill input and select', () => {
    const body = ruleBody(styles(BACKFILL), '.field input')
    expect(body).toContain(BORDER)
    expect(body).not.toContain('#cfdcda')
    expect(ruleBody(styles(BACKFILL), '.field select')).toContain(BORDER)
  })

  it('are on the calendar buttons', () => {
    const body = ruleBody(styles(CALENDAR), ':deep(.fc .fc-button-primary)')
    expect(body).toContain(`border-color: ${BORDER}`)
  })

  it('are on the notification switch outline', () => {
    const body = ruleBody(styles(SWITCH), '.notify-switch')
    expect(body).toContain(`border: 1px solid ${BORDER}`)
  })

  it('are on the import and export links', () => {
    for (const { path, selector, css } of LINK_FILES) {
      const body = ruleBody(css, selector)
      expect(body, path).toContain(`border: 1px solid ${BORDER}`)
      expect(body, path).not.toContain('#cfdcda')
    }
  })

  it('are on every controller pill and the menu button', () => {
    for (const { path, css } of PILLS) {
      const body = ruleBody(css, '.back-link')
      expect(body, path).toContain(`border: 1px solid ${BORDER}`)
      expect(body, path).not.toContain('#d8e4de')
    }
    const menu = ruleBody(styles(TOPBAR), '.menu-btn')
    expect(menu).toContain(`border: 1px solid ${BORDER}`)
    expect(menu).not.toContain('#d8e4de')
  })
})
