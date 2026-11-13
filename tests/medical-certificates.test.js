// @vitest-environment happy-dom
// The HR certificate page lists only what the server returns (sick-leave
// requests with certificates) and opens each file in a new tab through the
// HR-only streaming route. Approval, history and day views carry no link.


import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HrLeaveCertificatesPage from '../src/pages/HrLeaveCertificatesPage.vue'

import { readSource } from './helpers/read-source.js'

const PAGE = readSource('src/pages/HrLeaveCertificatesPage.vue')
const CSS = PAGE.slice(PAGE.indexOf('<style scoped>'))
const APPROVALS = readSource('src/pages/LeaveApprovalsPage.vue')
const DETAIL = readSource('src/components/LeaveRequestDetail.vue')

function json(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the HR certificate page', () => {
  it('lists the employee certificates and opens each in a new tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/directory/employees')) {
          return json({
            ok: true,
            results: [
              {
                id: 'emp-1',
                fullName: 'สมชาย ใจดี',
                employeeCode: 'EMP-001',
                departmentName: 'ฝ่ายบุคคล',
              },
            ],
          })
        }
        if (String(url).includes('/medical-certificates')) {
          return json({
            ok: true,
            results: [
              {
                id: 'req-1',
                requestCode: 'LV-20261102-001',
                startDate: '2026-11-02',
                endDate: '2026-11-03',
                status: 'approved',
              },
            ],
          })
        }
        return json({ ok: false }, 404)
      })
    )

    const wrapper = mount(HrLeaveCertificatesPage)
    await wrapper.find('.picker .input').setValue('สมชาย')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flushPromises()

    await wrapper.find('.result').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.row')).toHaveLength(1)
    expect(wrapper.text()).toContain('LV-20261102-001')
    expect(wrapper.text()).toContain('อนุมัติแล้ว')

    const link = wrapper.find('.open-btn')
    expect(link.attributes('href')).toBe(
      '/api/hr/leave-requests/req-1/medical-certificate'
    )
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('shows the empty state when the employee has no certificate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        String(url).includes('/directory/employees')
          ? json({ ok: true, results: [{ id: 'emp-1', fullName: 'สมชาย', employeeCode: 'E1' }] })
          : json({ ok: true, results: [] })
      )
    )

    const wrapper = mount(HrLeaveCertificatesPage)
    await wrapper.find('.picker .input').setValue('สมชาย')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flushPromises()
    await wrapper.find('.result').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.row')).toHaveLength(0)
    expect(wrapper.text()).toContain('ไม่พบใบรับรองแพทย์')
  })

  it('is mobile first: 44px targets, 16px inputs, stacked on phones', () => {
    expect(CSS).toContain('min-height: 44px')
    expect(CSS).toContain('@media (max-width: 480px)')
    expect(CSS).toMatch(/@media \(max-width: 480px\)[\s\S]*width:\s*100%/)
    const widths = [...CSS.matchAll(/(?:^|[;{\s])(?:width|min-width)\s*:\s*(\d+)px/g)].map(
      (match) => Number(match[1])
    )
    expect(widths.filter((value) => value > 288)).toEqual([])
  })
})

describe('no certificate link for approvers, history or the day panel', () => {
  it('the approvals page never links to an attachment or certificate', () => {
    expect(APPROVALS).not.toContain('/attachment')
    expect(APPROVALS).not.toContain('CERTIFICATE_OPEN_LABEL')
    expect(APPROVALS).not.toContain('certificateStatus')
  })

  it('the shared history/day detail shows no certificate at all', () => {
    expect(DETAIL).not.toContain('/attachment')
    expect(DETAIL).not.toContain('CERTIFICATE_OPEN_LABEL')
    expect(DETAIL).not.toContain('ใบรับรองแพทย์')
  })

  it('the owner page opens only the owner route, in a new tab', () => {
    const home = readSource('src/pages/LeaveHomePage.vue')
    expect(home).toContain('/api/leave/requests/')
    expect(home).toContain('canOpenOwnCertificate')
    expect(home).toContain('target="_blank"')
    expect(home).not.toContain('createCertificateSignedUrl')
    expect(home).not.toContain('data.url')
  })
})
