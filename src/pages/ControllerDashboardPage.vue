<script setup>
import { computed, reactive, ref } from 'vue'
import ControllerNav from '../components/ControllerNav.vue'

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
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">HR</div>
        <div class="brand-text">
          <span class="brand-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
          <span class="brand-sub">Meeting Controller Console</span>
        </div>
      </div>
      <div class="role-chip">
        <span class="material-symbols-outlined role-chip-icon">insights</span>
        <span>ผู้ควบคุมการประชุม</span>
      </div>
    </header>

    <div class="shell">
      <ControllerNav />

      <main class="page-main">
        <RouterLink to="/meeting/controller" class="back-link">
          <span class="material-symbols-outlined back-icon">arrow_back</span>
          กลับหน้าหลัก
        </RouterLink>

        <div class="page-head">
          <div class="page-head-text">
            <h1>แดชบอร์ดการเข้าประชุม</h1>
            <p class="updated">อัปเดตล่าสุด {{ updatedText || DASH }}</p>
          </div>
          <button type="button" class="btn btn-primary" :disabled="loading" @click="refresh">
            {{ loading ? 'กำลังโหลด…' : 'รีเฟรช' }}
          </button>
        </div>

        <div class="tabs" role="tablist">
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

        <template v-else-if="dash">
          <section class="card">
            <div class="card-head">
              <h2 class="card-title">{{ cycleHeading }}</h2>
              <span class="count-tag">{{ dash.meeting.periodLabel }}</span>
            </div>

            <p v-if="dash.history.empty" class="empty-text">{{ NO_DATA_MESSAGE }}</p>

            <template v-else>
              <div class="count-grid">
                <div
                  v-for="(label, index) in dash.statuses"
                  :key="label"
                  class="count-item"
                  :class="`tone-${TONES[index] ?? 'muted'}`"
                >
                  <span class="count-label">{{ label }}</span>
                  <span class="count-value">{{ dash.today.byStatus?.[label] ?? 0 }}</span>
                </div>
              </div>

              <div class="notyet-row">
                <span class="notyet-main">ยังไม่ลงทะเบียน {{ dash.today.notYet }} คน</span>
                <span class="notyet-sub">
                  ลงทะเบียนแล้ว {{ dash.today.registered }} / {{ dash.rosterCount }} คน
                </span>
              </div>
            </template>
          </section>

          <section class="card">
            <div class="card-head">
              <h2 class="card-title">ภาพรวมตามแผนก</h2>
              <span class="count-tag">{{ dash.depts.length }} แผนก</span>
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
                    tabindex="0"
                    @click="openDept(row.name)"
                    @keydown.enter="openDept(row.name)"
                  >
                    <td class="cell-name">{{ row.name }}</td>
                    <td class="cell-num">{{ row.registered }} / {{ row.total }}</td>
                    <td class="cell-num">{{ row.notYet }}</td>
                    <td>
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

          <section class="card">
            <div class="card-head">
              <h2 class="card-title">ประวัติย้อนหลัง</h2>
            </div>

            <div class="history-controls">
              <label class="field">
                <span class="field-label">เลือกรอบ</span>
                <select v-model="value" class="select" @change="selectCycle">
                  <option value="">รอบล่าสุด</option>
                  <option v-for="option in historyOptions" :key="option.key" :value="option.key">
                    {{ option.label }}
                  </option>
                </select>
              </label>

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

            <p v-if="dash.history.empty || !dash.history.cycles.length" class="empty-text">
              {{ NO_DATA_MESSAGE }}
            </p>

            <div v-else class="chart-wrap">
              <div class="chart">
                <div v-for="cycle in dash.history.cycles" :key="cycle.key" class="chart-col">
                  <span class="chart-total">{{ cycle.total }}</span>
                  <div class="chart-track">
                    <div class="chart-bar" :style="{ height: barHeight(cycle.total) }">
                      <span
                        v-for="segment in segmentsOf(cycle)"
                        :key="segment.key"
                        class="chart-seg"
                        :class="`seg-${segment.key}`"
                        :style="{ flexGrow: segment.count }"
                        :title="`${segment.label} ${segment.count}`"
                      ></span>
                    </div>
                  </div>
                  <span class="chart-label">{{ cycle.label }}</span>
                </div>
              </div>
            </div>

            <p class="note">ประวัติจะแสดงข้อมูลหลังนำเข้าข้อมูลย้อนหลังแล้วเท่านั้น</p>
          </section>

          <section v-if="code === 'monthly'" class="card">
            <div class="card-head">
              <h2 class="card-title">สรุปรายเดือน</h2>
              <span v-if="monthly.data" class="count-tag">
                {{ monthly.data.totalMeetings }} ครั้ง
              </span>
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
                      <td v-for="label in dash.statuses" :key="label" class="cell-num">
                        {{ row.counts?.[label] ?? 0 }}
                      </td>
                      <td class="cell-num">{{ row.rows }}</td>
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
                      <th v-for="status in ['not_attended', 'urgent_busy', 'leave']" :key="status" scope="col">
                        {{ TOP_STATUS_LABEL[status] }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="dept in topByDept" :key="dept.name">
                      <td class="cell-name">{{ dept.name }}</td>
                      <td v-for="cell in dept.cells" :key="cell.status" class="cell-top">
                        <span class="top-name">{{ cell.name || DASH }}</span>
                        <span class="top-meta">{{ cell.count }} ครั้ง · {{ percent(cell.pct) }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </section>
        </template>
      </main>
    </div>

    <div v-if="drawer.open" class="drawer-backdrop" @click.self="closeDrawer">
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="`รายชื่อแผนก ${drawer.dept}`">
        <div class="drawer-head">
          <div class="drawer-head-text">
            <h2 class="card-title">{{ drawer.dept }}</h2>
            <p class="drawer-sub">{{ drawer.data?.cycle?.label ?? dash?.current?.label ?? DASH }}</p>
          </div>
          <button type="button" class="icon-btn" aria-label="ปิด" @click="closeDrawer">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div v-if="drawer.loading" class="state-box">กำลังโหลด…</div>
        <p v-else-if="drawer.error" class="inline-error" role="alert">{{ drawer.error }}</p>

        <template v-else-if="drawer.data">
          <div class="drawer-tags">
            <span class="count-tag">{{ drawer.data.total }} คนในรายชื่อ</span>
            <span class="count-tag tag-warn">ยังไม่ลงทะเบียน {{ drawer.data.notYet }}</span>
          </div>

          <div class="drawer-counts">
            <div
              v-for="(label, index) in dash?.statuses ?? []"
              :key="label"
              class="drawer-count"
              :class="`tone-${TONES[index] ?? 'muted'}`"
            >
              <span class="drawer-count-label">{{ label }}</span>
              <span class="drawer-count-value">{{ drawer.data.counts?.[label] ?? 0 }}</span>
            </div>
          </div>

          <p v-if="drawer.data.total === 0" class="empty-text">{{ EMPTY_DEPT_MESSAGE }}</p>

          <div v-for="group in peopleGroups" :key="group.status" class="group">
            <h3 class="group-title" :class="`tone-${toneOfStatus(group.status)}`">
              {{ group.status }} ({{ group.people.length }})
            </h3>
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
        </template>
      </aside>
    </div>

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
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.page {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: #f4f8f5;
  font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif;
  color: #12251f;
}

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

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px;
  background: #ffffff;
  border-bottom: 1px solid #e3e8e6;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-mark {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #176c5b;
  color: #ffffff;
  font-family: 'Sarabun', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #115447;
  overflow-wrap: anywhere;
}

.brand-sub {
  font-size: 12px;
  line-height: 1.4;
  color: #6b7a75;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.role-chip-icon {
  font-size: 18px;
}

.shell {
  display: flex;
  gap: 20px;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 22px;
}

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
  color: #115447;
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
  font-size: 24px;
  font-weight: 600;
  line-height: 1.35;
  color: #115447;
  overflow-wrap: anywhere;
}

.updated {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #3d4f49;
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
  color: #115447;
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

.btn-primary {
  border-color: #176c5b;
  background: #176c5b;
  color: #ffffff;
}

.btn-primary:hover {
  background: #115447;
}

.btn-small {
  padding: 6px 12px;
  font-size: 13px;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #ffffff;
}

.tab {
  flex: 1 1 auto;
  min-width: 0;
  padding: 9px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #3d4f49;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: normal;
}

.tab-active {
  background: #176c5b;
  color: #ffffff;
}

.alert {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #f2c7c2;
  border-radius: 12px;
  background: #fdeeea;
  color: #b3261e;
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

.card {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e3e8e6;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(16, 40, 35, 0.06);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}

.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: #115447;
  overflow-wrap: anywhere;
}

.count-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.tag-warn {
  background: #fdf1e4;
  color: #a75c11;
}

.empty-text {
  margin: 0;
  padding: 6px 0;
  color: #6b7a75;
  font-size: 14px;
  line-height: 1.6;
}

.inline-error {
  margin: 8px 0 0;
  color: #b3261e;
  font-size: 13px;
  line-height: 1.5;
}

.note {
  margin: 10px 0 0;
  color: #6b7a75;
  font-size: 12px;
  line-height: 1.5;
}

.count-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.count-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #eef1ef;
  border-radius: 12px;
}

.count-label {
  font-size: 12px;
  color: #5d6d67;
}

.count-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
}

.tone-ok .count-value {
  color: #176c5b;
}

.tone-muted .count-value {
  color: #6b7a75;
}

.tone-warn .count-value {
  color: #c46a12;
}

.tone-info .count-value {
  color: #1f5f9c;
}

.notyet-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #eef1ef;
  border-radius: 12px;
  background: #f7faf8;
  font-size: 14px;
}

.notyet-main {
  font-weight: 600;
  color: #115447;
}

.notyet-sub {
  color: #6b7a75;
  font-variant-numeric: tabular-nums;
}

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
  border-bottom: 1px solid #e3e8e6;
  color: #5d6d67;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.table td {
  padding: 10px;
  border-bottom: 1px solid #f1f4f2;
  vertical-align: middle;
}

.table tbody tr:last-child td {
  border-bottom: 0;
}

.row-click {
  cursor: pointer;
}

.row-click:hover td {
  background: #f4f8f5;
}

.row-click:focus-visible {
  outline: 2px solid #176c5b;
  outline-offset: -2px;
}

.cell-name {
  font-weight: 500;
  color: #12251f;
  overflow-wrap: anywhere;
}

.cell-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cell-top {
  white-space: nowrap;
}

.top-name {
  display: block;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.top-meta {
  display: block;
  color: #6b7a75;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.rate {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 130px;
}

.rate-track {
  position: relative;
  flex: 1;
  height: 8px;
  border-radius: 999px;
  background: #eef1ef;
  overflow: hidden;
}

.rate-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: #176c5b;
}

.rate-text {
  min-width: 42px;
  color: #5d6d67;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.history-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  align-items: flex-end;
  margin-bottom: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 190px;
}

.field-label {
  color: #5d6d67;
  font-size: 12px;
  font-weight: 600;
}

.select,
.input {
  width: 100%;
  max-width: 100%;
  padding: 9px 12px;
  border: 1px solid #d8e4de;
  border-radius: 12px;
  background: #ffffff;
  color: #12251f;
  font-family: inherit;
  font-size: 14px;
}

.select:focus,
.input:focus {
  outline: 2px solid #176c5b;
  outline-offset: 1px;
}

.mode-group {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #f7faf8;
}

.mode-btn {
  padding: 6px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #3d4f49;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.mode-active {
  background: #176c5b;
  color: #ffffff;
}

.chart-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
}

.chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-width: 440px;
  padding: 4px 2px 0;
}

.chart-col {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 26px;
}

.chart-total {
  color: #5d6d67;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.chart-track {
  display: flex;
  align-items: flex-end;
  width: 100%;
  height: 130px;
}

.chart-bar {
  display: flex;
  flex-direction: column-reverse;
  width: 100%;
  overflow: hidden;
  border-radius: 6px 6px 0 0;
  background: #eef1ef;
}

.chart-seg {
  display: block;
  width: 100%;
  min-height: 0;
}

.seg-ok {
  background: #176c5b;
}

.seg-muted {
  background: #b3bdb8;
}

.seg-warn {
  background: #e39a4d;
}

.seg-info {
  background: #5b93c9;
}

.chart-label {
  max-width: 100%;
  color: #6b7a75;
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
  overflow-wrap: anywhere;
}

.sub-title {
  margin: 18px 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: #115447;
}

.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: rgba(16, 40, 35, 0.35);
}

.drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(460px, 100%);
  max-width: 100%;
  height: 100%;
  padding: 18px;
  overflow-y: auto;
  background: #ffffff;
  border-left: 1px solid #e3e8e6;
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.drawer-head-text {
  min-width: 0;
}

.drawer-sub {
  margin: 4px 0 0;
  color: #6b7a75;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border: 1px solid #e3e8e6;
  border-radius: 999px;
  background: #ffffff;
  color: #115447;
  cursor: pointer;
}

.drawer-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.drawer-counts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.drawer-count {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid #eef1ef;
  border-radius: 12px;
  background: #f7faf8;
}

.drawer-count-label {
  font-size: 11px;
  color: #5d6d67;
  overflow-wrap: anywhere;
}

.drawer-count-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.1;
}

.drawer-count.tone-ok .drawer-count-value {
  color: #176c5b;
}

.drawer-count.tone-muted .drawer-count-value {
  color: #6b7a75;
}

.drawer-count.tone-warn .drawer-count-value {
  color: #c46a12;
}

.drawer-count.tone-info .drawer-count-value {
  color: #1f5f9c;
}

.group {
  min-width: 0;
}

.group-title {
  margin: 6px 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #5d6d67;
}

.group-title.tone-ok {
  color: #176c5b;
}

.group-title.tone-warn {
  color: #c46a12;
}

.group-title.tone-info {
  color: #1f5f9c;
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
  border: 1px solid #eef1ef;
  border-radius: 12px;
  background: #f7faf8;
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
  color: #6b7a75;
  overflow-wrap: anywhere;
}

.reason-text {
  margin: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid #e3e8e6;
  color: #12251f;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.reason-label {
  display: inline-block;
  margin-right: 6px;
  color: #6b7a75;
  font-size: 12px;
  font-weight: 600;
}

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
  color: #115447;
}

.modal-text {
  margin: 0;
  color: #3d4f49;
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

@media (min-width: 480px) {
  .count-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 640px) {
  .card {
    padding: 22px;
  }
}

@media (min-width: 900px) {
  .page-head h1 {
    font-size: 26px;
  }
}

@media (max-width: 899px) {
  .shell {
    flex-direction: column;
    padding: 14px;
  }

  .topbar {
    padding: 12px 14px;
  }
}

@media (max-width: 420px) {
  .card {
    padding: 14px;
  }

  .page-head h1 {
    font-size: 20px;
  }

  .tab {
    flex: 1 1 100%;
  }

  .modal {
    padding: 16px;
  }
}
</style>
