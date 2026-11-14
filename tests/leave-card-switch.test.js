// @vitest-environment happy-dom
// The card stack on /leave: the employee's own newest requests, one card at a
// time. It must switch every 4.6s on a capable device, stop while the pointer or
// a focus is on it and while the page is hidden, hold still for a reduced-motion
// visitor and on a lite device or the low tier, keep the list's empty state when
// there is nothing to show, and read its numbers from the existing loader only.
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/LeaveHomePage.vue')
const PAGE_STYLES = [...PAGE_SOURCE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map((match) => match[1])
  .join('\n')
const CSS = PAGE_STYLES.replace(/\/\*[\s\S]*?\*\//g, '')

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
    requestCode: 'LV-20261105-002',
    leaveTypeName: 'ลาพักร้อน',
    startDate: '2026-11-05',
    endDate: '2026-11-07',
    days: 3,
    status: 'approved',
  },
  {
    id: 'req-3',
    requestCode: 'LV-20261110-003',
    leaveTypeName: 'ลากิจ',
    startDate: '2026-11-10',
    endDate: '2026-11-10',
    days: 1,
    status: 'rejected',
  },
]

const CYCLES = [ROWS[0].leaveTypeName, ROWS[1].leaveTypeName, ROWS[2].leaveTypeName]

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

async function waitCycle(ms = 4600) {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

const typeOf = (wrapper) => wrapper.find('.stack-card .stack-type').text()

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
  it('shows the newest request first, with its type, dates, days and status', async () => {
    H.results = ROWS
    H.counts = { pending: 2, approved: 3 }
    stubMatchMedia()
    const wrapper = await mountPage()

    const card = wrapper.find('.stack-card')
    expect(card.exists()).toBe(true)
    expect(card.find('.stack-type').text()).toBe('ลาป่วย')
    expect(card.find('.badge').text()).toBe('รออนุมัติ')
    expect(card.find('.badge').classes()).toContain('badge-pending')
    expect(card.text()).toContain('2 วัน')
    // The date range is the shared Thai formatter's output, not a raw ISO string.
    const range = card.findAll('.stack-fact dd')[0].text()
    expect(range).not.toBe('')
    expect(range).not.toContain('2026-11-01')
    expect(wrapper.find('.showcase-meta').text()).toContain('1 จาก 3')
    // Every card the employee has, up to four, never a fabricated one.
    expect(wrapper.findAll('.stack-ghost')).toHaveLength(2)
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
    expect(PAGE_SOURCE).toContain('results.value.slice(0, STACK_LIMIT)')
    expect(PAGE_SOURCE).not.toContain('fetch(')
    expect(PAGE_SOURCE).not.toMatch(/\/api\/leave\/requests\/mine\/stack/)
    wrapper.unmount()
  })

  it('cycles every 4.6s and pauses while the pointer is on it', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    expect(typeOf(wrapper)).toBe(CYCLES[0])
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[1])
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[2])
    // Back to the first card: the cycle is a loop, not a one-shot.
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[0])

    await wrapper.find('.showcase').trigger('mouseenter')
    await waitCycle()
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[0])

    await wrapper.find('.showcase').trigger('mouseleave')
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[1])
    wrapper.unmount()
  })

  it('pauses on focus and while the page is hidden', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    await wrapper.find('.showcase').trigger('focusin')
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[0])
    await wrapper.find('.showcase').trigger('focusout')
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[1])

    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[1])

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[2])

    delete document.visibilityState
    if (descriptor) Object.defineProperty(Document.prototype, 'visibilityState', descriptor)
    wrapper.unmount()
  })

  it('keeps the first card still and stops on the low tier', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()
    expect(typeOf(wrapper)).toBe(CYCLES[0])

    document.documentElement.setAttribute('data-bg-tier', 'low')
    await settle()
    expect(wrapper.find('.showcase-meta').text()).toContain('1 จาก 3')
    await waitCycle()
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[0])
    // The pause control belongs to a moving stack, so it goes with it.
    expect(wrapper.find('.stack-toggle').exists()).toBe(false)
    wrapper.unmount()
  })

  it('lets a finger stop the switch on a capable device', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    const toggle = wrapper.find('.stack-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    await toggle.trigger('click')
    await settle()
    expect(toggle.attributes('aria-pressed')).toBe('true')

    await waitCycle()
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[0])

    await toggle.trigger('click')
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[1])
    wrapper.unmount()
  })

  it('lands on the static top card when motion is reduced', async () => {
    H.results = ROWS
    stubMatchMedia({ reduce: true })
    const wrapper = await mountPage()

    expect(wrapper.findAll('.stack-card')).toHaveLength(1)
    expect(wrapper.find('.showcase-meta').text()).toContain('1 จาก 3')
    expect(wrapper.find('.stack-ghost').exists()).toBe(false)
    expect(wrapper.find('.stack-toggle').exists()).toBe(false)

    await waitCycle(15000)
    expect(typeOf(wrapper)).toBe(CYCLES[0])

    // The CSS contract: no transition survives reduced motion.
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(CSS)
    expect(reduced).not.toBeNull()
    expect(reduced[1]).toContain('.stack-card')
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
    expect(typeOf(wrapper)).toBe(CYCLES[0])
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

  it('schedules one timeout at a time and stops the chain on unmount', async () => {
    H.results = ROWS
    stubMatchMedia()
    const wrapper = await mountPage()

    // One pending step, not a repeating interval.
    expect(vi.getTimerCount()).toBe(1)
    await waitCycle()
    expect(typeOf(wrapper)).toBe(CYCLES[1])
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)

    // The chain is gone: a full cycle later nothing has been re-scheduled.
    await waitCycle()
    await waitCycle()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the motion budget the rules allow', () => {
    // A timeout chain, never an interval: /leave owns no polling timer, so
    // src/lib/approval-count.js stays the only interval in the tree.
    expect(PAGE_SOURCE).not.toContain('setInterval')
    expect(PAGE_SOURCE).toContain('cycleTimer = setTimeout(')
    expect(PAGE_SOURCE).toContain('scheduleNextStep()')
    expect(PAGE_SOURCE).toContain('clearTimeout(cycleTimer)')

    expect(PAGE_SOURCE).toContain('const CYCLE_MS = 4600')
    const cycle = Number(/const CYCLE_MS = (\d+)/.exec(PAGE_SOURCE)[1])
    expect(cycle).toBeGreaterThanOrEqual(4000)
    expect(cycle).toBeLessThanOrEqual(5000)

    // Transform and opacity only, under 600ms, and no cubic-bezier() (a comma
    // list reads as extra properties in the transition guard).
    const transition = /\.stack-enter-active,\n\.stack-leave-active \{([\s\S]*?)\}/.exec(CSS)
    expect(transition).not.toBeNull()
    const properties = [...transition[1].matchAll(/([a-z-]+):\s*([^;]+);/g)].map((match) => match[1])
    expect(properties).toEqual(['transition'])
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

    // 44px targets on the control the stack adds.
    const toggle = /\.stack-toggle \{([\s\S]*?)\}/.exec(CSS)[1]
    expect(toggle).toContain('min-height: var(--tap)')
    expect(toggle).toContain('min-width: var(--tap)')
    expect(CSS).toContain('outline: 2px solid var(--focus)')
  })
})
