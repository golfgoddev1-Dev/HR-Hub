// @vitest-environment happy-dom
// The /hr/leave pilot: its own glass console layout, the tint and blur budget,
// every ink against the worst-case scene pixel, the motion contract, reduced
// motion, and the API requests the page already made before the redesign.
//
// The contrast maths is self-tested first with known pairs, so a broken formula
// cannot report optimistic numbers.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HrLeaveRequestsPage from '../src/pages/HrLeaveRequestsPage.vue'
import { countUp } from '../src/lib/motion.js'
import { clearAll } from '../src/lib/data-cache.js'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/HrLeaveRequestsPage.vue')
const PAGE_STYLES = [...PAGE_SOURCE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((match) => match[1])
  .join('\n')
const CSS = PAGE_STYLES.replace(/\/\*[\s\S]*?\*\//g, '')

// --- colour maths ----------------------------------------------------------

function parseColor(value) {
  const text = String(value).trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(text)
  if (hex) {
    const digits = hex[1]
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    }
  }
  const rgba = /rgba?\(([^)]+)\)/.exec(text)
  if (!rgba) throw new Error(`cannot read colour "${value}"`)
  const parts = rgba[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] }
}

function luminance({ r, g, b }) {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** `top` painted over `bottom` with its own alpha. */
function over(top, bottom) {
  const alpha = top.a
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  }
}

// The darkest object the app background can draw: the indigo-800 card in
// src/lib/background-scene.js CARD_TINTS. A glass tint leaves the rest of it
// showing, so this is the worst pixel a panel can put behind its text.
const SCENE_DARKEST = parseColor('#3730a3')

function tintAlpha(token) {
  const match = new RegExp(`${token}:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([\\d.]+)\\)`).exec(PAGE_STYLES)
  if (!match) throw new Error(`${token} is not declared as a translucent white tint`)
  return Number(match[1])
}

function panelBackdrop(token) {
  return over({ ...parseColor('#ffffff'), a: tintAlpha(token) }, SCENE_DARKEST)
}

function blockAfter(selector) {
  const start = CSS.indexOf(selector)
  if (start === -1) return ''
  const open = CSS.indexOf('{', start)
  let depth = 0
  for (let index = open; index < CSS.length; index += 1) {
    if (CSS[index] === '{') depth += 1
    if (CSS[index] === '}') {
      depth -= 1
      if (depth === 0) return CSS.slice(start, index + 1)
    }
  }
  return ''
}

const GLASS = tintAlpha('--leave-glass')
const GLASS_STRONG = tintAlpha('--leave-glass-strong')
const PANEL = panelBackdrop('--leave-glass')
const DIALOG = panelBackdrop('--leave-glass-strong')

// Every ink the page puts on glass, against the worst-case backdrop. Large text
// could pass at 3:1, but every pair here is held to 4.5:1.
const TEXT_PAIRS = [
  ['หัวข้อหน้า #1e1b4b', '#1e1b4b', PANEL],
  ['ชื่อพนักงาน #1e1b4b', '#1e1b4b', PANEL],
  ['ข้อความรอง #475569', '#475569', PANEL],
  ['ตัวเลขสรุป #1e1b4b', '#1e1b4b', PANEL],
  ['ลิงก์และไอคอนหลัก #4f46e5', '#4f46e5', PANEL],
  ['แท็กคีย์ย้อนหลัง #4338ca', '#4338ca', PANEL],
  ['ป้ายหน้า #4338ca', '#4338ca', PANEL],
  ['คำเตือน #92400e', '#92400e', PANEL],
  ['ข้อผิดพลาด #b91c1c', '#b91c1c', PANEL],
  ['ไดอะล็อก #1e1b4b', '#1e1b4b', DIALOG],
  ['ไดอะล็อกข้อความรอง #475569', '#475569', DIALOG],
]

// Status badges carry their own opaque background, so they are checked as they
// are painted rather than against the scene.
const BADGE_PAIRS = [
  ['#8a4b06', '#fff2df'],
  ['#1c6b3f', '#e6f4ec'],
  ['#a01b1b', '#fdecec'],
  ['#5f5f5f', '#f1f1f1'],
]

// --- page fixture ----------------------------------------------------------

const ROWS = [
  {
    id: 'req-1',
    requestCode: 'LV-20261101-001',
    requester: { fullName: 'สมชาย ใจดี', employeeCode: 'EMP001' },
    departmentName: 'การเงิน',
    leaveTypeName: 'ลาป่วย',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: 2,
    status: 'pending',
    source: 'employee',
  },
  {
    id: 'req-2',
    requestCode: 'LV-20261103-002',
    requester: { fullName: 'สมหญิง รักงาน', employeeCode: 'EMP002' },
    departmentName: 'บุคคล',
    leaveTypeName: 'ลากิจ',
    startDate: '2026-11-03',
    endDate: '2026-11-03',
    days: 1,
    status: 'approved',
    source: 'hr_backdated',
  },
  {
    id: 'req-3',
    requestCode: 'LV-20261105-003',
    requester: { fullName: 'อนุชา ตั้งใจ', employeeCode: 'EMP003' },
    departmentName: 'ผลิต',
    leaveTypeName: 'ลาพักร้อน',
    startDate: '2026-11-05',
    endDate: '2026-11-07',
    days: 3,
    status: 'rejected',
    source: 'employee',
  },
]

const DETAIL = {
  ...ROWS[0],
  returnDate: '2026-11-03',
  returnTime: '08:00',
  shiftCode: 'A',
  otOption: 'none',
  approver: { fullName: 'หัวหน้า กอง' },
  decidedAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-11-01T09:12:00.000Z',
  reason: 'ป่วย',
  decisionNote: '',
}

const calls = []

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

function stubFetch() {
  calls.length = 0
  const fetchMock = vi.fn(async (url, options = {}) => {
    const path = String(url)
    calls.push({ url: path, options })
    if (path.includes('/api/hr/directory/catalog')) {
      return jsonResponse({ ok: true, departments: [{ id: 'dep-1', name: 'การเงิน', isActive: true }] })
    }
    if (path.includes('/api/leave/hr/catalog')) {
      return jsonResponse({
        ok: true,
        types: [{ id: 'type-1', name: 'ลาป่วย' }],
        certificateRetentionDays: 90,
      })
    }
    if (path.includes('/api/leave/hr/requests/req-1')) return jsonResponse({ ok: true, request: DETAIL })
    if (path.includes('/api/leave/hr/requests')) {
      return jsonResponse({ ok: true, results: ROWS, hasMore: true, scanCapped: false })
    }
    return jsonResponse({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const SelectStub = { inheritAttrs: false, template: '<div class="select-stub"></div>' }
const AlertStub = { template: '<div class="alert-stub"><slot /></div>' }

function mountPage() {
  return mount(HrLeaveRequestsPage, {
    global: {
      stubs: {
        'v-select': SelectStub,
        'v-alert': AlertStub,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

// A lite, reduced-motion window: the scene stays a gradient, no GPU and no GSAP
// is pulled in, and the page's own state is deterministic.
function stubEnvironment({ reduced = true } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion') ? reduced : query.includes('pointer: coarse'),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
}

beforeEach(() => {
  clearAll()
  stubEnvironment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearAll()
})

describe('contrast maths', () => {
  it('matches known pairs', () => {
    const white = parseColor('#ffffff')
    expect(contrast(parseColor('#000000'), white)).toBeCloseTo(21, 1)
    expect(contrast(parseColor('#1e1b4b'), white)).toBeCloseTo(15.99, 1)
    expect(contrast(parseColor('#475569'), white)).toBeCloseTo(7.58, 1)
    expect(contrast(white, parseColor('#4f46e5'))).toBeCloseTo(6.29, 1)
    expect(contrast(white, white)).toBeCloseTo(1, 2)
  })

  it('composites a tint over a backdrop before measuring', () => {
    const white = parseColor('#ffffff')
    expect(over(white, parseColor('#000000'))).toMatchObject({ r: 255, g: 255, b: 255 })
    const half = over({ ...white, a: 0.5 }, parseColor('#000000'))
    expect(half.r).toBeCloseTo(127.5, 3)
  })
})

describe('glass budget', () => {
  it('keeps every panel tint between 0.86 and 0.90', () => {
    for (const alpha of [GLASS, GLASS_STRONG]) {
      expect(alpha).toBeGreaterThanOrEqual(0.86)
      expect(alpha).toBeLessThanOrEqual(0.9)
    }

    // The static tier raises the tint, but only inside the same band.
    const staticBlock = blockAfter(":root[data-bg-tier='static']")
    const staticTints = [...staticBlock.matchAll(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/g)].map(
      (match) => Number(match[1])
    )
    expect(staticTints.length).toBeGreaterThanOrEqual(2)
    for (const alpha of staticTints) {
      expect(alpha).toBeGreaterThanOrEqual(0.86)
      expect(alpha).toBeLessThanOrEqual(0.9)
    }
  })

  it('follows the background tier: 14-18px at high, 8px at medium and low, none at static', () => {
    const high = Number(/--leave-glass-blur:\s*(\d+)px/.exec(PAGE_STYLES)[1])
    expect(high).toBeGreaterThanOrEqual(14)
    expect(high).toBeLessThanOrEqual(18)

    const reduced = blockAfter(":root[data-bg-tier='medium']")
    expect(reduced).toContain('--leave-glass-blur: 8px')
    expect(blockAfter(":root[data-bg-tier='low']").length).toBeGreaterThan(0)
    expect(PAGE_SOURCE).toContain(":root[data-bg-tier='low'] {")
    expect(PAGE_SOURCE.match(/--leave-glass-blur: 8px/g).length).toBe(1)
    expect(blockAfter(":root[data-bg-tier='static']")).toContain('--leave-glass-filter: none')
  })

  it('frosts every text panel with the shared recipe', () => {
    const recipe = blockAfter('.masthead,\n.filter-deck,\n.results,\n.detail')
    expect(recipe).toContain('background-color: var(--leave-glass)')
    expect(recipe).toContain('backdrop-filter: var(--leave-glass-filter)')
    expect(recipe).toContain('-webkit-backdrop-filter: var(--leave-glass-filter)')
    expect(PAGE_SOURCE).toContain('backdrop-filter: var(--leave-glass-filter)')
  })
})

describe('worst-case contrast on glass', () => {
  it('holds every text pair at 4.5:1 over the darkest scene pixel', () => {
    for (const [label, ink, backdrop] of TEXT_PAIRS) {
      const ratio = contrast(parseColor(ink), backdrop)
      expect(ratio, `${label}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('holds the semantic badges at 4.5:1 on their own fills', () => {
    for (const [ink, fill] of BADGE_PAIRS) {
      const ratio = contrast(parseColor(ink), parseColor(fill))
      expect(ratio, `${ink} on ${fill}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the cancelled badge at 5.5:1 after darkening its ink', () => {
    // #6a6a6a on #f1f1f1 was 4.79:1; the ink is now #5f5f5f.
    const ratio = contrast(parseColor('#5f5f5f'), parseColor('#f1f1f1'))
    expect(ratio).toBeGreaterThanOrEqual(5.5)
    expect(PAGE_SOURCE).toContain('.badge-cancelled { background: #f1f1f1; color: #5f5f5f; }')
    // The other badges keep their inks.
    expect(PAGE_SOURCE).toContain('.badge-pending { background: #fff2df; color: #8a4b06; }')
    expect(PAGE_SOURCE).toContain('.badge-approved { background: #e6f4ec; color: #1c6b3f; }')
    expect(PAGE_SOURCE).toContain('.badge-rejected { background: #fdecec; color: #a01b1b; }')
  })

  it('holds the control boundary at 3:1 against the glass', () => {
    // --leave-line is indigo-900 at 58%, painted over the glass panel.
    const line = over(parseColor('rgba(30, 27, 75, 0.58)'), PANEL)
    const ratio = contrast(line, PANEL)
    expect(ratio, `control boundary: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
  })

  it('keeps the worst ink above 4.5:1 with margin at the measured tint', () => {
    // Reported figure: slate-600 is the lightest ink on the panels.
    const ratio = contrast(parseColor('#475569'), PANEL)
    expect(ratio).toBeGreaterThanOrEqual(5)
    expect(ratio).toBeLessThan(9)
  })
})

describe('motion contract', () => {
  const LAYOUT = /\b(width|height|min-width|min-height|max-width|max-height|top|left|right|bottom|inset|margin|padding|gap|row-gap|column-gap|font-size)\b/

  it('never animates a layout property', () => {
    const declarations = [
      ...CSS.matchAll(/(?:^|[;{\s])(transition(?:-property)?|animation)\s*:\s*([^;}]+)/g),
    ]
    expect(declarations.length).toBeGreaterThan(0)
    for (const [, property, value] of declarations) {
      expect(value, `${property}: ${value.trim()}`).not.toMatch(LAYOUT)
    }
  })

  it('keeps every keyframe on transform and opacity', () => {
    let index = CSS.indexOf('@keyframes')
    const bodies = []
    while (index !== -1) {
      const open = CSS.indexOf('{', index)
      let depth = 0
      for (let at = open; at < CSS.length; at += 1) {
        if (CSS[at] === '{') depth += 1
        if (CSS[at] === '}') {
          depth -= 1
          if (depth === 0) {
            bodies.push(CSS.slice(open, at + 1))
            break
          }
        }
      }
      index = CSS.indexOf('@keyframes', index + 1)
    }
    for (const body of bodies) {
      expect(body).not.toMatch(LAYOUT)
    }
  })

  it('removes every transition and transform for reduced motion', () => {
    const reduced = blockAfter('@media (prefers-reduced-motion: reduce)')
    expect(reduced).toContain('transition: none')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transform: none')

    for (const selector of [
      '.list-row',
      '.list-row:active',
      '.summary-item',
      '.leave-card-enter-active',
      '.leave-detail-enter-active .detail',
      '.primary-btn',
      '.ghost-btn',
      '.primary-link',
      '.icon-btn',
    ]) {
      expect(reduced, selector).toContain(selector)
    }
    // The entrance and slide end states are the final state, not a hidden one.
    expect(reduced).toContain('opacity: 1')
  })

  it('shows the counted value at once under reduced motion', async () => {
    const element = document.createElement('span')
    element.textContent = '0'

    const value = await countUp(element, 12)

    expect(value).toBe(12)
    expect(element.textContent).toBe('12')
  })

  it('renders the list flat and already in place under reduced motion', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    const row = wrapper.find('.list-row')
    expect(row.exists()).toBe(true)
    expect(row.classes()).not.toContain('row-tilt')
    // The numbers are the real counts, not a zero waiting for a tween.
    expect(wrapper.findAll('.stat-count').map((node) => node.text())).toEqual(['1', '1', '1', '0'])
    wrapper.unmount()
  })

  it('never hides content outside a transition state', () => {
    const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const hidden = rules.filter(([, , body]) =>
      /opacity:\s*0(?:[;\s]|$)|visibility:\s*hidden/.test(body)
    )
    expect(hidden.length).toBeGreaterThan(0)
    for (const [, selector] of hidden) {
      expect(selector.trim()).toMatch(/-enter-from|-leave-to/)
    }
  })
})

describe('page layout', () => {
  it('renders the glass console: masthead, summary, filter rail and results', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    const masthead = wrapper.find('.masthead')
    expect(masthead.exists()).toBe(true)
    expect(masthead.find('.eyebrow').text()).toContain('งานบุคคล')
    expect(masthead.find('h1').text()).toBe('จัดการใบลา')
    expect(masthead.find('.primary-link').text()).toContain('คีย์ใบลาย้อนหลัง')

    // Four summary tiles, one per status, counted from this page's rows.
    const stats = wrapper.findAll('.summary-item')
    expect(stats.length).toBe(4)
    expect(stats.map((node) => node.find('.stat-label').text())).toEqual([
      'รออนุมัติ',
      'อนุมัติแล้ว',
      'ไม่อนุมัติ',
      'ยกเลิก',
    ])
    expect(wrapper.findAll('.stat-toggle').length).toBe(0)

    // The filter rail keeps all five controls and the two actions.
    const deck = wrapper.find('.filter-deck')
    expect(deck.exists()).toBe(true)
    expect(deck.findAll('.field').length).toBe(5)
    expect(deck.findAll('.input').length).toBe(2)
    expect(deck.text()).toContain('ค้นหา')
    expect(deck.text()).toContain('ล้างตัวกรอง')

    // The results panel keeps the column header, the rows and the pager.
    expect(wrapper.find('.results').exists()).toBe(true)
    expect(wrapper.find('.results-title').text()).toBe('รายการใบลา')
    expect(wrapper.find('.results-sub').text()).toContain('3 รายการ')
    expect(wrapper.find('.page-chip').text()).toBe('หน้า 1')
    expect(wrapper.findAll('.list-head span').length).toBe(5)
    expect(wrapper.findAll('.list-row').length).toBe(3)

    const first = wrapper.find('.list-row')
    expect(first.text()).toContain('LV-20261101-001')
    expect(first.text()).toContain('สมชาย ใจดี')
    expect(first.text()).toContain('2 วัน')
    expect(first.find('.badge').classes()).toContain('badge-pending')
    expect(first.find('.row-cue').text()).toBe('chevron_right')

    const pager = wrapper.find('.pager')
    expect(pager.text()).toContain('แสดงทีละ 20 รายการ')
    expect(pager.findAll('button').length).toBe(2)
    expect(pager.findAll('button')[0].attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('marks a backdated request and its own status colour', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    const second = wrapper.findAll('.list-row')[1]
    expect(second.find('.tag').text()).toBe('คีย์ย้อนหลัง')
    expect(second.find('.badge').classes()).toContain('badge-approved')
    wrapper.unmount()
  })

  it('keeps the entrance band on the page', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.hero-scene').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the empty state when the query returns nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const path = String(url)
        if (path.includes('/api/leave/hr/requests')) {
          return jsonResponse({ ok: true, results: [], hasMore: false, scanCapped: false })
        }
        return jsonResponse({ ok: true, departments: [], types: [], certificateRetentionDays: 0 })
      })
    )

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.find('.empty-state').text()).toContain('ไม่พบใบลาตามเงื่อนไขที่เลือก')
    expect(wrapper.findAll('.stat-count').map((node) => node.text())).toEqual(['0', '0', '0', '0'])
    wrapper.unmount()
  })
})

describe('detail dialog', () => {
  it('opens as a modal dialog with the same facts', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.list-row').trigger('click')
    await flushPromises()

    const dialog = wrapper.find('.detail')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.find('.detail-title').text()).toBe('LV-20261101-001')
    expect(dialog.find('.badge').classes()).toContain('badge-pending')
    expect(dialog.text()).toContain('กลับมาทำงาน')
    expect(dialog.text()).toContain('หัวหน้า กอง')
    expect(dialog.findAll('.fact').length).toBe(12)

    await wrapper.find('.icon-btn').trigger('click')
    expect(wrapper.find('.detail').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes when the scrim is tapped', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.list-row').trigger('click')
    await flushPromises()
    expect(wrapper.find('.detail').exists()).toBe(true)

    await wrapper.find('.detail-scrim').trigger('click')
    expect(wrapper.find('.detail').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('requests are unchanged', () => {
  it('asks for the same first page of HR requests', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    const list = calls.find((call) => call.url.includes('/api/leave/hr/requests?'))
    expect(list.url).toBe('/api/leave/hr/requests?page=1&pageSize=20')
    expect(list.options).toEqual({ credentials: 'same-origin' })
    wrapper.unmount()
  })

  it('keeps the filter query string exactly as before', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    wrapper.vm.filters.departmentId = 'dep-1'
    wrapper.vm.filters.status = 'pending'
    const search = wrapper
      .findAll('.filter-deck button')
      .find((node) => node.text().includes('ค้นหา'))
    await search.trigger('click')
    await flushPromises()

    const list = calls.filter((call) => call.url.includes('/api/leave/hr/requests?'))
    expect(list[list.length - 1].url).toBe(
      '/api/leave/hr/requests?departmentId=dep-1&status=pending&page=1&pageSize=20'
    )
    wrapper.unmount()
  })

  it('reads the detail with the same GET and opens the same print URL', async () => {
    stubFetch()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.list-row').trigger('click')
    await flushPromises()

    const detail = calls.find((call) => call.url === '/api/leave/hr/requests/req-1')
    expect(detail.options).toEqual({ credentials: 'same-origin' })

    const print = wrapper
      .findAll('.detail-actions button')
      .find((node) => node.text().includes('พิมพ์'))
    await print.trigger('click')
    expect(open).toHaveBeenCalledWith('/leave/hr/requests/req-1/print', '_blank', 'noopener')
    wrapper.unmount()
  })

  it('sends the approval-link POST with the same empty JSON body', async () => {
    stubFetch()
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('.list-row').trigger('click')
    await flushPromises()

    const resend = wrapper
      .findAll('.detail-actions button')
      .find((node) => node.text().includes('ส่งลิงก์อนุมัติใหม่'))
    expect(resend).toBeTruthy()
    await resend.trigger('click')
    await flushPromises()

    const call = calls.find((entry) => entry.url.endsWith('/approval-link'))
    expect(call.url).toBe('/api/leave/hr/requests/req-1/approval-link')
    expect(call.options).toEqual({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(wrapper.text()).toContain('ส่งลิงก์อนุมัติใหม่แล้ว')
    wrapper.unmount()
  })
})
