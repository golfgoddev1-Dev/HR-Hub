// @vitest-environment happy-dom
// The employee home shows the logged-in employee's own pending and approved
// counts, both read from the Worker (never counted from an approver queue).
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const H = vi.hoisted(() => ({
  counts: { pending: 0, approved: 0 },
}))

vi.mock('../src/api.js', () => ({
  getSession: async () => ({ isApprover: false }),
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
    myRequests: async () => ({ results: [], counts: H.counts }),
    approvals: async () => ({ results: [] }),
  },
  loadShared: async (_key, loader, options) => {
    options.onData(await loader())
  },
}))

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

// The totals count up to the Worker's number, so a test reads them once the
// 700ms count has settled (reduced motion would land on the value at once).
async function settle(wrapper) {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 900))
  await flushPromises()
  return wrapper
}

function cardText(wrapper, label) {
  const item = wrapper.findAll('.summary-item').find((node) => node.text().includes(label))
  expect(item, label).toBeTruthy()
  return item.text()
}

describe('leave home own request counts', () => {
  beforeEach(() => {
    H.counts = { pending: 0, approved: 0 }
  })

  it('shows the own pending and approved counts from the Worker', async () => {
    H.counts = { pending: 2, approved: 3 }
    const wrapper = await settle(mountPage())

    expect(cardText(wrapper, 'ใบลารออนุมัติ')).toContain('2')
    expect(cardText(wrapper, 'ใบลาอนุมัติแล้ว')).toContain('3')
    wrapper.unmount()
  })

  it('shows 0 on both cards when the employee has no matching requests', async () => {
    const wrapper = await settle(mountPage())

    expect(cardText(wrapper, 'ใบลารออนุมัติ')).toContain('0')
    expect(cardText(wrapper, 'ใบลาอนุมัติแล้ว')).toContain('0')
    wrapper.unmount()
  })
})
