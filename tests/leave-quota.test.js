// @vitest-environment happy-dom
// The two pages that show leave quota: the HR employee detail edits a year of
// quotas, and /leave shows the employee their own balance. A type without a
// quota says so instead of drawing a zero ring, an error from the Worker keeps
// its text plus a fix, and the only motion is the ProgressDonut primitive's own
// marker (and none of it under reduced motion).
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readSource } from './helpers/read-source.js'

const TYPE_SICK = '22222222-2222-4222-8222-222222222222'
const TYPE_PERSONAL = '33333333-3333-4333-8333-333333333333'
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('../src/api.js', () => ({
  getSession: async () => ({ isApprover: false }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: EMPLOYEE_ID }, query: {} }),
}))

vi.mock('../src/components/PushToggle.vue', () => ({
  default: { name: 'PushToggle', template: '<div />' },
}))

vi.mock('../src/lib/thai-date.js', () => ({
  formatThaiDate: () => '',
  formatThaiDateRange: () => '',
}))

vi.mock('../src/lib/data-cache.js', () => ({
  peekCached: () => null,
}))

vi.mock('../src/lib/approval-count.js', () => ({
  setApprovalCount: vi.fn(),
}))

vi.mock('../src/leave-certificate.js', () => ({
  OWN_CERTIFICATE_OPEN_LABEL: 'เปิด',
  canOpenOwnCertificate: () => false,
  certificateStatus: () => ({ has: false }),
}))

vi.mock('../src/lib/shared-data.js', () => ({
  APPROVALS_TTL_MS: 1,
  PAGE_TTL_MS: 1,
  DATA_KEYS: { myRequests: 'myRequests', approvals: 'approvals' },
  errorTextOf: (_error, fallback) => fallback,
  loaders: {
    myRequests: async () => ({ results: [], counts: { pending: 0, approved: 0 } }),
    approvals: async () => ({ results: [] }),
  },
  loadShared: async (_key, loader, options) => {
    options.onData(await loader())
  },
}))

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init, method: init.method ?? 'GET' }
    calls.push(call)
    return handler(call)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const BALANCE = {
  ok: true,
  year: 2026,
  results: [
    {
      leaveTypeId: TYPE_SICK,
      name: 'ลาป่วย',
      quota: 10,
      used: 3,
      pending: 1,
      remaining: 6,
    },
    {
      leaveTypeId: TYPE_PERSONAL,
      name: 'ลากิจ',
      quota: null,
      used: 1,
      pending: 0,
      remaining: null,
    },
  ],
}

import LeaveHomePage from '../src/pages/LeaveHomePage.vue'
import HrEmployeeDetailPage from '../src/pages/HrEmployeeDetailPage.vue'

function mountHome() {
  return mount(LeaveHomePage, {
    global: { stubs: { 'v-alert': true, RouterLink: true } },
  })
}

async function settle() {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await flushPromises()
}

describe('leave balance panel on /leave', () => {
  let fake

  afterEach(() => {
    fake?.restore()
    fake = null
  })

  it('shows used/quota beside the donut and “ไม่กำหนดโควตา” with no donut', async () => {
    fake = installFetch(() => jsonResponse(BALANCE))
    const wrapper = mountHome()
    await settle()

    const text = wrapper.text()
    expect(text).toContain('โควตาวันลา')
    expect(text).toContain('ใช้ไป 3 จาก 10 วัน')
    expect(text).toContain('คงเหลือ 6 วัน')
    expect(text).toContain('ไม่กำหนดโควตา')

    // Only the type with a quota gets a ring.
    expect(wrapper.findAll('.donut')).toHaveLength(1)
    expect(wrapper.find('.donut-value').text()).toBe('30%')

    const requests = fake.calls.map((call) => call.url)
    expect(requests.some((url) => url.startsWith('/api/leave/balance?year='))).toBe(true)
    wrapper.unmount()
  })

  it('shows the Worker error and the fix instead of an empty panel', async () => {
    fake = installFetch(() =>
      jsonResponse({ ok: false, message: 'โหลดโควตาวันลาไม่สำเร็จ กรุณาลองใหม่' }, 500)
    )
    const wrapper = mountHome()
    await settle()

    const panel = wrapper.find('.quota-panel')
    expect(panel.text()).toContain('โหลดโควตาวันลาไม่สำเร็จ')
    expect(panel.text()).toContain('ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง')
    expect(wrapper.findAll('.donut')).toHaveLength(0)
    wrapper.unmount()
  })

  it('keeps the panel still under reduced motion and leaves motion to the primitive', async () => {
    const panelSource = readSource('src/components/LeaveBalancePanel.vue')
    const panelStyles = [...panelSource.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((match) => match[1])
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')

    expect(panelStyles).not.toContain('@keyframes')
    expect(panelStyles).not.toContain('animation:')
    expect(panelStyles).not.toContain('transition:')

    // The ring itself is the existing primitive, and its reduced-motion block
    // turns the marker's transition off while the ring stays at its final arc.
    const donutSource = readSource('src/components/ProgressDonut.vue')
    expect(donutSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(donutSource).toContain('transition: none')

    fake = installFetch(() => jsonResponse(BALANCE))
    const wrapper = mountHome()
    await settle()
    expect(wrapper.text()).toContain('คงเหลือ 6 วัน')
    expect(wrapper.find('.quota-panel').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('leave quota section on /hr/employees/:id', () => {
  let fake

  beforeEach(() => {
    fake = installFetch(({ url, method }) => {
      if (url.includes('/leave-quotas') && method === 'GET') {
        return jsonResponse({
          ok: true,
          year: 2026,
          results: [
            { leaveTypeId: TYPE_SICK, name: 'ลาป่วย', quota: 10 },
            { leaveTypeId: TYPE_PERSONAL, name: 'ลากิจ', quota: null },
          ],
        })
      }
      if (url.includes('/leave-quotas') && method === 'PUT') {
        return jsonResponse({
          ok: true,
          year: 2026,
          results: [
            { leaveTypeId: TYPE_SICK, name: 'ลาป่วย', quota: 12 },
            { leaveTypeId: TYPE_PERSONAL, name: 'ลากิจ', quota: null },
          ],
        })
      }
      return jsonResponse({
        ok: true,
        employee: {
          id: EMPLOYEE_ID,
          employeeCode: 'E001',
          fullName: 'พนักงาน ตัวอย่าง',
          departmentName: 'บุคคล',
          positionName: null,
          isActive: true,
          nationalIdMasked: null,
          nationalIdAvailable: false,
        },
      })
    })
  })

  afterEach(() => {
    fake?.restore()
    fake = null
  })

  it('reads the year and saves an entered quota', async () => {
    const wrapper = mount(HrEmployeeDetailPage, {
      global: { stubs: { 'v-alert': true, RouterLink: true } },
    })
    await settle()

    expect(wrapper.text()).toContain('โควตาวันลา')
    expect(wrapper.find('#quota-year').exists()).toBe(true)

    const sickInput = wrapper.find(`#quota-${TYPE_SICK}`)
    expect(sickInput.element.value).toBe('10')
    expect(wrapper.find(`#quota-${TYPE_PERSONAL}`).element.value).toBe('')

    await sickInput.setValue('12')
    await wrapper.findAll('button').find((button) => button.text().includes('บันทึกโควตาวันลา')).trigger('click')
    await settle()

    const put = fake.calls.find((call) => call.method === 'PUT')
    expect(put).toBeTruthy()
    const body = JSON.parse(put.init.body)
    expect(body.quotas).toEqual([
      { leaveTypeId: TYPE_SICK, days: 12 },
      { leaveTypeId: TYPE_PERSONAL, days: null },
    ])
    expect(wrapper.text()).toContain('บันทึกโควตาวันลาแล้ว')
    wrapper.unmount()
  })

  it('shows the Worker error text and the fix when the save is refused', async () => {
    const wrapper = mount(HrEmployeeDetailPage, {
      global: { stubs: { 'v-alert': true, RouterLink: true } },
    })
    await settle()

    fake.restore()
    fake = installFetch(({ url, method }) => {
      if (url.includes('/leave-quotas') && method === 'GET') {
        return jsonResponse({
          ok: true,
          year: 2026,
          results: [{ leaveTypeId: TYPE_SICK, name: 'ลาป่วย', quota: 10 }],
        })
      }
      if (url.includes('/leave-quotas') && method === 'PUT') {
        return jsonResponse(
          { ok: false, message: 'จำนวนวันไม่ถูกต้อง ต้องอยู่ระหว่าง 0 ถึง 366 วัน' },
          400
        )
      }
      return jsonResponse({ ok: true, employee: { id: EMPLOYEE_ID, isActive: true } })
    })

    await wrapper.find(`#quota-${TYPE_SICK}`).setValue('')
    await wrapper.findAll('button').find((button) => button.text().includes('บันทึกโควตาวันลา')).trigger('click')
    await settle()

    expect(wrapper.text()).toContain('จำนวนวันไม่ถูกต้อง')
    expect(wrapper.text()).toContain('ตรวจสอบค่าที่กรอกแล้วลองบันทึกอีกครั้ง')
    wrapper.unmount()
  })
})
