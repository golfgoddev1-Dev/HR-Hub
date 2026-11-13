// @vitest-environment happy-dom
// The public approval page: reached from the email link, outside the signed-in
// shell, with no redirect. It only reads until a button is pressed, and the
// reject button stays disabled until the shared reason rule passes.

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ApprovalLinkView from '../src/components/ApprovalLinkView.vue'
import ApprovalLinkPage from '../src/pages/ApproveLinkPage.vue'
import {
  INVALID_LINK_LABELS,
  REJECT_REASON_MAX_LENGTH,
  reasonError,
} from '../src/lib/approval-link.js'

import { readSource } from './helpers/read-source.js'

const TOKEN = 'T'.repeat(43)
const EMPLOYEE_NAME = 'สมชาย ใจดี'
const EMPLOYEE_CODE = 'EMP-001'

// Read from the project root: under the happy-dom environment import.meta.url is
// an http URL, so the file paths are resolved by the test runner's cwd instead.
const ROUTER = readSource('src/router.js')
const COMPONENT = readSource('src/components/ApprovalLinkView.vue')
const PAGE = readSource('src/pages/ApproveLinkPage.vue')
const CSS = COMPONENT.slice(COMPONENT.indexOf('<style scoped>'))

const DETAIL = {
  requestCode: 'LV-20261109-001',
  employeeName: EMPLOYEE_NAME,
  employeeCode: EMPLOYEE_CODE,
  departmentName: 'ฝ่ายบุคคล',
  leaveTypeName: 'ลากิจ',
  otherTypeDetail: null,
  startDate: '2026-11-10',
  endDate: '2026-11-11',
  days: 2,
  returnDate: '2026-11-12',
  returnTime: '08:00',
  shiftCode: 'DAY_FULL',
  shiftEndOverride: null,
  otOption: 'ไม่ OT',
  reason: 'ไปธุระที่ต่างจังหวัด',
  hasMedicalCertificate: false,
  createdAt: '2026-11-09T02:00:00.000Z',
  expiresAt: '2026-11-12T02:00:00.000Z',
}

function response(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

function mockFetch(handler) {
  const spy = vi.fn(handler)
  vi.stubGlobal('fetch', spy)
  return spy
}

function approveButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.text() === 'อนุมัติ')
}

function rejectButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.text() === 'ไม่อนุมัติ')
}

function confirmRejectButton(wrapper) {
  return wrapper
    .findAll('button')
    .find((button) => button.text().includes('ยืนยันไม่อนุมัติ'))
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.title = 'HR Hub'
})

describe('public route', () => {
  it('is outside the signed-in shell and needs no auth', () => {
    const start = ROUTER.indexOf("path: '/approve/:token'")
    const end = ROUTER.indexOf("path: '/pending'")
    const shellStart = ROUTER.indexOf('component: RoleShell')
    const shellEnd = ROUTER.indexOf("path: '/leave/hr/requests/:id/print'")

    expect(start).toBeGreaterThan(-1)
    expect(start).toBeLessThan(shellStart)

    const block = ROUTER.slice(start, end)
    expect(block).toContain('ApproveLinkPage')
    expect(block).not.toContain('requiresAuth')

    // The shell block never declares the approval page.
    expect(ROUTER.slice(shellStart, shellEnd)).not.toContain('/approve/')

    // The page and the view never read the session or a router guard.
    for (const source of [PAGE, COMPONENT]) {
      expect(source).not.toContain('getSession')
      expect(source).not.toContain('requiresAuth')
      expect(source).not.toContain('RoleShell')
      expect(source).not.toContain('AppLayout')
      expect(source).not.toContain('/login')
      expect(source).not.toContain('window.location')
    }
  })

  it('renders without a session and shows the full details', async () => {
    const fetchSpy = mockFetch(() => response({ ok: true, request: DETAIL }))

    const wrapper = mount(ApprovalLinkView, { props: { token: TOKEN } })
    await flushPromises()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/approve-link/${TOKEN}`,
      expect.objectContaining({ credentials: 'omit' })
    )

    const text = wrapper.text()
    expect(text).toContain(EMPLOYEE_NAME)
    expect(text).toContain(EMPLOYEE_CODE)
    expect(text).toContain('ฝ่ายบุคคล')
    expect(text).toContain('ลากิจ')
    expect(text).toContain('ไปธุระที่ต่างจังหวัด')
    expect(rejectButton(wrapper)).toBeTruthy()
    expect(approveButton(wrapper)).toBeTruthy()

    // The title carries no personal data.
    expect(document.title).toBe('อนุมัติใบลา · HR Hub')
    expect(document.title).not.toContain(EMPLOYEE_NAME)
    expect(document.title).not.toContain(EMPLOYEE_CODE)
  })
})

describe('the reject reason rule', () => {
  it('keeps the submit button disabled until the reason is valid', async () => {
    mockFetch(() => response({ ok: true, request: DETAIL }))

    const wrapper = mount(ApprovalLinkView, { props: { token: TOKEN } })
    await flushPromises()

    await rejectButton(wrapper).trigger('click')
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)

    expect(confirmRejectButton(wrapper).attributes('disabled')).toBeDefined()

    await textarea.setValue('   ')
    expect(confirmRejectButton(wrapper).attributes('disabled')).toBeDefined()

    await textarea.setValue('ไม่สะดวก')
    expect(confirmRejectButton(wrapper).attributes('disabled')).toBeUndefined()

    await textarea.setValue('ก'.repeat(REJECT_REASON_MAX_LENGTH + 1))
    expect(confirmRejectButton(wrapper).attributes('disabled')).toBeDefined()

    expect(reasonError('')).not.toBe('')
    expect(reasonError('ไม่สะดวก')).toBe('')
  })
})

describe('submitting a decision', () => {
  it('prevents a second submission while the first is in flight', async () => {
    let resolveDecision
    const pending = new Promise((resolve) => {
      resolveDecision = resolve
    })

    const fetchSpy = mockFetch((url, init) => {
      if (init?.method === 'POST') return pending
      return response({ ok: true, request: DETAIL })
    })

    const wrapper = mount(ApprovalLinkView, { props: { token: TOKEN } })
    await flushPromises()

    await approveButton(wrapper).trigger('click')
    await approveButton(wrapper).trigger('click')

    const posts = fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toBe(`/api/approve-link/${TOKEN}/decision`)
    expect(JSON.parse(posts[0][1].body)).toEqual({ decision: 'approve' })

    resolveDecision(await response({ ok: true, status: 'approved' }))
    await flushPromises()

    expect(wrapper.text()).toContain('อนุมัติแล้ว')
    expect(approveButton(wrapper)).toBeUndefined()
  })

  it('shows the rejection confirmation', async () => {
    mockFetch((url, init) => {
      if (init?.method === 'POST') return response({ ok: true, status: 'rejected' })
      return response({ ok: true, request: DETAIL })
    })

    const wrapper = mount(ApprovalLinkView, { props: { token: TOKEN } })
    await flushPromises()

    await rejectButton(wrapper).trigger('click')
    await wrapper.find('textarea').setValue('ไม่สะดวก')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('ไม่อนุมัติแล้ว')
  })

  it('shows the generic invalid-link message with a category only', async () => {
    for (const category of ['expired', 'used', 'invalid']) {
      mockFetch(() => response({ ok: false, code: 'link_unusable', category }, 410))

      const wrapper = mount(ApprovalLinkView, { props: { token: TOKEN } })
      await flushPromises()

      const text = wrapper.text()
      expect(text).toContain('ลิงก์นี้ใช้ไม่ได้แล้ว')
      expect(text).toContain(INVALID_LINK_LABELS[category])
      expect(text).not.toContain(EMPLOYEE_NAME)
      expect(text).not.toContain(EMPLOYEE_CODE)
      expect(document.title).not.toContain(EMPLOYEE_NAME)
    }
  })
})

describe('mobile layout', () => {
  it('has no fixed width wider than a 320px viewport minus gutters', () => {
    const widths = [...CSS.matchAll(/(?:^|[;{\s])(?:width|min-width)\s*:\s*(\d+)px/g)].map(
      (match) => Number(match[1])
    )

    // 320px viewport minus 16px of page padding on each side.
    expect(widths.filter((value) => value > 288)).toEqual([])
  })

  it('stacks the buttons on phones and keeps 44px targets and 16px input text', () => {
    expect(CSS).toContain('@media (max-width: 480px)')
    expect(CSS).toMatch(/@media \(max-width: 480px\)\s*{[^}]*grid-template-columns:\s*1fr/)
    expect(CSS).toContain('min-height: 48px')
    expect(CSS).toContain('font-size: 16px')
    expect(CSS).toContain('overflow-wrap: anywhere')
    expect(CSS).toContain('min-height: 100dvh')
    expect(CSS).not.toContain('position: fixed')
  })
})
