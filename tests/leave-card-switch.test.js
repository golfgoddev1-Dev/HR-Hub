// @vitest-environment happy-dom
// The card stack on /leave: one card per leave request, in the Worker's order,
// wrapping at both ends. It advances itself every 3s with a single chained
// timeout, and it also moves by button, by swipe and by arrow key — each manual
// move restarts the full 3s and never touches the pause button's own state.
//
// The two regression tests at the bottom pin the stall that shipped: a pause
// state that latched (synthesized mouseenter from a tap, and a mouse click that
// left focus inside the showcase) froze the card for good while the pause button
// still read "หยุดสลับการ์ด".
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/LeaveHomePage.vue')
const PAGE_STYLES = [...PAGE_SOURCE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((match) => match[1])
  .join('\n')
const CSS = PAGE_STYLES.replace(/\/\*[\s\S]*?\*\//g, '')

const CYCLE_MS = 3000

const H = vi.hoisted(() => ({
  results: [],
  counts: { pending: 0, approved: 0 },
  loaderCalls: 0,
}))

vi.mock('../src/api.js', () => ({ getSession: async () => ({ isApprover: false }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('../src/components/PushToggle.vue', () => ({ default: { name: 'PushToggle', template: '<div />' } }))
vi.mock('../src/lib/data-cache.js', () => ({ peekCached: () => null }))
vi.mock('../src/lib/approval-count.js', () => ({ setApprovalCount: vi.fn() }))
vi.mock('../src/leave-certificate.js', () => ({
  OWN_CERTIFICATE_OPEN_LABEL: 'เปิด',
  canOpenOwnCertificate: () => false,
  certificateStatus: () => ({ has: false }),
}))
vi.mock('../src/lib/motion.js', () => ({ countUp: vi.fn(async () => 0) }))
vi.mock('../src/lib/shared-data.js', () => ({
  APPROVALS_TTL_MS: 1,
  PAGE_TTL_MS: 1,
  DATA_KEYS: { myRequests: 'myRequests', approvals: 'approvals' },
  errorTextOf: (_error, fallback) => fallback,
  loaders: {
    myRequests: async () => {
      H.loaderCalls += 1
      return { results: H.results, counts: H.counts, certificateRetentionDays: 90 }
    },
    approvals: async () => ({ results: [] }),
  },
  loadShared: async (_key, loader, options) => {
    options.onData(await loader())
  },
}))

import LeaveHomePage from '../src/pages/LeaveHomePage.vue'

const ROWS = [
  {
    id: 'req-1',
    requestCode: 'LV-20261101-001',
    leaveTypeName: 'ลาป่วย',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: 2,
    status: 'pending',
  },
  {
    id: 'req-2',
    requestCode: 'LV-20261101-002',
    leaveTypeName: 'ลากิจ',
    startDate: '2026-11-01',
    endDate: '2026-11-02',
    days: 2,
    status: 'approved',
  },
  {
    id: 'req-3',
    requestCode: 'LV-20261020-003',
    leaveTypeName: 'ลาพักร้อน',
    startDate: '2026-10-20',
    endDate: '2026-10-22',
    days: 3,
    status: 'rejected',
  },
  {
    id: 'req-4',
    requestCode: 'LV-20261010-004',
    leaveTypeName: 'ลาป่วย',
    startDate: '2026-10-10',
    endDate: '2026-10-10',
    days: 1,
    status: 'cancelled',
  },
]

const CODES = ROWS.map((row) => row.requestCode)

function stubMatchMedia({ reduce = false, coarse = false } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion: reduce')
        ? reduce
        : query.includes('pointer: coarse')
          ? coarse
          : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
}

async function settle() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
  await nextTick()
  await nextTick()
}

async function mountPage() {
  const wrapper = mount(LeaveHomePage, {
    global: {
      stubs: {
        'v-alert': true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
  await settle()
  return wrapper
}

async function waitCycle(ms = CYCLE_MS) {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

const metaOf = (wrapper) => wrapper.find('.showcase-meta').text()
const codeOf = (wrapper) => wrapper.find('.stack-card .code').text()
const stepButton = (wrapper, label) => wrapper.findAll('.stack-step').find((node) => node.attributes('aria-label') === label)

function pointerEvent(type, { x = 0, y = 0, id = 1, kind = 'touch' } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: x, clientY: y, pointerId: id, pointerType: kind })
  return event
}

async function swipe(wrapper, { from = 100, to = 60, dy = 0, kind = 'touch' } = {}) {
  const stack = wrapper.find('.stack').element
  stack.dispatchEvent(pointerEvent('pointerdown', { x: from, y: 100, kind }))
  stack.dispatchEvent(pointerEvent('pointerup', { x: to, y: 100 + dy, kind }))
  await settle()
}

beforeEach(() => {
  H.results = []
  H.counts = { pending: 0, approved: 0 }
  H.loaderCalls = 0
  document.documentElement.setAttribute('data-bg-tier', 'high')
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-bg-tier')
})

describe('leave home card stack', () => {
  it('shows one request per card, in list order', async () => {
    H.results = ROWS
    H.counts = { pending: 2, approved: 3 }
    stubMatchMedia()
    const wrapper = await mountPage()

    // Exactly one card in the DOM, and it is the first request — never several
    // requests folded into one card.
    expect(wrapper.findAll('.stack-card')).toHaveLength(1)
    expect(codeOf(wrapper)).toBe(CODES[0])
    expect(wrapper.find('.stack-card .stack-type').text()).toBe('ลาป่วย')
    expect(wrapper.find('.stack-card .badge').text()).toBe('รออนุมัติ')
    expect(wrapper.find('.stack-card').text()).toContain('2 วัน')
    expect(metaOf(wrapper)).toContain('1 จาก 4')

    // Every request gets its turn, in order, and the last wraps to the first.
    for (const expected of [1, 2, 3, 0]) {
      await waitCycle()
      expect(codeOf(wrapper)).toBe(CODES[expected])
      expect(wrapper.findAll('.stack-card')).toHaveLength(1)
    }
    wrapper.unmount()
  })

  it('reads its counts from the existing per-employee loader only', async () => {
    H.results = ROWS
    H.counts = { pending: 2, approved: 3 }
    stubMatchMedia()
    const wrapper = await mountPage()

    const stats = wrapper.findAll('.stat').map((node) => node.text())
    expect(stats[0]).toContain('ใบลารออนุมัติ')
    expect(stats[0]).toContain('2')
    expect(stats[1]).toContain('ใบลาอนุมัติแล้ว')
    expect(stats[1]).toContain('3')
    expect(H.loaderCalls).toBe(1)

    // The stack reuses the list it already loaded: no second request, no fetch.
    expect(PAGE_SOURCE).toContain('loadShared(DATA_KEYS.myRequests, loaders.myRequests')
    expect(PAGE_SOURCE).toContain('computed(() => results.value)')
    expect(PAGE_SOURCE).not.toContain('fetch(')
    wrapper.unmount()
  })

  it('advances every 3000ms with one chained timeout', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    expect(PAGE_SOURCE).toContain('const CYCLE_MS = 3000')
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(CYCLE_MS - 50)
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[0])
    await vi.advanceTimersByTimeAsync(50)
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    // Still exactly one pending step, never an interval.
    expect(vi.getTimerCount()).toBe(1)

    expect(PAGE_SOURCE).not.toContain('setInterval')
    expect(PAGE_SOURCE).toContain('cycleTimer = setTimeout(')
    expect(PAGE_SOURCE).toContain('scheduleNextStep()')
    expect(PAGE_SOURCE).toContain('clearTimeout(cycleTimer)')
    wrapper.unmount()
  })

  it('stops the chain on unmount', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    expect(vi.getTimerCount()).toBe(1)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await waitCycle()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pauses on a real mouse hover and resumes on leave', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    await wrapper.find('.showcase').trigger('pointerenter', { pointerType: 'mouse' })
    await waitCycle()
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[0])

    await wrapper.find('.showcase').trigger('pointerleave', { pointerType: 'mouse' })
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    wrapper.unmount()
  })

  it('pauses on keyboard focus and while the page is hidden', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    const toggle = wrapper.find('.stack-toggle').element
    Object.defineProperty(toggle, 'matches', { configurable: true, value: (selector) => selector === ':focus-visible' })
    toggle.dispatchEvent(new Event('focusin', { bubbles: true }))
    await settle()
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[0])

    toggle.dispatchEvent(new Event('focusout', { bubbles: true }))
    await settle()
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[1])

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[1])

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[2])

    delete document.visibilityState
    wrapper.unmount()
  })

  it('gives the counter a previous and a next button', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    const prev = stepButton(wrapper, 'ใบลาก่อนหน้า')
    const next = stepButton(wrapper, 'ใบลาถัดไป')
    expect(prev, 'previous button').toBeTruthy()
    expect(next, 'next button').toBeTruthy()
    expect(prev.attributes('type')).toBe('button')
    expect(next.attributes('type')).toBe('button')
    // Beside the counter, inside the same control row.
    expect(wrapper.find('.stack-controls .stack-step').exists()).toBe(true)
    expect(wrapper.find('.stack-controls .showcase-meta').exists()).toBe(true)

    const step = /\.stack-step \{([\s\S]*?)\}/.exec(CSS)[1]
    expect(step).toContain('width: var(--tap)')
    expect(step).toContain('height: var(--tap)')
    expect(CSS).toContain('--tap: 44px')
    const focus = /\.stack-step:focus-visible \{([\s\S]*?)\}/.exec(CSS)[1]
    expect(focus).toContain('outline: 2px solid var(--focus)')
    expect(focus).toContain('outline-offset: 2px')
    wrapper.unmount()
  })

  it('moves one request per button press and wraps at both ends', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    await stepButton(wrapper, 'ใบลาถัดไป').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    expect(metaOf(wrapper)).toContain('2 จาก 4')

    await stepButton(wrapper, 'ใบลาก่อนหน้า').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[0])

    // Backwards from the first wraps to the last, forwards from the last to the first.
    await stepButton(wrapper, 'ใบลาก่อนหน้า').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[3])
    expect(metaOf(wrapper)).toContain('4 จาก 4')

    await stepButton(wrapper, 'ใบลาถัดไป').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[0])
    wrapper.unmount()
  })

  it('moves one request with ArrowRight and ArrowLeft', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    await wrapper.find('.showcase').trigger('keydown', { key: 'ArrowRight' })
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])

    await wrapper.find('.showcase').trigger('keydown', { key: 'ArrowRight' })
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[2])

    await wrapper.find('.showcase').trigger('keydown', { key: 'ArrowLeft' })
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])

    // A key with no meaning here must not move the card.
    await wrapper.find('.showcase').trigger('keydown', { key: 'ArrowUp' })
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    wrapper.unmount()
  })

  it('moves one request on a 40px horizontal swipe and ignores a vertical drag', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    // 40px to the left: next.
    await swipe(wrapper, { from: 120, to: 80 })
    expect(codeOf(wrapper)).toBe(CODES[1])

    // 39px is below the threshold.
    await swipe(wrapper, { from: 120, to: 81 })
    expect(codeOf(wrapper)).toBe(CODES[1])

    // 40px to the right: previous.
    await swipe(wrapper, { from: 80, to: 120 })
    expect(codeOf(wrapper)).toBe(CODES[0])

    // 120px across but 300px down is a page scroll, not a swipe.
    await swipe(wrapper, { from: 120, to: 0, dy: 300 })
    expect(codeOf(wrapper)).toBe(CODES[0])

    // A mouse drag is a text selection, so it must not move the card either.
    await swipe(wrapper, { from: 120, to: 40, kind: 'mouse' })
    expect(codeOf(wrapper)).toBe(CODES[0])

    // The gesture is read from pointer events, and the stack keeps vertical scroll.
    expect(PAGE_SOURCE).toContain('@pointerdown="onPointerDown"')
    expect(PAGE_SOURCE).toContain('@pointerup="onPointerUp"')
    expect(PAGE_SOURCE).toContain('const SWIPE_MIN = 40')
    expect(/\.stack \{([\s\S]*?)\}/.exec(CSS)[1]).toContain('touch-action: pan-y')
    wrapper.unmount()
  })

  it('restarts the full 3000ms after a manual move', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    await vi.advanceTimersByTimeAsync(2500)
    await settle()
    await stepButton(wrapper, 'ใบลาถัดไป').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])

    // The click reset the clock: the auto step does not land at the old 3000ms mark.
    await vi.advanceTimersByTimeAsync(2999)
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[2])
    wrapper.unmount()
  })

  it('keeps the pause button state across manual moves', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    const toggle = () => wrapper.find('.stack-toggle')
    await toggle().trigger('click')
    await settle()
    expect(toggle().attributes('aria-pressed')).toBe('true')

    // A manual move changes the card but leaves the pause state alone.
    await stepButton(wrapper, 'ใบลาถัดไป').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    expect(toggle().attributes('aria-pressed')).toBe('true')
    expect(toggle().text()).toBe('สลับการ์ดต่อ')

    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    wrapper.unmount()
  })

  it('keeps the first card still and stops on the low tier', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()
    expect(codeOf(wrapper)).toBe(CODES[0])

    document.documentElement.setAttribute('data-bg-tier', 'low')
    await settle()
    await waitCycle()
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[0])
    expect(wrapper.find('.stack-toggle').exists()).toBe(false)
    // Manual navigation is not an animation, so it still works on the low tier.
    await stepButton(wrapper, 'ใบลาถัดไป').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    wrapper.unmount()
  })

  it('lands on the static top card, keeps the timer off, and still moves by hand', async () => {
    H.results = ROWS
    stubMatchMedia({ reduce: true })
    const wrapper = await mountPage()

    expect(wrapper.findAll('.stack-card')).toHaveLength(1)
    expect(metaOf(wrapper)).toContain('1 จาก 4')
    expect(wrapper.find('.stack-ghost').exists()).toBe(false)
    expect(wrapper.find('.stack-toggle').exists()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    await waitCycle(15000)
    expect(codeOf(wrapper)).toBe(CODES[0])

    // Manual moves are instant and never start the timer.
    await stepButton(wrapper, 'ใบลาถัดไป').trigger('click')
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    expect(vi.getTimerCount()).toBe(0)
    await waitCycle(15000)
    expect(codeOf(wrapper)).toBe(CODES[1])

    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(CSS)
    expect(reduced[1]).toContain('.stack-card')
    expect(reduced[1]).toContain('.stack-step')
    expect(reduced[1]).toContain('transition: none')
    wrapper.unmount()
  })

  it('shows the top card only on a lite device', async () => {
    H.results = ROWS
    stubMatchMedia({ coarse: true })
    const wrapper = await mountPage()

    expect(wrapper.findAll('.stack-card')).toHaveLength(1)
    expect(wrapper.find('.stack-ghost').exists()).toBe(false)
    expect(wrapper.find('.stack-toggle').exists()).toBe(false)
    await waitCycle(15000)
    expect(codeOf(wrapper)).toBe(CODES[0])
    wrapper.unmount()
  })

  it('shows the list empty state and no stack when there are no requests', async () => {
    H.results = []
    stubMatchMedia()
    const wrapper = await mountPage()

    expect(wrapper.find('.showcase').exists()).toBe(false)
    expect(wrapper.find('.stack-card').exists()).toBe(false)
    expect(wrapper.text()).toContain('ยังไม่มีรายการใบลา')
    wrapper.unmount()
  })

  // --- the stall that shipped ------------------------------------------------

  it('is not frozen by the synthesized mouseenter a touch tap leaves behind', async () => {
    // Regression: @mouseenter used to set stackHovered, and a tap emits one with
    // no matching mouseleave, so the chain died while the button still offered
    // to stop it. Hover now comes from pointerenter with pointerType 'mouse'.
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    await wrapper.find('.showcase').trigger('mouseenter')
    await wrapper.find('.showcase').trigger('pointerenter', { pointerType: 'touch' })
    await settle()

    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[1])
    wrapper.unmount()
  })

  it('is not frozen by a mouse click that leaves focus inside the showcase', async () => {
    // Regression: @focusin used to pause on any focus, so clicking the pause
    // button (or a step button) froze the stack until the pointer left, while
    // aria-pressed still reported "running".
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    const next = stepButton(wrapper, 'ใบลาถัดไป').element
    next.dispatchEvent(new Event('focusin', { bubbles: true }))
    await settle()
    next.dispatchEvent(new Event('click', { bubbles: true }))
    await settle()
    expect(codeOf(wrapper)).toBe(CODES[1])

    // The click did not park the cycle: the next auto step still arrives.
    await waitCycle()
    expect(codeOf(wrapper)).toBe(CODES[2])
    wrapper.unmount()
  })

  it('uses the motion budget the rules allow', () => {
    // Transform and opacity only, under 600ms, and no cubic-bezier() (a comma
    // list reads as extra properties in the transition guard).
    const transition = /\.stack-enter-active,\n\.stack-leave-active \{([\s\S]*?)\}/.exec(CSS)
    expect(transition).not.toBeNull()
    for (const entry of transition[1].split(';')[0].split('transition:')[1].split(',')) {
      const [property, duration] = entry.trim().split(/\s+/)
      expect(['transform', 'opacity']).toContain(property)
      expect(Number(duration.replace('s', ''))).toBeLessThan(0.6)
    }

    // The stack is the page's glass, on the tier's blur: never a solid card.
    const card = /\.stack-card \{([\s\S]*?)\}/.exec(CSS)[1]
    expect(card).toContain('background-color: var(--leave-home-glass)')
    expect(card).toContain('backdrop-filter: var(--leave-home-filter)')
    const tint = /--leave-home-glass: rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(PAGE_STYLES)
    expect(Number(tint[1])).toBeGreaterThanOrEqual(0.86)
    expect(Number(tint[1])).toBeLessThanOrEqual(0.9)
  })
})
