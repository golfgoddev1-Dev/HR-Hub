// @vitest-environment happy-dom
// The HR landing page: its own two-panel composition, the glass tint and the
// blur that follows the tier, every ink against the darkest glass the scene can
// put behind it, the motion contract (transform and opacity only, a short
// entrance, a 50ms stagger), reduced motion landing on the finished page, and
// the three link targets unchanged.
//
// The contrast maths is self-tested first with known pairs, so a broken formula
// cannot report optimistic numbers.
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import HrHomePage from '../src/pages/HrHomePage.vue'
import { QUALITY_TIERS } from '../src/lib/background-quality.js'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/HrHomePage.vue')
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

/** The `{...}` body that follows the first occurrence of `selector`. */
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

const RouterLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' }

function mountPage() {
  return mount(HrHomePage, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

const TARGETS = ['/hr/employees', '/hr/employees/import', '/hr/employees/manage']

// Every ink the page puts on glass or on an opaque fill, against the worst-case
// backdrop. Large text could pass at 3:1, but every pair here is held to 4.5:1.
const TEXT_PAIRS = [
  ['หัวข้อหน้า #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--home-glass')],
  ['ข้อความนำ #334155', parseColor('#334155'), panelBackdrop('--home-glass')],
  ['คำอธิบายการ์ด #334155', parseColor('#334155'), panelBackdrop('--home-glass')],
  ['คำโปรย #475569', parseColor('#475569'), panelBackdrop('--home-glass')],
  ['สถานะ #475569', parseColor('#475569'), panelBackdrop('--home-glass')],
  ['ลิงก์เปิดหน้า #4338ca', parseColor('#4338ca'), panelBackdrop('--home-glass')],
  ['ไอคอนบนป้าย #4f46e5', parseColor('#4f46e5'), parseColor('#eef2ff')],
  ['ไอคอนตอน hover #ffffff', parseColor('#ffffff'), parseColor('#4f46e5')],
]

describe('HR home page', () => {
  it('composes a desk beside a task menu', () => {
    expect(PAGE_SOURCE).toContain('<section class="hero" aria-labelledby="home-title">')
    expect(PAGE_SOURCE).toContain('<h1 id="home-title" class="title">')
    expect(PAGE_SOURCE).toContain('<nav class="menu" aria-label="งานของฝ่ายบุคคล">')
    expect(PAGE_SOURCE).toContain('<ul class="tasks">')
    expect(PAGE_SOURCE).toContain('v-for="(card, index) in cards"')

    const wrapper = mountPage()
    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(wrapper.find('main.page').exists()).toBe(true)
    expect(wrapper.findAll('a.task')).toHaveLength(3)
    expect(wrapper.findAll('.task-title')).toHaveLength(3)
  })

  it('keeps the three link targets exactly as they were', () => {
    const declared = [...PAGE_SOURCE.matchAll(/^\s*to: '([^']+)',$/gm)].map((match) => match[1])
    expect(declared).toEqual(TARGETS)

    const wrapper = mountPage()
    const rendered = wrapper.findAll('a.task').map((link) => link.attributes('href'))
    expect(rendered).toEqual(TARGETS)

    // No raw href, and the only dynamic navigation targets are the task-row loop
    // and the pinned-menu card that sits above it.
    expect(PAGE_SOURCE).not.toMatch(/(^|\s)href=/)
    expect(PAGE_SOURCE.match(/:to=/g)).toHaveLength(2)
    expect(PAGE_SOURCE).toContain(':to="current.to"')
  })

  it('keeps the glass tint in the 0.86-0.90 band and the blur on the tier', () => {
    const alpha = tintAlpha('--home-glass')
    expect(alpha).toBeGreaterThanOrEqual(0.86)
    expect(alpha).toBeLessThanOrEqual(0.9)

    // The same band on the static tier, which has no scene to frost.
    const staticBlock = blockFor(":root[data-bg-tier='static']")
    expect(staticBlock).toContain('--home-glass-filter: none')
    const staticTint = /--home-glass:\s*rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(staticBlock)
    expect(staticTint).not.toBeNull()
    expect(Number(staticTint[1])).toBeGreaterThanOrEqual(0.86)
    expect(Number(staticTint[1])).toBeLessThanOrEqual(0.9)

    // Blur is exactly the tier's glassBlur: 18 high, 8 medium and low, none static.
    expect(QUALITY_TIERS.high.glassBlur).toBe(18)
    expect(QUALITY_TIERS.medium.glassBlur).toBe(8)
    expect(QUALITY_TIERS.low.glassBlur).toBe(8)
    expect(CSS).toContain('--home-glass-blur: 18px')
    expect(blockFor(":root[data-bg-tier='medium']")).toContain('--home-glass-blur: 8px')

    // Both panels are glass, and both take the filter the tier publishes.
    const panel = blockFor('.hero,\n.menu')
    expect(panel).toContain('background-color: var(--home-glass)')
    expect(panel).toContain('backdrop-filter: var(--home-glass-filter)')
    expect(panel).toContain('-webkit-backdrop-filter: var(--home-glass-filter)')
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
        // `transition: none` in the reduced-motion block animates nothing.
        if (property === 'none') continue
        expect(allowed, `transition animates ${property}`).toContain(property)
      }
    }

    // Durations and stagger: the entrance is short and the steps are shallow.
    expect(CSS).toMatch(/home-rise 0\.44s/)
    expect(CSS).toMatch(/home-rise 0\.42s/)
    const stagger = /\* (\d+)ms \+ 80ms/.exec(CSS)
    expect(stagger).not.toBeNull()
    expect(Number(stagger[1])).toBeLessThanOrEqual(60)
  })

  it('puts hover lift and press feedback behind a fine pointer', () => {
    const hoverQuery = CSS.indexOf('@media (hover: hover) and (pointer: fine)')
    expect(hoverQuery).toBeGreaterThan(-1)
    expect(CSS.indexOf(':hover')).toBeGreaterThan(hoverQuery)
    expect(CSS.indexOf(':active')).toBeGreaterThan(hoverQuery)

    const hover = blockFor('.task:hover {')
    expect(hover).toContain('translateY(-2px)')
    expect(blockFor('.task:active {')).toContain('scale(0.995)')
  })

  it('lands on the finished page when motion is reduced', () => {
    const noPreference = mediaBlock('(prefers-reduced-motion: no-preference)')
    expect(noPreference).toContain('animation: home-rise')

    const reduced = mediaBlock('(prefers-reduced-motion: reduce)')
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')

    // Nothing is hidden in the base state: the rows are visible without the
    // animation ever running, and the content does not depend on it.
    expect(blockFor('.hero {')).not.toMatch(/opacity:\s*0(?!\.)/)
    expect(blockFor('.task {')).not.toMatch(/opacity:\s*0(?!\.)/)

    const wrapper = mountPage()
    expect(wrapper.text()).toContain('หน้าหลัก')
    expect(wrapper.text()).toContain('งานประจำวัน')
    expect(wrapper.findAll('.task-desc')).toHaveLength(3)
  })

  it('makes the whole row the tap target', () => {
    expect(CSS).toContain('--tap: 44px')
    const task = blockFor('.task {')
    expect(task).toContain('min-height: var(--tap)')
    const icon = blockFor('.task-icon {')
    expect(icon).toContain('width: var(--tap)')
    expect(icon).toContain('height: var(--tap)')

    // The row is a link, not a click handler on a div.
    expect(PAGE_SOURCE).toContain('<RouterLink :to="card.to" class="task"')
  })
})
