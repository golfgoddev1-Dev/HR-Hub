// @vitest-environment happy-dom
// Leave data retention on the existing settings page: off by default, 730..3650
// days, a dry-run preview and confirmation before enabling, and a Thai message
// below the minimum.


import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HrLeaveSettingsPage from '../src/pages/HrLeaveSettingsPage.vue'

import { readSource } from './helpers/read-source.js'

const PAGE = readSource('src/pages/HrLeaveSettingsPage.vue')
const WORKER = readSource('worker/src/maintenance/cleanup.js')

const SETTINGS = {
  ok: true,
  configured: true,
  certificateRetentionDays: 90,
  limits: { min: 30, max: 365, default: 90 },
  leaveRetentionEnabled: false,
  leaveRetentionDays: 1825,
  leaveRetentionLimits: { min: 730, max: 3650, default: 1825 },
}

function json(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

const DialogStub = {
  props: ['modelValue'],
  template: '<div v-if="modelValue" class="dialog-stub"><slot /></div>',
}

const AlertStub = {
  template: '<div class="alert-stub"><slot /></div>',
}

function mountPage(calls) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url, options = {}) => {
      calls.push({ url: String(url), options })
      const method = options.method ?? 'GET'
      if (String(url).includes('/leave-retention/preview')) {
        return json({ ok: true, leaveRequests: 3, certificateFiles: 2 })
      }
      if (method === 'PUT') {
        const body = JSON.parse(options.body)
        return json({
          ok: true,
          configured: true,
          certificateRetentionDays: 90,
          leaveRetentionEnabled: body.leaveRetentionEnabled ?? false,
          leaveRetentionDays: body.leaveRetentionDays ?? 1825,
        })
      }
      return json(SETTINGS)
    })
  )

  return mount(HrLeaveSettingsPage, {
    global: { stubs: { 'v-dialog': DialogStub, 'v-alert': AlertStub } },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('leave retention settings', () => {
  it('shows the preview and asks for confirmation before enabling', async () => {
    const calls = []
    const wrapper = mountPage(calls)
    await flushPromises()

    const toggle = wrapper.find('#leave-retention-enabled')
    expect(toggle.element.checked).toBe(false)
    expect(wrapper.find('#leave-retention-days').element.value).toBe('1825')

    await toggle.setValue(true)
    await flushPromises()

    const previewCall = calls.find((call) =>
      call.url.includes('/api/leave/hr/settings/leave-retention/preview')
    )
    expect(previewCall).toBeTruthy()
    expect(previewCall.url).toContain('days=1825')
    expect(calls.some((call) => (call.options.method ?? 'GET') === 'PUT')).toBe(false)

    const text = wrapper.text()
    expect(text).toContain('ยืนยันเปิดการลบข้อมูลอัตโนมัติ')
    expect(text).toContain('1825')
    expect(text).toContain('02:00 UTC')
    expect(text).toContain('ไฟล์ใบรับรองแพทย์')
    expect(text).toContain('ใบลาที่จะถูกลบตอนนี้: 3 รายการ')
    expect(text).toContain('ไฟล์ใบรับรองแพทย์ที่จะถูกลบตอนนี้: 2 ไฟล์')

    await wrapper.find('.confirm-leave-btn').trigger('click')
    await flushPromises()

    const put = calls.find((call) => call.options.method === 'PUT')
    expect(put).toBeTruthy()
    expect(JSON.parse(put.options.body)).toEqual({
      leaveRetentionEnabled: true,
      leaveRetentionDays: 1825,
    })
    expect(wrapper.find('#leave-retention-enabled').element.checked).toBe(true)
  })

  it('shows the Thai minimum message and sends nothing for 729 days', async () => {
    const calls = []
    const wrapper = mountPage(calls)
    await flushPromises()

    await wrapper.find('#leave-retention-days').setValue(729)
    await flushPromises()

    expect(wrapper.find('.leave-days-error').text()).toBe(
      'จำนวนวันต้องอยู่ระหว่าง 730 ถึง 3650 วัน'
    )

    await wrapper.find('.retention-card .primary-btn').trigger('click')
    await flushPromises()
    expect(calls.some((call) => call.options.method === 'PUT')).toBe(false)
  })

  it('never reads the retention window from an environment variable', () => {
    expect(WORKER).not.toContain('LEAVE_RETENTION_DAYS')
    expect(PAGE).toContain('leaveRetentionEnabled')
    expect(PAGE).toContain('leaveRetentionDays')
    expect(PAGE).not.toContain('LEAVE_RETENTION_DAYS')
  })
})
