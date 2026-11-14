// @vitest-environment happy-dom
// The employee list's master-detail: the URL owns the selection, the list stays
// mounted (search text and rows survive), the desktop panel sits beside the list,
// the phone sheet traps Tab and closes on Escape, focus goes in and comes back to
// the row, and both detail requests keep the shape the old page used.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import HrEmployeesPage from '../src/pages/HrEmployeesPage.vue'
import { focusableIn } from '../src/lib/dialog-focus.js'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/HrEmployeesPage.vue')
const PAGE_STYLES = [...PAGE_SOURCE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((match) => match[1])
  .join('\n')
const CSS = PAGE_STYLES.replace(/\/\*[\s\S]*?\*\//g, '')

// --- colour maths (self-checked below) -------------------------------------

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

function over(top, bottom) {
  const alpha = top.a
  return {
    r: top.r * alpha + bottom.r * (1 - alpha),
    g: top.g * alpha + bottom.g * (1 - alpha),
    b: top.b * alpha + bottom.b * (1 - alpha),
    a: 1,
  }
}

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

// --- page fixtures ---------------------------------------------------------

const ROWS = [
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

const EMPLOYEES = {
  'emp-1': {
    id: 'emp-1',
    employeeCode: 'EMP001',
    fullName: 'สมชาย ใจดี',
    namePrefix: 'นาย',
    departmentName: 'การเงิน',
    positionName: 'นักบัญชี',
    isActive: true,
    nationalIdMasked: '••••••••1234',
    nationalIdAvailable: true,
  },
  'emp-2': {
    id: 'emp-2',
    employeeCode: 'EMP002',
    fullName: 'สมหญิง รักงาน',
    namePrefix: 'นาง',
    departmentName: 'บุคคล',
    positionName: 'เจ้าหน้าที่บุคคล',
    isActive: false,
    nationalIdMasked: '',
    nationalIdAvailable: false,
  },
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

function stubFetch() {
  const calls = []
  const fetchMock = vi.fn(async (url, options) => {
    const path = String(url)
    calls.push({ url: path, options })
    const detail = /\/api\/hr\/employees\/([^/?]+)$/.exec(path)
    if (detail) {
      const employee = EMPLOYEES[decodeURIComponent(detail[1])]
      return jsonResponse(employee ? { ok: true, employee } : { ok: false, message: 'ไม่พบข้อมูลพนักงาน' })
    }
    if (path.includes('/reveal-national-id')) {
      return jsonResponse({ ok: true, nationalId: '1103700001234' })
    }
    if (path.startsWith('/api/hr/employees?q=')) {
      return jsonResponse({ ok: true, results: ROWS })
    }
    return jsonResponse({ ok: true, results: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

function stubMatchMedia(wide) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      matches: query.includes('min-width: 1080px') ? wide : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/hr/employees', component: { template: '<div />' } },
      { path: '/hr/employees/:id', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(path, { wide = true } = {}) {
  stubMatchMedia(wide)
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(HrEmployeesPage, {
    attachTo: document.body,
    global: {
      plugins: [router],
      stubs: { 'v-alert': true },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

async function searchFor(wrapper, text = 'ab') {
  await wrapper.find('.search input').setValue(text)
  await new Promise((resolve) => setTimeout(resolve, 400))
  await flushPromises()
}

function press(key, { shift = false } = {}) {
  return document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }))
}

let fetchCalls

beforeEach(() => {
  fetchCalls = stubFetch().calls
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('HR employee master-detail', () => {
  it('self-checks the contrast maths before measuring the detail', () => {
    expect(contrast(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 2)
    expect(contrast(parseColor('#475569'), parseColor('#ffffff'))).toBeCloseTo(7.58, 1)
    expect(contrast(parseColor('#ffffff'), parseColor('#4f46e5'))).toBeCloseTo(6.29, 1)
  })

  it('puts the list and the detail side by side on desktop', async () => {
    const { wrapper, router } = await mountAt('/hr/employees', { wide: true })
    await searchFor(wrapper)

    expect(wrapper.findAll('button.list-row')).toHaveLength(2)
    await wrapper.findAll('button.list-row')[0].trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/hr/employees/emp-1')
    expect(wrapper.find('.results').exists()).toBe(true)
    expect(wrapper.find('.detail').exists()).toBe(true)
    expect(wrapper.find('.detail-scrim').exists()).toBe(false)
    expect(wrapper.find('.detail').attributes('role')).toBe('region')
    expect(wrapper.find('.detail').text()).toContain('EMP001')
    expect(wrapper.find('.detail').text()).toContain('นักบัญชี')

    // The split is a real two-column grid, with the finder moved to the list
    // column's header so the rows keep their four columns.
    const split = blockFor('.page.is-split {')
    expect(split).toContain('minmax(0, 1fr) 380px')
    expect(blockFor('.page.is-split .detail-layer {')).toContain('grid-column: 2')
    expect(blockFor('.page.is-split .results {')).toContain('grid-column: 1')
    expect(PAGE_SOURCE).toContain(':class="{ \'is-split\': selectedId && isWide }"')

    // The selected row is marked and the list is still interactive.
    const selected = wrapper.find('button.list-row.is-selected')
    expect(selected.exists()).toBe(true)
    expect(selected.attributes('aria-current')).toBe('true')
    wrapper.unmount()
  })

  it('marks another employee without leaving the page', async () => {
    const { wrapper, router } = await mountAt('/hr/employees', { wide: true })
    await searchFor(wrapper)

    const rows = wrapper.findAll('button.list-row')
    await rows[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/hr/employees/emp-2')

    await rows[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/hr/employees/emp-1')
    expect(wrapper.find('.detail').text()).toContain('EMP001')
    expect(wrapper.find('.search input').element.value).toBe('ab')
    wrapper.unmount()
  })

  it('opens a full-screen sheet on phones and closing keeps the search text', async () => {
    const { wrapper, router } = await mountAt('/hr/employees', { wide: false })
    await searchFor(wrapper, 'สมชาย')

    await wrapper.findAll('button.list-row')[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('.detail-layer.is-sheet').exists()).toBe(true)
    expect(wrapper.find('.detail-scrim').exists()).toBe(true)
    expect(wrapper.find('.detail').attributes('role')).toBe('dialog')
    expect(wrapper.find('.detail').attributes('aria-modal')).toBe('true')

    // The sheet rules: fixed, full-height, over the untouched list.
    const sheet = mediaBlock('(max-width: 1079px)')
    expect(sheet).toContain('position: fixed')
    // The panel caps its own height on desktop; the sheet overrides that to full.
    expect(CSS).toMatch(/\.detail \{[^}]*max-height: calc\(100vh - 48px\)/)
    expect(sheet).toContain('max-height: none')

    await wrapper.find('.detail-close').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/hr/employees')
    expect(wrapper.find('.detail').exists()).toBe(false)
    expect(wrapper.find('.search input').element.value).toBe('สมชาย')
    wrapper.unmount()
  })

  it('opens the deep-linked employee directly', async () => {
    const { wrapper } = await mountAt('/hr/employees/emp-2', { wide: true })

    const call = fetchCalls.find((entry) => entry.url === '/api/hr/employees/emp-2')
    expect(call).toBeTruthy()
    expect(call.options).toEqual({ credentials: 'same-origin' })
    expect(wrapper.find('.detail').text()).toContain('EMP002')
    expect(wrapper.find('.detail').text()).toContain('เจ้าหน้าที่บุคคล')
    // A deep link has no list to go back to, so closing lands on the list route.
    await wrapper.find('.detail-close').trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.fullPath).toBe('/hr/employees')
    wrapper.unmount()
  })

  it('returns to the list with the back button', async () => {
    const { wrapper, router } = await mountAt('/hr/employees', { wide: false })
    await searchFor(wrapper)

    await wrapper.findAll('button.list-row')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/hr/employees/emp-1')

    router.back()
    await flushPromises()

    expect(router.currentRoute.value.fullPath).toBe('/hr/employees')
    expect(wrapper.find('.detail').exists()).toBe(false)
    expect(wrapper.find('.search input').element.value).toBe('ab')
    wrapper.unmount()
  })

  it('keeps both detail requests exactly as the detail page made them', async () => {
    expect(PAGE_SOURCE).toContain('fetch(`/api/hr/employees/${encodeURIComponent(id)}`, {\n      credentials: \'same-origin\',\n    })')
    expect(PAGE_SOURCE).toContain('/api/hr/employees/${encodeURIComponent(id)}/reveal-national-id')
    expect(PAGE_SOURCE).toContain("{ method: 'POST', credentials: 'same-origin' }")
    expect(PAGE_SOURCE).toContain('fetch(`/api/hr/employees?q=${encodeURIComponent(text)}`, {')

    const { wrapper } = await mountAt('/hr/employees/emp-1', { wide: true })
    await wrapper.find('.reveal-btn').trigger('click')
    await flushPromises()

    const reveal = fetchCalls.find((entry) => entry.url === '/api/hr/employees/emp-1/reveal-national-id')
    expect(reveal).toBeTruthy()
    expect(reveal.options).toEqual({ method: 'POST', credentials: 'same-origin' })
    expect(wrapper.find('.detail .mono').text()).toBe('1103700001234')
    wrapper.unmount()
  })

  it('moves focus into the panel and back to the row', async () => {
    const { wrapper } = await mountAt('/hr/employees', { wide: false })
    await searchFor(wrapper)

    const row = wrapper.findAll('button.list-row')[0]
    row.element.focus()
    await row.trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.find('.detail-close').element)

    await wrapper.find('.detail-close').trigger('click')
    await flushPromises()
    // The list re-renders on the route change, so compare with the live row.
    const returned = wrapper.findAll('button.list-row')[0]
    expect(returned.attributes('aria-current')).toBeUndefined()
    expect(document.activeElement).toBe(returned.element)
    wrapper.unmount()
  })

  it('traps Tab in the sheet and closes it on Escape', async () => {
    const { wrapper, router } = await mountAt('/hr/employees', { wide: false })
    await searchFor(wrapper)
    await wrapper.findAll('button.list-row')[0].trigger('click')
    await flushPromises()

    const panel = wrapper.find('.detail').element
    const items = focusableIn(panel)
    expect(items.length).toBeGreaterThanOrEqual(2)

    items[items.length - 1].focus()
    expect(press('Tab')).toBe(false)
    expect(document.activeElement).toBe(items[0])

    items[0].focus()
    expect(press('Tab', { shift: true })).toBe(false)
    expect(document.activeElement).toBe(items[items.length - 1])

    expect(press('Escape')).toBe(false)
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/hr/employees')
    expect(wrapper.find('.detail').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not trap Tab or close on Escape on the desktop panel', async () => {
    const { wrapper, router } = await mountAt('/hr/employees', { wide: true })
    await searchFor(wrapper)
    await wrapper.findAll('button.list-row')[0].trigger('click')
    await flushPromises()

    // The list is still usable beside the panel, so Tab is the browser's.
    expect(press('Tab')).toBe(true)
    expect(press('Escape')).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/hr/employees/emp-1')
    wrapper.unmount()
  })

  it('shows the finished panel when motion is reduced', async () => {
    const reduced = mediaBlock('(prefers-reduced-motion: reduce)')
    expect(reduced).toContain('.detail-slide-enter-active')
    expect(reduced).toContain('transition: none')
    // The final state is the base state: no hidden-by-default panel.
    expect(blockFor('.detail {')).not.toMatch(/opacity:\s*0(?!\.)/)

    const enter = blockFor('.detail-slide-enter-from {')
    expect(enter).toContain('opacity: 0')
    expect(enter).toContain('transform: translate3d(0, 12px, 0)')
    const active = blockFor('.detail-slide-enter-active {')
    for (const line of active.split(',')) {
      const property = line.trim().split(/\s+/)[0]
      if (property === 'transition:' || property === '') continue
      expect(['opacity', 'transform']).toContain(property)
    }

    const { wrapper } = await mountAt('/hr/employees/emp-1', { wide: true })
    expect(wrapper.find('.detail').isVisible()).toBe(true)
    wrapper.unmount()
  })

  it('keeps the detail on the page glass and above 4.5:1', () => {
    const alpha = tintAlpha('--dir-glass')
    expect(alpha).toBeGreaterThanOrEqual(0.86)
    expect(alpha).toBeLessThanOrEqual(0.9)
    expect(blockFor('.detail {')).toContain('background-color: var(--dir-glass)')
    expect(blockFor('.finder,\n.results,\n.detail {')).toContain('backdrop-filter: var(--dir-filter)')

    const pairs = [
      ['หัวข้อพนักงาน #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--dir-glass')],
      ['ป้ายข้อมูล #475569', parseColor('#475569'), panelBackdrop('--dir-glass')],
      ['ค่าข้อมูล #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--dir-glass')],
      ['ข้อความผิดพลาด #8a1c1c', parseColor('#8a1c1c'), panelBackdrop('--dir-glass')],
      ['ปุ่มเปิดเลขบัตร #4338ca', parseColor('#4338ca'), panelBackdrop('--dir-glass')],
      ['ไอคอนปิด #1e1b4b', parseColor('#1e1b4b'), panelBackdrop('--dir-glass')],
    ]
    for (const [name, ink, backdrop] of pairs) {
      expect(contrast(ink, backdrop), name).toBeGreaterThanOrEqual(4.5)
    }

    // Every action in the sheet, including the close button, keeps a 44px target.
    expect(blockFor('.detail-close {')).toContain('width: var(--tap)')
    expect(blockFor('.detail-close {')).toContain('height: var(--tap)')
    expect(blockFor('.reveal-btn {')).toContain('min-height: var(--tap)')
  })
})
