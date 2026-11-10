// @vitest-environment happy-dom
// The reset page tells the employee where the 8-digit code comes from, right
// above the code field. This is text only; validation and the endpoint are not
// part of this test.
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('../src/api.js', () => ({
  postJson: vi.fn(),
}))

import SetPinPage from '../src/pages/SetPinPage.vue'

const NOTICE = 'ช่องรหัส 8 หลัก ให้ติดต่อฝ่ายบุคคล (HR) เพื่อขอรหัสไปรีเซ็ต PIN'

describe('set PIN reset notice', () => {
  it('renders the HR notice directly above the 8-digit code field', () => {
    const wrapper = mount(SetPinPage, {
      global: { stubs: { RouterLink: true } },
    })

    const notice = wrapper.find('.code-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain(NOTICE)

    const formHtml = wrapper.find('form').html()
    expect(formHtml.indexOf(NOTICE)).toBeGreaterThan(-1)
    expect(formHtml.indexOf(NOTICE)).toBeLessThan(formHtml.indexOf('id="code"'))

    wrapper.unmount()
  })
})
