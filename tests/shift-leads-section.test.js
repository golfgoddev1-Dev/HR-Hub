// @vitest-environment happy-dom
// The HR approvers page's shift-lead section: two rows at most, a live label
// counter, a case-insensitive duplicate block, a warning when the chosen person
// has no email, and a server error that keeps what the user typed.

import { readFileSync } from 'node:fs'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ShiftLeadsSection from '../src/components/ShiftLeadsSection.vue'
import {
  hasDuplicateShiftLabels,
  shiftLabelError,
  shiftLabelLength,
  shiftLeadPayload,
  shiftLeadsPath,
} from '../src/lib/shift-leads.js'

const COMPONENT = readFileSync('src/components/ShiftLeadsSection.vue', 'utf8')
const CSS = COMPONENT.slice(COMPONENT.indexOf('<style scoped>'))

const DEPARTMENT_ID = 'dept-1'
const DEPARTMENT_NAME = 'ฝ่ายบุคคล'

const LEAD_ONE = {
  id: 'sl-1',
  employeeId: 'emp-1',
  employeeCode: 'EMP-001',
  employeeName: 'สมชาย ใจดี',
  shiftLabel: 'กะ A',
  hasEmail: true,
}

const LEAD_TWO = {
  id: 'sl-2',
  employeeId: 'emp-2',
  employeeCode: 'EMP-002',
  employeeName: 'สมหญิง ดี',
  shiftLabel: 'กะ B',
  hasEmail: true,
}

function json(body, status = 200) {
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

function mountSection(handler) {
  mockFetch(handler)
  return mount(ShiftLeadsSection, {
    props: { departmentId: DEPARTMENT_ID, departmentName: DEPARTMENT_NAME },
  })
}

function button(wrapper, text) {
  return wrapper.findAll('button').find((item) => item.text() === text)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the two-row limit', () => {
  it('renders two saved leads and disables the add button', async () => {
    const wrapper = mountSection(() => json({ ok: true, leads: [LEAD_ONE, LEAD_TWO] }))
    await flushPromises()

    expect(wrapper.findAll('.lead-row')).toHaveLength(2)
    expect(wrapper.text()).toContain(DEPARTMENT_NAME)
    expect(wrapper.text()).toContain('2/2')
    expect(button(wrapper, 'เพิ่มหัวหน้ากะ').attributes('disabled')).toBeDefined()
  })

  it('enables the add button again after removing a row', async () => {
    const wrapper = mountSection(() => json({ ok: true, leads: [LEAD_ONE, LEAD_TWO] }))
    await flushPromises()

    await wrapper.findAll('button').find((item) => item.text() === 'ลบ').trigger('click')

    expect(wrapper.findAll('.lead-row')).toHaveLength(1)
    expect(button(wrapper, 'เพิ่มหัวหน้ากะ').attributes('disabled')).toBeUndefined()
  })
})

describe('the shift label', () => {
  it('shows a live 30-character counter', async () => {
    const wrapper = mountSection(() => json({ ok: true, leads: [LEAD_ONE] }))
    await flushPromises()

    const label = 'กะเช้า'
    await wrapper.find('.label-input').setValue(label)

    expect(wrapper.text()).toContain(`${shiftLabelLength(label)}/30`)
  })

  it('blocks a duplicate label, ignoring case and surrounding spaces', async () => {
    const wrapper = mountSection(() => json({ ok: true, leads: [LEAD_ONE, LEAD_TWO] }))
    await flushPromises()

    const inputs = wrapper.findAll('.label-input')
    await inputs[0].setValue('กะ A')
    await inputs[1].setValue('  กะ a ')

    expect(wrapper.text()).toContain('ชื่อกะซ้ำกันในแผนกนี้')
    expect(button(wrapper, 'บันทึกหัวหน้ากะ').attributes('disabled')).toBeDefined()
  })

  it('marks a row whose person has no email', async () => {
    const wrapper = mountSection(() =>
      json({ ok: true, leads: [{ ...LEAD_ONE, hasEmail: false }] })
    )
    await flushPromises()

    expect(wrapper.text()).toContain('ไม่มีอีเมล')
    expect(wrapper.text()).toContain('จะไม่ได้รับแจ้งเตือน')
  })
})

describe('saving', () => {
  it('keeps the typed label when the server refuses the save', async () => {
    mockFetch((url, init = {}) => {
      if (init.method === 'PUT') {
        return json({ ok: false, message: 'ชื่อกะซ้ำกันในแผนกนี้' }, 409)
      }
      return json({ ok: true, leads: [LEAD_ONE] })
    })
    const wrapper = mount(ShiftLeadsSection, {
      props: { departmentId: DEPARTMENT_ID, departmentName: DEPARTMENT_NAME },
    })
    await flushPromises()

    await wrapper.find('.label-input').setValue('กะ C')
    await button(wrapper, 'บันทึกหัวหน้ากะ').trigger('click')
    await flushPromises()

    expect(wrapper.find('.label-input').element.value).toBe('กะ C')
    expect(wrapper.text()).toContain('ชื่อกะซ้ำกันในแผนกนี้')

    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeTruthy()
    expect(put[0]).toBe(shiftLeadsPath(DEPARTMENT_ID))
    expect(JSON.parse(put[1].body)).toEqual({
      leads: [{ employeeId: 'emp-1', shiftLabel: 'กะ C' }],
    })
  })

  it('sends at most two rows, each with its person and trimmed label', () => {
    expect(
      shiftLeadPayload([
        { employee: { id: 'emp-1' }, shiftLabel: '  กะ A  ' },
        { employee: { id: 'emp-2' }, shiftLabel: 'กะ B' },
      ])
    ).toEqual({
      leads: [
        { employeeId: 'emp-1', shiftLabel: 'กะ A' },
        { employeeId: 'emp-2', shiftLabel: 'กะ B' },
      ],
    })
  })
})

describe('labels and layout', () => {
  it('applies the shared label rule', () => {
    expect(shiftLabelError('')).not.toBe('')
    expect(shiftLabelError('   ')).not.toBe('')
    expect(shiftLabelError('ก'.repeat(31))).not.toBe('')
    expect(shiftLabelError('ก'.repeat(30))).toBe('')
    expect(shiftLabelLength('กะ A')).toBe(4)
    expect(hasDuplicateShiftLabels(['กะ A', ' กะ a '])).toBe(true)
    expect(hasDuplicateShiftLabels(['กะ A', 'กะ B'])).toBe(false)
    expect(shiftLeadsPath('a/b')).toBe('/api/hr/departments/a%2Fb/shift-leads')
  })

  it('has no fixed width wider than a 320px viewport minus gutters', () => {
    const widths = [...CSS.matchAll(/(?:^|[;{\s])(?:width|min-width)\s*:\s*(\d+)px/g)].map(
      (match) => Number(match[1])
    )
    expect(widths.filter((value) => value > 288)).toEqual([])
  })

  it('stacks on phones with 44px targets and 16px input text', () => {
    expect(CSS).toContain('min-height: 44px')
    expect(CSS).toContain('font-size: 16px')
    expect(CSS).toContain('@media (max-width: 480px)')
    expect(CSS).toMatch(/@media \(max-width: 480px\)\s*{[^}]*grid-template-columns:\s*1fr/)
    expect(CSS).not.toContain('position: fixed')
    // The picker is limited to the section's department.
    expect(COMPONENT).toContain(':department-id="departmentId"')
  })
})
