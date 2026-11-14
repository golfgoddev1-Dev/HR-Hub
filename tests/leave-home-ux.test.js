// @vitest-environment happy-dom
// The employee leave landing page: its own desk-and-list composition, the glass
// tint and the blur that follows the tier, every ink against the darkest glass
// the scene can show, the motion contract (transform and opacity only, a short
// entrance, a 50ms stagger), reduced motion landing on the finished page, and
// the link targets and request shapes left exactly as they were.
//
// The contrast maths is self-tested first with known pairs, so a broken formula
// cannot report optimistic numbers.
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QUALITY_TIERS } from '../src/lib/background-quality.js'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/LeaveHomePage.vue')
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

// --- CSS helpers -----------------------------------------------------------

function blockFor(selector) {
  const start = CSS.indexOf(selector)
  if (start === -1) return ''
  const open = CSS.indexOf('{', start)
  let depth = 0
  for (let index = open; index < CSS.length; index += 1) {
    if (CSS[index] === '{') depth += 1
    if (CSS[index] === '}') {
      depth -= 1
      if (depth === 0) return CSS.slice(open + 1, index)
    }
  }
  return ''
}

function keyframeBodies() {
  const bodies = []
  const pattern = /@keyframes\s+[\w-]+\s*\{/g
  let match = pattern.exec(CSS)
  while (match) {
    const open = CSS.indexOf('{', match.index)
    let depth = 0
    for (let index = open; index < CSS.length; index += 1) {
      if (CSS[index] === '{') depth += 1
      if (CSS[index] === '}') {
        depth -= 1
        if (depth === 0) {
          bodies.push(CSS.slice(open + 1, index))
          pattern.lastIndex = index
          break
        }
      }
    }
    match = pattern.exec(CSS)
  }
  return bodies
}

function mediaBlock(query) {
  const start = CSS.indexOf(`@media ${query}`)
  if (start === -1) return ''
  const open = CSS.indexOf('{', start)
  let depth = 0
  for (let index = open; index < CSS.length; index += 1) {
    if (CSS[index] === '{') depth += 1
    if (CSS[index] === '}') {
      depth -= 1
      if (depth === 0) return CSS.slice(open + 1, index)
    }
  }
  return ''
}

// --- the page --------------------------------------------------------------

const H = vi.hoisted(() => ({
  counts: { pending: 2, approved: 3 },
  rows: [],
  approvalLoads: 0,
}))

vi.mock('../src/api.js', () => ({
  getSession: async () => ({ isApprover: false }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
}))

vi.mock('../src/components/PushToggle.vue', () => ({
  default: { name: 'PushToggle', template: '<div class="push-card" />' },
}))

vi.mock('../src/lib/data-cache.js', () => ({
  peekCached: () => null,
}))

vi.mock('../src/lib/approval-count.js', () => ({
  setApprovalCount: vi.fn(),
}))

vi.mock('../src/lib/shared-data.js', () => ({
  APPROVALS_TTL_MS: 1,
  PAGE_TTL_MS: 1,
  DATA_KEYS: { myRequests: 'myRequests', approvals: 'approvals' },
  errorTextOf: (_error, fallback) => fallback,
  loaders: {
    myRequests: async () => ({
      results: H.rows,
      counts: H.counts,
      certificateRetentionDays: 90,
    }),
    approvals: async () => {
      H.approvalLoads += 1
      return { results: [] }
    },
  },
  loadShared: async (_key, loader, options) => {
    options.onData(await loader())
  },
}))

import LeaveHomePage from '../src/pages/LeaveHomePage.vue'

function mountPage() {
  return mount(LeaveHomePage, {
    global: {
      stubs: {
        'v-alert': true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
}

const TARGETS = ['/leave/new']

// Every ink the page puts on glass or on an opaque fill, against the
// worst-case backdrop. Large text could pass at 3:1, but every pair here is
// held to 4.5:1.
const TEXT_PAIRS = [
  ['หัวข้อหน้า #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--leave-home-glass')],
  ['คำโปรย #475569', parseColor('#475569'), panelBackdrop('--leave-home-glass')],
  ['ชื่อรายการ #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--leave-home-glass')],
  ['รหัสใบลา #475569', parseColor('#475569'), panelBackdrop('--leave-home-glass')],
  ['ป้ายกำกับตัวเลข #475569', parseColor('#475569'), panelBackdrop('--leave-home-glass')],
  ['ตัวเลขรออนุมัติ #8a4b06', parseColor('#8a4b06'), panelBackdrop('--leave-home-glass')],
  ['ตัวเลขอนุมัติแล้ว #1c6b3f', parseColor('#1c6b3f'), panelBackdrop('--leave-home-glass')],
  ['ค่าข้อมูล #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--leave-home-glass')],
  ['ลิงก์ใบรับรอง #4338ca', parseColor('#4338ca'), panelBackdrop('--leave-home-glass')],
  ['ปุ่มหลัก #ffffff', parseColor('#ffffff'), parseColor('#4f46e5')],
  ['ป้ายสถานะรออนุมัติ #8a4b06', parseColor('#8a4b06'), parseColor('#fff2df')],
  ['ป้ายสถานะอนุมัติ #1c6b3f', parseColor('#1c6b3f'), parseColor('#e6f4ec')],
  ['ป้ายสถานะไม่อนุมัติ #a01b1b', parseColor('#a01b1b'), parseColor('#fdecec')],
  ['ป้ายสถานะยกเลิก #5f5f5f', parseColor('#5f5f5f'), parseColor('#f1f1f1')],
]

const ROW = {
  id: 'req-1',
  requestCode: 'LV-20261101-001',
  leaveTypeName: 'ลาป่วย',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  days: 2,
  status: 'pending',
  returnDate: '2026-11-03',
  returnTime: '08:30',
  createdAt: '2026-10-30',
}

async function settle(wrapper) {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 900))
  await flushPromises()
  return wrapper
}

describe('leave home page', () => {
  beforeEach(() => {
    H.counts = { pending: 2, approved: 3 }
    H.rows = []
    H.approvalLoads = 0
  })

  it('composes a desk with the two counts above a list panel', () => {
    expect(PAGE_SOURCE).toContain('<section class="hero" aria-labelledby="leave-title">')
    expect(PAGE_SOURCE).toContain('<h1 id="leave-title" class="title">')
    expect(PAGE_SOURCE).toContain('<dl class="stats">')
    expect(PAGE_SOURCE).toContain('<section class="list-panel"')
    expect(PAGE_SOURCE).toContain('<PushToggle />')

    const wrapper = mountPage()
    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(wrapper.findAll('.stats .stat')).toHaveLength(2)
    expect(wrapper.find('.rail').exists()).toBe(true)
  })

  it('keeps the link targets exactly as they were', () => {
    const declared = [...PAGE_SOURCE.matchAll(/\sto="([^"]+)"/g)].map((match) => match[1])
    expect(declared).toEqual(TARGETS)
    expect(PAGE_SOURCE).not.toContain(':to=')

    const wrapper = mountPage()
    expect(wrapper.findAll('a.primary-link').map((link) => link.attributes('href'))).toEqual(TARGETS)

    // The certificate stays on the owner route, in a new tab.
    expect(PAGE_SOURCE).toContain('/api/leave/requests/')
    expect(PAGE_SOURCE).toContain('canOpenOwnCertificate')
    expect(PAGE_SOURCE).toContain('target="_blank"')
    expect(PAGE_SOURCE).not.toMatch(/(^|\s)href="\/(?!api\/leave\/requests\/)/)
  })

  it('keeps the count source and the request shapes unchanged', async () => {
    H.counts = { pending: 4, approved: 1 }
    const wrapper = await settle(mountPage())
    const text = wrapper.text()
    expect(text).toContain('ใบลารออนุมัติ')
    expect(text).toContain('ใบลาอนุมัติแล้ว')
    expect(text).toContain('4')
    expect(text).toContain('1')

    // The page still counts from the Worker through the shared loader, and the
    // interpolation that countUp repaints is the same one.
    expect(PAGE_SOURCE).toContain('loadShared(DATA_KEYS.myRequests, loaders.myRequests')
    expect(PAGE_SOURCE).toContain('counts.value = {')
    expect(PAGE_SOURCE).toContain('pending: Number(data.counts?.pending) || 0')
    expect(PAGE_SOURCE).toContain('approved: Number(data.counts?.approved) || 0')
    expect(PAGE_SOURCE).toContain('countUp(')
    expect(PAGE_SOURCE).toContain('{{ counts.pending }}')
    expect(PAGE_SOURCE).toContain('{{ counts.approved }}')

    // Approvals are an approver's queue, unchanged.
    expect(H.approvalLoads).toBe(0)
    expect(PAGE_SOURCE).toContain('if (session?.isApprover === true) await loadPendingApprovals()')
    wrapper.unmount()
  })

  it('renders the rows with their badges and facts', async () => {
    H.rows = [ROW, { ...ROW, id: 'req-2', status: 'approved', requestCode: 'LV-2' }]
    const wrapper = await settle(mountPage())
    const rows = wrapper.findAll('article.row')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.badge').classes()).toContain('badge-pending')
    expect(rows[1].find('.badge').classes()).toContain('badge-approved')
    expect(rows[0].text()).toContain('LV-20261101-001')
    expect(rows[0].findAll('.fact')).toHaveLength(4)
    wrapper.unmount()
  })

  it('keeps the glass tint in the 0.86-0.90 band and the blur on the tier', () => {
    const alpha = tintAlpha('--leave-home-glass')
    expect(alpha).toBeGreaterThanOrEqual(0.86)
    expect(alpha).toBeLessThanOrEqual(0.9)

    const staticBlock = blockFor(":root[data-bg-tier='static']")
    expect(staticBlock).toContain('--leave-home-filter: none')
    const staticTint = /--leave-home-glass:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(staticBlock)
    expect(staticTint).not.toBeNull()
    expect(Number(staticTint[1])).toBeGreaterThanOrEqual(0.86)
    expect(Number(staticTint[1])).toBeLessThanOrEqual(0.9)

    expect(QUALITY_TIERS.high.glassBlur).toBe(18)
    expect(QUALITY_TIERS.medium.glassBlur).toBe(8)
    expect(QUALITY_TIERS.low.glassBlur).toBe(8)
    expect(CSS).toContain('--leave-home-blur: 18px')
    expect(blockFor(":root[data-bg-tier='medium']")).toContain('--leave-home-blur: 8px')

    const panel = blockFor('.hero,\n.list-panel')
    expect(panel).toContain('background-color: var(--leave-home-glass)')
    expect(panel).toContain('backdrop-filter: var(--leave-home-filter)')
    expect(panel).toContain('-webkit-backdrop-filter: var(--leave-home-filter)')
  })

  it('passes the sampler self-check before measuring the page', () => {
    expect(contrast(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 2)
    expect(contrast(parseColor('#475569'), parseColor('#ffffff'))).toBeCloseTo(7.58, 1)
    expect(contrast(parseColor('#1e1b4b'), parseColor('#ffffff'))).toBeCloseTo(15.99, 1)
    expect(contrast(parseColor('#ffffff'), parseColor('#4f46e5'))).toBeCloseTo(6.29, 1)
  })

  it('holds every text and icon ink at 4.5:1 against its worst-case backdrop', () => {
    for (const [name, ink, backdrop] of TEXT_PAIRS) {
      expect(contrast(ink, backdrop), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('animates transform and opacity only, under 600ms with a 50ms stagger', () => {
    const keyframes = keyframeBodies()
    expect(keyframes.length).toBeGreaterThan(0)
    for (const body of keyframes) {
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1])
      expect(properties.length).toBeGreaterThan(0)
      for (const property of properties) {
        expect(['opacity', 'transform'], `keyframe animates ${property}`).toContain(property)
      }
    }

    const allowed = ['transform', 'opacity', 'background-color', 'border-color', 'color', 'box-shadow', 'outline-color']
    const transitions = [...CSS.matchAll(/transition:\s*([^;]+);/g)].map((match) => match[1])
    expect(transitions.length).toBeGreaterThan(0)
    for (const value of transitions) {
      for (const entry of value.split(',')) {
        const property = entry.trim().split(/\s+/)[0]
        if (property === 'none') continue
        expect(allowed, `transition animates ${property}`).toContain(property)
      }
    }

    expect(CSS).toMatch(/leave-rise 0\.44s/)
    expect(CSS).toMatch(/leave-rise 0\.4[0-9]s/)
    const stagger = /\* (\d+)ms \+ (\d+)ms/.exec(CSS)
    expect(stagger).not.toBeNull()
    expect(Number(stagger[1])).toBeLessThanOrEqual(60)
  })

  it('puts hover lift and press feedback behind a fine pointer', () => {
    const hoverQuery = CSS.indexOf('@media (hover: hover) and (pointer: fine)')
    expect(hoverQuery).toBeGreaterThan(-1)
    expect(CSS.indexOf(':hover')).toBeGreaterThan(hoverQuery)
    expect(blockFor('.primary-link:hover {')).toContain('translateY(-1px)')
    expect(blockFor('.primary-link:active {')).toContain('scale(0.98)')
  })

  it('lands on the finished page when motion is reduced', () => {
    expect(mediaBlock('(prefers-reduced-motion: no-preference)')).toContain('animation: leave-rise')
    const reduced = mediaBlock('(prefers-reduced-motion: reduce)')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')

    expect(blockFor('.hero {')).not.toMatch(/opacity:\s*0(?!\.)/)
    expect(blockFor('.row {')).not.toMatch(/opacity:\s*0(?!\.)/)

    const wrapper = mountPage()
    expect(wrapper.text()).toContain('ใบลาของฉัน')
    expect(wrapper.text()).toContain('ยื่นใบลาใหม่')
  })

  it('keeps tap targets at 44px on phones', () => {
    expect(CSS).toContain('--tap: 44px')
    const link = blockFor('.primary-link {')
    expect(link).toContain('min-height: var(--tap)')
    const noteLink = blockFor('.note a {')
    expect(noteLink).toContain('min-height: var(--tap)')

    // The notification switch is one action, so it takes the same floor.
    const toggle = blockFor('.rail :deep(.notify-switch) {')
    expect(toggle).toContain('height: var(--tap)')
    expect(toggle).toContain('min-width: var(--tap)')
  })
})
