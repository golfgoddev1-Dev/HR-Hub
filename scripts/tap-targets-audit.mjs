#!/usr/bin/env node
// Tap-target audit: every tappable control on every page, measured from the
// rendered page at 390 and 1280.
//
// It reuses the route sweep's setup on purpose:
//   - the same role sessions and the same route-level `context.route` stub for
//     `/api/**`, so no page is judged on an error state it would not show;
//   - the same forced-tier init script (`data-bg-tier` held on <html>), so the
//     glass and the backdrop are the ones a real high-tier visitor sees;
//   - the same system Chrome through `executablePath`; `playwright install` is
//     never run, and Playwright is never added to package.json.
//
// What it measures, per the brief:
//   button, a, input, select, textarea, [role=button], [role=link], summary,
//   and any element that carries a click listener or is a pointer-only target.
//   A Vuetify field's inner <input> is a focus proxy, so the hit area is the
//   outer `.v-field` wrapper; a checkbox/radio/switch uses its
//   `.v-selection-control` label, which is what the finger lands on.
//
// Hidden, disabled and closed-dialog controls are skipped and listed, never
// dropped silently.
//
// Usage:
//   node scripts/tap-targets-audit.mjs [--json <path>] [--widths 390,1280]
//                                      [--base http://localhost:5173]
// Exit code: 0 when every measured control is at least 44x44, 1 when not,
//            2 when the audit could not run (no browser, dev server down).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const MIN = 44

// Playwright is deliberately not a dependency of this project, so resolve the
// copy that is already on the machine. Never run `playwright install`.
async function loadChromium() {
  const local = resolve(process.cwd(), '.freebuff/pw/node_modules/playwright-core/index.js')
  const candidates = [process.env.PLAYWRIGHT_CORE_PATH, local, 'playwright-core', 'playwright'].filter(Boolean)
  const problems = []
  for (const candidate of candidates) {
    const spec = /^([A-Za-z]:|[./])/.test(candidate) ? pathToFileURL(candidate).href : candidate
    try {
      const mod = await import(spec)
      // playwright-core is CommonJS: the API arrives under `default`.
      const chromium = mod.chromium ?? mod.default?.chromium
      if (chromium) return chromium
    } catch (error) {
      problems.push(`${candidate}: ${error.message}`)
    }
  }
  throw new Error(`Playwright not found. Set PLAYWRIGHT_CORE_PATH.\n${problems.join('\n')}`)
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const BASE = arg('base', process.env.AUDIT_BASE || 'http://localhost:5173')
const JSON_OUT = arg('json', '')
// `--only /meeting/controller` narrows a debugging run; the assertion run does
// not pass it, so the full route list is always what CI (and the report) uses.
const ONLY = arg('only', '')
const WIDTHS = String(arg('widths', '390,1280'))
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value))

// ---- Sessions and stub data (the route sweep's fixtures) --------------------
const EMPLOYEE = {
  ok: true,
  role: 'employee',
  isApprover: true,
  hasEmployee: true,
  mustChangePin: false,
  fullName: 'สมชาย ใจดี',
  name: 'สมชาย ใจดี',
  employeeCode: 'EMP001',
  departmentName: 'การเงิน',
}
const HR = {
  ok: true,
  role: 'hr',
  isApprover: true,
  hasEmployee: true,
  mustChangePin: false,
  fullName: 'ฝ่ายบุคคล',
  name: 'ฝ่ายบุคคล',
  employeeCode: 'HR001',
  departmentName: 'ทรัพยากรบุคคล',
}
const CONTROLLER = {
  ok: true,
  role: 'meeting_controller',
  isApprover: false,
  hasEmployee: false,
  mustChangePin: false,
  fullName: 'ผู้ควบคุมการประชุม',
  name: 'ผู้ควบคุมการประชุม',
  employeeCode: 'MC001',
  departmentName: 'ผู้ควบคุมการประชุม',
}
const ADMIN = {
  ok: true,
  role: 'system_admin',
  isApprover: false,
  hasEmployee: false,
  mustChangePin: false,
  fullName: 'ผู้ดูแลระบบ',
  name: 'ผู้ดูแลระบบ',
  employeeCode: 'ADM001',
  departmentName: 'ระบบ',
}

const MINE_ROWS = [
  {
    id: 'req-1',
    requestCode: 'LV-20261101-001',
    leaveTypeName: 'ลาป่วย',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: 2,
    status: 'pending',
    returnDate: '2026-11-03',
    returnTime: '08:30',
    createdAt: '2026-11-01',
    hasMedicalCertificate: true,
    attachmentPath: 'leave/1/certificate.pdf',
    source: 'employee',
  },
  {
    id: 'req-2',
    requestCode: 'LV-20261028-002',
    leaveTypeName: 'ลากิจ',
    startDate: '2026-10-28',
    endDate: '2026-10-28',
    days: 1,
    status: 'approved',
    returnDate: '2026-10-29',
    returnTime: '08:30',
    createdAt: '2026-10-27',
    source: 'employee',
  },
  {
    id: 'req-3',
    requestCode: 'LV-20261020-003',
    leaveTypeName: 'ลาพักร้อน',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    days: 3,
    status: 'rejected',
    returnDate: '2026-10-23',
    returnTime: '08:30',
    createdAt: '2026-10-18',
    decisionNote: 'ช่วงนี้มีงานสำคัญของแผนก ขอเลื่อนเป็นสัปดาห์ถัดไป',
    source: 'employee',
  },
  {
    id: 'req-4',
    requestCode: 'LV-20261010-004',
    leaveTypeName: 'ลากิจ',
    startDate: '2026-10-10',
    endDate: '2026-10-10',
    days: 1,
    status: 'cancelled',
    returnDate: '2026-10-11',
    returnTime: '08:30',
    createdAt: '2026-10-09',
    source: 'employee',
  },
]

const HR_ROWS = MINE_ROWS.map((row, index) => ({
  ...row,
  id: `req-${index + 1}`,
  departmentName: 'การเงิน',
  requester: { fullName: 'สมชาย ใจดี', employeeCode: 'EMP001' },
  createdAt: '2026-11-01T09:12:00.000Z',
}))

const EMPLOYEES = [
  { id: 'e1', employeeCode: 'EMP001', fullName: 'สมชาย ใจดีมากเป็นพิเศษ', namePrefix: 'นาย', departmentName: 'การเงินและบัญชี', isActive: true },
  { id: 'e2', employeeCode: 'EMP002', fullName: 'สมหญิง รักงาน', namePrefix: 'นาง', departmentName: 'บุคคล', isActive: false },
  { id: 'e3', employeeCode: 'EMP003', fullName: 'อนุชา ตั้งใจ', namePrefix: 'นาย', departmentName: 'ผลิต', isActive: true },
  { id: 'e4', employeeCode: 'EMP004', fullName: 'ปิยะดา สุขสันต์', namePrefix: 'นางสาว', departmentName: 'ขาย', isActive: true },
]

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

function stubFor(session) {
  return (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') {
      if (!session) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false }) })
      return route.fulfill(json(session))
    }
    if (path === '/api/leave/hr/requests' || path === '/api/leave/approvals') {
      return route.fulfill(json({ ok: true, results: HR_ROWS, hasMore: false, total: HR_ROWS.length, page: 1, pageSize: 20, counts: { pending: 1, approved: 1, rejected: 1, cancelled: 1 } }))
    }
    if (path === '/api/leave/requests/mine') {
      return route.fulfill(json({ ok: true, results: MINE_ROWS, counts: { pending: 1, approved: 1 }, certificateRetentionDays: 90 }))
    }
    if (path.endsWith('/mine/counts')) return route.fulfill(json({ ok: true, counts: { pending: 1, approved: 1 } }))
    if (path === '/api/hr/employees') return route.fulfill(json({ ok: true, results: EMPLOYEES, hasMore: false, total: EMPLOYEES.length }))
    if (path === '/api/leave/hr/catalog' || path === '/api/hr/catalog') {
      return route.fulfill(json({ ok: true, departments: [{ id: 'd1', name: 'การเงิน' }], leaveTypes: [{ id: 't1', name: 'ลาป่วย' }] }))
    }
    if (path === '/api/admin/audit') {
      const actor = { fullName: 'ผู้ดูแล ระบบ', employeeCode: 'ADM001' }
      return route.fulfill(
        json({
          ok: true,
          items: [
            { id: '3', createdAt: '2026-11-02T07:15:00.000Z', action: 'permission_revoked', entity: 'permission', actor, target: { fullName: 'สมชาย ใจดีมากเป็นพิเศษ', employeeCode: 'EMP001' }, permission: 'hr_admin' },
            { id: '2', createdAt: '2026-11-02T02:40:00.000Z', action: 'leave_approved', entity: 'leave_request', actor, target: null, permission: null },
            { id: '1', createdAt: '2026-11-01T01:05:00.000Z', action: 'auto_absent_done', entity: 'meeting_session', actor: null, target: null, permission: null },
          ],
          nextBefore: '1',
        })
      )
    }
    if (path === '/api/leave/hr/settings') {
      return route.fulfill(
        json({
          ok: true,
          configured: true,
          certificateRetentionDays: 90,
          limits: { min: 30, max: 3650, default: 1825 },
          leaveRetentionEnabled: false,
          leaveRetentionDays: 1825,
          leaveRetentionLimits: { min: 30, max: 3650, default: 1825 },
        })
      )
    }
    return route.fulfill(json({ ok: true, results: [] }))
  }
}

// ---- Routes that render a page (src/router.js) -----------------------------
// The catch-all is deliberately excluded: it renders PendingPage, which is
// already measured on /pending.
const ROUTES = [
  { path: '/login', session: null, publicPage: true },
  { path: '/approve#t=sample-token', session: null, publicPage: true, name: '/approve' },
  { path: '/pending', session: null },
  { path: '/set-pin', session: null },
  { path: '/change-pin', session: ADMIN },
  { path: '/leave', session: EMPLOYEE, wait: 'main' },
  { path: '/leave/new', session: EMPLOYEE },
  { path: '/leave/my-approvers', session: EMPLOYEE },
  { path: '/leave/rules', session: EMPLOYEE },
  { path: '/leave/approvals', session: EMPLOYEE },
  { path: '/leave/calendar', session: EMPLOYEE },
  { path: '/leave/approvals/history', session: EMPLOYEE },
  { path: '/profile', session: EMPLOYEE },
  { path: '/hr', session: HR },
  { path: '/hr/employees', session: HR },
  { path: '/hr/employees/manage', session: HR },
  { path: '/hr/employees/password', session: HR },
  { path: '/hr/employees/import', session: HR },
  { path: '/hr/employees/e1', session: HR, name: '/hr/employees/:id' },
  { path: '/hr/leave', session: HR },
  { path: '/hr/leave/backdated', session: HR },
  { path: '/hr/leave/certificates', session: HR },
  { path: '/hr/leave/approvers', session: HR },
  { path: '/hr/leave/holidays', session: HR },
  { path: '/hr/leave/settings', session: HR },
  { path: '/meeting/controller', session: CONTROLLER },
  { path: '/meeting/controller/qr', session: CONTROLLER },
  { path: '/meeting/controller/roster', session: CONTROLLER },
  { path: '/meeting/controller/dashboard', session: CONTROLLER },
  { path: '/meeting/controller/registrants', session: CONTROLLER },
  { path: '/meeting/controller/employees', session: CONTROLLER },
  { path: '/meeting/controller/backfill', session: CONTROLLER },
  { path: '/meeting/controller/backfill/import', session: CONTROLLER },
  { path: '/meeting/register', session: null },
  { path: '/admin', session: ADMIN },
  { path: '/admin/permissions', session: ADMIN },
  { path: '/admin/audit', session: ADMIN },
  { path: '/leave/hr/requests/req-1/print', session: HR, name: '/leave/hr/requests/:id/print' },
]

// Hold the tier on <html> before the app mounts, and keep holding it: the page
// publishes its own guess and the benchmark may revise it.
const FORCE_TIER = (tier) => `((tier) => {
  const apply = () => {
    const root = document.documentElement
    if (!root) return false
    if (root.getAttribute('data-bg-tier') !== tier) root.setAttribute('data-bg-tier', tier)
    return true
  }
  const hold = () => new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bg-tier'],
  })
  if (apply()) { hold(); return }
  const timer = setInterval(() => { if (apply()) { clearInterval(timer); hold() } }, 0)
})(${JSON.stringify(tier)})`

// ---- The measurement -------------------------------------------------------
const MEASURE = () => {
  const MIN = 44
  const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="link"], summary'
  const CLOSED = '.v-overlay:not(.v-overlay--active)'

  const describe = (element) => {
    const tag = element.tagName.toLowerCase()
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean) : []
    const id = element.id ? `#${element.id}` : ''
    return `${tag}${id}${classes.length ? `.${classes.slice(0, 3).join('.')}` : ''}`
  }
  const label = (element) =>
    (element.getAttribute('aria-label') || element.textContent || element.getAttribute('placeholder') || element.getAttribute('title') || '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 48) || element.getAttribute('type') || '(no text)'

  const visible = (element) => {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    // A zero-height overflow ancestor clips the control away entirely.
    for (let node = element.parentElement; node; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node)
      if (nodeStyle.display === 'none') return false
      if (nodeStyle.overflow === 'hidden' || nodeStyle.overflowY === 'hidden') {
        const box = node.getBoundingClientRect()
        if (box.height < 1 || box.width < 1) return false
      }
    }
    return true
  }

  const disabled = (element) =>
    element.disabled === true ||
    element.getAttribute('aria-disabled') === 'true' ||
    Boolean(element.closest('fieldset[disabled]')) ||
    element.classList.contains('v-btn--disabled') ||
    element.classList.contains('v-field--disabled')

  // A click listener on a non-interactive element. Vue keeps its invokers on
  // `_vei`/`__vei`, and a vnode's props may carry the handler in dev builds.
  const clickable = (element) => {
    if (element.hasAttribute('onclick')) return true
    for (const key of ['_vei', '__vei']) {
      const invokers = element[key]
      if (invokers && Object.keys(invokers).some((name) => name.startsWith('click'))) return true
    }
    const vnode = element.__vnode
    if (vnode && vnode.props) {
      if (vnode.props.onClick || vnode.props.onclick) return true
    }
    return false
  }

  const hasInteractiveAncestor = (element) => Boolean(element.parentElement && element.parentElement.closest(INTERACTIVE))

  // A transparent absolute pseudo-element with px insets extends the hit area
  // without changing how the control looks (a switch pill, for example). Only a
  // layer that paints nothing qualifies: a coloured pseudo is decoration, not a
  // tap target.
  const pseudoHitArea = (element, box) => {
    for (const name of ['::before', '::after']) {
      const style = getComputedStyle(element, name)
      if (!style || style.content === 'none' || style.content === 'normal') continue
      if (style.position !== 'absolute') continue
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') continue
      if (style.backgroundImage !== 'none') continue
      if (style.borderTopWidth !== '0px' || style.borderLeftWidth !== '0px') continue
      const px = (value) => {
        const match = /^(-?[\d.]+)px$/.exec(value)
        return match ? Number(match[1]) : null
      }
      const top = px(style.top)
      const right = px(style.right)
      const bottom = px(style.bottom)
      const left = px(style.left)
      if ([top, right, bottom, left].some((value) => value === null)) continue
      return { name, width: box.width - left - right, height: box.height - top - bottom }
    }
    return null
  }

  const seen = new Set()
  const measuredTargets = new Set()
  const controls = []
  const skipped = []

  for (const element of document.querySelectorAll(INTERACTIVE)) {
    // The printed leave form and the public pages are documents too: measure
    // them, they are still pages someone taps.
    if (seen.has(element)) continue
    seen.add(element)
    if (!visible(element)) {
      skipped.push({ element: describe(element), reason: 'not rendered (hidden or zero-size)' })
      continue
    }
    if (disabled(element)) {
      skipped.push({ element: describe(element), reason: 'disabled' })
      continue
    }
    const overlay = element.closest('.v-overlay')
    if (overlay && !overlay.classList.contains('v-overlay--active')) {
      skipped.push({ element: describe(element), reason: 'inside a closed dialog' })
      continue
    }
    if (element.closest('.v-overlay--active') === null && element.closest(CLOSED)) {
      skipped.push({ element: describe(element), reason: 'inside a closed dialog' })
      continue
    }

    // The hit area, not the visual size: Vuetify's inner input is a focus proxy.
    let target = element
    let measuredAs = 'self'
    if (element.tagName === 'INPUT' || element.tagName === 'SELECT' || element.tagName === 'TEXTAREA') {
      const field = element.closest('.v-field')
      const selection = element.closest('.v-selection-control')
      const labelWrap = element.closest('label')
      if (field) {
        target = field
        measuredAs = 'v-field wrapper (outer hit area)'
      } else if (selection && (element.type === 'checkbox' || element.type === 'radio' || element.tagName === 'SELECT')) {
        target = selection
        measuredAs = 'v-selection-control label (outer hit area)'
      } else if (labelWrap && (element.type === 'checkbox' || element.type === 'radio')) {
        // The label is the tap target for a bare radio or checkbox.
        target = labelWrap
        measuredAs = 'label wrapper (outer hit area)'
      }
    }
    if (measuredTargets.has(target)) continue
    measuredTargets.add(target)
    // A single-line input's own box is the hit area; a hidden proxy input is not.
    if (element.tagName === 'INPUT' && element.type === 'hidden') {
      skipped.push({ element: describe(element), reason: 'hidden input' })
      continue
    }

    const box = target.getBoundingClientRect()
    const style = getComputedStyle(target)
    const pseudo = pseudoHitArea(target, box)
    const round = (value) => Math.round(value * 10) / 10
    controls.push({
      element: describe(element),
      selector: describe(target),
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type') || '',
      role: element.getAttribute('role') || '',
      text: label(element),
      width: round(Math.max(box.width, pseudo?.width ?? 0)),
      height: round(Math.max(box.height, pseudo?.height ?? 0)),
      paintedWidth: round(box.width),
      paintedHeight: round(box.height),
      hitArea: pseudo ? `${pseudo.name} layer` : 'own box',
      measuredAs,
      display: style.display,
      overflow: box.width < 1 || box.height < 1 ? 'zero' : '',
    })
  }

  // Pointer-only targets: a click handler on a div, or a pointer cursor with no
  // real control around it. Both are things a finger is expected to hit.
  const decorative = '[aria-hidden="true"], .app-background, canvas'
  for (const element of document.querySelectorAll('main *, .v-main *, .page *')) {
    if (seen.has(element)) continue
    if (element.closest(INTERACTIVE)) continue
    if (element.closest(decorative)) continue
    if (hasInteractiveAncestor(element)) continue
    const isClickable = clickable(element)
    const style = getComputedStyle(element)
    // A pointer cursor inherited from a card or a label belongs to that
    // ancestor, not to every span inside it: only the element that sets it is
    // a pointer-only target.
    const inheritedCursor = element.parentElement ? getComputedStyle(element.parentElement).cursor : 'auto'
    const startsPointer = style.cursor === 'pointer' && inheritedCursor !== 'pointer'
    if (!isClickable && !startsPointer) continue
    if (!visible(element)) continue
    if (disabled(element)) {
      skipped.push({ element: describe(element), reason: 'disabled' })
      continue
    }
    const overlay = element.closest('.v-overlay')
    if (overlay && !overlay.classList.contains('v-overlay--active')) {
      skipped.push({ element: describe(element), reason: 'inside a closed dialog' })
      continue
    }
    // A label's own box is the tap target for its control: measured through the
    // input above, not a second time here.
    const labelWrap = element.closest('label')
    if (labelWrap && labelWrap !== element) continue
    if (measuredTargets.has(element)) continue
    measuredTargets.add(element)
    seen.add(element)
    const box = element.getBoundingClientRect()
    controls.push({
      element: describe(element),
      selector: describe(element),
      tag: element.tagName.toLowerCase(),
      type: '',
      role: element.getAttribute('role') || '',
      text: label(element),
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
      measuredAs: isClickable ? 'click listener on a non-interactive element' : 'pointer cursor only',
    })
  }

  // The mobile dock is fixed over the page: name the controls it covers instead
  // of counting a tap that the dock would take.
  const dock = document.querySelector('.dock, .nav-dock, [data-dock]')
  const dockBox = dock ? dock.getBoundingClientRect() : null
  const underDock = dockBox
    ? controls.filter((control) => {
        const element = [...document.querySelectorAll(INTERACTIVE)].find((node) => describe(node) === control.element)
        if (!element || dock.contains(element)) return false
        const box = element.getBoundingClientRect()
        return box.top < dockBox.bottom && box.bottom > dockBox.top && box.left < dockBox.right && box.right > dockBox.left
      }).length
    : 0

  const small = controls.filter((control) => control.width < MIN || control.height < MIN)
  return {
    controls,
    skipped,
    underDock,
    small,
    total: controls.length,
  }
}

// ---- Run -------------------------------------------------------------------
const chromium = await loadChromium()
mkdirSync(dirname(resolve(process.cwd(), JSON_OUT || 'audit.json')), { recursive: true })

let browser
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })
} catch (error) {
  console.error(`Could not launch Chrome at ${CHROME}: ${error.message}`)
  process.exit(2)
}

const report = { generatedAt: new Date().toISOString(), base: BASE, tier: 'high', minimum: `${MIN}x${MIN}`, widths: WIDTHS, runs: [], failures: 0 }

const SELECTED = ONLY ? ROUTES.filter((route) => route.path.includes(ONLY)) : ROUTES

for (const route of SELECTED) {
  for (const width of WIDTHS) {
    const mobile = width < 640
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 },
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    })
    await context.addInitScript(FORCE_TIER('high'))
    await context.route('**/api/**', stubFor(route.session))
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    const name = route.name || route.path
    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForFunction(
        () => Boolean(document.querySelector('main, .pending-page, .login-layout, .approve-page, .page, .print-page, h1')),
        null,
        { polling: 100, timeout: 20000 }
      )
      await page.waitForTimeout(1200)
      // Settle the entrance so a control mid-animation is measured at rest.
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(200)

      const measured = await page.evaluate(MEASURE)
      const run = {
        route: name,
        path: route.path,
        width,
        tier: await page.evaluate(() => document.documentElement.getAttribute('data-bg-tier')),
        total: measured.total,
        smallCount: measured.small.length,
        underDock: measured.underDock,
        controls: measured.controls,
        small: measured.small,
        skipped: measured.skipped,
        errors,
      }
      report.runs.push(run)
      report.failures += measured.small.length
      const flag = measured.small.length ? 'FAIL' : 'ok  '
      console.log(`${flag} ${name} @${width}: ${measured.total} controls, ${measured.small.length} under ${MIN}px, ${measured.skipped.length} skipped, ${errors.length} errors`)
      for (const item of measured.small) console.log(`       ${item.width}x${item.height} ${item.element} "${item.text}"`)
    } catch (error) {
      report.runs.push({ route: name, path: route.path, width, error: error.message, errors })
      report.failures += 1
      console.log(`ERR  ${name} @${width}: ${error.message}`)
    }
    await context.close()
  }
}

await browser.close()

if (JSON_OUT) {
  writeFileSync(resolve(process.cwd(), JSON_OUT), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nWrote ${JSON_OUT}`)
}

const runsWithFailures = report.runs.filter((run) => (run.smallCount ?? 1) > 0 || run.error)
console.log(`\n${report.runs.length} page-runs, ${runsWithFailures.length} with sub-${MIN}px controls or errors, ${report.failures} sub-${MIN}px controls in total.`)
process.exit(report.failures === 0 ? 0 : 1)
