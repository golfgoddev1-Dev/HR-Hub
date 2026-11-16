#!/usr/bin/env node
// Stack overlap audit: is a second card's text drawn where the live card's text
// is, during or after a switch?
//
// /hr and /leave share one stack controller (src/lib/card-stack.js) and one
// Vue <Transition> swap, so both are captured the same way:
//   - three cards in the deck;
//   - the switch is started by the deck's own next button;
//   - at 0, 150, 300 and 600 ms after the click, and once with no switch
//     running, the script lists every element at the centre of the live card's
//     description with its text, its card, its own opacity and the product of
//     the opacities from the element up to <html> (that product is what the eye
//     actually sees: a card at opacity .4 paints its text at .4).
//
// A run fails when two different cards have text at that point whose effective
// opacity is above VISIBLE (0.05). The surface is translucent on purpose, so a
// fading card that is nearly invisible is not the bug; a second card you can
// still read through the surface is.
//
// Playwright comes from the copy already on this machine (never `playwright
// install`), and the system Chrome is used through executablePath, like every
// other browser check in this repo.
//
// Usage: node scripts/stack-overlap-audit.mjs [--json <path>] [--shots <dir>]
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.AUDIT_BASE || 'http://localhost:5173'
const VISIBLE = 0.05
const SAMPLE_MS = [0, 150, 300, 600]

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const JSON_OUT = arg('json', '')
const SHOTS = arg('shots', '')

async function loadChromium() {
  const local = resolve(process.cwd(), '.freebuff/pw/node_modules/playwright-core/index.js')
  const candidates = [process.env.PLAYWRIGHT_CORE_PATH, local, 'playwright-core', 'playwright'].filter(Boolean)
  const problems = []
  for (const candidate of candidates) {
    const spec = /^([A-Za-z]:|[./])/.test(candidate) ? pathToFileURL(candidate).href : candidate
    try {
      const mod = await import(spec)
      const chromium = mod.chromium ?? mod.default?.chromium
      if (chromium) return chromium
    } catch (error) {
      problems.push(`${candidate}: ${error.message}`)
    }
  }
  throw new Error(`Playwright not found. Set PLAYWRIGHT_CORE_PATH.\n${problems.join('\n')}`)
}

// ---- sessions and stubs ----------------------------------------------------
const HR = { ok: true, role: 'hr', isApprover: false, hasEmployee: true, mustChangePin: false, name: 'ฝ่ายบุคคล', fullName: 'ฝ่ายบุคคล ทดสอบ' }
const EMPLOYEE = { ok: true, role: 'employee', isApprover: false, hasEmployee: true, mustChangePin: false, name: 'พนักงาน ทดสอบ', fullName: 'พนักงาน ทดสอบ', employeeCode: 'EMP001', departmentName: 'การเงิน' }

// Three pinned menus, the third being วันหยุด — the card the report names.
const PROFILE = {
  ok: true,
  profile: {
    id: 'hr-1',
    employeeCode: 'HR001',
    fullName: 'ฝ่ายบุคคล ทดสอบ',
    hrMenuShortcuts: ['/hr/leave', '/hr/employees', '/hr/leave/holidays'],
  },
}

// Three leave requests, so the employee deck holds three cards too.
const MINE = [
  { id: 'req-1', requestCode: 'LV-20261101-001', leaveTypeName: 'ลาป่วย', startDate: '2026-11-01', endDate: '2026-11-02', days: 2, status: 'pending', returnDate: '2026-11-03', returnTime: '08:30', createdAt: '2026-11-01', source: 'employee' },
  { id: 'req-2', requestCode: 'LV-20261028-002', leaveTypeName: 'ลากิจ', startDate: '2026-10-28', endDate: '2026-10-28', days: 1, status: 'approved', returnDate: '2026-10-29', returnTime: '08:30', createdAt: '2026-10-27', source: 'employee' },
  { id: 'req-3', requestCode: 'LV-20261020-003', leaveTypeName: 'ลาพักร้อน', startDate: '2026-10-20', endDate: '2026-10-22', days: 3, status: 'rejected', returnDate: '2026-10-23', returnTime: '08:30', createdAt: '2026-10-18', source: 'employee' },
]

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
function stubFor(session) {
  return (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/me') return route.fulfill(json(session))
    if (path === '/api/profile/me') return route.fulfill(json(PROFILE))
    if (path === '/api/leave/requests/mine') return route.fulfill(json({ ok: true, results: MINE, counts: { pending: 1, approved: 1 }, certificateRetentionDays: 90 }))
    if (path.endsWith('/mine/counts')) return route.fulfill(json({ ok: true, counts: { pending: 1, approved: 1 } }))
    return route.fulfill(json({ ok: true, results: [] }))
  }
}

const PAGES = [
  { name: 'hr', path: '/hr', session: HR, card: '.deck-card', text: '.deck-desc', next: '[aria-label="เมนูถัดไป"]', root: '.deck' },
  { name: 'leave', path: '/leave', session: EMPLOYEE, card: '.stack-card', text: '.stack-type', next: '[aria-label="ใบลาถัดไป"]', root: '.stack' },
]

const FORCE = (tier) => `((tier) => {
  const apply = () => {
    const root = document.documentElement
    if (!root) return false
    if (root.getAttribute('data-bg-tier') !== tier) root.setAttribute('data-bg-tier', tier)
    return true
  }
  const hold = () => new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bg-tier'] })
  if (apply()) { hold(); return }
  const timer = setInterval(() => { if (apply()) { clearInterval(timer); hold() } }, 0)
})(${JSON.stringify(tier)})`

// Everything painted at one point, with the opacity product that decides whether
// it can be read, and the card it belongs to.
const SAMPLE = ({ x, y, cardSelector, textSelector }) => {
  function describe(el) {
    const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : []
    return `${el.tagName.toLowerCase()}${classes.length ? `.${classes.slice(0, 2).join('.')}` : ''}`
  }
  const opacityOf = (el) => {
    let product = 1
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      product *= Number(getComputedStyle(node).opacity)
    }
    return product
  }
  const cardText = (card) => (card?.querySelector(textSelector)?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  return document.elementsFromPoint(x, y).map((el, index) => {
    const card = el.closest(cardSelector)
    const box = el.getBoundingClientRect()
    return {
      index,
      element: describe(el),
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      inCard: Boolean(card),
      cardKey: card ? cardText(card) : null,
      ownOpacity: Number(getComputedStyle(el).opacity),
      effectiveOpacity: Number(opacityOf(el).toFixed(3)),
      rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
    }
  })
}

// The centre of the live card's description, plus what the deck looks like.
const PROBE = ({ cardSelector, textSelector, rootSelector }) => {
  const cards = [...document.querySelectorAll(cardSelector)]
  const live = cards.find((card) => Number(getComputedStyle(card).opacity) > 0.5) ?? cards[0]
  const target = live?.querySelector(textSelector) ?? document.querySelector(textSelector)
  const box = target?.getBoundingClientRect()
  const root = document.querySelector(rootSelector)?.getBoundingClientRect()
  return {
    x: box ? Math.round(box.left + box.width / 2) : Math.round(innerWidth / 2),
    y: box ? Math.round(box.top + box.height / 2) : Math.round(innerHeight / 2),
    text: (target?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    inFlow: cards.filter((card) => {
      const position = getComputedStyle(card).position
      return position !== 'absolute' && position !== 'fixed'
    }).length,
    cards: cards.map((card) => {
      const rect = card.getBoundingClientRect()
      const style = getComputedStyle(card)
      return {
        text: (card.querySelector(textSelector)?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
        opacity: Number(style.opacity),
        position: style.position,
        background: style.backgroundColor,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      }
    }),
    root: root ? { x: Math.round(root.x), y: Math.round(root.y), width: Math.round(root.width), height: Math.round(root.height) } : null,
  }
}

function offenders(sample) {
  const byCard = new Map()
  for (const entry of sample) {
    if (!entry.inCard || !entry.cardKey || !entry.text) continue
    if (entry.effectiveOpacity <= VISIBLE) continue
    const current = byCard.get(entry.cardKey)
    if (!current || entry.effectiveOpacity > current.effectiveOpacity) byCard.set(entry.cardKey, entry)
  }
  return [...byCard.entries()].map(([card, entry]) => ({ card, opacity: entry.effectiveOpacity, element: entry.element, text: entry.text }))
}

const chromium = await loadChromium()
if (SHOTS) mkdirSync(resolve(process.cwd(), SHOTS), { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] })

const report = { generatedAt: new Date().toISOString(), minimumVisibleOpacity: VISIBLE, sampleMs: SAMPLE_MS, runs: [], failures: 0 }

for (const config of PAGES) {
  for (const width of [390, 1280]) {
    for (const phase of ['idle', ...SAMPLE_MS]) {
      const mobile = width < 640
      const context = await browser.newContext({
        viewport: { width, height: mobile ? 844 : 900 },
        isMobile: mobile,
        hasTouch: mobile,
        deviceScaleFactor: 1,
        reducedMotion: 'no-preference',
      })
      await context.addInitScript(FORCE('high'))
      await context.route('**/api/**', stubFor(config.session))
      const page = await context.newPage()
      const errors = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

      const name = `${config.name}-${width}-${phase === 'idle' ? 'idle' : `${phase}ms`}`
      try {
        await page.goto(`${BASE}${config.path}`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForSelector(config.card, { timeout: 20000 })
        await page.waitForTimeout(1200)

        // The probe point is taken from the card that is on screen before the
        // switch, so every later sample measures the same patch of the page.
        const probe = await page.evaluate(PROBE, { cardSelector: config.card, textSelector: config.text, rootSelector: config.root })
        if (phase !== 'idle') {
          // The click is dispatched in the page so the clock starts on the same
          // frame the switch does: a Playwright click adds 50-150ms of its own.
          await page.evaluate((selector) => {
            window.__stackT0 = performance.now()
            document.querySelector(selector)?.click()
          }, config.next)
          if (phase > 0) {
            await page.waitForFunction((target) => performance.now() - window.__stackT0 >= target, phase, { polling: 10, timeout: 10000 })
          }
        }
        const elapsed = await page.evaluate(() =>
          window.__stackT0 ? Math.round(performance.now() - window.__stackT0) : 0
        )
        const sample = await page.evaluate(SAMPLE, { x: probe.x, y: probe.y, cardSelector: config.card, textSelector: config.text })
        const found = offenders(sample)
        const shot = SHOTS ? `${SHOTS}/${name}.png` : ''
        if (SHOTS) await page.screenshot({ path: shot })
        const after = await page.evaluate(PROBE, { cardSelector: config.card, textSelector: config.text, rootSelector: config.root })
        // Two cards taking part in the layout at once is the same bug seen from
        // the other side: the second card is pushed out of the stack's box.
        const stacked = after.inFlow > 1
        const violation = found.length > 1 || stacked
        if (violation) report.failures += 1
        report.runs.push({ page: config.name, width, phase, elapsed, probe, after: after.cards, inFlow: after.inFlow, offenders: found, violation, stacked, sample, shot, errors })
        console.log(
          `${violation ? 'OVERLAP' : 'ok     '} ${config.name} @${width} ${phase === 'idle' ? 'idle' : `${phase}ms (at ${elapsed}ms)`}: ${found.length} card(s) at the description point` +
            (found.length ? ` — ${found.map((item) => `"${item.card}" @${item.opacity}`).join(' | ')}` : '') +
            ` (cards in DOM: ${after.cards.length}, in layout: ${after.inFlow})` +
            (stacked ? ' — two cards share the layout' : '')
        )
      } catch (error) {
        report.failures += 1
        report.runs.push({ page: config.name, width, phase, error: error.message, errors })
        console.log(`ERROR  ${config.name} @${width} ${phase}: ${error.message}`)
      }
      await context.close()
    }
  }
}

await browser.close()
if (JSON_OUT) {
  writeFileSync(resolve(process.cwd(), JSON_OUT), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nWrote ${JSON_OUT}`)
}
const violating = report.runs.filter((run) => run.violation)
console.log(`\n${report.runs.length} samples, ${violating.length} with a second card's text drawn at the description point.`)
process.exit(report.failures === 0 ? 0 : 1)
