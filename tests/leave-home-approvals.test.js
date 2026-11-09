// @vitest-environment happy-dom
// The leave landing page only asks for the approval queue when the session says
// this employee is an approver; other employees must never trigger the 403.
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const H = vi.hoisted(() => ({
  session: null,
  approvalLoads: 0,
}))

vi.mock('../src/api.js', () => ({
  getSession: async () => H.session,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
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
  approvalCount: { value: 0 },
  setApprovalCount: vi.fn(),
}))

vi.mock('../src/leave-certificate.js', () => ({
  OWN_CERTIFICATE_OPEN_LABEL: 'เปิด',
  canOpenOwnCertificate: () => false,
  certificateStatus: () => ({ has: false }),
}))

vi.mock('../src/lib/shared-data.js', () => {
  const DATA_KEYS = { myRequests: 'myRequests', approvals: 'approvals' }
  return {
    APPROVALS_TTL_MS: 1,
    PAGE_TTL_MS: 1,
    DATA_KEYS,
    errorTextOf: (_error, fallback) => fallback,
    loaders: {
      myRequests: async () => ({ results: [] }),
      approvals: async () => {
        H.approvalLoads += 1
        return { results: [{}] }
      },
    },
    loadShared: async (_key, loader, options) => {
      options.onData(await loader())
    },
  }
})

import LeaveHomePage from '../src/pages/LeaveHomePage.vue'

function mountPage() {
  return mount(LeaveHomePage, {
    global: {
      stubs: {
        'v-alert': true,
        RouterLink: true,
      },
    },
  })
}

describe('leave home approval loading', () => {
  beforeEach(() => {
    H.approvalLoads = 0
  })

  it('loads the approval queue for an approver', async () => {
    H.session = { isApprover: true }
    const wrapper = mountPage()
    await flushPromises()

    expect(H.approvalLoads).toBe(1)
    wrapper.unmount()
  })

  it('does not request approvals for an employee who is not an approver', async () => {
    H.session = { isApprover: false }
    const wrapper = mountPage()
    await flushPromises()

    expect(H.approvalLoads).toBe(0)
    wrapper.unmount()
  })
})
