// @vitest-environment happy-dom
// The list is the default view on phones, so it must render the month rows from
// the same in-memory response the grid, the counts and the day panel use. These
// tests mount the real component with a FullCalendar stub and a mocked API.
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatThaiDateRange } from '../src/lib/thai-date.js'

const H = vi.hoisted(() => ({
  requestJson: null,
  api: null,
  options: null,
  calls: [],
}))

vi.mock('../src/lib/data-cache.js', () => ({
  getCached: async () => ({ holidays: [] }),
}))

vi.mock('../src/lib/shared-data.js', () => ({
  DATA_KEYS: {},
  SHARED_TTL_MS: 60_000,
  dataKey: { leaveHolidays: (from, to) => `holidays:${from}:${to}` },
  errorTextOf: (error, fallback) => fallback,
  loadHrDepartments: async () => [],
  loaders: { leaveHolidays: () => async () => ({ holidays: [] }) },
  requestJson: (...args) => H.requestJson(...args),
}))

vi.mock('@fullcalendar/vue3', async () => {
  const { defineComponent, h, onMounted } = await import('vue')

  return {
    default: defineComponent({
      name: 'FullCalendarStub',
      props: { options: { type: Object, default: () => ({}) } },
      setup(props, { expose }) {
        const state = { offset: 0 }

        function iso(date) {
          const month = String(date.getMonth() + 1).padStart(2, '0')
          const day = String(date.getDate()).padStart(2, '0')
          return `${date.getFullYear()}-${month}-${day}`
        }

        function viewInfo() {
          const now = new Date()
          const start = new Date(now.getFullYear(), now.getMonth() + state.offset, 1)
          const end = new Date(now.getFullYear(), now.getMonth() + state.offset + 1, 1)
          const gridStart = new Date(start)
          gridStart.setDate(gridStart.getDate() - gridStart.getDay())
          const gridEnd = new Date(end)
          gridEnd.setDate(gridEnd.getDate() + ((7 - gridEnd.getDay()) % 7))
          return {
            startStr: iso(gridStart),
            endStr: iso(gridEnd),
            view: { currentStart: start, currentEnd: end },
          }
        }

        function emit() {
          const info = viewInfo()
          api.view = { activeStart: info.view.currentStart, activeEnd: info.view.currentEnd }
          props.options?.datesSet?.(info)
        }

        const api = {
          view: { activeStart: null, activeEnd: null },
          render() {},
          updateSize() {},
          next() {
            state.offset += 1
            emit()
          },
          prev() {
            state.offset -= 1
            emit()
          },
          today() {
            state.offset = 0
            emit()
          },
        }

        onMounted(() => {
          H.api = api
          H.options = props.options
          emit()
        })

        expose({ getApi: () => api })
        return () => h('div', { class: 'calendar-stub' })
      },
    }),
  }
})

import LeaveCalendarView from '../src/components/LeaveCalendarView.vue'

function iso(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** A day in the displayed month (offset 0) or the next one. */
function dayOfMonth(offset, day) {
  const now = new Date()
  return iso(new Date(now.getFullYear(), now.getMonth() + offset, day))
}

function leaveEvent({ id, name, department, type, date, status = 'approved' }) {
  return {
    id,
    employeeName: name,
    departmentName: department,
    leaveTypeLabel: type,
    status,
    startDate: date,
    endDate: date,
  }
}

function currentMonthEvents() {
  return [
    leaveEvent({
      id: 'leave-a',
      name: 'นาย สมชาย ใจดี',
      department: 'ฝ่ายบุคคล',
      type: 'ลาป่วย',
      date: dayOfMonth(0, 5),
    }),
    leaveEvent({
      id: 'leave-b',
      name: 'นาง สมหญิง รักงาน',
      department: 'ฝ่ายบัญชี',
      type: 'ลากิจ',
      date: dayOfMonth(0, 9),
      status: 'pending',
    }),
  ]
}

function nextMonthEvents() {
  return [
    leaveEvent({
      id: 'leave-c',
      name: 'นาย อนาคต ใจเย็น',
      department: 'ฝ่ายขาย',
      type: 'ลาพักร้อน',
      date: dayOfMonth(1, 4),
    }),
  ]
}

async function mountView(width) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.localStorage.clear()
  const wrapper = mount(LeaveCalendarView, {
    global: { stubs: { 'v-alert': true } },
  })
  await flushPromises()
  return wrapper
}

function leaveRows(wrapper) {
  return wrapper
    .findAll('.day-list .row')
    .filter((row) => !row.classes().includes('row-holiday'))
}

function buttonWithText(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text().trim() === label)
}

beforeEach(() => {
  H.calls = []
  H.api = null
  H.options = null
  H.requestJson = async () => ({ events: [], dayCounts: {} })
})

afterEach(() => {
  window.localStorage.clear()
})

describe('the phone list view', () => {
  it('renders one row per visible leave with name, department, type and dates', async () => {
    const events = currentMonthEvents()
    H.requestJson = async () => ({ events, dayCounts: {} })

    const wrapper = await mountView(390)

    expect(wrapper.find('.list-card').exists()).toBe(true)
    const rows = leaveRows(wrapper)
    expect(rows).toHaveLength(events.length)

    for (const [index, event] of events.entries()) {
      const text = rows[index].text()
      expect(text).toContain(event.employeeName)
      expect(text).toContain(event.departmentName)
      expect(text).toContain(event.leaveTypeLabel)
      expect(text).toContain(formatThaiDateRange(event.startDate, event.endDate))
    }

    wrapper.unmount()
  })

  it('keeps the phone grid free of event titles and a "+N" link', async () => {
    H.requestJson = async () => ({ events: currentMonthEvents(), dayCounts: {} })

    const wrapper = await mountView(390)
    await buttonWithText(wrapper, 'ปฏิทิน').trigger('click')
    await flushPromises()

    expect(H.options.events).toEqual([])
    expect(H.options.dayMaxEvents).toBe(false)
    expect(typeof H.options.dayCellContent).toBe('function')
    expect(wrapper.html()).not.toContain('เพิ่มเติม')
    expect(wrapper.html()).not.toContain('นาย สมชาย ใจดี')
    expect(wrapper.findAll('.fc-event')).toHaveLength(0)

    wrapper.unmount()
  })

  it('shows the same rows on a phone as on a desktop for the same data', async () => {
    H.requestJson = async () => ({ events: currentMonthEvents(), dayCounts: {} })

    const phone = await mountView(390)
    const phoneRows = leaveRows(phone).map((row) => row.text())
    expect(phoneRows).toHaveLength(2)
    phone.unmount()

    const desktop = await mountView(1200)
    // Desktop opens on the grid; the list is one tap away.
    expect(desktop.find('.day-list').exists()).toBe(false)
    await buttonWithText(desktop, 'รายการ').trigger('click')
    await flushPromises()

    expect(leaveRows(desktop).map((row) => row.text())).toEqual(phoneRows)
    desktop.unmount()
  })

  it('shows the existing empty-state text for a month with no leave', async () => {
    const wrapper = await mountView(390)

    expect(wrapper.text()).toContain('ไม่มีรายการการลาในช่วงนี้')
    expect(leaveRows(wrapper)).toHaveLength(0)

    wrapper.unmount()
  })

  it('loads the next month into the list when navigating in list view', async () => {
    const events = [currentMonthEvents(), nextMonthEvents()]
    H.requestJson = async (url) => {
      H.calls.push(url)
      return { events: events[H.calls.length - 1] ?? [], dayCounts: {} }
    }

    const wrapper = await mountView(390)
    expect(leaveRows(wrapper).map((row) => row.text()).join(' ')).toContain('นาย สมชาย ใจดี')

    await buttonWithText(wrapper, 'ถัดไป').trigger('click')
    await flushPromises()

    const text = leaveRows(wrapper).map((row) => row.text()).join(' ')
    expect(text).toContain('นาย อนาคต ใจเย็น')
    expect(text).not.toContain('นาย สมชาย ใจดี')

    // The list reuses the calendar request and never adds one of its own.
    expect(H.calls.every((url) => url.startsWith('/api/leave/calendar'))).toBe(true)
    expect(H.calls).toHaveLength(2)

    wrapper.unmount()
  })
})
