// @vitest-environment happy-dom
// The detail dialog's keyboard and focus contract, mounted for real: focus moves
// to the close button when the dialog opens, Tab and Shift+Tab stay inside it,
// Escape closes it, and focus returns to the row that opened it.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HrLeaveRequestsPage from '../src/pages/HrLeaveRequestsPage.vue'
import { clearAll } from '../src/lib/data-cache.js'
import { focusableIn } from '../src/lib/dialog-focus.js'

const ROW = {
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
}

const DETAIL = {
  ...ROW,
  returnDate: '2026-11-03',
  returnTime: '08:00',
  shiftCode: 'A',
  otOption: 'none',
  approver: { fullName: 'หัวหน้า กอง' },
  decidedAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-11-01T09:12:00.000Z',
  reason: 'ป่วย',
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url)
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
      if (path.includes('/api/leave/hr/requests/req-1')) {
        return jsonResponse({ ok: true, request: DETAIL })
      }
      if (path.includes('/api/leave/hr/requests')) {
        return jsonResponse({ ok: true, results: [ROW], hasMore: false, scanCapped: false })
      }
      return jsonResponse({ ok: true })
    })
  )
}

function stubEnvironment() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query) => ({
      media: query,
      // Reduced motion keeps tilt and GSAP out of these tests.
      matches: query.includes('prefers-reduced-motion'),
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
  )
}

const SelectStub = { inheritAttrs: false, template: '<div class="select-stub"></div>' }
const AlertStub = { template: '<div class="alert-stub"><slot /></div>' }

function mountPage() {
  return mount(HrLeaveRequestsPage, {
    attachTo: document.body,
    global: {
      stubs: {
        'v-select': SelectStub,
        'v-alert': AlertStub,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

/** Click the first row and wait for the dialog. */
async function openDialog(wrapper) {
  const row = wrapper.find('.list-row')
  row.element.focus()
  await row.trigger('click')
  await flushPromises()
  return row
}

function press(key, { shift = false, target = document } = {}) {
  return target.dispatchEvent(
    new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true })
  )
}

beforeEach(() => {
  clearAll()
  stubFetch()
  stubEnvironment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearAll()
  document.body.innerHTML = ''
})

describe('detail dialog focus', () => {
  it('moves focus to the close button when it opens', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await openDialog(wrapper)

    const close = wrapper.find('.detail .icon-btn')
    expect(close.exists()).toBe(true)
    expect(close.attributes('aria-label')).toBe('ปิดรายละเอียด')
    expect(document.activeElement).toBe(close.element)
    wrapper.unmount()
  })

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const wrapper = mountPage()
    await flushPromises()
    await openDialog(wrapper)

    const panel = wrapper.find('.detail').element
    const items = focusableIn(panel)
    expect(items.length).toBeGreaterThanOrEqual(3) // close, print, resend

    // Tab at the last control wraps to the first.
    items[items.length - 1].focus()
    expect(press('Tab')).toBe(false) // handled: default prevented
    expect(document.activeElement).toBe(items[0])

    // Shift+Tab at the first wraps to the last.
    items[0].focus()
    expect(press('Tab', { shift: true })).toBe(false)
    expect(document.activeElement).toBe(items[items.length - 1])

    // A Tab from the middle is left to the browser.
    items[1].focus()
    expect(press('Tab')).toBe(true)
    expect(document.activeElement).toBe(items[1])

    // Focus that escaped the panel is pulled back in.
    document.body.focus()
    press('Tab', { shift: true })
    expect(document.activeElement).toBe(items[items.length - 1])
    wrapper.unmount()
  })

  it('closes on Escape and returns focus to the row that opened it', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const row = await openDialog(wrapper)
    expect(wrapper.find('.detail').exists()).toBe(true)

    press('Escape')
    await flushPromises()

    expect(wrapper.find('.detail').exists()).toBe(false)
    expect(document.activeElement).toBe(row.element)
    wrapper.unmount()
  })

  it('returns focus to the row when the close button is used', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const row = await openDialog(wrapper)

    await wrapper.find('.detail .icon-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('.detail').exists()).toBe(false)
    expect(document.activeElement).toBe(row.element)
    wrapper.unmount()
  })
})
