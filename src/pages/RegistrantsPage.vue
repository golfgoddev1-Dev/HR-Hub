<script setup>
// Registrant list for the meeting controller. Read-only: it consumes the
// existing Worker GET endpoints (dashboard summary for the cycle picker and
// status labels, dashboard registrants for the rows) and never writes.
import { computed, ref } from 'vue'
import ControllerNav from '../components/ControllerNav.vue'

const LOAD_ERROR_MESSAGE = 'ไม่สามารถโหลดรายชื่อผู้ลงทะเบียนได้ กรุณาลองใหม่'
const EMPTY_MESSAGE = 'ยังไม่มีผู้ลงทะเบียนในรอบนี้'
const EMPTY_FILTER_MESSAGE = 'ไม่มีรายชื่อในสถานะนี้'
const DASH = '-'
const ALL_FILTER = 'ทั้งหมด'

// Same tab labels as the dashboard page.
const TABS = [
  { code: 'sup', label: 'ประชุมหัวหน้างาน' },
  { code: 'monthly', label: 'ประชุม Monthly' },
]

// Status label -> tone, mirroring the dashboard page. The labels themselves
// always come from the Worker (STATUS_LABELS) so the order cannot drift.
const STATUS_TONE = {
  เข้าร่วมประชุม: 'ok',
  ไม่เข้าร่วม: 'muted',
  ติดงานด่วน: 'warn',
  ลาประชุม: 'info',
}

const code = ref('sup')
const cycle = ref('')
const filter = ref(ALL_FILTER)

const summary = ref({ statuses: [], options: [], currentKey: '' })
const loading = ref(true)
const errorMessage = ref('')
const items = ref([])
const total = ref(0)
const cycleLabel = ref('')

let requestSeq = 0

const filters = computed(() => [ALL_FILTER, ...summary.value.statuses])

const counts = computed(() => {
  const result = {}
  for (const item of items.value) {
    const key = typeof item.status === 'string' ? item.status : DASH
    result[key] = (result[key] ?? 0) + 1
  }
  return result
})

const filteredItems = computed(() => {
  if (filter.value === ALL_FILTER) return items.value
  return items.value.filter((item) => item.status === filter.value)
})

function toneOfStatus(label) {
  return STATUS_TONE[label] ?? 'muted'
}

function serverMessage(data, fallback) {
  return typeof data?.message === 'string' && data.message.length > 0 ? data.message : fallback
}

async function requestJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  return { ok: response.ok, data }
}

function resetRegistrants() {
  items.value = []
  total.value = 0
  cycleLabel.value = ''
}

async function loadRegistrants(seq, cycleKey) {
  const params = new URLSearchParams({ code: code.value, cycle: cycleKey })
  try {
    const { ok, data } = await requestJson(
      `/api/meeting/dashboard/registrants?${params.toString()}`,
    )
    if (seq !== requestSeq) return
    if (!ok || data.ok !== true) {
      resetRegistrants()
      errorMessage.value = serverMessage(data, LOAD_ERROR_MESSAGE)
      return
    }
    items.value = Array.isArray(data.items) ? data.items : []
    total.value = Number.isFinite(data.total) ? data.total : items.value.length
    cycleLabel.value = typeof data.cycle?.label === 'string' ? data.cycle.label : ''
  } catch {
    if (seq !== requestSeq) return
    resetRegistrants()
    errorMessage.value = LOAD_ERROR_MESSAGE
  }
}

async function loadPage() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  filter.value = ALL_FILTER
  resetRegistrants()

  try {
    const params = new URLSearchParams({ code: code.value })
    const { ok, data } = await requestJson(`/api/meeting/dashboard?${params.toString()}`)
    if (seq !== requestSeq) return
    if (!ok || data.ok !== true) {
      errorMessage.value = serverMessage(data, LOAD_ERROR_MESSAGE)
      return
    }

    const statuses = Array.isArray(data.statuses) ? data.statuses : []
    const options = Array.isArray(data.history?.options) ? data.history.options : []
    const currentKey = typeof data.current?.key === 'string' ? data.current.key : ''
    summary.value = { statuses, options, currentKey }

    const keys = options.map((option) => option.key)
    const nextCycle = keys.includes(cycle.value)
      ? cycle.value
      : currentKey || keys[keys.length - 1] || ''
    cycle.value = nextCycle

    if (nextCycle) await loadRegistrants(seq, nextCycle)
  } catch {
    if (seq !== requestSeq) return
    errorMessage.value = LOAD_ERROR_MESSAGE
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

async function selectCode(nextCode) {
  if (code.value === nextCode || loading.value) return
  code.value = nextCode
  cycle.value = ''
  await loadPage()
}

async function selectCycle(event) {
  cycle.value = event.target.value
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  filter.value = ALL_FILTER
  resetRegistrants()
  if (cycle.value) await loadRegistrants(seq, cycle.value)
  if (seq === requestSeq) loading.value = false
}

loadPage()
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
        <span class="material-symbols-outlined role-chip-icon">groups</span>
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
          <h1>ผู้เข้าร่วมและรายชื่อลงทะเบียน</h1>
          <p>รายชื่อพนักงานที่ลงทะเบียนไว้ในแต่ละรอบประชุม</p>
        </div>

        <section class="card">
          <div class="tabs" role="group" aria-label="เลือกประเภทการประชุม">
            <button
              v-for="tab in TABS"
              :key="tab.code"
              type="button"
              class="tab"
              :class="{ 'tab-active': code === tab.code }"
              :aria-pressed="code === tab.code"
              @click="selectCode(tab.code)"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="controls">
            <label class="field">
              <span class="field-label">รอบประชุม</span>
              <select
                class="select"
                :value="cycle"
                :disabled="summary.options.length === 0"
                @change="selectCycle"
              >
                <option v-for="option in summary.options" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
            </label>

            <span v-if="cycleLabel" class="count-tag">{{ cycleLabel }}</span>
          </div>

          <div class="chips" role="group" aria-label="กรองตามสถานะ">
            <button
              v-for="status in filters"
              :key="status"
              type="button"
              class="chip"
              :class="{ 'chip-active': filter === status }"
              :aria-pressed="filter === status"
              @click="filter = status"
            >
              {{ status }}
              <span v-if="status !== ALL_FILTER" class="chip-count">
                {{ counts[status] ?? 0 }}
              </span>
            </button>
          </div>

          <div v-if="loading" class="state-box">กำลังโหลด…</div>

          <p v-else-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>

          <p v-else-if="total === 0" class="empty-text">{{ EMPTY_MESSAGE }}</p>

          <p v-else-if="filteredItems.length === 0" class="empty-text">{{ EMPTY_FILTER_MESSAGE }}</p>

          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">ชื่อ-นามสกุล</th>
                  <th scope="col">รหัสพนักงาน</th>
                  <th scope="col">แผนก</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col">เวลาลงทะเบียน</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in filteredItems" :key="`${item.name}-${item.time}-${index}`">
                  <td class="cell-name" data-label="ชื่อ-นามสกุล">{{ item.name || DASH }}</td>
                  <td class="cell-code" data-label="รหัสพนักงาน">
                    {{ item.employeeCode || DASH }}
                  </td>
                  <td data-label="แผนก">{{ item.departmentName || DASH }}</td>
                  <td data-label="สถานะ">
                    <span class="status-pill" :class="`tone-${toneOfStatus(item.status)}`">
                      {{ item.status || DASH }}
                    </span>
                  </td>
                  <td class="cell-time" data-label="เวลาลงทะเบียน">
                    {{ item.time ? `${item.time} น.` : DASH }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p v-if="!loading && !errorMessage && total > 0" class="total-note">
            ทั้งหมด {{ total }} คน
          </p>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.page {
  min-height: 100vh;
  background: #f4f7f5;
  color: #1b2a24;
  font-family: 'IBM Plex Sans Thai', sans-serif;
  --gutter: 16px;
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

.page-head h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.35;
  color: #115447;
  overflow-wrap: anywhere;
}

.page-head p {
  margin: 6px 0 0;
  color: #5a6b64;
  font-size: 14px;
  line-height: 1.6;
}

.card {
  padding: 16px;
  border: 1px solid #e3e8e6;
  border-radius: 16px;
  background: #ffffff;
  min-width: 0;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tab {
  padding: 8px 14px;
  border: 1px solid #d8e4de;
  border-radius: 999px;
  background: #ffffff;
  color: #3d4f49;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.tab-active {
  border-color: #176c5b;
  background: #176c5b;
  color: #ffffff;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  margin-top: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 220px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: #5a6b64;
}

.select {
  width: 100%;
  max-width: 100%;
  padding: 9px 12px;
  border: 1px solid #d8e4de;
  border-radius: 10px;
  background: #ffffff;
  color: #1b2a24;
  font-family: inherit;
  font-size: 14px;
}

.select:disabled {
  background: #f2f5f3;
  color: #8a9992;
}

.count-tag {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid #dbe6e0;
  border-radius: 999px;
  background: #ffffff;
  color: #3d4f49;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.chip-active {
  border-color: #176c5b;
  background: #eaf3ef;
  color: #115447;
}

.chip-count {
  font-variant-numeric: tabular-nums;
  color: #6b7a75;
}

.table-wrap {
  margin-top: 14px;
  width: 100%;
  min-width: 0;
}

.table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 14px;
}

.table th,
.table td {
  padding: 10px 8px;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid #eef1ef;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.table th {
  color: #5a6b64;
  font-size: 12px;
  font-weight: 600;
  white-space: normal;
}

.cell-name {
  font-weight: 600;
}

.cell-code,
.cell-time {
  font-variant-numeric: tabular-nums;
  color: #3d4f49;
}

.status-pill {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.tone-ok {
  background: #e4f5ec;
  color: #14624a;
}

.tone-muted {
  background: #eef1ef;
  color: #55645e;
}

.tone-warn {
  background: #fdf0e3;
  color: #8a4b12;
}

.tone-info {
  background: #e8f1fb;
  color: #1e4f86;
}

.total-note {
  margin: 12px 0 0;
  color: #5a6b64;
  font-size: 13px;
}

.state-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  margin-top: 14px;
  color: #4b5b55;
  font-size: 14px;
  text-align: center;
}

.inline-error {
  margin: 14px 0 0;
  color: #b3261e;
  font-size: 13px;
  line-height: 1.6;
}

.empty-text {
  margin: 20px 0;
  color: #6b7a75;
  font-size: 14px;
  text-align: center;
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
    padding: 16px var(--gutter) 24px;
  }

  .topbar {
    padding: 12px var(--gutter);
  }
}

@media (max-width: 600px) {
  .table {
    display: block;
    width: 100%;
    min-width: 0;
    font-size: 13px;
  }

  .table thead {
    display: none;
  }

  .table tbody,
  .table tr,
  .table td {
    display: block;
    width: 100%;
    min-width: 0;
  }

  .table tr {
    margin-bottom: 10px;
    padding: 10px 12px;
    border: 1px solid #eef1ef;
    border-radius: 12px;
    background: #f7faf8;
  }

  .table td {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px 0;
    border-bottom: 0;
  }

  .table td::before {
    content: attr(data-label);
    flex: 0 0 auto;
    min-width: 0;
    color: #6b7a75;
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .select {
    font-size: 16px;
  }
}
</style>
