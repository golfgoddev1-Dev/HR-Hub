<script setup>
import { computed, reactive, ref } from 'vue'
import ControllerNav from '../components/ControllerNav.vue'

const LOAD_ERROR_MESSAGE = 'ไม่สามารถโหลดข้อมูลภาพรวมได้ กรุณาลองใหม่'
const PENDING_ERROR_MESSAGE = 'ไม่สามารถโหลดรายชื่อที่ยังไม่ลงทะเบียนได้ กรุณาลองใหม่'

const PHASE_LABEL = {
  not_open: 'ยังไม่เปิด',
  open: 'กำลังเปิดรับ',
  closed: 'ปิดรับแล้ว',
  none: 'ยังไม่กำหนดเวลา',
}

const STATUS_FIELDS = [
  { key: 'attended', label: 'เข้าร่วมประชุม', tone: 'ok' },
  { key: 'not_attended', label: 'ไม่เข้าร่วม', tone: 'muted' },
  { key: 'urgent_busy', label: 'ติดงานด่วน', tone: 'warn' },
  { key: 'leave', label: 'ลาประชุม', tone: 'info' },
]

const overview = ref(null)
const loading = ref(true)
const errorMessage = ref('')
const pending = reactive({
  sup: { open: false, loading: false, loaded: false, error: '', items: [] },
  monthly: { open: false, loading: false, loaded: false, error: '', items: [] },
})

const sup = computed(() => overview.value?.today?.sup ?? null)
const monthly = computed(() => overview.value?.today?.monthly ?? null)
const dateText = computed(() => overview.value?.today?.dateText ?? '')
const rosterCount = computed(() => sup.value?.rosterCount ?? 0)

async function requestJson(url) {
  const response = await fetch(url, {
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

function resetPending() {
  for (const code of ['sup', 'monthly']) {
    pending[code] = { open: false, loading: false, loaded: false, error: '', items: [] }
  }
}

async function loadOverview() {
  loading.value = true
  errorMessage.value = ''
  try {
    const { ok, data } = await requestJson('/api/meeting/overview')
    if (!ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR_MESSAGE
      return
    }
    overview.value = data
    resetPending()
  } catch {
    errorMessage.value = LOAD_ERROR_MESSAGE
  } finally {
    loading.value = false
  }
}

async function loadPending(code) {
  const state = pending[code]
  state.loading = true
  state.error = ''
  try {
    const { ok, data } = await requestJson(`/api/meeting/overview/pending?code=${code}`)
    if (!ok || data.ok !== true) {
      state.error = PENDING_ERROR_MESSAGE
      return
    }
    state.items = Array.isArray(data.pending) ? data.pending : []
    state.loaded = true
  } catch {
    state.error = PENDING_ERROR_MESSAGE
  } finally {
    state.loading = false
  }
}

async function togglePending(code) {
  const state = pending[code]
  if (state.open) {
    state.open = false
    return
  }
  state.open = true
  if (!state.loaded) await loadPending(code)
}

function pendingCount(card) {
  const total = card?.counts?.total ?? 0
  const roster = card?.rosterCount ?? 0
  return Math.max(roster - total, 0)
}

function formatWindow(card) {
  if (!card?.openTime || !card?.cutoffTime) return 'ยังไม่กำหนดเวลา'
  return `${card.openTime}–${card.cutoffTime} น.`
}

function phaseLabel(card) {
  return PHASE_LABEL[card?.phase] ?? PHASE_LABEL.none
}

loadOverview()
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
        <span class="material-symbols-outlined role-chip-icon">dashboard</span>
        <span>ผู้ควบคุมการประชุม</span>
      </div>
    </header>

    <div class="shell">
      <ControllerNav />

      <main class="page-main">
        <div class="page-head">
          <div>
            <h1>ภาพรวมการประชุม</h1>
            <p class="greeting">สวัสดี ผู้ควบคุมการประชุม</p>
            <p v-if="dateText" class="today-text">{{ dateText }}</p>
          </div>
          <v-btn variant="outlined" color="primary" :loading="loading" @click="loadOverview">
            รีเฟรช
          </v-btn>
        </div>

        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="comfortable"
          class="page-alert"
        >
          {{ errorMessage }}
        </v-alert>

        <div v-if="loading && !overview" class="state-box">
          <v-progress-circular indeterminate color="primary" size="26" />
          <span>กำลังโหลดภาพรวม…</span>
        </div>

        <template v-else-if="overview">
          <section class="card">
            <div class="card-head">
              <h2 class="card-title">ประชุมหัวหน้างาน วันนี้</h2>
              <span v-if="sup?.hasSession" class="phase-badge" :class="`phase-${sup.phase}`">
                {{ phaseLabel(sup) }}
              </span>
            </div>

            <p v-if="!sup?.hasSession" class="empty-text">วันนี้ไม่มีการประชุมหัวหน้างาน</p>

            <template v-else>
              <p class="window-line">ช่วงเวลาลงทะเบียน {{ formatWindow(sup) }}</p>

              <div class="count-grid">
                <div v-for="field in STATUS_FIELDS" :key="field.key" class="count-item" :class="`tone-${field.tone}`">
                  <span class="count-label">{{ field.label }}</span>
                  <span class="count-value">{{ sup.counts?.[field.key] ?? 0 }}</span>
                </div>
              </div>

              <div class="pending-row">
                <span class="pending-text">ยังไม่ลงทะเบียน: {{ pendingCount(sup) }} คน</span>
                <v-btn size="small" variant="tonal" color="primary" @click="togglePending('sup')">
                  {{ pending.sup.open ? 'ซ่อนรายชื่อ' : 'ดูรายชื่อ' }}
                </v-btn>
              </div>

              <div v-if="pending.sup.open" class="pending-box">
                <div v-if="pending.sup.loading" class="state-box">
                  <v-progress-circular indeterminate color="primary" size="22" />
                  <span>กำลังโหลดรายชื่อ…</span>
                </div>
                <p v-else-if="pending.sup.error" class="inline-error" role="alert">{{ pending.sup.error }}</p>
                <p v-else-if="!pending.sup.items.length" class="empty-text">ไม่มีรายชื่อที่ยังไม่ลงทะเบียน</p>
                <ul v-else class="pending-list">
                  <li v-for="person in pending.sup.items" :key="`${person.fullName}-${person.positionName}`" class="pending-item">
                    <span class="person-name">{{ person.fullName }}</span>
                    <span class="person-sub">{{ person.departmentName }} · {{ person.positionName }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </section>

          <section class="card">
            <div class="card-head">
              <h2 class="card-title">ประชุม Monthly วันนี้</h2>
              <span v-if="monthly?.hasSession" class="phase-badge" :class="`phase-${monthly.phase}`">
                {{ phaseLabel(monthly) }}
              </span>
            </div>

            <template v-if="!monthly?.hasSession">
              <p class="empty-text">ยังไม่ได้ตั้งรอบวันนี้</p>
              <v-btn
                color="primary"
                class="card-action"
                to="/meeting/controller/qr?type=monthly"
              >
                ตั้งรอบ Monthly
              </v-btn>
            </template>

            <template v-else>
              <p class="window-line">ช่วงเวลาลงทะเบียน {{ formatWindow(monthly) }}</p>

              <div class="count-grid">
                <div v-for="field in STATUS_FIELDS" :key="field.key" class="count-item" :class="`tone-${field.tone}`">
                  <span class="count-label">{{ field.label }}</span>
                  <span class="count-value">{{ monthly.counts?.[field.key] ?? 0 }}</span>
                </div>
              </div>

              <div class="pending-row">
                <span class="pending-text">ยังไม่ลงทะเบียน: {{ pendingCount(monthly) }} คน</span>
                <v-btn size="small" variant="tonal" color="primary" @click="togglePending('monthly')">
                  {{ pending.monthly.open ? 'ซ่อนรายชื่อ' : 'ดูรายชื่อ' }}
                </v-btn>
              </div>

              <div v-if="pending.monthly.open" class="pending-box">
                <div v-if="pending.monthly.loading" class="state-box">
                  <v-progress-circular indeterminate color="primary" size="22" />
                  <span>กำลังโหลดรายชื่อ…</span>
                </div>
                <p v-else-if="pending.monthly.error" class="inline-error" role="alert">{{ pending.monthly.error }}</p>
                <p v-else-if="!pending.monthly.items.length" class="empty-text">ไม่มีรายชื่อที่ยังไม่ลงทะเบียน</p>
                <ul v-else class="pending-list">
                  <li v-for="person in pending.monthly.items" :key="`${person.fullName}-${person.positionName}`" class="pending-item">
                    <span class="person-name">{{ person.fullName }}</span>
                    <span class="person-sub">{{ person.departmentName }} · {{ person.positionName }}</span>
                  </li>
                </ul>
              </div>
            </template>
          </section>

          <section class="card">
            <div class="card-head">
              <h2 class="card-title">รายชื่อประชุม</h2>
              <span class="count-tag">{{ rosterCount }} คน</span>
            </div>
            <p class="card-text">รายชื่อนี้ใช้กับทั้งประชุมหัวหน้างานและประชุม Monthly</p>
            <v-btn
              variant="outlined"
              color="primary"
              class="card-action"
              to="/meeting/controller/roster"
            >
              จัดการรายชื่อ
            </v-btn>
          </section>

          <section class="quick-actions">
            <v-btn color="primary" to="/meeting/controller/qr">ดู QR</v-btn>
            <v-btn variant="outlined" color="primary" to="/meeting/controller/qr?type=monthly">
              ตั้งรอบ Monthly
            </v-btn>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.page {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: #f4f8f5;
  font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif;
  color: #12251f;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
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
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #176c5b;
  color: #ffffff;
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
  color: #115447;
}

.brand-sub {
  font-size: 12px;
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
}

.role-chip-icon {
  font-size: 18px;
  line-height: 1;
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

.page-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
  color: #115447;
}

.greeting {
  margin: 0 0 4px;
  font-size: 15px;
  color: #3d4f49;
}

.today-text {
  margin: 0;
  font-size: 14px;
  color: #1f6f5e;
  font-weight: 600;
}

.page-alert {
  margin-bottom: 4px;
}

.state-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px;
  color: #4b5b55;
  font-size: 14px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  background: #ffffff;
  border: 1px solid #e3e8e6;
  border-radius: 18px;
  box-shadow: 0 10px 24px rgba(16, 40, 35, 0.06);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #115447;
}

.count-tag {
  padding: 4px 12px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.phase-badge {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.phase-not_open {
  background: #fdf1e4;
  color: #a75c11;
}

.phase-open {
  background: #e4f5ec;
  color: #176c5b;
}

.phase-closed {
  background: #f1f3f2;
  color: #5d6d67;
}

.phase-none {
  background: #f1f3f2;
  color: #8a9793;
}

.window-line {
  margin: 0;
  font-size: 14px;
  color: #3d4f49;
}

.empty-text {
  margin: 0;
  font-size: 14px;
  color: #6b7a75;
}

.card-text {
  margin: 0;
  font-size: 14px;
  color: #6b7a75;
}

.count-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.count-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #eef1ef;
  min-width: 0;
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

.pending-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f7faf8;
  border: 1px solid #eef1ef;
}

.pending-text {
  font-size: 14px;
  font-weight: 600;
  color: #115447;
}

.pending-box {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid #eef1ef;
}

.pending-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pending-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.person-name {
  font-size: 15px;
  font-weight: 600;
  color: #12251f;
}

.person-sub {
  font-size: 13px;
  color: #6b7a75;
}

.inline-error {
  margin: 0;
  font-size: 14px;
  color: #b3261e;
}

.card-action {
  align-self: flex-start;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 900px) {
  .shell {
    flex-direction: column;
    padding: 14px;
  }

  .topbar {
    padding: 12px 14px;
  }

  .count-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
