<script setup>
import { computed, reactive, ref } from 'vue'


const LOAD_ERROR_MESSAGE = 'ไม่สามารถโหลดแดชบอร์ดได้ กรุณาลองใหม่'
const DEPT_ERROR_MESSAGE = 'ไม่สามารถโหลดรายชื่อแผนกได้ กรุณาลองใหม่'
const REASON_ERROR_MESSAGE = 'ไม่สามารถดูเหตุผลได้ กรุณาลองใหม่'
const PIN_FORMAT_MESSAGE = 'กรอก PIN เป็นตัวเลข 6 หลัก'
const NO_DATA_MESSAGE = 'ยังไม่มีข้อมูลในระบบ'
const EMPTY_DEPT_MESSAGE = 'ไม่มีรายชื่อในแผนกนี้'
const NO_REASON_TEXT = 'ไม่ระบุเหตุผล'
const DASH = '-'
const REASON_STATUSES = ['ติดงานด่วน', 'ลาประชุม']
const NOT_YET_LABEL = 'ยังไม่ลงทะเบียน'
const STATUS_TONE = {
  เข้าร่วมประชุม: 'ok',
  ไม่เข้าร่วม: 'muted',
  ติดงานด่วน: 'warn',
  ลาประชุม: 'info',
  [NOT_YET_LABEL]: 'muted',
}
const TONES = ['ok', 'muted', 'warn', 'info']
const TABS = [
  { code: 'sup', label: 'ประชุมหัวหน้างาน' },
  { code: 'monthly', label: 'ประชุม Monthly' },
]
const MODES = [
  { key: 'day', label: 'วัน' },
  { key: 'month', label: 'เดือน' },
  { key: 'year', label: 'ปี' },
]
const TOP_STATUS_LABEL = {
  not_attended: 'ไม่เข้าร่วม',
  urgent_busy: 'ติดงานด่วน',
  leave: 'ลาประชุม',
}

const code = ref('sup')
const mode = ref('day')
const value = ref('')
const cycleOptions = ref([])
const dash = ref(null)
const loading = ref(true)
const errorMessage = ref('')
const updatedText = ref('')

const drawer = reactive({ open: false, loading: false, error: '', dept: '', data: null })
let deptRequestId = 0
const pinForm = reactive({ open: false, employeeId: '', name: '', pin: '', busy: false, error: '' })
const reasons = reactive({})

const monthly = reactive({ month: '', options: [], loading: false, error: '', data: null })

const STATUS_ICON = { เข้าร่วมประชุม: 'check_circle', ไม่เข้าร่วม: 'cancel', ติดงานด่วน: 'engineering', ลาประชุม: 'event_busy' }
const SHORT_LABEL = { เข้าร่วมประชุม: 'เข้าร่วม', ไม่เข้าร่วม: 'ไม่เข้า', ติดงานด่วน: 'งานด่วน', ลาประชุม: 'ลา' }
const DONUT_COLORS = { ok: '#006b56', muted: '#bfc9c4', warn: '#eec14b', info: '#90d4c0' }
const QUORUM_TARGET = 80
const DONUT_C = 2 * Math.PI * 40
const GAUGE_C = 2 * Math.PI * 32

const registeredCount = computed(() => dash.value?.today?.registered ?? 0)
const rosterCount = computed(() => dash.value?.rosterCount ?? 0)
const registeredPct = computed(() =>
  rosterCount.value ? Math.round((registeredCount.value / rosterCount.value) * 1000) / 10 : 0,
)
const quorumOk = computed(() => registeredPct.value > QUORUM_TARGET)
const gaugeOffset = computed(() => GAUGE_C * (1 - Math.min(registeredPct.value, 100) / 100))

function countOf(label) {
  return dash.value?.today?.byStatus?.[label] ?? 0
}

function shareOf(count, base) {
  return base ? Math.round((count / base) * 1000) / 10 : 0
}

function segWidth(count) {
  return rosterCount.value ? `${(count / rosterCount.value) * 100}%` : '0%'
}

function isCurrentCycle(cycle) {
  return currentIsThisPeriod.value && cycle.key === (dash.value?.current?.key ?? '')
}

const donutSegments = computed(() => {
  const labels = dash.value?.statuses ?? []
  const total = labels.reduce((sum, label) => sum + countOf(label), 0)
  let consumed = 0
  return labels.map((label) => {
    const count = countOf(label)
    const length = total ? (count / total) * DONUT_C : 0
    const seg = { label, count, tone: toneOfStatus(label), length, offset: -consumed }
    consumed += length
    return seg
  })
})

const historyOptions = computed(() =>
  cycleOptions.value.length > 0 ? cycleOptions.value : dash.value?.history?.options ?? [],
)

const maxTotal = computed(() => {
  const cycles = dash.value?.history?.cycles ?? []
  return cycles.reduce((max, cycle) => Math.max(max, cycle.total ?? 0), 0)
})

const currentIsThisPeriod = computed(() => {
  const key = dash.value?.current?.key ?? ''
  const todayKey = dash.value?.todayKey ?? ''
  if (!key || !todayKey) return false
  return code.value === 'monthly' ? key === todayKey.slice(0, 7) : key === todayKey
})

const cycleHeading = computed(() => {
  const current = dash.value?.current ?? null
  if (!current) return ''
  if (!current.key) return current.label ?? ''
  if (currentIsThisPeriod.value) return code.value === 'monthly' ? 'เดือนนี้' : 'วันนี้'
  return `รอบล่าสุด: ${current.label}`
})

const peopleGroups = computed(() => {
  const people = drawer.data?.people ?? []
  const statuses = [...(dash.value?.statuses ?? []), NOT_YET_LABEL]
  return statuses
    .map((status) => ({
      status,
      people: people.filter((person) => person.status === status),
    }))
    .filter((group) => group.people.length > 0)
})

const topByDept = computed(() => {
  const entries = monthly.data?.top ?? []
  const groups = []
  const byName = new Map()
  for (const entry of entries) {
    const group = byName.get(entry.dept) ?? { name: entry.dept, cells: [] }
    group.cells.push(entry)
    byName.set(entry.dept, group)
  }
  for (const name of [...byName.keys()].sort((a, b) => a.localeCompare(b, 'th'))) {
    groups.push(byName.get(name))
  }
  return groups
})

async function requestJson(method, url, body) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  return { ok: response.ok, data }
}

function formatUpdated(iso) {
  if (typeof iso !== 'string' || iso.length === 0) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const day = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
  return `${day} · ${time} น.`
}

function percent(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value) || value <= 0) return '0%'
  const clamped = Math.min(value, 1)
  return `${Math.round(clamped * 1000) / 10}%`
}

function toneOfStatus(label) {
  return STATUS_TONE[label] ?? 'muted'
}

function segmentsOf(cycle) {
  const counts = cycle?.counts ?? {}
  const statuses = dash.value?.statuses ?? []
  return statuses.map((label, index) => ({
    key: TONES[index] ?? 'muted',
    label,
    count: counts[
      ['attended', 'not_attended', 'urgent_busy', 'leave'][index]
    ] ?? 0,
  }))
}

function barHeight(total) {
  if (!maxTotal.value || !total) return '0%'
  return `${Math.max((total / maxTotal.value) * 100, 3)}%`
}

async function loadCycleOptions() {
  try {
    const { ok, data } = await requestJson(
      'GET',
      `/api/meeting/dashboard/cycles?code=${encodeURIComponent(code.value)}`,
    )
    cycleOptions.value = ok && data.ok === true && Array.isArray(data.options) ? data.options : []
  } catch {
    cycleOptions.value = []
  }
}

async function loadDashboard() {
  loading.value = true
  errorMessage.value = ''
  await loadCycleOptions()
  try {
    const params = new URLSearchParams({ code: code.value, mode: mode.value })
    if (value.value) params.set('value', value.value)
    const { ok, data } = await requestJson('GET', `/api/meeting/dashboard?${params.toString()}`)
    if (!ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR_MESSAGE
      return
    }
    dash.value = data
    updatedText.value = formatUpdated(data.updated)
    const selected = drawer.dept || data.depts?.[0]?.name || ''
    if (selected) await openDept(selected)
  } catch {
    errorMessage.value = LOAD_ERROR_MESSAGE
  } finally {
    loading.value = false
  }
}

function clearReasons() {
  for (const key of Object.keys(reasons)) delete reasons[key]
}

async function selectTab(next) {
  if (code.value === next) return
  code.value = next
  mode.value = 'day'
  value.value = ''
  dash.value = null
  clearReasons()
  closeDrawer()
  closeReason()
  await loadDashboard()
  if (next === 'monthly') {
    await loadMonthlyOptions()
    await loadMonthlySummary()
  }
}

async function selectMode(next) {
  if (mode.value === next) return
  mode.value = next
  value.value = ''
  await loadDashboard()
}

async function selectCycle() {
  clearReasons()
  await loadDashboard()
}

function drawerCycleKey() {
  const currentKey = dash.value?.current?.key ?? ''
  if (currentKey) return currentKey
  const todayKey = dash.value?.todayKey ?? ''
  if (!todayKey) return ''
  return code.value === 'monthly' ? todayKey.slice(0, 7) : todayKey
}

async function openDept(deptName) {
  const cycle = drawerCycleKey()
  if (!cycle) return

  const requestId = ++deptRequestId
  drawer.open = true
  drawer.loading = true
  drawer.error = ''
  drawer.dept = deptName
  drawer.data = null

  const isStale = () => requestId !== deptRequestId || drawer.dept !== deptName

  try {
    const params = new URLSearchParams({ code: code.value, cycle, dept: deptName })
    const { ok, data } = await requestJson('GET', `/api/meeting/dashboard/dept?${params.toString()}`)
    if (isStale()) return
    if (!ok || data.ok !== true) {
      drawer.error = typeof data.message === 'string' ? data.message : DEPT_ERROR_MESSAGE
      return
    }
    drawer.data = data
  } catch {
    if (isStale()) return
    drawer.error = DEPT_ERROR_MESSAGE
  } finally {
    if (!isStale()) drawer.loading = false
  }
}

function closeDrawer() {
  deptRequestId += 1
  drawer.open = false
  drawer.loading = false
  drawer.error = ''
  drawer.dept = ''
  drawer.data = null
}

function openReason(person) {
  pinForm.open = true
  pinForm.employeeId = person.employeeId
  pinForm.name = person.name
  pinForm.pin = ''
  pinForm.busy = false
  pinForm.error = ''
}

function closeReason() {
  pinForm.open = false
  pinForm.employeeId = ''
  pinForm.name = ''
  pinForm.pin = ''
  pinForm.busy = false
  pinForm.error = ''
}

function sanitizePin() {
  pinForm.pin = String(pinForm.pin ?? '').replace(/\D/g, '').slice(0, 6)
}

async function submitReason() {
  if (pinForm.busy) return
  pinForm.error = ''
  if (!/^\d{6}$/.test(pinForm.pin)) {
    pinForm.error = PIN_FORMAT_MESSAGE
    return
  }
  const cycle = dash.value?.current?.key
  if (!cycle) return

  const employeeId = pinForm.employeeId
  pinForm.busy = true
  try {
    const { ok, data } = await requestJson('POST', '/api/meeting/dashboard/reason', {
      pin: pinForm.pin,
      code: code.value,
      cycle,
      employeeId,
    })
    if (!ok || data.ok !== true) {
      pinForm.error = typeof data.message === 'string' ? data.message : REASON_ERROR_MESSAGE
      return
    }
    reasons[employeeId] = { text: data.reason || NO_REASON_TEXT, status: data.status }
    closeReason()
  } catch {
    pinForm.error = REASON_ERROR_MESSAGE
  } finally {
    pinForm.pin = ''
    pinForm.busy = false
  }
}

async function loadMonthlyOptions() {
  try {
    const { ok, data } = await requestJson('GET', '/api/meeting/dashboard/cycles?code=monthly')
    if (!ok || data.ok !== true) return
    monthly.options = Array.isArray(data.options) ? data.options : []
    if (!monthly.month && monthly.options.length > 0) {
      const fromDashboard = dash.value?.current?.key ?? ''
      const match = monthly.options.find((option) => option.key === fromDashboard)
      monthly.month = match ? match.key : monthly.options[monthly.options.length - 1].key
    }
  } catch {
    monthly.options = []
  }
}

async function loadMonthlySummary() {
  if (!monthly.month) {
    monthly.data = null
    return
  }
  monthly.loading = true
  monthly.error = ''
  try {
    const params = new URLSearchParams({ month: monthly.month })
    const { ok, data } = await requestJson(
      'GET',
      `/api/meeting/dashboard/monthly-summary?${params.toString()}`,
    )
    if (!ok || data.ok !== true) {
      monthly.error = typeof data.message === 'string' ? data.message : LOAD_ERROR_MESSAGE
      monthly.data = null
      return
    }
    monthly.data = data
  } catch {
    monthly.error = LOAD_ERROR_MESSAGE
    monthly.data = null
  } finally {
    monthly.loading = false
  }
}

async function refresh() {
  clearReasons()
  await loadDashboard()
  if (code.value === 'monthly') await loadMonthlySummary()
}

async function selectMonth() {
  await loadMonthlySummary()
}

loadDashboard()
</script>

<template>
      <main class="page-main">
        <RouterLink to="/meeting/controller" class="back-link">
          <span class="material-symbols-outlined back-icon">arrow_back</span>
          กลับหน้าหลัก
        </RouterLink>

        <div class="page-head fade-up">
          <div class="page-head-text">
            <h1>แดชบอร์ดการเข้าประชุม</h1>
            <p class="updated">
              <span class="pulse-dot"></span>
              อัปเดตล่าสุด {{ updatedText || DASH }}
            </p>
          </div>
          <button type="button" class="btn btn-primary" :disabled="loading" @click="refresh">
            <span class="material-symbols-outlined btn-icon" :class="{ spin: loading }">refresh</span>
            {{ loading ? 'กำลังโหลด…' : 'รีเฟรช' }}
          </button>
        </div>

        <div class="tabs fade-up delay-1" role="tablist">
          <button
            v-for="tab in TABS"
            :key="tab.code"
            type="button"
            role="tab"
            class="tab"
            :class="{ 'tab-active': code === tab.code }"
            :aria-selected="code === tab.code"
            @click="selectTab(tab.code)"
          >
            {{ tab.label }}
          </button>
        </div>

        <p v-if="errorMessage" class="alert" role="alert">{{ errorMessage }}</p>

        <div v-if="loading && !dash" class="state-box">กำลังโหลดข้อมูล…</div>

        <div v-else-if="dash" class="layout">
          <div class="col-main">
            <!-- Current cycle: counts, donut, quorum gauge -->
            <section class="card fade-up delay-1">
              <div class="card-head">
                <div class="card-head-left">
                  <span v-if="currentIsThisPeriod" class="badge-today">วันนี้</span>
                  <h2 class="card-title">{{ cycleHeading }}</h2>
                </div>
                <span class="period-tag">{{ dash.meeting.periodLabel }}</span>
              </div>

              <p v-if="dash.history.empty" class="empty-text">{{ NO_DATA_MESSAGE }}</p>

              <template v-else>
                <div class="metric-grid">
                  <div
                    v-for="label in dash.statuses"
                    :key="label"
                    class="metric"
                    :class="`tone-${toneOfStatus(label)}`"
                  >
                    <div class="metric-top">
                      <span class="metric-label">{{ label }}</span>
                      <span class="metric-icon material-symbols-outlined">{{ STATUS_ICON[label] ?? 'circle' }}</span>
                    </div>
                    <div class="metric-value-row">
                      <span class="metric-value">{{ countOf(label) }}</span>
                      <span class="metric-unit">คน</span>
                      <span class="metric-share">{{ shareOf(countOf(label), registeredCount) }}%</span>
                    </div>
                  </div>
                </div>

                <div class="donut-row">
                  <div class="donut-card">
                    <div class="donut">
                      <svg viewBox="0 0 100 100" class="donut-svg" aria-hidden="true">
                        <circle cx="50" cy="50" r="40" fill="none" stroke-width="12" class="donut-track" />
                        <circle
                          v-for="seg in donutSegments"
                          :key="seg.label"
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke-width="12"
                          :stroke="DONUT_COLORS[seg.tone]"
                          :stroke-dasharray="`${seg.length} ${DONUT_C}`"
                          :stroke-dashoffset="seg.offset"
                        />
                      </svg>
                      <div class="donut-center">
                        <span class="donut-num">{{ registeredCount }}</span>
                        <span class="donut-sub">ยืนยันแล้ว</span>
                      </div>
                    </div>
                    <div class="donut-legend">
                      <div class="legend-head">
                        <span>สัดส่วนผู้แจ้งสถานะรอบนี้</span>
                        <span>{{ registeredCount }} คน</span>
                      </div>
                      <div v-for="seg in donutSegments" :key="seg.label" class="legend-row">
                        <span class="legend-dot" :style="{ background: DONUT_COLORS[seg.tone] }"></span>
                        <span class="legend-label">{{ seg.label }}</span>
                        <span class="legend-value">
                          {{ shareOf(seg.count, registeredCount) }}% <em>({{ seg.count }})</em>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div class="quorum-card">
                    <div class="quorum-text">
                      <span class="quorum-title">
                        <span class="material-symbols-outlined">verified_user</span>
                        อัตราลงทะเบียนรวม
                      </span>
                      <span class="quorum-sub">{{ registeredCount }} จากทั้งหมด {{ rosterCount }} คน</span>
                      <span class="quorum-badge" :class="{ 'is-ok': quorumOk }">
                        {{ quorumOk ? 'ครบองค์ประชุม' : 'ยังไม่ครบองค์ประชุม' }}
                      </span>
                    </div>
                    <div class="gauge">
                      <svg viewBox="0 0 80 80" class="gauge-svg" aria-hidden="true">
                        <circle cx="40" cy="40" r="32" fill="none" stroke-width="8" class="gauge-track" />
                        <circle
                          cx="40"
                          cy="40"
                          r="32"
                          fill="none"
                          stroke-width="8"
                          stroke-linecap="round"
                          class="gauge-fill"
                          :stroke-dasharray="GAUGE_C"
                          :stroke-dashoffset="gaugeOffset"
                        />
                      </svg>
                      <div class="gauge-center">
                        <span class="gauge-num">{{ registeredPct }}%</span>
                        <span class="gauge-target">เป้าหมาย &gt;{{ QUORUM_TARGET }}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="summary-banner">
                  <div class="summary-main">
                    <span class="pulse-dot"></span>
                    <span>ลงทะเบียนแล้ว {{ registeredCount }} / {{ rosterCount }} คน</span>
                    <span class="summary-pct">({{ registeredPct }}% ของทั้งหมด)</span>
                  </div>
                  <div class="summary-pending">
                    <span class="material-symbols-outlined">pending</span>
                    ยังไม่ลงทะเบียน {{ dash.today.notYet }} คน
                  </div>
                </div>
              </template>
            </section>

            <!-- Department overview -->
            <section class="card fade-up delay-2">
              <div class="card-head">
                <div class="card-head-left">
                  <h3 class="card-title">ภาพรวมตามแผนก</h3>
                  <span class="count-tag">{{ dash.depts.length }} แผนก</span>
                </div>
                <span class="hint">
                  <span class="material-symbols-outlined">touch_app</span>
                  คลิกแถวเพื่อดูรายละเอียด
                </span>
              </div>

              <p v-if="!dash.depts.length" class="empty-text">{{ NO_DATA_MESSAGE }}</p>

              <div v-else class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">แผนก</th>
                      <th scope="col">ลงทะเบียน / ทั้งหมด</th>
                      <th scope="col">ยังไม่ลงทะเบียน</th>
                      <th scope="col">อัตราเข้าร่วม</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in dash.depts"
                      :key="row.name"
                      class="row-click"
                      :class="{ 'row-active': drawer.dept === row.name }"
                      tabindex="0"
                      @click="openDept(row.name)"
                      @keydown.enter="openDept(row.name)"
                    >
                      <td class="cell-name">
                        <span class="dept-dot"></span>
                        {{ row.name }}
                      </td>
                      <td class="cell-num" data-label="ลงทะเบียน / ทั้งหมด">
                        {{ row.registered }} / {{ row.total }}
                      </td>
                      <td data-label="ยังไม่ลงทะเบียน">
                        <span class="pill" :class="row.notYet > 0 ? 'pill-error' : 'pill-muted'">
                          {{ row.notYet }} คน
                        </span>
                      </td>
                      <td data-label="อัตราเข้าร่วม">
                        <div class="rate">
                          <span class="rate-track">
                            <span class="rate-fill" :style="{ width: percent(row.rate) }"></span>
                          </span>
                          <span class="rate-text">{{ percent(row.rate) }}</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <!-- History -->
            <section class="card fade-up delay-3">
              <div class="card-head wrap">
                <div class="card-head-left column">
                  <h3 class="card-title">ประวัติย้อนหลัง</h3>
                  <span class="card-sub">แนวโน้มองค์ประกอบผู้เข้าร่วมแต่ละรอบการประชุม</span>
                </div>
                <div class="history-tools">
                  <select v-model="value" class="select" aria-label="เลือกรอบ" @change="selectCycle">
                    <option value="">รอบล่าสุด</option>
                    <option v-for="option in historyOptions" :key="option.key" :value="option.key">
                      {{ option.label }}
                    </option>
                  </select>
                  <div class="mode-group" role="group" aria-label="มุมมองประวัติ">
                    <button
                      v-for="item in MODES"
                      :key="item.key"
                      type="button"
                      class="mode-btn"
                      :class="{ 'mode-active': mode === item.key }"
                      @click="selectMode(item.key)"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </div>
              </div>

              <div class="history-legend">
                <span v-for="(label, index) in dash.statuses" :key="label" class="legend-chip">
                  <span class="legend-swatch" :class="`seg-${TONES[index] ?? 'muted'}`"></span>{{ label }}
                </span>
              </div>

              <p v-if="dash.history.empty || !dash.history.cycles.length" class="empty-text">
                {{ NO_DATA_MESSAGE }}
              </p>

              <div v-else class="history-list">
                <div v-for="cycle in dash.history.cycles" :key="cycle.key" class="history-row">
                  <div class="history-label">
                    <span>{{ cycle.label }}</span>
                    <span v-if="isCurrentCycle(cycle)" class="badge-today small">วันนี้</span>
                  </div>
                  <div class="history-track">
                    <div
                      v-for="segment in segmentsOf(cycle)"
                      :key="segment.key"
                      class="history-seg"
                      :class="`seg-${segment.key}`"
                      :style="{ width: segWidth(segment.count) }"
                      :title="`${segment.label} ${segment.count}`"
                    >
                      <span v-if="segment.count > 0">{{ segment.count }}</span>
                    </div>
                  </div>
                  <div class="history-total">{{ cycle.total }}/{{ rosterCount }}</div>
                </div>
              </div>

              <p class="note">ประวัติจะแสดงข้อมูลหลังนำเข้าข้อมูลย้อนหลังแล้วเท่านั้น</p>
            </section>

            <!-- Monthly summary -->
            <section v-if="code === 'monthly'" class="card fade-up delay-3">
              <div class="card-head">
                <div class="card-head-left">
                  <h2 class="card-title">สรุปรายเดือน</h2>
                  <span v-if="monthly.data" class="count-tag">{{ monthly.data.totalMeetings }} ครั้ง</span>
                </div>
              </div>

              <label class="field">
                <span class="field-label">เดือน</span>
                <select v-model="monthly.month" class="select" @change="selectMonth">
                  <option v-if="!monthly.options.length" value="">{{ DASH }}</option>
                  <option v-for="option in monthly.options" :key="option.key" :value="option.key">
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <p v-if="monthly.error" class="inline-error" role="alert">{{ monthly.error }}</p>
              <div v-else-if="monthly.loading" class="state-box">กำลังโหลด…</div>
              <p v-else-if="!monthly.data" class="empty-text">{{ NO_DATA_MESSAGE }}</p>

              <template v-else>
                <p v-if="!monthly.data.depts.length" class="empty-text">{{ NO_DATA_MESSAGE }}</p>

                <div v-else class="table-wrap">
                  <table class="table table-wide">
                    <thead>
                      <tr>
                        <th scope="col">แผนก</th>
                        <th v-for="label in dash.statuses" :key="label" scope="col">{{ label }}</th>
                        <th scope="col">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in monthly.data.depts" :key="row.name">
                        <td class="cell-name">{{ row.name }}</td>
                        <td
                          v-for="label in dash.statuses"
                          :key="label"
                          class="cell-num"
                          :data-label="label"
                        >
                          {{ row.counts?.[label] ?? 0 }}
                        </td>
                        <td class="cell-num" data-label="รวม">{{ row.rows }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 class="sub-title">ผู้ไม่เข้าร่วมมากที่สุดต่อแผนก</h3>

                <p v-if="!topByDept.length" class="empty-text">{{ NO_DATA_MESSAGE }}</p>

                <div v-else class="table-wrap">
                  <table class="table table-wide">
                    <thead>
                      <tr>
                        <th scope="col">แผนก</th>
                        <th
                          v-for="status in ['not_attended', 'urgent_busy', 'leave']"
                          :key="status"
                          scope="col"
                        >
                          {{ TOP_STATUS_LABEL[status] }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="dept in topByDept" :key="dept.name">
                        <td class="cell-name">{{ dept.name }}</td>
                        <td
                          v-for="cell in dept.cells"
                          :key="cell.status"
                          class="cell-top"
                          :data-label="TOP_STATUS_LABEL[cell.status]"
                        >
                          <span class="top-name">{{ cell.name || DASH }}</span>
                          <span class="top-meta">{{ cell.count }} ครั้ง · {{ percent(cell.pct) }}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </section>
          </div>

          <!-- Side panel: department detail (always visible once a department is selected) -->
          <aside class="col-side">
            <div v-if="drawer.dept" class="card side-card fade-up delay-2">
              <div class="side-head">
                <div class="side-title">
                  <span class="material-symbols-outlined side-icon">domain</span>
                  <h3 class="card-title">{{ drawer.dept }}</h3>
                </div>
                <span v-if="drawer.data" class="count-tag">
                  {{ drawer.data.total - drawer.data.notYet }} / {{ drawer.data.total }} คน
                </span>
              </div>
              <p class="card-sub">{{ drawer.data?.cycle?.label ?? dash?.current?.label ?? DASH }}</p>

              <div v-if="drawer.loading" class="state-box">กำลังโหลด…</div>
              <p v-else-if="drawer.error" class="inline-error" role="alert">{{ drawer.error }}</p>

              <template v-else-if="drawer.data">
                <div class="mini-grid">
                  <div
                    v-for="(label, index) in dash?.statuses ?? []"
                    :key="label"
                    class="mini"
                    :class="`tone-${TONES[index] ?? 'muted'}`"
                  >
                    <span class="mini-value">{{ drawer.data.counts?.[label] ?? 0 }}</span>
                    <span class="mini-label">{{ SHORT_LABEL[label] ?? label }}</span>
                  </div>
                  <div class="mini tone-error">
                    <span class="mini-value">{{ drawer.data.notYet }}</span>
                    <span class="mini-label">รอลง</span>
                  </div>
                </div>

                <p v-if="drawer.data.total === 0" class="empty-text">{{ EMPTY_DEPT_MESSAGE }}</p>

                <div class="people-scroll">
                  <div v-for="group in peopleGroups" :key="group.status" class="group">
                    <h4 class="group-title" :class="`tone-${toneOfStatus(group.status)}`">
                      {{ group.status }} ({{ group.people.length }})
                    </h4>
                    <ul class="people">
                      <li v-for="person in group.people" :key="person.employeeId" class="person">
                        <div class="person-row">
                          <div class="person-info">
                            <span class="person-name">{{ person.name }}</span>
                            <span class="person-sub">
                              {{ person.level }}
                              <template v-if="person.shift"> · {{ person.shift }}</template>
                              <template v-if="person.time"> · {{ person.time }} น.</template>
                            </span>
                          </div>
                          <button
                            v-if="REASON_STATUSES.includes(group.status)"
                            type="button"
                            class="btn btn-small"
                            @click="openReason(person)"
                          >
                            ดูเหตุผล
                          </button>
                        </div>
                        <p v-if="reasons[person.employeeId]" class="reason-text">
                          <span class="reason-label">เหตุผล</span>
                          {{ reasons[person.employeeId].text }}
                        </p>
                      </li>
                    </ul>
                  </div>
                </div>
              </template>
            </div>

            <div v-else class="card side-card side-empty">
              <span class="material-symbols-outlined">domain</span>
              <p class="empty-text">เลือกแผนกจากตารางเพื่อดูรายละเอียด</p>
            </div>
          </aside>
        </div>
      </main>

    <div v-if="pinForm.open" class="modal-backdrop" @click.self="closeReason">
      <form class="modal" @submit.prevent="submitReason">
        <h2 class="modal-title">ดูเหตุผล</h2>
        <p class="modal-text">
          ยืนยัน PIN ของผู้ควบคุมการประชุมเพื่อดูเหตุผลของ {{ pinForm.name }}
        </p>

        <label class="field">
          <span class="field-label">PIN 6 หลัก</span>
          <input
            v-model="pinForm.pin"
            class="input"
            type="password"
            inputmode="numeric"
            maxlength="6"
            pattern="\d{6}"
            autocomplete="off"
            @input="sanitizePin"
          />
        </label>

        <p v-if="pinForm.error" class="inline-error" role="alert">{{ pinForm.error }}</p>

        <div class="modal-actions">
          <button type="button" class="btn" :disabled="pinForm.busy" @click="closeReason">
            ยกเลิก
          </button>
          <button type="submit" class="btn btn-primary" :disabled="pinForm.busy">
            {{ pinForm.busy ? 'กำลังตรวจสอบ…' : 'ยืนยัน' }}
          </button>
        </div>
      </form>
    </div>
</template>

<style scoped>

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined', sans-serif;
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

/* ---------- entrance & pulse ---------- */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.fade-up {
  animation: fadeInUp 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.delay-1 { animation-delay: 80ms; }
.delay-2 { animation-delay: 160ms; }
.delay-3 { animation-delay: 240ms; }
.spin { animation: spin 1s linear infinite; }

@media (prefers-reduced-motion: reduce) {
  .fade-up,
  .spin,
  .pulse-dot {
    animation: none;
  }
}

/* ---------- shell ---------- */

.page-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  max-width: 100%;
  padding: 7px 14px;
  border: 1px solid #d8e4de;
  border-radius: 999px;
  background: #ffffff;
  color: var(--secondary);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.back-link:hover {
  background: #eaf3ef;
}

.back-icon {
  font-size: 18px;
}

/* ---------- page head ---------- */
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.page-head-text {
  min-width: 0;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: var(--controller-h1-size, 26px);
  font-weight: 600;
  line-height: 1.35;
  color: var(--primary);
  overflow-wrap: anywhere;
}

.updated {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--surface-high);
  font-size: 13px;
  line-height: 1.5;
  color: var(--on-surface-variant);
}

.pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 999px;
  background: var(--secondary);
  animation: pulse 2s ease-in-out infinite;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 18px;
  border: 1px solid #d8e4de;
  border-radius: 999px;
  background: #ffffff;
  color: var(--primary);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
}

.btn:hover {
  background: #eaf3ef;
}

.btn:disabled {
  cursor: progress;
  opacity: 0.7;
}

.btn-icon {
  font-size: 18px;
  color: var(--secondary);
}

.btn-primary {
  border-color: var(--primary-container);
  background: var(--primary-container);
  color: #ffffff;
}

.btn-primary .btn-icon {
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--primary);
}

.btn-small {
  padding: 6px 12px;
  font-size: 13px;
}

/* ---------- tabs ---------- */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border-radius: 14px;
  background: var(--surface-high);
}

.tab {
  flex: 1 1 auto;
  min-width: 0;
  padding: 9px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.tab:hover {
  color: var(--on-surface);
}

.tab-active {
  background: #ffffff;
  color: var(--primary);
  box-shadow: 0 1px 4px rgba(16, 40, 35, 0.12);
}

.alert {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #f2c7c2;
  border-radius: 12px;
  background: #fdeeea;
  color: var(--error);
  font-size: 14px;
  line-height: 1.5;
}

.state-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 18px;
  border: 1px solid #e3e8e6;
  border-radius: 18px;
  background: #ffffff;
  color: #4b5b55;
  font-size: 14px;
  text-align: center;
}

/* ---------- layout ---------- */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.col-main,
.col-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

/* ---------- cards ---------- */
.card {
  min-width: 0;
  padding: 18px;
  border: 1px solid rgba(191, 201, 196, 0.35);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 6px 18px rgba(16, 40, 35, 0.05);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--surface-container);
}

.card-head.wrap {
  align-items: flex-start;
}

.card-head-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.card-head-left.column {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--on-surface);
  overflow-wrap: anywhere;
}

.card-sub {
  font-size: 13px;
  line-height: 1.5;
  color: var(--on-surface-variant);
}

.count-tag,
.period-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.badge-today {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 107, 86, 0.14);
  color: var(--secondary);
  font-size: 12px;
  font-weight: 600;
}

.badge-today.small {
  padding: 1px 6px;
  font-size: 10px;
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.hint .material-symbols-outlined {
  font-size: 14px;
}

.empty-text {
  margin: 0;
  padding: 6px 0;
  color: var(--outline);
  font-size: 14px;
  line-height: 1.6;
}

.inline-error {
  margin: 8px 0 0;
  color: var(--error);
  font-size: 13px;
  line-height: 1.5;
}

.note {
  margin: 10px 0 0;
  color: var(--outline);
  font-size: 12px;
  line-height: 1.5;
}

/* ---------- metric cards ---------- */
.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.metric {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--surface-low);
  transition: transform 0.2s, background 0.2s;
}

.metric:hover {
  background: var(--surface-container);
  transform: translateY(-2px);
}

.metric-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.metric-label {
  font-size: 12px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.metric-icon {
  font-size: 18px;
  opacity: 0.9;
}

.metric-value-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
}

.metric-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.metric-unit {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.metric-share {
  margin-left: auto;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tone-ok { color: var(--secondary); }
.tone-muted { color: var(--outline); }
.tone-warn { color: #a75c11; }
.tone-info { color: #1f5f9c; }
.tone-error { color: var(--error); }

.metric.tone-warn .metric-value,
.metric.tone-info .metric-value {
  color: inherit;
}

.metric.tone-warn { border-color: rgba(238, 193, 75, 0.45); }
.metric.tone-info { border-color: rgba(144, 212, 192, 0.5); }

/* ---------- donut + quorum ---------- */
.donut-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--surface-container);
}

.donut-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-low);
  min-width: 0;
}

.donut {
  position: relative;
  width: 112px;
  height: 112px;
  flex: 0 0 112px;
}

.donut-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.donut-track {
  stroke: var(--surface-variant);
}

.donut-svg circle:not(.donut-track) {
  transition: stroke-dasharray 0.7s ease, stroke-dashoffset 0.7s ease;
}

.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.donut-num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--primary);
}

.donut-sub {
  font-size: 10px;
  color: var(--on-surface-variant);
}

.donut-legend {
  flex: 1 1 180px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.legend-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--surface-high);
  font-size: 12px;
  font-weight: 600;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  border-radius: 999px;
}

.legend-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.legend-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.legend-value em {
  font-style: normal;
  font-weight: 400;
  color: var(--on-surface-variant);
}

.quorum-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-low);
  min-width: 0;
}

.quorum-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.quorum-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}

.quorum-title .material-symbols-outlined {
  font-size: 16px;
  color: var(--secondary);
}

.quorum-sub {
  font-size: 13px;
  color: var(--on-surface-variant);
}

.quorum-badge {
  align-self: flex-start;
  margin-top: 2px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--error-container);
  color: var(--error);
  font-size: 11px;
  font-weight: 600;
}

.quorum-badge.is-ok {
  background: rgba(0, 107, 86, 0.14);
  color: var(--secondary);
}

.gauge {
  position: relative;
  width: 84px;
  height: 84px;
  flex: 0 0 84px;
}

.gauge-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.gauge-track {
  stroke: var(--surface-variant);
}

.gauge-fill {
  stroke: var(--primary);
  transition: stroke-dashoffset 1s ease;
}

.gauge-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.gauge-num {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
}

.gauge-target {
  font-size: 9px;
  color: var(--on-surface-variant);
}

.summary-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface-container);
  font-size: 14px;
}

.summary-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.summary-pct {
  font-weight: 400;
  color: var(--on-surface-variant);
  font-size: 13px;
}

.summary-pending {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 10px;
  background: #ffffff;
  color: var(--error);
  font-size: 13px;
  font-weight: 600;
}

.summary-pending .material-symbols-outlined {
  font-size: 16px;
}

/* ---------- department table ---------- */
.table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
}

.table {
  width: 100%;
  min-width: 460px;
  border-collapse: collapse;
  font-size: 14px;
}

.table-wide {
  min-width: 620px;
}

.table th {
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-high);
  background: var(--surface-low);
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.table th:first-child {
  border-radius: 10px 0 0 10px;
}

.table th:last-child {
  border-radius: 0 10px 10px 0;
}

.table td {
  padding: 10px;
  border-bottom: 1px solid var(--surface-container);
  vertical-align: middle;
}

.table tbody tr:last-child td {
  border-bottom: 0;
}

.row-click {
  cursor: pointer;
  transition: background 0.2s;
}

.row-click:hover td {
  background: var(--surface-low);
}

.row-click:focus-visible {
  outline: 2px solid var(--secondary);
  outline-offset: -2px;
}

.row-active td {
  background: #eaf3ef;
}

.cell-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--on-surface);
  overflow-wrap: anywhere;
}

.dept-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 999px;
  background: var(--secondary);
}

.cell-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cell-top {
  white-space: nowrap;
}

.pill {
  display: inline-flex;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.pill-error {
  background: var(--error-container);
  color: #93000a;
}

.pill-muted {
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.rate {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
}

.rate-track {
  position: relative;
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: var(--surface-high);
  overflow: hidden;
}

.rate-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--secondary);
  transition: width 0.8s ease-out;
}

.rate-text {
  min-width: 46px;
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.top-name {
  display: block;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.top-meta {
  display: block;
  color: var(--outline);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.sub-title {
  margin: 18px 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--primary);
}

/* ---------- history ---------- */
.history-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.select,
.input {
  max-width: 100%;
  padding: 8px 12px;
  border: 1px solid #d8e4de;
  border-radius: 10px;
  background: #ffffff;
  color: var(--on-surface);
  font-family: inherit;
  font-size: 14px;
}

.select:focus,
.input:focus {
  outline: 2px solid var(--secondary);
  outline-offset: 1px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  margin-bottom: 12px;
}

.field-label {
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
}

.input {
  width: 100%;
}

.mode-group {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-container);
}

.mode-btn {
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.mode-active {
  background: #ffffff;
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(16, 40, 35, 0.12);
}

.history-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-bottom: 12px;
}

.legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--on-surface);
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 4px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.history-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) 56px;
  align-items: center;
  gap: 10px;
}

.history-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.history-track {
  display: flex;
  height: 28px;
  padding: 2px;
  gap: 2px;
  border-radius: 8px;
  background: var(--surface-container);
  overflow: hidden;
}

.history-seg {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 100%;
  border-radius: 6px;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  overflow: hidden;
}

.history-seg:empty {
  width: 0;
}

.history-total {
  text-align: right;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.seg-ok { background: var(--secondary); }
.seg-muted { background: var(--outline-variant); color: var(--on-surface); }
.seg-warn { background: var(--tertiary-fixed-dim); color: #251a00; }
.seg-info { background: var(--primary-fixed-dim); color: #002019; }

/* ---------- side panel ---------- */
.side-card {
  position: relative;
}

.side-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: var(--outline);
}

.side-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.side-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.side-icon {
  color: var(--secondary);
  font-size: 20px;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(68px, 1fr));
  gap: 8px;
  margin: 14px 0;
}

.mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border-radius: 12px;
  background: var(--surface-low);
  text-align: center;
}

.mini-value {
  font-size: 20px;
  font-weight: 700;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.mini-label {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.people-scroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 520px;
  overflow-y: auto;
  padding-right: 4px;
}

.group {
  min-width: 0;
}

.group-title {
  margin: 4px 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.people {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.person {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-low);
}

.person-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.person-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.person-name {
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.person-sub {
  font-size: 12px;
  color: var(--outline);
  overflow-wrap: anywhere;
}

.reason-text {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid var(--surface-high);
  color: var(--on-surface);
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.reason-label {
  display: inline-block;
  margin-right: 6px;
  color: var(--outline);
  font-size: 12px;
  font-weight: 600;
}

/* ---------- modal ---------- */
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(16, 40, 35, 0.45);
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(380px, 100%);
  max-width: 100%;
  padding: 20px;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 18px 40px rgba(16, 40, 35, 0.2);
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--primary);
}

.modal-text {
  margin: 0;
  color: var(--on-surface-variant);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.modal-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* ---------- responsive ---------- */
@media (min-width: 1024px) {
  .metric-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 640px) {
  .card {
    padding: 22px;
  }
}

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: minmax(0, 8fr) minmax(0, 4fr);
  }

  .side-card {
    position: sticky;
    top: calc(var(--controller-topbar-height, 64px) + 20px);
  }
}

@media (max-width: 600px) {
  .table-wrap {
    overflow-x: auto;
  }

  .table,
  .table-wide {
    display: block;
    width: 100%;
    min-width: 0;
    font-size: 13px;
  }

  .table thead {
    display: none;
  }

  .table tbody {
    display: block;
  }

  .table tbody tr {
    display: block;
    margin-bottom: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface-low);
    min-width: 0;
  }

  .table tbody tr:last-child {
    margin-bottom: 0;
  }

  .table td {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    padding: 3px 0;
    border-bottom: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .table td::before {
    content: attr(data-label);
    color: var(--outline);
    font-size: 12px;
    font-weight: 600;
  }

  .table td.cell-name {
    display: flex;
    padding: 0 0 6px;
    color: var(--secondary);
    font-size: 14px;
    font-weight: 700;
  }

  .table td.cell-name::before {
    content: none;
  }

  .table td.cell-top::before {
    align-self: start;
  }

  .rate {
    min-width: 0;
  }

  .history-row {
    grid-template-columns: minmax(0, 1fr) 48px;
  }

  .history-track {
    grid-column: 1 / -1;
    order: 3;
  }

  .history-label {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  .donut-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .quorum-card {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 420px) {
  .card {
    padding: 14px;
  }

  .tab {
    flex: 1 1 100%;
  }

  .modal {
    padding: 16px;
  }
}
</style>