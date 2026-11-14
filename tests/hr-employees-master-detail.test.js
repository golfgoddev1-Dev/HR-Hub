// @vitest-environment happy-dom
// The employee list and the employee page are two pages again.
//
// /hr/employees is the finder and the results and nothing else: no panel beside
// the list, no sheet over it, at any width. A row is a link to
// /hr/employees/:id, which renders HrEmployeeDetailPage as a full page with its
// own back control. The search that found the row travels in ?q= both ways, so
// the round trip returns to the same results (the user rejected the side panel).
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import HrEmployeesPage from '../src/pages/HrEmployeesPage.vue'
import HrEmployeeDetailPage from '../src/pages/HrEmployeeDetailPage.vue'

import { readSource } from './helpers/read-source.js'

const LIST_SOURCE = readSource('src/pages/HrEmployeesPage.vue')
const DETAIL_SOURCE = readSource('src/pages/HrEmployeeDetailPage.vue')
const ROUTER_SOURCE = readSource('src/router.js')

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

const Stub = { template: '<div />' }

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/hr/employees', component: HrEmployeesPage },
      { path: '/hr/employees/import', component: Stub },
      { path: '/hr/employees/manage', component: Stub },
      { path: '/hr/employees/:id', component: HrEmployeeDetailPage },
    ],
  })
}

async function mountList(search = '', { wide = true, attach = false } = {}) {
  stubMatchMedia(wide)
  const router = makeRouter()
  await router.push(search ? `/hr/employees?q=${encodeURIComponent(search)}` : '/hr/employees')
  await router.isReady()
  const wrapper = mount(HrEmployeesPage, {
    attachTo: attach ? document.body : undefined,
    global: { plugins: [router], stubs: { 'v-alert': true } },
  })
  await flushPromises()
  return { wrapper, router }
}

async function mountDetail(path = '/hr/employees/emp-1', { search = '' } = {}) {
  stubMatchMedia(true)
  const router = makeRouter()
  await router.push(search ? `${path}?q=${encodeURIComponent(search)}` : path)
  await router.isReady()
  const wrapper = mount(HrEmployeeDetailPage, {
    global: { plugins: [router], stubs: { 'v-alert': true } },
  })
  await flushPromises()
  return { wrapper, router }
}

async function searchFor(wrapper, text = 'ab') {
  await wrapper.find('.search input').setValue(text)
  await new Promise((resolve) => setTimeout(resolve, 400))
  await flushPromises()
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

describe('the list opens a separate employee page', () => {
  it('renders no detail panel and no sheet at any width', async () => {
    for (const wide of [true, false]) {
      const { wrapper } = await mountList('', { wide })
      await searchFor(wrapper)

      expect(wrapper.findAll('a.list-row')).toHaveLength(2)
      // Nothing that reads one employee lives on this page.
      expect(wrapper.find('.detail').exists()).toBe(false)
      expect(wrapper.find('.detail-layer').exists()).toBe(false)
      expect(wrapper.find('.detail-scrim').exists()).toBe(false)
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(wrapper.find('[role="region"]').exists()).toBe(false)
      expect(wrapper.html()).not.toContain('รายละเอียดพนักงาน')
      expect(wrapper.html()).not.toContain('กลับไปหน้านำเข้า')
      wrapper.unmount()
    }

    // The source carries no panel state either: no selection, no sheet, no trap.
    expect(LIST_SOURCE).not.toContain('selectedId')
    expect(LIST_SOURCE).not.toContain('detailPanel')
    expect(LIST_SOURCE).not.toContain('dialog-focus')
    expect(LIST_SOURCE).not.toContain('Escape')
    expect(LIST_SOURCE).not.toContain('is-split')
  })

  it('links each row to that employee’s own page, keeping the search', async () => {
    const { wrapper } = await mountList('', { wide: true })
    await searchFor(wrapper, 'ab')

    const rows = wrapper.findAll('a.list-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].attributes('href')).toBe('/hr/employees/emp-1?q=ab')
    expect(rows[1].attributes('href')).toBe('/hr/employees/emp-2?q=ab')

    // A real click moves the route: the list is replaced, not overlaid.
    await rows[0].trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.fullPath).toBe('/hr/employees/emp-1?q=ab')
    wrapper.unmount()
  })

  it('keeps the search, the badges, the count and the empty state', async () => {
    const { wrapper } = await mountList('', { wide: true })
    await searchFor(wrapper, 'สม')

    expect(wrapper.find('.search input').element.value).toBe('สม')
    expect(wrapper.find('.panel-meta').text()).toBe('2 รายการ')
    const rows = wrapper.findAll('a.list-row')
    expect(rows[0].find('.badge').classes()).toContain('badge-on')
    expect(rows[1].find('.badge').classes()).toContain('badge-off')
    expect(rows[0].findAll('.cell')).toHaveLength(4)
    expect(rows[0].text()).toContain('นาย สมชาย ใจดี')
    wrapper.unmount()
  })

  it('fills the search from ?q= and runs that search once', async () => {
    const { wrapper } = await mountList('ab', { wide: true })
    await flushPromises()

    expect(wrapper.find('.search input').element.value).toBe('ab')
    expect(wrapper.findAll('a.list-row')).toHaveLength(2)

    // One request: the immediate fill does not also fire the 300ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    const searches = fetchCalls.filter((call) => call.url === '/api/hr/employees?q=ab')
    expect(searches).toHaveLength(1)
    // Nothing about the search is kept in browser storage.
    expect(LIST_SOURCE).not.toContain('localStorage.setItem')
    expect(LIST_SOURCE).not.toContain('localStorage.getItem')
    expect(LIST_SOURCE).not.toContain('sessionStorage.setItem')
    wrapper.unmount()
  })
})

describe('the employee page', () => {
  it('is its own route, not the list component', () => {
    const list = ROUTER_SOURCE.indexOf("path: '/hr/employees',")
    const detail = ROUTER_SOURCE.indexOf("path: '/hr/employees/:id',")
    expect(list).toBeGreaterThan(-1)
    expect(detail).toBeGreaterThan(list)
    expect(ROUTER_SOURCE).toContain("import('./pages/HrEmployeesPage.vue')")
    expect(ROUTER_SOURCE).toContain("import('./pages/HrEmployeeDetailPage.vue')")
    // The shared wrapper that kept the list mounted across both routes is gone.
    expect(ROUTER_SOURCE).not.toContain('hrEmployeesPage')
  })

  it('shows the back control and the import link, both as real controls', async () => {
    const { wrapper } = await mountDetail('/hr/employees/emp-1')
    expect(wrapper.text()).toContain('สมชาย ใจดี')
    expect(wrapper.text()).toContain('นักบัญชี')

    const back = wrapper.find('.control-back')
    expect(back.text()).toContain('กลับไปหน้าค้นหารายชื่อพนักงาน')
    expect(back.attributes('href')).toBe('/hr/employees')
    expect(back.element.tagName).toBe('A')

    const importLink = wrapper.find('a[href="/hr/employees/import"]')
    expect(importLink.exists()).toBe(true)
    expect(importLink.text()).toContain('กลับไปหน้านำเข้า')

    // 44px and the violet ring, on both.
    expect(DETAIL_SOURCE).toMatch(/\.control \{[^}]*min-height: var\(--tap\)/)
    expect(DETAIL_SOURCE).toContain('outline: 2px solid var(--focus)')
    expect(DETAIL_SOURCE).toContain('outline-offset: 2px')
    wrapper.unmount()
  })

  it('returns to the list with the search text kept', async () => {
    const { wrapper } = await mountDetail('/hr/employees/emp-1', { search: 'ab' })

    const back = wrapper.find('.control-back')
    expect(back.attributes('href')).toBe('/hr/employees?q=ab')

    await back.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$route.fullPath).toBe('/hr/employees?q=ab')
    wrapper.unmount()

    // The page that route renders fills its search box from the same query.
    const { wrapper: list } = await mountList('ab')
    await flushPromises()
    expect(list.find('.search input').element.value).toBe('ab')
    expect(list.findAll('a.list-row')).toHaveLength(2)
    list.unmount()
  })

  it('keeps both employee requests exactly as the old page made them', async () => {
    expect(DETAIL_SOURCE).toContain(
      'fetch(`/api/hr/employees/${encodeURIComponent(employeeId.value)}`, {\n      credentials: \'same-origin\',\n    })'
    )
    expect(DETAIL_SOURCE).toContain(
      '`/api/hr/employees/${encodeURIComponent(employeeId.value)}/reveal-national-id`'
    )
    expect(DETAIL_SOURCE).toContain("{ method: 'POST', credentials: 'same-origin' }")

    const { wrapper } = await mountDetail('/hr/employees/emp-1')
    const load = fetchCalls.find((entry) => entry.url === '/api/hr/employees/emp-1')
    expect(load).toBeTruthy()
    expect(load.options).toEqual({ credentials: 'same-origin' })

    await wrapper.find('.reveal-btn').trigger('click')
    await flushPromises()

    const reveal = fetchCalls.find((entry) => entry.url === '/api/hr/employees/emp-1/reveal-national-id')
    expect(reveal).toBeTruthy()
    expect(reveal.options).toEqual({ method: 'POST', credentials: 'same-origin' })
    expect(wrapper.find('.mono').text()).toBe('1103700001234')
    wrapper.unmount()
  })

  it('says so when there is no full national id to reveal', async () => {
    const { wrapper } = await mountDetail('/hr/employees/emp-2')
    expect(wrapper.text()).toContain('ปิดการใช้งาน')
    expect(wrapper.text()).toContain('ยังไม่มีเลขบัตรที่เข้ารหัสด้วยกุญแจของระบบปัจจุบัน')
    expect(wrapper.find('.reveal-btn').exists()).toBe(false)
    wrapper.unmount()
  })

  it('lands on the finished page when motion is reduced', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(DETAIL_SOURCE)
    expect(reduced).not.toBeNull()
    expect(reduced[0]).toContain('animation: none')
    expect(reduced[0]).toContain('transition: none')
    // The base state is the visible one.
    expect(DETAIL_SOURCE).not.toMatch(/\.panel \{[^}]*opacity: 0/)
  })

  it('keeps the back control’s ink and border above the floor', () => {
    // The palette comment states the same numbers; the tokens are project ones.
    expect(DETAIL_SOURCE).toContain('--accent-deep: #4338ca')
    expect(DETAIL_SOURCE).toContain('--control-line: rgba(30, 27, 75, 0.52)')
    expect(DETAIL_SOURCE).toContain('--focus: #8b5cf6')
    // Violet stays a ring, never an ink.
    expect(DETAIL_SOURCE).not.toMatch(/color: #8b5cf6/i)
  })
})
