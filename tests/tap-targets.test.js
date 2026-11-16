// The 44px tap target is a layout rule (docs/ai/hr-hub-ui-motion.md section 4),
// so it is asserted in the source the same way the other layout rules are: read
// the component through readSource, find the rule this change touched, and check
// the declaration that makes the hit area big enough. The browser half of the
// rule lives in scripts/tap-targets-audit.mjs, which re-measures the rendered
// pages and fails on anything under 44x44.
import { describe, expect, it } from 'vitest'
import { readSource } from './helpers/read-source.js'

const MIN = 44

/** The declarations of the first `selector { ... }` block in a file. */
function rule(source, selector) {
  const at = source.indexOf(`${selector} {`)
  if (at === -1) return ''
  const open = source.indexOf('{', at)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

/** Every declaration of a rule, counted in px, whatever property carries it. */
function px(declarations, property) {
  const match = new RegExp(`${property}:\\s*(-?[\\d.]+)px`).exec(declarations)
  return match ? Number(match[1]) : null
}

const CASES = [
  // component: the shell controls every signed-in page draws
  { file: 'src/components/AdminNav.vue', selector: '.nav-link', properties: ['min-height'] },
  { file: 'src/components/ControllerTopbar.vue', selector: '.menu-btn', properties: ['width', 'height'] },
  { file: 'src/components/EmployeeDirectoryManager.vue', selector: '.search', properties: ['min-height'] },
  { file: 'src/components/EmployeeDirectoryManager.vue', selector: '.search input', properties: ['min-height'] },
  // pages with a back link or a reveal toggle
  { file: 'src/pages/SetPinPage.vue', selector: '.toggle', properties: ['height', 'min-width'] },
  { file: 'src/pages/SetPinPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/ChangePinPage.vue', selector: '.toggle', properties: ['min-height', 'min-width'] },
  { file: 'src/pages/LoginPage.vue', selector: '.footer-link', properties: ['min-height'] },
  { file: 'src/pages/LeaveRequestPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/HrPasswordPage.vue', selector: '.back', properties: ['min-height'] },
  { file: 'src/pages/ControllerEmployeeDataPage.vue', selector: '.back', properties: ['min-height'] },
  { file: 'src/pages/HrEmployeeDataPage.vue', selector: '.link', properties: ['min-height'] },
  { file: 'src/pages/HrLeaveBackdatedPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/HrLeaveBackdatedPage.vue', selector: '.checkbox', properties: ['min-height'] },
  { file: 'src/pages/HrLeavePrintPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/ControllerQrPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/ControllerRosterPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/ControllerDashboardPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/ControllerDashboardPage.vue', selector: '.tab', properties: ['min-height'] },
  { file: 'src/pages/RegistrantsPage.vue', selector: '.back-link', properties: ['min-height'] },
  { file: 'src/pages/RegistrantsPage.vue', selector: '.tab', properties: ['min-height'] },
  { file: 'src/pages/RegistrantsPage.vue', selector: '.chip', properties: ['min-height'] },
  // controller toolbar, filters and file pickers
  { file: 'src/pages/MeetingBackfillHistoryPage.vue', selector: '.export-link', properties: ['min-height'] },
  { file: 'src/pages/MeetingBackfillHistoryPage.vue', selector: '.field input,\n.field select,\n.search-row input', properties: ['min-height'] },
  { file: 'src/pages/MeetingBackfillHistoryPage.vue', selector: '.tab', properties: ['min-height'] },
  { file: 'src/pages/MeetingBackfillHistoryPage.vue', selector: ':deep(.v-btn)', properties: ['min-height'] },
  { file: 'src/pages/MeetingBackfillImportPage.vue', selector: '.template-link', properties: ['min-height'] },
  { file: 'src/pages/MeetingBackfillImportPage.vue', selector: '.file-pick', properties: ['min-height'] },
  { file: 'src/pages/HrEmployeeImportPage.vue', selector: '.template-link', properties: ['min-height'] },
  { file: 'src/pages/HrEmployeeImportPage.vue', selector: '.file-pick', properties: ['min-height'] },
  { file: 'src/pages/HrLeaveApproversPage.vue', selector: '.tab', properties: ['min-height'] },
  { file: 'src/pages/HrLeaveApproversPage.vue', selector: ':deep(.v-field)', properties: ['min-height'] },
  { file: 'src/pages/ControllerOverviewPage.vue', selector: ':deep(.v-btn)', properties: ['min-height'] },
  // the calendar's own toolbar, header row and day grid
  { file: 'src/components/LeaveCalendarView.vue', selector: ':deep(.fc .fc-button)', properties: ['min-height', 'min-width'] },
  { file: 'src/components/LeaveCalendarView.vue', selector: ':deep(.fc .fc-col-header-cell-cushion)', properties: ['min-height'] },
  { file: 'src/components/LeaveCalendarView.vue', selector: ':deep(.fc .fc-daygrid-day-top)', properties: ['min-height'] },
  { file: 'src/components/LeaveCalendarView.vue', selector: ':deep(.fc .fc-daygrid-day-number)', properties: ['min-height', 'min-width'] },
]

describe('tap targets: every changed rule reaches 44px', () => {
  for (const { file, selector, properties } of CASES) {
    it(`${file} — ${selector.split('\n')[0]}`, () => {
      const declarations = rule(readSource(file), selector)
      expect(declarations, `${file}: rule "${selector.split('\n')[0]}" not found`).not.toBe('')
      for (const property of properties) {
        const value = px(declarations, property)
        expect(value, `${file}: ${property} is missing from "${selector.split('\n')[0]}"`).not.toBeNull()
        expect(value, `${file}: ${property} is ${value}px on "${selector.split('\n')[0]}"`).toBeGreaterThanOrEqual(MIN)
      }
    })
  }
})

describe('tap targets: the switch grows its hit area, not its paint', () => {
  it('keeps the 46x26 pill and adds exactly the missing height', () => {
    const source = readSource('src/components/NotificationSwitch.vue')
    const pill = rule(source, '.notify-switch')
    const height = px(pill, 'height')
    const width = px(pill, 'width')
    expect(height).toBe(26)
    expect(width).toBe(46)

    const layer = rule(source, '.notify-switch::before')
    expect(layer).toContain("content: ''")
    expect(layer).toContain('position: absolute')
    // `inset: -9px 0`: the vertical pair grows the height, the horizontal pair
    // keeps the pill's own 46px width.
    const inset = /inset:\s*(-?[\d.]+)px\s+(-?[\d.]+)(?:px)?/.exec(layer)
    expect(inset, 'the hit layer needs a px inset').not.toBeNull()
    const vertical = Number(inset[1])
    const horizontal = Number(inset[2])
    expect(vertical).toBeLessThan(0)
    expect(horizontal).toBe(0)
    expect(height - vertical * 2).toBeGreaterThanOrEqual(MIN)
    expect(width).toBeGreaterThanOrEqual(MIN)
  })
})

describe('tap targets: no new focus ring', () => {
  it('leaves the 2px violet ring on the element that receives focus', () => {
    const global = readSource('src/styles.css')
    expect(global).toContain(':where(a, button, input, select, textarea, summary, [tabindex]):focus-visible')
    expect(global).toContain('outline: var(--motion-focus-width) solid var(--motion-focus)')
    expect(global).toContain('outline-offset: var(--motion-focus-offset)')
    expect(global).toContain('--motion-focus: #8b5cf6')
    expect(global).toContain('--motion-focus-width: 2px')
    expect(global).toContain('--motion-focus-offset: 2px')

    // A hit-area layer is not a focus target and must not paint.
    const switchLayer = rule(readSource('src/components/NotificationSwitch.vue'), '.notify-switch::before')
    expect(switchLayer).not.toContain('outline')
    expect(switchLayer).not.toContain('background')
  })
})

describe('tap targets: the audit covers every page route', () => {
  const audit = readSource('scripts/tap-targets-audit.mjs')

  it('measures 390 and 1280 at a 44px minimum by default', () => {
    expect(audit).toContain("arg('widths', '390,1280')")
    expect(audit).toContain('const MIN = 44')
  })

  it('lists every static page path the router renders', () => {
    // Paths with a parameter are matched by their prefix: the audit visits one
    // concrete id for each of them.
    const router = readSource('src/router.js')
    const paths = [...router.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1])
    const staticPaths = paths.filter(
      (path) => path.startsWith('/') && !path.includes(':') && path !== '/'
    )
    expect(staticPaths.length).toBeGreaterThan(25)
    for (const path of staticPaths) {
      expect(audit, `scripts/tap-targets-audit.mjs does not visit ${path}`).toContain(`'${path}'`)
    }
  })

  it('names the Vuetify wrapper as the field hit area', () => {
    expect(audit).toContain("element.closest('.v-field')")
    expect(audit).toContain('v-field wrapper (outer hit area)')
  })
})
