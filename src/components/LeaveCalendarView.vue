<script setup>
// The calendar itself. It is layout-free on purpose: LeaveCalendarPage puts it
// inside the shared app layout (employee/approver or the HR shell).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import thLocale from '@fullcalendar/core/locales/th'

import { formatThaiDateRange } from '../lib/thai-date.js'
import {
  NARROW_VIEW_WIDTH,
  calendarTitle,
  eventColors,
  eventTitle,
  initialCalendarView,
  rangeFromView,
  statusLabel,
  toExclusiveEnd,
} from '../lib/leave-calendar.js'
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
const title = ref('ปฏิทินการลา')
const selected = ref(null)
const panelClose = ref(null)
const departmentId = ref(null)
const departments = ref([])
const width = ref(typeof window === 'undefined' ? 1024 : window.innerWidth)
const loadedRange = ref({ from: '', to: '' })

const isNarrow = computed(() => width.value < NARROW_VIEW_WIDTH)

const options = computed(() => ({
  plugins: [dayGridPlugin, listPlugin],
  initialView: initialCalendarView(width.value),
  locale: thLocale,
  firstDay: 0,
  height: 'auto',
  dayMaxEvents: true,
  noEventsText: 'ไม่มีรายการลาในช่วงนี้',
  headerToolbar: isNarrow.value
    ? { left: 'prev,next', center: 'title', right: 'today' }
    : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listWeek' },
  buttonText: {
    today: 'วันนี้',
    month: 'เดือน',
    week: 'สัปดาห์',
    list: 'รายการ',
    prev: 'ก่อนหน้า',
    next: 'ถัดไป',
  },
  events: events.value,
  eventDisplay: 'block',
  eventClick: (info) => {
    if (info.event.extendedProps?.kind === 'holiday') return
    openPanel(info.event)
  },
  eventDidMount: decorateEvent,
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

    const holidays = Array.isArray(holidayData?.holidays) ? holidayData.holidays : []

    events.value = [
      ...calendarData.events.map(toCalendarEvent),
      ...holidays.map(toHolidayEvent),
    ]
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
    events.value = []
  } finally {
    loading.value = false
  }
}

function onDatesSet(info) {
  const range = rangeFromView(info.startStr, info.endStr)
  const current = info.view?.currentStart ?? info.start
  title.value = calendarTitle(
    current instanceof Date ? current.toISOString().slice(0, 10) : info.startStr
  )
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

function reloadRange() {
  const api = calendarRef.value?.getApi()
  const view = api?.view
  if (!view) return
  const range = rangeFromView(
    view.activeStart.toISOString().slice(0, 10),
    view.activeEnd.toISOString().slice(0, 10)
  )
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
  const wasNarrow = width.value < NARROW_VIEW_WIDTH
  width.value = window.innerWidth
  const nowNarrow = width.value < NARROW_VIEW_WIDTH
  if (wasNarrow !== nowNarrow) {
    calendarRef.value?.getApi()?.changeView(initialCalendarView(width.value))
  }
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

    <p v-if="departmentError" class="warning">{{ departmentError }}</p>

    <v-alert v-if="errorMessage" type="error" variant="tonal" class="alert">
      {{ errorMessage }}
    </v-alert>

    <section class="calendar-card" :aria-busy="loading ? 'true' : 'false'">
      <p v-if="loading" class="loading-note">กำลังโหลด…</p>
      <FullCalendar ref="calendarRef" :options="options" />
      <p class="legend">
        <span class="legend-item"><span class="swatch swatch-approved" aria-hidden="true"></span>อนุมัติแล้ว</span>
        <span class="legend-item"><span class="swatch swatch-pending" aria-hidden="true"></span>รออนุมัติ</span>
        <span class="legend-item"><span class="swatch swatch-holiday" aria-hidden="true"></span>วันหยุด</span>
      </p>
    </section>

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

.warning {
  margin: 0 0 8px;
  color: #b45309;
  font-size: 13px;
}

.alert {
  margin-bottom: 12px;
}

.calendar-card {
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
</style>
