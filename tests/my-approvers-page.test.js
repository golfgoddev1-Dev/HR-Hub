// @vitest-environment happy-dom
// The page is a read-only contact list: both sections, a phone fallback and no
// field or button that could change anything.
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const H = vi.hoisted(() => ({
  approvers: [],
  shiftLeads: [],
}))

vi.mock('../src/lib/shared-data.js', () => ({
  DATA_KEYS: { myApprovers: 'myApprovers' },
  PAGE_TTL_MS: 1,
  errorTextOf: (_error, fallback) => fallback,
  loaders: {
    myApprovers: async () => ({ approvers: H.approvers, shiftLeads: H.shiftLeads }),
  },
  loadShared: async (_key, loader, options) => {
    options.onData(await loader())
  },
}))

import MyApproversPage from '../src/pages/MyApproversPage.vue'

function mountPage() {
  return mount(MyApproversPage, {
    global: { stubs: { 'v-alert': true } },
  })
}

describe('my approvers page', () => {
  beforeEach(() => {
    H.approvers = []
    H.shiftLeads = []
  })

  it('renders both sections with name, department, position and phone', async () => {
    H.approvers = [
      {
        firstName: 'ประเสริฐ',
        lastName: 'อนุมัติ',
        departmentName: 'ฝ่ายบุคคล',
        positionName: 'หัวหน้างาน',
        phone: '0812345678',
        roleLabel: 'ผู้อนุมัติ',
      },
    ]
    H.shiftLeads = [
      {
        firstName: 'มาลี',
        lastName: 'ตรวจสอบ',
        departmentName: 'ฝ่ายขาย',
        positionName: 'เจ้าหน้าที่',
        phone: null,
        roleLabel: 'หัวหน้ากะ',
      },
    ]

    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('ผู้อนุมัติใบลาของฉัน')
    expect(wrapper.text()).toContain('หัวหน้ากะของฉัน')
    expect(wrapper.text()).toContain('ประเสริฐ อนุมัติ')
    expect(wrapper.text()).toContain('ฝ่ายบุคคล')
    expect(wrapper.text()).toContain('หัวหน้างาน')
    expect(wrapper.text()).toContain('0812345678')
    expect(wrapper.text()).toContain('มาลี ตรวจสอบ')
    expect(wrapper.text()).toContain('ยังไม่มีข้อมูล')
    expect(wrapper.text()).toContain('ข้อมูลนี้ให้ไว้เพื่อการติดต่อเท่านั้น')

    wrapper.unmount()
  })

  it('shows a clear Thai empty message for each empty section', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('ยังไม่มีข้อมูลผู้อนุมัติใบลา')
    expect(wrapper.text()).toContain('ยังไม่มีข้อมูลหัวหน้ากะ')

    wrapper.unmount()
  })

  it('has no input, form or button on the page', async () => {
    H.approvers = [{ firstName: 'ก', lastName: 'ข', phone: '0812345678' }]
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.findAll('input, textarea, select, form, button')).toHaveLength(0)

    wrapper.unmount()
  })
})
