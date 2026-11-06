<script setup>
// The calendar itself. It is layout-free on purpose: LeaveCalendarPage puts it
// inside the shared app layout (employee/approver or the HR shell).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import thLocale from '@fullcalendar/core/locales/th'

import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import {
  NARROW_VIEW_WIDTH,
  addIsoDays,
  calendarTitle,
  eventColors,
  eventTitle,
  initialCalendarView,
  rangeFromView,
  statusLabel,
  toExclusiveEnd,
} from '../lib/leave-calendar.js'
import {
  VIEW_BREAKPOINT,
  VIEW_CALENDAR,
  VIEW_LIST,
  buildLeaveList,
  initialLeaveView,
  storeLeaveView,
} from '../lib/leave-calendar-view.js'
import {
  DAY_PANEL_EMPTY,
  buildDayRows,
  dayCountLabel,
  formatThaiDayHeading,
  groupDayRows,
  toDetailRequest,
} from '../lib/leave-day.js'
import LeaveRequestDetail from './LeaveRequestDetail.vue'
import { getCached } from '../lib/data-cache.js'
import {
  DATA_KEYS,
  SHARED_TTL_MS,
  dataKey,
  errorTextOf,
  loadHrDepartments,
  loaders,
  requestJson,
} from '../lib/shared-data.js'

const props = defineProps({
  isHr: { type: Boolean, default: false },
})

const LOAD_ERROR = 'โหลดปฏิทินการลาไม่สำเร็จ กรุณาลองใหม่'
const EMPTY_DEPARTMENTS = 'โหลดรายชื่อแผนกไม่สำเร็จ'

const calendarRef = ref(null)
const loading = ref(false)
const errorMessage = ref('')
const departmentError = ref('')
const events = ref([])
// The raw responses: one array feeds the grid and the grouped list, so the two
// views can never disagree about what is visible.
const leaveEvents = ref([])
const holidays = ref([])
const title = ref('ปฏิทินการลา')
const selected = ref(null)
const panelClose = ref(null)
const departmentId = ref(null)
const departments = ref([])
const width = ref(typeof window === 'undefined' ? 1024 : window.innerWidth)
const loadedRange = ref({ from: '', to: '' })
// The month the grid is showing (without its leading/trailing filler days).
const monthRange = ref({ from: '', to: '' })
// Approved people per Bangkok day, computed by the Worker from the same rows.
const dayCounts = ref({})
const dayPanel = ref(null)
const dayPanelEl = ref(null)
const dayPanelClose = ref(null)
const expandedRowId = ref('')
let lastDayCell = null

/** localStorage, or null when the browser refuses to hand it over. */
function localStore() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

const view = ref(initialLeaveView({ width: width.value, storage: localStore() }))
const isNarrow = computed(() => width.value < NARROW_VIEW_WIDTH)
const isPhone = computed(() => width.value <= VIEW_BREAKPOINT)

const listGroups = computed(() =>
  buildLeaveList({ events: leaveEvents.value, holidays: holidays.value })
)

const rangeLabel = computed(() => {
  const { from, to } = monthRange.value
  if (!from || !to) return ''
  return formatThaiDateRange(from, to)
})

const groupedDayRows = computed(() => groupDayRows(dayPanel.value?.rows ?? []))

const options = computed(() => ({
  plugins: [dayGridPlugin],
  initialView: initialCalendarView(width.value),
  locale: thLocale,
  firstDay: 0,
  height: 'auto',
  // Phones keep the month grid but collapse the events into dots, so a 360px
  // screen fits without horizontal scrolling. v6 has no 'dot' eventDisplay, so
  // the dot is the event element itself, emptied of text here.
  dayMaxEvents: isPhone.value ? 2 : true,
  eventContent: isPhone.value ? renderDotEvent : undefined,
  noEventsText: 'ไม่มีรายการลาในช่วงนี้',
  headerToolbar: isPhone.value
    ? { left: 'prev,next', center: 'title', right: 'today' }
    : { left: 'prev,next today', center: 'title' },
  buttonText: {
    today: 'วันนี้',
    prev: 'ก่อนหน้า',
    next: 'ถัดไป',
  },
  events: events.value,
  eventClick: (info) => {
    if (info.event.extendedProps?.kind === 'holiday') return
    openPanel(info.event)
  },
  eventDidMount: decorateEvent,
  dayCellDidMount: decorateDayCell,
  datesSet: onDatesSet,
}))

function toCalendarEvent(event) {
  return {
    id: `leave-${event.id}`,
    title: eventTitle(event),
    start: event.startDate,
    end: toExclusiveEnd(event.endDate),
    allDay: true,
    ...eventColors(event.status),
    extendedProps: { kind: 'leave', ...event },
  }
}

function toHolidayEvent(holiday) {
  const name = typeof holiday.name === 'string' && holiday.name.length > 0 ? holiday.name : ''
  return {
    id: `holiday-${holiday.date}`,
    title: `วันหยุด${name ? ` · ${name}` : ''}`,
    start: holiday.date,
    end: toExclusiveEnd(holiday.date),
    allDay: true,
    classNames: ['holiday-event'],
    backgroundColor: '#e7f2f0',
    borderColor: '#9ec9c4',
    textColor: '#10504e',
    extendedProps: { kind: 'holiday', date: holiday.date, name },
  }
}

async function load(range) {
  if (!range) return
  loadedRange.value = range
  loading.value = true
  errorMessage.value = ''

  const params = new URLSearchParams({ from: range.from, to: range.to })
  if (props.isHr && departmentId.value) params.set('departmentId', departmentId.value)

  try {
    const [calendarData, holidayData] = await Promise.all([
      requestJson(`/api/leave/calendar?${params.toString()}`),
      // Holidays barely change: 30 minutes per range, shared with the leave form.
      getCached(
        dataKey.leaveHolidays(range.from, range.to),
        loaders.leaveHolidays(range.from, range.to),
        { ttlMs: SHARED_TTL_MS }
      ).catch(() => ({ holidays: [] })),
    ])

    leaveEvents.value = Array.isArray(calendarData.events) ? calendarData.events : []
    holidays.value = Array.isArray(holidayData?.holidays) ? holidayData.holidays : []
    dayCounts.value =
      calendarData?.dayCounts && typeof calendarData.dayCounts === 'object'
        ? calendarData.dayCounts
        : {}

    events.value = [
      ...leaveEvents.value.map(toCalendarEvent),
      ...holidays.value.map(toHolidayEvent),
    ]
    nextTick(syncDayBadges)
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
    events.value = []
    leaveEvents.value = []
    holidays.value = []
    dayCounts.value = {}
    nextTick(syncDayBadges)
  } finally {
    loading.value = false
  }
}

function onDatesSet(info) {
  const range = rangeFromView(info.startStr, info.endStr)
  const current = info.view?.currentStart ?? info.start
  const monthStart = current instanceof Date ? isoDayOf(current) : info.startStr
  title.value = calendarTitle(monthStart)

  const monthEnd = info.view?.currentEnd
  if (monthEnd instanceof Date) {
    monthRange.value = { from: monthStart, to: addIsoDays(isoDayOf(monthEnd), -1) }
  }

  if (!range) return
  if (loadedRange.value.from === range.from && loadedRange.value.to === range.to) return
  load(range)
}

function openPanel(event) {
  selected.value = { ...event.extendedProps }
  nextTick(() => panelClose.value?.focus())
}

function closePanel() {
  selected.value = null
}

/** The day panel opens from the data already in memory: no list request. */
function openDayPanel(date, cell) {
  const key = String(date ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return

  dayPanel.value = {
    date: key,
    rows: buildDayRows({ events: leaveEvents.value, date: key }),
  }
  expandedRowId.value = ''
  lastDayCell = cell ?? (typeof document === 'undefined' ? null : document.activeElement)
  nextTick(() => dayPanelClose.value?.focus())
}

/** Escape, the close button and the backdrop all land here; focus goes back. */
function closeDayPanel() {
  if (!dayPanel.value) return
  dayPanel.value = null
  expandedRowId.value = ''
  const target = lastDayCell
  lastDayCell = null
  nextTick(() => {
    if (target && target.isConnected !== false) target.focus()
  })
}

/** Escape closes, and Tab stays inside the modal while it is open. */
function onDayPanelKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDayPanel()
    return
  }
  if (event.key !== 'Tab') return

  const nodes = [
    ...(dayPanelEl.value?.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) ?? []),
  ].filter((node) => node.offsetParent !== null)
  if (nodes.length === 0) return

  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/** One expanded row at a time; it is the same detail the approvals page shows. */
function toggleRow(row) {
  if (!row?.id) return
  expandedRowId.value = expandedRowId.value === row.id ? '' : row.id
}

/** Paints the approved-people badge on every visible day cell. */
function syncDayBadges() {
  if (typeof document === 'undefined') return

  for (const cell of document.querySelectorAll('.fc-daygrid-day[data-date]')) {
    const date = cell.getAttribute('data-date') ?? ''
    const count = Number(dayCounts.value[date] ?? 0)
    const existing = cell.querySelector('.day-count')

    if (!Number.isFinite(count) || count <= 0) {
      existing?.remove()
      cell.removeAttribute('data-leave-count')
      continue
    }

    const badge = existing ?? document.createElement('span')
    if (!existing) {
      badge.className = 'day-count'
      badge.setAttribute('aria-hidden', 'true')
      cell.querySelector('.fc-daygrid-day-frame')?.appendChild(badge)
    }
    badge.textContent = String(count)
    cell.setAttribute('data-leave-count', String(count))

    const label = `ดูรายละเอียดวันที่ ${formatThaiDate(date)} มีผู้ลา ${count} คน`
    cell.setAttribute('aria-label', label)
  }
}

/** Events are real buttons: tabindex plus Enter/Space, with a focus ring. */
function decorateEvent(info) {
  const el = info.el
  const extended = info.event.extendedProps ?? {}
  el.setAttribute('tabindex', '0')
  el.setAttribute('role', 'button')

  const dates =
    extended.kind === 'leave'
      ? formatThaiDateRange(extended.startDate, extended.endDate)
      : ''
  el.setAttribute('aria-label', dates ? `${info.event.title} · ${dates}` : info.event.title)

  el.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return
    keyEvent.preventDefault()
    if (extended.kind === 'holiday') return
    openPanel(info.event)
  })
}

function isoDayOf(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** The phone grid's dot carries no text: the aria-label still names it. */
function renderDotEvent() {
  return { domNodes: [] }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Switching view only changes what is shown: the range and its data stay. */
function selectView(next) {
  if (next !== VIEW_CALENDAR && next !== VIEW_LIST) return
  view.value = next
  storeLeaveView(next, localStore())
  if (next === VIEW_CALENDAR) {
    // The grid was hidden, so it has to measure itself again.
    nextTick(() => {
      calendarRef.value?.getApi()?.updateSize()
      syncDayBadges()
    })
  }
}

/** One calendar instance owns the range, so the list navigates the same month. */
function moveRange(action) {
  const api = calendarRef.value?.getApi()
  if (!api) return
  api[action]()
}

/** Every day cell is a button: tap/click or Enter/Space opens the day panel. */
function decorateDayCell(info) {
  const date = isoDayOf(info.date)
  if (!date) return

  const el = info.el
  const count = Number(dayCounts.value[date] ?? 0)
  const open = () => openDayPanel(date, el)
  el.setAttribute('tabindex', '0')
  el.setAttribute('role', 'button')
  el.setAttribute(
    'aria-label',
    count > 0
      ? `ดูรายละเอียดวันที่ ${formatThaiDate(date)} มีผู้ลา ${count} คน`
      : `ดูรายละเอียดวันที่ ${formatThaiDate(date)}`
  )

  el.addEventListener('click', open)
  el.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return
    keyEvent.preventDefault()
    open()
  })
}

function reloadRange() {
  const api = calendarRef.value?.getApi()
  const current = api?.view
  if (!current) return
  const range = rangeFromView(isoDayOf(current.activeStart), isoDayOf(current.activeEnd))
  loadedRange.value = { from: '', to: '' }
  load(range)
}

async function loadDepartments() {
  if (!props.isHr) return
  departmentError.value = ''
  try {
    departments.value = await loadHrDepartments()
  } catch {
    departmentError.value = EMPTY_DEPARTMENTS
  }
}

function onResize() {
  width.value = window.innerWidth
}

onMounted(() => {
  loadDepartments()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <main class="content">
    <div class="head">
      <div>
        <h1 class="title">{{ title }}</h1>
        <p class="sub">
          {{
            props.isHr
              ? 'ใบลาที่อนุมัติแล้วและรออนุมัติของทุกแผนก'
              : 'ใบลาที่อนุมัติแล้วและรออนุมัติของพนักงานในแผนกคุณ'
          }}
          · เลือกรายการเพื่อดูรายละเอียด
        </p>
      </div>

      <label v-if="props.isHr" class="filter">
        <span class="filter-label">แผนก</span>
        <select v-model="departmentId" class="filter-select" @change="reloadRange">
          <option :value="null">ทุกแผนก</option>
          <option v-for="department in departments" :key="department.id" :value="department.id">
            {{ department.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="view-switch" role="group" aria-label="รูปแบบการแสดงผลปฏิทินการลา">
      <button
        type="button"
        class="view-option"
        :class="{ 'is-selected': view === VIEW_CALENDAR }"
        :aria-pressed="view === VIEW_CALENDAR"
        @click="selectView(VIEW_CALENDAR)"
      >
        <span class="view-label">ปฏิทิน</span>
      </button>
      <button
        type="button"
        class="view-option"
        :class="{ 'is-selected': view === VIEW_LIST }"
        :aria-pressed="view === VIEW_LIST"
        @click="selectView(VIEW_LIST)"
      >
        <span class="view-label">รายการ</span>
      </button>
    </div>

    <p v-if="departmentError" class="warning">{{ departmentError }}</p>

    <v-alert v-if="errorMessage" type="error" variant="tonal" class="alert">
      {{ errorMessage }}
    </v-alert>

    <section
      v-show="view === VIEW_CALENDAR"
      class="calendar-card"
      :aria-busy="loading ? 'true' : 'false'"
    >
      <p v-if="loading" class="loading-note">กำลังโหลด…</p>
      <FullCalendar ref="calendarRef" :options="options" />
      <p class="legend">
        <span class="legend-item"><span class="swatch swatch-approved" aria-hidden="true"></span>อนุมัติแล้ว</span>
        <span class="legend-item"><span class="swatch swatch-pending" aria-hidden="true"></span>รออนุมัติ</span>
        <span class="legend-item"><span class="swatch swatch-holiday" aria-hidden="true"></span>วันหยุด</span>
      </p>
    </section>

    <section
      v-if="view === VIEW_LIST"
      class="list-card"
      aria-label="รายการการลา"
      :aria-busy="loading ? 'true' : 'false'"
    >
      <div class="list-nav">
        <button type="button" class="list-nav-button" @click="moveRange('prev')">ก่อนหน้า</button>
        <button type="button" class="list-nav-button" @click="moveRange('next')">ถัดไป</button>
        <button type="button" class="list-nav-button" @click="moveRange('today')">วันนี้</button>
      </div>

      <p v-if="rangeLabel" class="list-range">{{ rangeLabel }}</p>
      <p v-if="loading" class="loading-note">กำลังโหลด…</p>

      <p v-if="errorMessage" class="list-empty">{{ errorMessage }}</p>
      <p v-else-if="!loading && listGroups.length === 0" class="list-empty">
        ไม่มีรายการการลาในช่วงนี้
      </p>

      <ul v-else class="day-list">
        <li v-for="group in listGroups" :key="group.date" :id="'leave-day-' + group.date" class="day-group">
          <h3 class="day-heading">{{ formatThaiDate(group.date) }}</h3>
          <ul class="rows">
            <template v-for="row in group.rows" :key="row.id">
              <li v-if="row.kind === 'holiday'" class="row row-holiday">
                <span class="row-name">{{ row.name || 'วันหยุด' }}</span>
                <span class="status pill-holiday">วันหยุด</span>
              </li>
              <li v-else class="row">
                <span class="row-name">{{ row.employeeName || '—' }}</span>
                <span
                  class="status"
                  :class="row.status === 'pending' ? 'is-pending' : 'is-approved'"
                >
                  {{ statusLabel(row.status) }}
                </span>
                <span class="row-meta">
                  <span class="row-type">{{ row.leaveTypeLabel || '—' }}</span>
                  <span class="row-dates">{{ formatThaiDateRange(row.startDate, row.endDate) }}</span>
                </span>
              </li>
            </template>
          </ul>
        </li>
      </ul>
    </section>

    <div v-if="dayPanel" class="day-panel-layer">
      <div class="day-panel-backdrop" aria-hidden="true" @click="closeDayPanel"></div>
      <section
        ref="dayPanelEl"
        class="day-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-panel-title"
        tabindex="-1"
        @keydown="onDayPanelKeydown"
      >
        <header class="day-panel-head">
          <div>
            <h2 id="day-panel-title" class="day-panel-title">
              {{ formatThaiDayHeading(dayPanel.date) }}
            </h2>
            <p class="day-panel-count">{{ dayCountLabel(dayPanel.rows.length) }}</p>
          </div>
          <button
            ref="dayPanelClose"
            type="button"
            class="day-panel-close"
            aria-label="ปิด"
            @click="closeDayPanel"
          >
            ปิด
          </button>
        </header>

        <div class="day-panel-body">
          <p v-if="dayPanel.rows.length === 0" class="day-panel-empty">
            {{ DAY_PANEL_EMPTY }}
          </p>

          <section
            v-for="group in groupedDayRows"
            :key="group.department"
            class="day-department"
          >
            <h3 class="day-department-name">{{ group.department }}</h3>

            <template v-for="row in group.rows" :key="row.id">
              <button
                type="button"
                class="day-person"
                :aria-expanded="expandedRowId === row.id ? 'true' : 'false'"
                @click="toggleRow(row)"
              >
                <span class="day-person-head">
                  <span class="day-person-name">{{ row.employeeName || '—' }}</span>
                  <span class="day-person-type">{{ row.leaveTypeLabel || '—' }}</span>
                </span>
                <span class="day-person-dates">
                  {{ formatThaiDateRange(row.startDate, row.endDate) }}
                </span>
                <span class="day-person-hint">
                  {{ row.detail ? 'ดูรายละเอียด' : 'รายละเอียดถูกจำกัดตามสิทธิ์' }}
                </span>
              </button>

              <div v-if="expandedRowId === row.id" class="day-person-detail">
                <LeaveRequestDetail v-if="row.detail" :request="toDetailRequest(row)" />
                <p v-else class="day-panel-empty">ไม่มีสิทธิ์ดูรายละเอียดใบลานี้</p>
              </div>
            </template>
          </section>
        </div>
      </section>
    </div>

    <aside
      v-if="selected"
      class="panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="calendar-panel-title"
      @keydown.esc="closePanel"
    >
      <div class="panel-head">
        <h2 id="calendar-panel-title" class="panel-title">{{ selected.employeeName || '—' }}</h2>
        <button ref="panelClose" type="button" class="panel-close" @click="closePanel">ปิด</button>
      </div>

      <dl class="facts">
        <div class="fact">
          <dt>แผนก</dt>
          <dd>{{ selected.departmentName || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>ประเภทการลา</dt>
          <dd>{{ selected.leaveTypeLabel || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>วันที่</dt>
          <dd>{{ formatThaiDateRange(selected.startDate, selected.endDate) }}</dd>
        </div>
        <div class="fact">
          <dt>สถานะ</dt>
          <dd>
            <span class="status" :class="selected.status === 'pending' ? 'is-pending' : 'is-approved'">
              {{ statusLabel(selected.status) }}
            </span>
          </dd>
        </div>
      </dl>
    </aside>
  </main>
</template>

<style scoped>
.content {
  position: relative;
  padding: 8px 0 32px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 12px;
}

.title {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
}

.sub {
  margin: 0;
  font-size: 13px;
  color: #5c7176;
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 180px;
}

.filter-label {
  font-size: 12px;
  font-weight: 600;
  color: #48615e;
}

.filter-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d8e3e1;
  border-radius: 10px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 14px;
}

.filter-select:focus-visible,
.panel-close:focus-visible {
  outline: 3px solid #10504e;
  outline-offset: 2px;
}

/* The ปฏิทิน / รายการ switch, directly under the title. */
.view-switch {
  display: inline-flex;
  gap: 4px;
  margin: 0 0 12px;
  padding: 4px;
  background: #f0f5f4;
  border: 1px solid #e2e9e7;
  border-radius: 12px;
}

.view-option {
  min-height: 44px;
  min-width: 88px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: #48615e;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.view-option:hover {
  background: #ffffff;
  color: #10504e;
}

.view-option.is-selected {
  background: #10504e;
  border-color: #10504e;
  color: #ffffff;
}

.view-option:focus-visible {
  outline: 3px solid #10504e;
  outline-offset: 2px;
}

.warning {
  margin: 0 0 8px;
  color: #b45309;
  font-size: 13px;
}

.alert {
  margin-bottom: 12px;
}

.calendar-card,
.list-card {
  background: #ffffff;
  border: 1px solid #e2e9e7;
  border-radius: 16px;
  padding: 12px;
  overflow: hidden;
}

.loading-note {
  margin: 0 0 8px;
  color: #5c7176;
  font-size: 13px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 10px 0 0;
  font-size: 12px;
  color: #48615e;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  display: inline-block;
}

.swatch-approved {
  background: #10504e;
}

.swatch-pending {
  background: #fef3c7;
  border: 1px solid #f59e0b;
}

.swatch-holiday {
  background: #e7f2f0;
  border: 1px dashed #9ec9c4;
}

/* List view */
.list-nav {
  display: flex;
  gap: 8px;
}

.list-nav-button {
  flex: 1 1 0;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid #d8e3e1;
  border-radius: 10px;
  background: #ffffff;
  color: #10504e;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.list-nav-button:hover {
  background: #f0f7f6;
  border-color: #c8dcd9;
}

.list-nav-button:focus-visible {
  outline: 3px solid #10504e;
  outline-offset: 2px;
}

.list-range {
  margin: 8px 0 0;
  font-size: 12px;
  color: #5c7176;
}

.list-empty {
  margin: 16px 0 4px;
  text-align: center;
  font-size: 13px;
  color: #5c7176;
}

.day-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 16px;
}

.day-group {
  display: grid;
  gap: 6px;
  scroll-margin-top: 76px;
}

.day-heading {
  margin: 0;
  padding: 0 2px;
  font-size: 13px;
  font-weight: 700;
  color: #10504e;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 8px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e2e9e7;
  border-radius: 12px;
  background: #fbfdfc;
}

.row-name {
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.row-meta {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  font-size: 12px;
  color: #48615e;
}

.row-dates {
  color: #5c7176;
}

.row-holiday {
  background: #f2f8f7;
  border-style: dashed;
  border-color: #9ec9c4;
}

.pill-holiday {
  background: #e7f2f0;
  color: #10504e;
  border: 1px dashed #9ec9c4;
}

:deep(.fc) {
  --fc-border-color: #e2e9e7;
  --fc-today-bg-color: #f0f7f6;
  --fc-page-bg-color: #ffffff;
  --fc-neutral-bg-color: #f7faf9;
  font-family: inherit;
  color: #12343b;
}

:deep(.fc .fc-toolbar-title) {
  font-size: 18px;
  font-weight: 700;
  color: #12343b;
}

:deep(.fc .fc-button-primary) {
  background: #ffffff;
  border-color: #d8e3e1;
  color: #10504e;
  text-transform: none;
  font-weight: 600;
  font-family: inherit;
}

:deep(.fc .fc-button-primary:not(:disabled):hover) {
  background: #f0f7f6;
  border-color: #c8dcd9;
  color: #10504e;
}

:deep(.fc .fc-button-primary:not(:disabled).fc-button-active),
:deep(.fc .fc-button-primary:not(:disabled):active) {
  background: #10504e;
  border-color: #10504e;
  color: #ffffff;
}

:deep(.fc .fc-button:focus-visible),
:deep(.fc-event:focus-visible) {
  outline: 3px solid #10504e;
  outline-offset: 2px;
  box-shadow: none;
}

:deep(.fc-event) {
  cursor: pointer;
  border-radius: 8px;
  padding: 2px 6px;
  font-size: 12px;
  font-weight: 600;
  border-width: 1px;
}

:deep(.fc-event.holiday-event) {
  border-style: dashed;
  font-weight: 600;
}

/* The narrow-grid event: a dot, with the text still in its aria-label. */
.panel {
  position: fixed;
  top: 96px;
  right: 16px;
  width: min(340px, calc(100vw - 32px));
  background: #ffffff;
  border: 1px solid #e2e9e7;
  border-radius: 16px;
  box-shadow: 0 18px 40px -18px rgba(15, 33, 55, 0.35);
  padding: 16px;
  z-index: 80;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.panel-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.panel-close {
  border: 1px solid #d8e3e1;
  background: #ffffff;
  border-radius: 10px;
  padding: 4px 10px;
  font-family: inherit;
  font-size: 13px;
  color: #48615e;
  cursor: pointer;
}

.facts {
  margin: 0;
  display: grid;
  gap: 8px;
}

.fact {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px;
  font-size: 13px;
}

.fact dt {
  color: #5c7176;
}

.fact dd {
  margin: 0;
  color: #12343b;
  font-weight: 600;
}

.status {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.is-approved {
  background: #e7f2f0;
  color: #10504e;
}

.is-pending {
  background: #fef3c7;
  color: #7c2d12;
}

/* Phones: keep the month grid but make it fit 360px without scrolling. */
@media (max-width: 720px) {
  .calendar-card {
    padding: 8px;
  }

  .view-switch {
    display: flex;
    width: 100%;
  }

  .view-option {
    flex: 1 1 0;
    min-width: 0;
  }

  /* Two rows on phones: the month title, then the buttons sharing one row, so
     nothing is squeezed at 360px. */
  :deep(.fc .fc-toolbar) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  :deep(.fc .fc-toolbar-chunk) {
    display: flex;
    justify-content: center;
    gap: 6px;
  }

  :deep(.fc .fc-toolbar-chunk:nth-child(2)) {
    grid-row: 1;
    grid-column: 1 / -1;
  }

  :deep(.fc .fc-toolbar-title) {
    font-size: 16px;
  }

  :deep(.fc .fc-button) {
    padding: 0.35em 0.55em;
    font-size: 12px;
  }

  :deep(.fc .fc-col-header-cell-cushion) {
    padding: 4px 2px;
    font-size: 11px;
  }

  :deep(.fc .fc-daygrid-day-number) {
    padding: 3px 5px;
    font-size: 12px;
  }

  :deep(.fc .fc-daygrid-day-frame) {
    min-height: 46px;
  }

  :deep(.fc .fc-daygrid-day-events) {
    margin-top: 2px;
  }

  :deep(.fc .fc-daygrid-event-harness) {
    margin-top: 2px;
  }

  /* Each event is a 10px dot keeping its status colour from the grid. */
  :deep(.fc .fc-daygrid-event) {
    width: 10px;
    height: 10px;
    margin: 3px auto 0;
    padding: 0;
    border-radius: 999px;
    overflow: hidden;
  }

  :deep(.fc .fc-daygrid-event:focus-visible) {
    outline: 3px solid #10504e;
    outline-offset: 2px;
    box-shadow: none;
  }

  :deep(.fc .fc-daygrid-more-link) {
    font-size: 11px;
  }

  :deep(.fc .fc-daygrid-day) {
    cursor: pointer;
  }

  :deep(.fc .fc-daygrid-day:focus-visible) {
    outline: 3px solid #10504e;
    outline-offset: -3px;
    box-shadow: none;
  }
}

@media (max-width: 640px) {
  .panel {
    top: auto;
    right: 0;
    left: 0;
    bottom: 0;
    width: auto;
    border-radius: 16px 16px 0 0;
    max-height: 70vh;
    overflow: auto;
  }

  .title {
    font-size: 20px;
  }
}

/* ---------- Day panel: bottom sheet on phones, centred dialog above ---------- */
.day-panel-layer {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.day-panel-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(11, 28, 24, 0.45);
}

.day-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 80vh;
  overflow: hidden;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 24px 60px -24px rgba(11, 28, 24, 0.55);
}

.day-panel:focus {
  outline: none;
}

.day-panel-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid #e2e9e7;
  background: #ffffff;
}

.day-panel-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.4;
  color: #12343b;
  overflow-wrap: anywhere;
}

.day-panel-count {
  margin: 4px 0 0;
  font-size: 13px;
  color: #48615e;
}

.day-panel-close {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid #d8e3e1;
  border-radius: 10px;
  background: #f3f8f6;
  color: #10504e;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.day-panel-close:focus-visible,
.day-person:focus-visible {
  outline: 3px solid #10504e;
  outline-offset: 2px;
}

.day-panel-body {
  display: grid;
  gap: 16px;
  padding: 12px 16px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.day-panel-empty {
  margin: 8px 0;
  text-align: center;
  font-size: 13px;
  color: #5c7176;
}

.day-department {
  display: grid;
  gap: 8px;
}

.day-department-name {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #10504e;
}

.day-person {
  display: grid;
  gap: 2px;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #e2e9e7;
  border-radius: 12px;
  background: #fbfdfc;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.day-person-head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}

.day-person-name {
  font-size: 14px;
  font-weight: 700;
  color: #12343b;
  overflow-wrap: anywhere;
}

.day-person-type {
  font-size: 12px;
  color: #48615e;
}

.day-person-dates {
  font-size: 12px;
  color: #5c7176;
}

.day-person-hint {
  font-size: 12px;
  font-weight: 600;
  color: #10504e;
}

.day-person-detail {
  margin-bottom: 4px;
}

/* Approved people on the day, as a small badge the cell cannot overflow. */
.day-count {
  position: absolute;
  left: 3px;
  top: 2px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 999px;
  background: #10504e;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}

:deep(.fc-daygrid-day-frame) {
  position: relative;
}

@media (max-width: 767px) {
  .day-panel-layer {
    align-items: flex-end;
    padding: 0;
  }

  .day-panel {
    width: 100%;
    max-height: 80vh;
    border-radius: 16px 16px 0 0;
    animation: day-panel-rise 0.22s ease-out;
  }
}

@keyframes day-panel-rise {
  from {
    opacity: 0.6;
    transform: translateY(12%);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .view-option,
  .list-nav-button {
    transition: none;
  }

  .day-group {
    scroll-behavior: auto;
  }

  .day-panel {
    animation: none !important;
  }
}
</style>
