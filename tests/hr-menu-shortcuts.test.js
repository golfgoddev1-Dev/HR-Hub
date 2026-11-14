// @vitest-environment happy-dom
// The HR home menu stack and its picker.
//
// The stack is the HR person's own short list: one card per saved menu, in the
// saved order, the default three when nothing is saved. On a desktop it steps
// every 3s with a single chained timeout and pauses only for a real mouse hover
// or a keyboard focus; on a phone it moves by swipe and never on its own.
//
// Nothing on this page approves leave: the decision belongs to the approver.
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { hrNavItems } from '../src/lib/nav-config.js'
import { HR_MENU_ROUTES } from '../worker/src/routes/profile.js'

import { readSource } from './helpers/read-source.js'

const PAGE_SOURCE = readSource('src/pages/HrHomePage.vue')
const PROFILE_PAGE = readSource('src/pages/ProfilePage.vue')
const SETTINGS_SOURCE = readSource('src/components/HrMenuShortcutSettings.vue')
const WORKER_ROUTE = readSource('worker/src/routes/profile.js')

const CYCLE_MS = 3000
const HINT_KEY = 'hr-menu-shortcuts-hint'

const H = vi.hoisted(() => ({
  profile: { profile: {} },
  lite: false,
  reduce: false,
  putJson: async () => ({ status: 200, data: { ok: true, menus: [] } }),
}))

vi.mock('../src/lib/lite-mode.js', () => ({
  isLiteMode: () => H.lite,
  prefersReducedMotion: () => H.reduce,
}))
vi.mock('../src/lib/shared-data.js', () => ({
  DATA_KEYS: { profile: 'profile' },
  PAGE_TTL_MS: 1,
  errorTextOf: (_error, fallback) => fallback,
  loaders: { profile: async () => H.profile },
  loadShared: async (_key, loader, options) => {
    options.onData(await loader())
  },
  invalidateProfile: vi.fn(),
}))
vi.mock('../src/api.js', () => ({
  putJson: (...args) => H.putJson(...args),
}))

import HrHomePage from '../src/pages/HrHomePage.vue'
import HrMenuShortcutSettings from '../src/components/HrMenuShortcutSettings.vue'

async function settle() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
  await nextTick()
  await nextTick()
}

function stubMatchMedia({ desktop = true, coarse = false, reduce = false } = {}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      matches: query.includes('prefers-reduced-motion: reduce')
        ? reduce
        : query.includes('pointer: coarse')
          ? coarse
          : query.includes('hover: hover')
            ? desktop
            : false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
}

const LINK_STUB = { props: ['to'], template: '<a :href="to"><slot /></a>' }

async function mountHome() {
  const wrapper = mount(HrHomePage, {
    global: { stubs: { RouterLink: LINK_STUB } },
  })
  await settle()
  return wrapper
}

async function waitCycle(ms = CYCLE_MS) {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

const cardName = (wrapper) => wrapper.find('.deck-name').text()
const cardLink = (wrapper) => wrapper.find('.deck-card')
const counter = (wrapper) => wrapper.find('[data-shortcut-counter]').text()
const stepButton = (wrapper, label) =>
  wrapper.findAll('.step').find((node) => node.attributes('aria-label') === label)

function pointerEvent(type, { x = 0, y = 0, id = 1, kind = 'touch' } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { clientX: x, clientY: y, pointerId: id, pointerType: kind })
  return event
}

async function swipe(wrapper, { from = 120, to = 60, dy = 0, kind = 'touch' } = {}) {
  const deck = wrapper.find('.deck').element
  deck.dispatchEvent(pointerEvent('pointerdown', { x: from, y: 100, kind }))
  deck.dispatchEvent(pointerEvent('pointerup', { x: to, y: 100 + dy, kind }))
  await settle()
}

beforeEach(() => {
  H.profile = { profile: {} }
  H.lite = false
  H.reduce = false
  H.putJson = vi.fn(async () => ({ status: 200, data: { ok: true, menus: [] } }))
  document.documentElement.setAttribute('data-bg-tier', 'high')
  window.sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-bg-tier')
  window.sessionStorage.clear()
})

describe('HR home menu stack', () => {
  it('shows the default three when nothing is saved, in order', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')
    expect(wrapper.find('.deck-desc').text()).toBe('ดูใบลาทุกใบ กรองตามสถานะและแผนก')
    expect(counter(wrapper)).toContain('1 จาก 3')

    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')
    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    expect(cardName(wrapper)).toBe('วันหยุด')
    // Last wraps to first.
    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')
    await stepButton(wrapper, 'เมนูก่อนหน้า').trigger('click')
    expect(cardName(wrapper)).toBe('วันหยุด')

    expect(PAGE_SOURCE).toContain('hrMenuShortcutItems(data)')
    wrapper.unmount()
  })

  it('shows one card per saved menu, in the saved order', async () => {
    H.profile = { profile: { hrMenuShortcuts: ['/hr/leave/holidays', '/hr/employees/import'] } }
    stubMatchMedia()
    const wrapper = await mountHome()

    expect(wrapper.findAll('.deck-card')).toHaveLength(1)
    expect(counter(wrapper)).toContain('1 จาก 2')
    expect(cardName(wrapper)).toBe('วันหยุด')
    expect(cardLink(wrapper).attributes('href')).toBe('/hr/leave/holidays')

    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    expect(cardName(wrapper)).toBe('นำเข้าพนักงาน')
    expect(cardLink(wrapper).attributes('href')).toBe('/hr/employees/import')
    wrapper.unmount()
  })

  it('drops an unknown saved route and falls back when nothing usable is left', async () => {
    H.profile = { profile: { hrMenuShortcuts: ['/hr/not-a-menu'] } }
    stubMatchMedia()
    const wrapper = await mountHome()

    expect(counter(wrapper)).toContain('1 จาก 3')
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')
    wrapper.unmount()
  })

  it('opens the menu when the card is tapped', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    expect(cardLink(wrapper).attributes('href')).toBe('/hr/leave')
    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    expect(cardLink(wrapper).attributes('href')).toBe('/hr/employees')

    // The card is one link and its foot row states the action.
    expect(wrapper.find('.deck-foot').text()).toContain('ไปที่เมนูนี้')
    expect(wrapper.findAll('.deck-card a')).toHaveLength(0)
    wrapper.unmount()
  })

  it('carries no leave-approval action anywhere on the page', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    // No approval queue, no approve/reject route, and no decision control: HR
    // reads leave on /hr/leave, the approval itself belongs to the approver.
    expect(PAGE_SOURCE).not.toContain('/leave/approvals')
    expect(PAGE_SOURCE).not.toMatch(/fetch\([^)]*approv/i)
    expect(PAGE_SOURCE).not.toMatch(/\/api\/[^'`]*approv/i)
    expect(wrapper.text()).not.toContain('อนุมัติ')
    for (const node of wrapper.findAll('a, button')) {
      expect(node.text()).not.toMatch(/^(อนุมัติ|ไม่อนุมัติ)$/)
      const href = node.attributes('href') ?? ''
      expect(href).not.toContain('/leave/approvals')
    }
    wrapper.unmount()
  })

  it('moves one card on a 40px touch swipe, and ignores a vertical or mouse drag', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    await swipe(wrapper, { from: 120, to: 60 })
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')

    await swipe(wrapper, { from: 60, to: 120 })
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')

    // 39px is under the threshold: nothing moves.
    await swipe(wrapper, { from: 100, to: 61 })
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')

    // Mostly vertical is a page scroll, not a swipe.
    await swipe(wrapper, { from: 120, to: 60, dy: 200 })
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')

    // A mouse drag is a text selection.
    await swipe(wrapper, { from: 120, to: 40, kind: 'mouse' })
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')

    // The threshold and the mouse-drag rule live in the shared primitive, once,
    // for both decks (tests/motion-system.test.js pins SWIPE.min to 40).
    const PRIMITIVE = readSource('src/lib/card-stack.js')
    expect(PRIMITIVE).toContain('swipeMin = options.swipeMin ?? SWIPE.min')
    expect(PRIMITIVE).toContain("if (event?.pointerType === 'mouse') return")
    wrapper.unmount()
  })

  it('does not follow the card link on a swipe, and the next tap still works', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    await swipe(wrapper, { from: 120, to: 60 })
    const link = wrapper.find('.deck-card').element

    // The click the browser sends at the end of a swipe is swallowed.
    const afterSwipe = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(afterSwipe)
    expect(afterSwipe.defaultPrevented).toBe(true)

    // A click that was never sent cannot swallow a later tap: the guard expires.
    await vi.advanceTimersByTimeAsync(1000)
    const later = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
    expect(PAGE_SOURCE).toContain('const CLICK_GUARD_MS = 400')
    wrapper.unmount()
  })

  it('steps every 3000ms with one chained timeout and clears it on unmount', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    // The 3000ms chain belongs to the primitive now (tests/motion-system.test.js
    // pins CYCLE.ms); the page only starts and stops it.
    const PRIMITIVE = readSource('src/lib/card-stack.js')
    expect(PRIMITIVE).toContain('cycleMs = options.cycleMs ?? CYCLE.ms')
    expect(PRIMITIVE).toContain('timer = setTimeout(')
    expect(PAGE_SOURCE).not.toContain('setInterval')
    expect(PAGE_SOURCE).toContain('stack.start()')
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(CYCLE_MS - 50)
    await settle()
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')
    await vi.advanceTimersByTimeAsync(50)
    await settle()
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')
    // Still exactly one pending step, never a second timer.
    expect(vi.getTimerCount()).toBe(1)

    // A manual move restarts the full 3s from that moment.
    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    await vi.advanceTimersByTimeAsync(CYCLE_MS - 50)
    await settle()
    expect(cardName(wrapper)).toBe('วันหยุด')
    await vi.advanceTimersByTimeAsync(50)
    await settle()
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never pauses on a synthesized mouseenter, and pauses on a real hover', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()

    // What a tap leaves behind: a mouseenter with no matching mouseleave.
    wrapper.find('.hero').element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await waitCycle()
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')

    // A real mouse hover pauses the chain...
    await wrapper.find('.deck').trigger('pointerenter', { pointerType: 'mouse' })
    await waitCycle()
    await waitCycle()
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')

    // ...and leaving resumes it.
    await wrapper.find('.deck').trigger('pointerleave', { pointerType: 'mouse' })
    await waitCycle()
    expect(cardName(wrapper)).toBe('วันหยุด')

    // A finger's pointerenter can never pause it either.
    await wrapper.find('.deck').trigger('pointerenter', { pointerType: 'touch' })
    await waitCycle()
    expect(cardName(wrapper)).toBe('ใบลาทั้งหมด')
    wrapper.unmount()
  })

  it('changes instantly under reduced motion and never starts the timer', async () => {
    H.reduce = true
    stubMatchMedia({ reduce: true })
    const wrapper = await mountHome()

    expect(vi.getTimerCount()).toBe(0)
    await stepButton(wrapper, 'เมนูถัดไป').trigger('click')
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')

    await vi.advanceTimersByTimeAsync(CYCLE_MS * 2)
    await settle()
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })

  it('shows the swipe hint on a phone until the first swipe', async () => {
    stubMatchMedia({ desktop: false, coarse: true })
    const wrapper = await mountHome()

    expect(wrapper.find('.swipe-hint').text()).toBe('ปัดเพื่อดูเมนูอื่น')
    // No automatic cycling on a phone at all.
    expect(vi.getTimerCount()).toBe(0)

    await swipe(wrapper, { from: 120, to: 60 })
    expect(cardName(wrapper)).toBe('รายชื่อพนักงาน')
    expect(wrapper.find('.swipe-hint').exists()).toBe(false)
    expect(window.sessionStorage.getItem(HINT_KEY)).toBe('1')
    wrapper.unmount()

    // The next mount in the same tab does not show it again.
    const again = await mountHome()
    expect(again.find('.swipe-hint').exists()).toBe(false)
    again.unmount()
  })

  it('desktop keeps the gesture too, but does not show the phone hint', async () => {
    stubMatchMedia()
    const wrapper = await mountHome()
    expect(wrapper.find('.swipe-hint').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('เมนูที่ใช้บ่อย settings', () => {
  it('exists on the HR profile page and reads the saved order', () => {
    expect(PROFILE_PAGE).toContain("import HrMenuShortcutSettings from '../components/HrMenuShortcutSettings.vue'")
    expect(PROFILE_PAGE).toContain('<HrMenuShortcutSettings')
    expect(PROFILE_PAGE).toContain('isHr.value = session?.role === \'hr\'')
    expect(SETTINGS_SOURCE).toContain('เมนูที่ใช้บ่อย')
    expect(SETTINGS_SOURCE).toContain('putJson(\'/api/profile/hr-menus\'')
  })

  it('limits the choice to 1 to 5 with a visible counter', async () => {
    const wrapper = mount(HrMenuShortcutSettings, {
      props: { saved: ['/hr/leave'] },
    })
    await settle()

    expect(wrapper.find('[data-shortcut-counter]').text()).toContain('เลือกแล้ว 1 จาก 5 เมนู')
    // The last remaining menu cannot be removed.
    expect(wrapper.find('.remove').attributes('disabled')).toBeDefined()

    const choices = () => wrapper.findAll('.choice')
    const unchosen = () => choices().filter((node) => node.attributes('aria-pressed') === 'false')

    for (let index = 0; index < 4; index += 1) {
      await unchosen()[0].trigger('click')
    }
    expect(wrapper.findAll('.chosen-row')).toHaveLength(5)
    expect(wrapper.find('[data-shortcut-counter]').text()).toContain('เลือกแล้ว 5 จาก 5 เมนู')
    // At five, every unselected menu is disabled: no sixth can be added.
    expect(unchosen().every((node) => node.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.find('.note').text()).toContain('ครบ 5 เมนูแล้ว')
    wrapper.unmount()
  })

  it('saves the chosen routes in order and reports the Worker error with a fix', async () => {
    H.putJson = vi.fn(async () => ({
      status: 200,
      data: { ok: true, menus: ['/hr/leave', '/hr/leave/holidays'] },
    }))
    const wrapper = mount(HrMenuShortcutSettings, { props: { saved: ['/hr/leave'] } })
    await settle()

    // Add a second menu, so the order is "what was there" then "what was added".
    const holiday = wrapper.findAll('.choice').find((node) => node.text().includes('วันหยุด'))
    await holiday.trigger('click')
    await wrapper.find('.save').trigger('click')
    await settle()

    expect(H.putJson).toHaveBeenCalledWith('/api/profile/hr-menus', {
      menus: ['/hr/leave', '/hr/leave/holidays'],
    })
    expect(wrapper.find('.status').text()).toBe('บันทึกแล้ว')
    expect(wrapper.find('.error').exists()).toBe(false)
    wrapper.unmount()

    // The Worker's own message is shown, with what to do about it.
    H.putJson = vi.fn(async () => ({
      status: 400,
      data: { ok: false, message: 'มีเมนูซ้ำในรายการ กรุณาเลือกใหม่' },
    }))
    const failing = mount(HrMenuShortcutSettings, { props: { saved: ['/hr/leave'] } })
    await settle()
    await failing.find('.save').trigger('click')
    await settle()

    expect(failing.find('.error-text').text()).toBe('มีเมนูซ้ำในรายการ กรุณาเลือกใหม่')
    expect(failing.find('.error-fix').text()).toContain('1 ถึง 5 เมนู')
    failing.unmount()
  })
})

describe('the server allowlist', () => {
  it('is the same route set as the HR navigation', () => {
    const navRoutes = hrNavItems().map((item) => item.to).sort()
    expect([...HR_MENU_ROUTES].sort()).toEqual(navRoutes)
    // The Worker refuses anything outside it.
    expect(WORKER_ROUTE).toContain('if (!HR_MENU_ROUTES.includes(entry))')
    expect(WORKER_ROUTE).toContain('requireRole(c.env, c.req.raw, [HR_ROLE])')
    expect(WORKER_ROUTE).toContain('hr_menu_shortcuts_updated')
  })
})
