// @vitest-environment happy-dom
// The HR employee directory: its own finder-and-results composition, the glass
// tint and the blur that follows the tier, every ink against the darkest glass
// the scene can show, the motion contract (transform and opacity only, a short
// entrance, a 50ms stagger), reduced motion landing on the finished page, the
// link targets, and the search request shape left exactly as it was.
//
// The contrast maths is self-tested first with known pairs, so a broken formula
// cannot report optimistic numbers.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QUALITY_TIERS } from '../src/lib/background-quality.js'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/HrEmployeesPage.vue')
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

import HrEmployeesPage from '../src/pages/HrEmployeesPage.vue'

function mountPage() {
  return mount(HrEmployeesPage, {
    global: {
      stubs: {
        'v-alert': true,
        'v-icon': true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
}

// Every ink the page puts on glass or on an opaque fill, against the worst-case
// backdrop. Every pair here is held to 4.5:1.
const TEXT_PAIRS = [
  ['หัวข้อหน้า #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--dir-glass')],
  ['คำโปรย #475569', parseColor('#475569'), panelBackdrop('--dir-glass')],
  ['ชื่อคอลัมน์ #475569', parseColor('#475569'), panelBackdrop('--dir-glass')],
  ['ช่องค้นหา #1e1b4b', parseColor('#1e1b4b'), over({ ...parseColor('#ffffff'), a: 0.75 }, panelBackdrop('--dir-glass'))],
  ['รหัสพนักงาน #475569', parseColor('#475569'), panelBackdrop('--dir-glass')],
  ['ชื่อพนักงาน #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--dir-glass')],
  ['แผนก #334155', parseColor('#334155'), panelBackdrop('--dir-glass')],
  ['ลิงก์นำเข้า #4338ca', parseColor('#4338ca'), panelBackdrop('--dir-glass')],
  ['ป้ายใช้งานอยู่ #1c6b3f', parseColor('#1c6b3f'), parseColor('#e6f4ec')],
  ['ป้ายปิดการใช้งาน #5f5f5f', parseColor('#5f5f5f'), parseColor('#f1f1f1')],
]

const RESULTS = [
  {
    id: 'emp-1',
    employeeCode: 'EMP001',
    fullName: 'สมชาย ใจดี',
    namePrefix: 'นาย',
    departmentName: 'การเงิน',
    isActive: true,
  },
  {
    id: 'emp-2',
    employeeCode: 'EMP002',
    fullName: 'สมหญิง รักงาน',
    namePrefix: 'นาง',
    departmentName: 'บุคคล',
    isActive: false,
  },
]

describe('HR employee directory page', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, results: RESULTS }) }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('composes a finder beside a results panel', () => {
    expect(PAGE_SOURCE).toContain('<section class="finder" aria-labelledby="employees-title">')
    expect(PAGE_SOURCE).toContain('<h1 id="employees-title" class="title">')
    expect(PAGE_SOURCE).toContain('<section class="results" aria-labelledby="results-title">')
    expect(PAGE_SOURCE).toContain('<label class="search">')
    expect(PAGE_SOURCE).toContain('aria-label="ค้นหาพนักงาน"')

    const wrapper = mountPage()
    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(wrapper.find('.search input').exists()).toBe(true)
    expect(wrapper.find('.list-head').exists()).toBe(false) // no rows before a search
  })

  it('keeps the link targets exactly as they were', () => {
    expect(PAGE_SOURCE).toContain('to="/hr/employees/import"')
    expect(PAGE_SOURCE).toContain('router.push(`/hr/employees/${encodeURIComponent(id)}`)')
    expect(PAGE_SOURCE).not.toMatch(/\sto="(?!\/hr\/employees\/import")/)
    expect(PAGE_SOURCE).not.toMatch(/(^|\s)href=/)
  })

  it('keeps the search request shape unchanged', async () => {
    // The constant, the debounce and the fetch are the ones the page already had.
    expect(PAGE_SOURCE).toContain('const MIN_LENGTH = 2')
    expect(PAGE_SOURCE).toContain('timer = setTimeout(search, 300)')
    expect(PAGE_SOURCE).toContain('watch(query, () => {')
    expect(PAGE_SOURCE).toContain(
      'fetch(`/api/hr/employees?q=${encodeURIComponent(text)}`, {\n      credentials: \'same-origin\',\n    })'
    )
    // No filter control was added: the page has one query and one request.
    expect(PAGE_SOURCE).not.toMatch(/<select|type="checkbox"|type="radio"/)

    const wrapper = mountPage()
    await wrapper.find('.search input').setValue('ab')
    await new Promise((resolve) => setTimeout(resolve, 420))
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/hr/employees?q=ab')
    expect(options).toEqual({ credentials: 'same-origin' })
    wrapper.unmount()
  })

  it('renders the rows with their status badges', async () => {
    const wrapper = mountPage()
    await wrapper.find('.search input').setValue('สม')
    await new Promise((resolve) => setTimeout(resolve, 420))
    await flushPromises()

    const rows = wrapper.findAll('button.list-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].find('.badge').classes()).toContain('badge-on')
    expect(rows[1].find('.badge').classes()).toContain('badge-off')
    expect(rows[0].findAll('.cell')).toHaveLength(4)
    expect(rows[0].text()).toContain('EMP001')
    expect(rows[0].text()).toContain('นาย สมชาย ใจดี')
    wrapper.unmount()
  })

  it('keeps the glass tint in the 0.86-0.90 band and the blur on the tier', () => {
    const alpha = tintAlpha('--dir-glass')
    expect(alpha).toBeGreaterThanOrEqual(0.86)
    expect(alpha).toBeLessThanOrEqual(0.9)

    const staticBlock = blockFor(":root[data-bg-tier='static']")
    expect(staticBlock).toContain('--dir-filter: none')
    const staticTint = /--dir-glass:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(staticBlock)
    expect(staticTint).not.toBeNull()
    expect(Number(staticTint[1])).toBeGreaterThanOrEqual(0.86)
    expect(Number(staticTint[1])).toBeLessThanOrEqual(0.9)

    expect(QUALITY_TIERS.high.glassBlur).toBe(18)
    expect(QUALITY_TIERS.medium.glassBlur).toBe(8)
    expect(CSS).toContain('--dir-blur: 18px')
    expect(blockFor(":root[data-bg-tier='medium']")).toContain('--dir-blur: 8px')

    const panel = blockFor('.finder,\n.results')
    expect(panel).toContain('background-color: var(--dir-glass)')
    expect(panel).toContain('backdrop-filter: var(--dir-filter)')
    expect(panel).toContain('-webkit-backdrop-filter: var(--dir-filter)')
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

    expect(CSS).toMatch(/dir-rise 0\.44s/)
    expect(CSS).toMatch(/dir-rise 0\.4[0-9]s/)
    const stagger = /\* (\d+)ms \+ (\d+)ms/.exec(CSS)
    expect(stagger).not.toBeNull()
    expect(Number(stagger[1])).toBeLessThanOrEqual(60)
  })

  it('puts hover and press feedback behind a fine pointer', () => {
    const hoverQuery = CSS.indexOf('@media (hover: hover) and (pointer: fine)')
    expect(hoverQuery).toBeGreaterThan(-1)
    expect(CSS.indexOf(':hover')).toBeGreaterThan(hoverQuery)
    expect(blockFor('.list-row:hover {')).toContain('background-color')
    expect(blockFor('.list-row:active {')).toContain('scale(0.995)')
  })

  it('lands on the finished page when motion is reduced', () => {
    expect(mediaBlock('(prefers-reduced-motion: no-preference)')).toContain('animation: dir-rise')
    const reduced = mediaBlock('(prefers-reduced-motion: reduce)')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')

    expect(blockFor('.finder {')).not.toMatch(/opacity:\s*0(?!\.)/)
    expect(blockFor('.results {')).not.toMatch(/opacity:\s*0(?!\.)/)

    const wrapper = mountPage()
    expect(wrapper.text()).toContain('รายชื่อพนักงาน')
    expect(wrapper.text()).toContain('ผลการค้นหา')
  })

  it('keeps every tap target at 44px', () => {
    expect(CSS).toContain('--tap: 44px')
    expect(blockFor('.search {')).toContain('min-height: var(--tap)')
    // The row's own block (not the shared four-column grid block) sets the floor.
    expect(CSS).toMatch(/\.list-row \{[^}]*min-height: var\(--tap\)/)
    expect(blockFor('.import-link {')).toContain('min-height: var(--tap)')
  })
})
