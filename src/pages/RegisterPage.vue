<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

// Fonts ship with the project (no CDN). Thai glyphs come from IBM Plex Sans Thai,
// Latin/digits from IBM Plex Sans.
import '@fontsource/ibm-plex-sans-thai/thai-400.css'
import '@fontsource/ibm-plex-sans-thai/thai-500.css'
import '@fontsource/ibm-plex-sans-thai/thai-600.css'
import '@fontsource/ibm-plex-sans-thai/thai-700.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'

const LINK_ERROR_MESSAGE = 'ลิงก์ไม่ถูกต้อง กรุณาสแกน QR ใหม่อีกครั้ง'
const LOAD_ERROR_MESSAGE = 'โหลดข้อมูลการลงทะเบียนไม่สำเร็จ กรุณาลองใหม่'
const SERVER_ERROR_MESSAGE = 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'
const REASON_MAX_LENGTH = 200

const STATUS_COLORS = {
  'เข้าร่วมประชุม': 'success',
  'ไม่เข้าร่วม': 'grey',
  'ติดงานด่วน': 'orange',
  'ลาประชุม': 'blue',
}

const route = useRoute()

const context = ref(null)
const loading = ref(true)
const loadError = ref('')
const dialogOpen = ref(false)
const submitting = ref(false)
const submitError = ref('')
const receipt = ref(null)

const selectedEmployeeId = ref(null)
const statusCode = ref('')
const shift = ref('')
const reason = ref('')

const token = computed(() => (typeof route.query.t === 'string' ? route.query.t : ''))
const state = computed(() => context.value?.state ?? '')
const employees = computed(() => context.value?.employees ?? [])
const statuses = computed(() => context.value?.statuses ?? [])
const shifts = computed(() => context.value?.shifts ?? [])
const reasonStatuses = computed(() => context.value?.reasonStatuses ?? [])
const leaveStatus = computed(() => context.value?.leaveStatus ?? 'ลาประชุม')
const selectedEmployee = computed(() => employees.value.find((item) => item.employeeId === selectedEmployeeId.value) ?? null)
const needsShift = computed(() => statusCode.value === leaveStatus.value)
const needsReason = computed(() => reasonStatuses.value.includes(statusCode.value))
const reasonHint = computed(() => (needsReason.value ? '(จำเป็นต้องระบุเหตุผล)' : '(กรณีไม่สะดวกเข้าร่วม)'))
const windowText = computed(() => {
  const open = context.value?.openTime
  const cutoff = context.value?.cutoffTime
  if (!open || !cutoff) return ''
  return `เปิดรับ ${open}–${cutoff} น.`
})
const windowLine = computed(() => {
  const open = context.value?.openTime
  const cutoff = context.value?.cutoffTime
  if (!open || !cutoff) return 'ยังไม่กำหนดเวลา'
  return `${formatThaiDate(todayInBangkok())} · ${open}–${cutoff} น.`
})
const stateTitle = computed(() => {
  if (state.value === 'before') return 'ยังไม่เปิดลงทะเบียน'
  if (state.value === 'after') return 'หมดเวลาลงทะเบียน'
  return 'ยังไม่พบรอบประชุม'
})
const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!selectedEmployeeId.value || !statusCode.value) return false
  if (needsShift.value && !shifts.value.includes(shift.value)) return false
  const reasonLength = reason.value.trim().length
  if (needsReason.value && (reasonLength < 1 || reasonLength > REASON_MAX_LENGTH)) return false
  return true
})

function todayInBangkok() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function formatThaiDate(value) {
  const parsed = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

async function loadContext() {
  loading.value = true
  loadError.value = ''

  if (!token.value) {
    loadError.value = LINK_ERROR_MESSAGE
    loading.value = false
    return
  }

  try {
    const response = await fetch(`/api/register/context?t=${encodeURIComponent(token.value)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    if (!response.ok || data.ok !== true) {
      loadError.value = typeof data.message === 'string' ? data.message : LINK_ERROR_MESSAGE
      return
    }
    context.value = data
    if (data.state !== 'open') dialogOpen.value = true
  } catch {
    loadError.value = LOAD_ERROR_MESSAGE
  } finally {
    loading.value = false
  }
}

async function submitRegistration() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const response = await fetch('/api/register/submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        t: token.value,
        employeeId: selectedEmployeeId.value,
        statusCode: statusCode.value,
        shift: needsShift.value ? shift.value : null,
        reason: needsReason.value ? reason.value.trim() : null,
      }),
    })
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    if (response.status === 403 || response.status === 409) {
      submitError.value = typeof data.message === 'string' ? data.message : SERVER_ERROR_MESSAGE
      return
    }
    if (!response.ok || data.ok !== true) {
      submitError.value = typeof data.message === 'string' ? data.message : SERVER_ERROR_MESSAGE
      return
    }
    receipt.value = data.summary
  } catch {
    submitError.value = SERVER_ERROR_MESSAGE
  } finally {
    submitting.value = false
  }
}

watch(statusCode, (value) => {
  if (value !== leaveStatus.value) shift.value = ''
  if (!reasonStatuses.value.includes(value)) reason.value = ''
})

onMounted(loadContext)
</script>

<template>
  <div class="page">
    <main class="shell">
      <header class="brand">
        <div class="brand-mark" aria-hidden="true">HR</div>
        <div class="brand-copy">
          <span class="brand-label">ลงทะเบียนเข้าประชุม</span>
          <span class="brand-sub">แบบฟอร์มสำหรับพนักงาน</span>
        </div>
      </header>

      <section v-if="loading" class="card state-card" aria-live="polite">
        <v-progress-circular indeterminate color="#00203b" size="32" width="3" />
        <span class="state-card__loading-text">กำลังโหลดข้อมูล…</span>
      </section>

      <section v-else-if="loadError" class="card state-card" role="alert">
        <div class="state-icon state-icon--error">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h1 class="card-title">ไม่สามารถเปิดแบบฟอร์มได้</h1>
        <p class="card-text">{{ loadError }}</p>
      </section>

      <template v-else>
        <section class="meeting-card">
          <p class="meeting-eyebrow">รอบประชุม</p>
          <h1 class="meeting-name">{{ context?.meetingName }}</h1>
          <div class="meeting-meta">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span class="meeting-meta__label">วัน-เวลาลงทะเบียน</span>
            <span class="meeting-meta__value">{{ windowLine }}</span>
          </div>
        </section>

        <transition name="fade-slide" mode="out-in">
          <section v-if="receipt" key="receipt-section" class="card receipt-card">
            <div class="receipt-badge" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 class="card-title card-title--center">ลงทะเบียนเรียบร้อย</h2>
            <dl class="receipt-list">
              <div class="receipt-row">
                <dt>ชื่อ-นามสกุล</dt>
                <dd>{{ receipt.name }}</dd>
              </div>
              <div class="receipt-row">
                <dt>แผนก</dt>
                <dd>{{ receipt.dept }}</dd>
              </div>
              <div class="receipt-row">
                <dt>ตำแหน่ง</dt>
                <dd>{{ receipt.level }}</dd>
              </div>
              <div class="receipt-row">
                <dt>สถานะ</dt>
                <dd class="receipt-status">{{ receipt.status }}</dd>
              </div>
              <div v-if="receipt.shift" class="receipt-row">
                <dt>กะที่ลา</dt>
                <dd>{{ receipt.shift }}</dd>
              </div>
              <div class="receipt-row">
                <dt>รอบประชุม</dt>
                <dd>{{ receipt.meetingName }}</dd>
              </div>
              <div class="receipt-row">
                <dt>บันทึกเมื่อ</dt>
                <dd>{{ receipt.savedAt }}</dd>
              </div>
            </dl>
            <p class="receipt-note">สามารถปิดหน้านี้ได้ทันที</p>
          </section>

          <section v-else-if="state === 'open'" key="form-section" class="card form-card">
            <div class="field">
              <label class="field-label" for="employee">รายชื่อของคุณ</label>
              <v-select
                id="employee"
                v-model="selectedEmployeeId"
                class="register-select"
                :items="employees"
                item-title="fullName"
                item-value="employeeId"
                placeholder="พิมพ์ชื่อเพื่อค้นหา"
                variant="outlined"
                density="comfortable"
                hide-details
                no-data-text="ไม่พบรายชื่อ"
              />
              <p class="field-hint">เลือกชื่อของท่านจากรายการ</p>
            </div>

            <div v-if="selectedEmployee" class="readout">
              <div class="readout-item">
                <span class="readout-label">แผนก</span>
                <span class="readout-value">{{ selectedEmployee.departmentName }}</span>
              </div>
              <div class="readout-item">
                <span class="readout-label">ตำแหน่ง</span>
                <span class="readout-value">{{ selectedEmployee.positionName }}</span>
              </div>
            </div>

            <fieldset class="field fieldset">
              <legend class="field-label">สถานะการเข้าร่วม</legend>
              <div class="status-list">
                <label
                  v-for="status in statuses"
                  :key="status"
                  class="status-card"
                  :class="{ 'status-card--active': statusCode === status }"
                >
                  <input
                    v-model="statusCode"
                    class="status-input"
                    type="radio"
                    name="attendance-status"
                    :value="status"
                  />
                  <span class="status-radio" aria-hidden="true"></span>
                  <span class="status-text">
                    <span
                      class="status-dot"
                      :class="`status-dot--${STATUS_COLORS[status] ?? 'grey'}`"
                      aria-hidden="true"
                    ></span>
                    {{ status }}
                  </span>
                </label>
              </div>
            </fieldset>

            <fieldset v-if="needsShift" class="field fieldset">
              <legend class="field-label">กะที่ลา</legend>
              <div class="shift-list">
                <label
                  v-for="item in shifts"
                  :key="item"
                  class="shift-chip"
                  :class="{ 'shift-chip--active': shift === item }"
                >
                  <input
                    v-model="shift"
                    class="shift-input"
                    type="radio"
                    name="leave-shift"
                    :value="item"
                  />
                  <span>{{ item }}</span>
                </label>
              </div>
            </fieldset>

            <div v-if="needsReason" class="field">
              <div class="field-head">
                <label class="field-label" for="reason">เหตุผล</label>
                <span class="field-hint field-hint--inline">{{ reasonHint }}</span>
              </div>
              <textarea
                id="reason"
                v-model="reason"
                class="reason-input"
                :maxlength="REASON_MAX_LENGTH"
                rows="3"
                placeholder="ระบุเหตุผลสั้น ๆ"
              ></textarea>
              <div class="reason-count">{{ reason.length }}/{{ REASON_MAX_LENGTH }}</div>
            </div>

            <p v-if="submitError" class="error-text" role="alert">{{ submitError }}</p>

            <button
              type="button"
              class="submit-btn"
              :disabled="!canSubmit"
              @click="submitRegistration"
            >
              <span v-if="submitting" class="submit-spinner" aria-hidden="true"></span>
              {{ submitting ? 'กำลังบันทึก…' : 'ยืนยันการลงทะเบียน' }}
            </button>
          </section>

          <section v-else key="other-state-section" class="card state-card">
            <div class="state-icon state-icon--warning">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 class="card-title">{{ stateTitle }}</h2>
            <p class="card-text">{{ context?.message }}</p>
            <p v-if="state === 'before' && windowText" class="card-text strong">{{ windowText }}</p>
          </section>
        </transition>
      </template>
    </main>

    <v-dialog :model-value="dialogOpen" max-width="420" persistent>
      <div class="dialog-card" role="dialog" aria-modal="true">
        <h2 class="dialog-title">{{ stateTitle }}</h2>
        <p class="dialog-text">{{ context?.message }}</p>
        <p v-if="state === 'before' && windowText" class="dialog-window">{{ windowText }}</p>
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" @click="dialogOpen = false">ตกลง</button>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<style scoped>
.page {
  --primary: #00203b;
  --primary-container: #183553;
  --secondary-container: #fc853d;
  --secondary: #9d4400;
  --surface: #f7f9fb;
  --surface-lowest: #ffffff;
  --surface-low: #f2f4f6;
  --surface-container: #eceef0;
  --on-surface: #191c1e;
  --on-surface-variant: #43474d;
  --outline-variant: #c3c6ce;
  --error: #ba1a1a;

  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  padding: 20px 16px 40px;
  background: var(--surface);
  color: var(--on-surface);
  font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.shell {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

/* Header */
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 2px 6px;
}

.brand-mark {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: var(--primary);
  color: var(--surface-lowest);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.brand-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--primary);
  letter-spacing: -0.2px;
}

.brand-sub {
  font-size: 12px;
  color: var(--on-surface-variant);
}

/* Cards */
.card {
  width: 100%;
  min-width: 0;
  padding: 20px;
  border-radius: 18px;
  background: var(--surface-lowest);
  border: 1px solid var(--surface-container);
}

/* Meeting header */
.meeting-card {
  width: 100%;
  min-width: 0;
  padding: 20px;
  border-radius: 18px;
  background: var(--primary);
  color: #ffffff;
}

.meeting-eyebrow {
  margin: 0 0 6px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #a8bdd4;
}

.meeting-name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: -0.3px;
  color: #ffffff;
  overflow-wrap: anywhere;
}

.meeting-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--primary-container);
  color: #d7e4f0;
}

.meeting-meta__label {
  font-size: 12px;
  font-weight: 500;
  color: #a8bdd4;
}

.meeting-meta__value {
  flex: 1 1 100%;
  font-size: 13.5px;
  font-weight: 600;
  color: #ffffff;
  overflow-wrap: anywhere;
}

/* State cards */
.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 20px;
  text-align: center;
}

.state-card__loading-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface-variant);
}

.state-icon {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: grid;
  place-items: center;
}

.state-icon--error {
  background: #fdecec;
  color: var(--error);
}

.state-icon--warning {
  background: var(--surface-low);
  color: var(--primary-container);
}

.card-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: -0.2px;
}

.card-title--center {
  text-align: center;
  margin-top: 4px;
}

.card-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--on-surface-variant);
}

.card-text.strong {
  margin-top: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  background: var(--surface-low);
  font-weight: 600;
  color: var(--primary-container);
}

/* Form fields */
.field {
  margin-bottom: 20px;
  min-width: 0;
}

.field:last-of-type {
  margin-bottom: 16px;
}

.fieldset {
  margin: 0 0 20px;
  padding: 0;
  border: 0;
}

.fieldset legend {
  padding: 0;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--on-surface);
}

.field-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 10px;
}

.field-head .field-label {
  margin-bottom: 8px;
}

.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--on-surface-variant);
}

.field-hint--inline {
  margin: 0 0 8px;
}

/* Employee select (Vuetify) */
.register-select :deep(.v-field) {
  border-radius: 12px;
  background: var(--surface-lowest);
  font-size: 14.5px;
}

.register-select :deep(.v-field__outline) {
  color: var(--outline-variant);
}

.register-select :deep(.v-field--focused .v-field__outline) {
  color: var(--primary);
}

.register-select :deep(.v-label) {
  font-size: 14px;
  color: var(--on-surface-variant);
}

.register-select :deep(.v-select__selection-text),
.register-select :deep(input) {
  color: var(--on-surface);
}

/* Read-only employee details */
.readout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  margin: -8px 0 20px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-low);
}

.readout-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.readout-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: var(--on-surface-variant);
}

.readout-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
  overflow-wrap: anywhere;
}

/* Status cards with real radio inputs */
.status-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 12px 14px;
  border: 1.5px solid var(--outline-variant);
  border-radius: 14px;
  background: var(--surface-lowest);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.status-card:hover {
  border-color: var(--primary-container);
  background: var(--surface-low);
}

.status-card--active {
  border-color: var(--primary);
  background: var(--surface-low);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.status-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}

.status-radio {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--outline-variant);
  border-radius: 50%;
  background: var(--surface-lowest);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.status-card--active .status-radio {
  border-color: var(--primary);
  box-shadow: inset 0 0 0 4px var(--surface-lowest), inset 0 0 0 12px var(--primary);
}

.status-card:focus-within {
  outline: 3px solid rgba(252, 133, 61, 0.55);
  outline-offset: 2px;
}

.status-text {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14.5px;
  font-weight: 500;
  color: var(--on-surface);
  overflow-wrap: anywhere;
}

.status-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--outline-variant);
}

.status-dot--success {
  background: #2f7d5d;
}

.status-dot--grey {
  background: #8a8f96;
}

.status-dot--orange {
  background: var(--secondary);
}

.status-dot--blue {
  background: var(--primary-container);
}

/* Shift chips */
.shift-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.shift-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 10px 16px;
  border: 1.5px solid var(--outline-variant);
  border-radius: 999px;
  background: var(--surface-lowest);
  font-size: 14px;
  font-weight: 500;
  color: var(--on-surface);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.shift-chip:hover {
  border-color: var(--primary-container);
  background: var(--surface-low);
}

.shift-chip--active {
  border-color: var(--primary);
  background: var(--primary);
  color: #ffffff;
}

.shift-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.shift-chip:focus-within {
  outline: 3px solid rgba(252, 133, 61, 0.55);
  outline-offset: 2px;
}

/* Reason */
.reason-input {
  display: block;
  width: 100%;
  min-width: 0;
  padding: 12px 14px;
  border: 1.5px solid var(--outline-variant);
  border-radius: 12px;
  background: var(--surface-lowest);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 14.5px;
  line-height: 1.6;
  resize: vertical;
}

.reason-input::placeholder {
  color: #8a9099;
}

.reason-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 32, 59, 0.12);
}

.reason-count {
  margin-top: 6px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--on-surface-variant);
}

/* Error */
.error-text {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fdecec;
  border: 1px solid #f3c6c6;
  color: var(--error);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
}

/* Submit */
.submit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 50px;
  padding: 0 20px;
  border: 0;
  border-radius: 14px;
  background: var(--secondary-container);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.1px;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.12s ease;
}

.submit-btn:hover:not(:disabled) {
  filter: brightness(1.04);
}

.submit-btn:active:not(:disabled) {
  transform: scale(0.99);
}

.submit-btn:focus-visible {
  outline: 3px solid rgba(0, 32, 59, 0.45);
  outline-offset: 2px;
}

.submit-btn:disabled {
  background: var(--surface-container);
  color: #8a9099;
  cursor: not-allowed;
}

.submit-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(25, 28, 30, 0.25);
  border-top-color: var(--on-surface);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Receipt */
.receipt-card {
  padding: 24px 20px 20px;
  border-color: #cfe3d8;
}

.receipt-badge {
  width: 52px;
  height: 52px;
  margin: 0 auto 12px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--primary);
  color: #ffffff;
  animation: badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes badge-pop {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.receipt-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 18px 0 0;
  padding: 16px;
  border-radius: 14px;
  background: var(--surface-low);
}

.receipt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--surface-container);
}

.receipt-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.receipt-row dt {
  flex: 0 0 auto;
  font-size: 13px;
  color: var(--on-surface-variant);
}

.receipt-row dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  color: var(--on-surface);
  overflow-wrap: anywhere;
}

.receipt-status {
  color: var(--secondary);
  font-weight: 700;
}

.receipt-note {
  margin: 16px 0 0;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  color: var(--on-surface-variant);
}

/* Transition */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* Dialog (teleported outside .page, so colours and font are set here) */
.dialog-card {
  padding: 24px;
  border-radius: 20px;
  background: #ffffff;
  color: #191c1e;
  font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  box-shadow: 0 18px 40px rgba(0, 32, 59, 0.18);
}

.dialog-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  color: #00203b;
}

.dialog-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #43474d;
}

.dialog-window {
  display: inline-block;
  margin: 12px 0 0;
  padding: 6px 12px;
  border-radius: 8px;
  background: #f2f4f6;
  font-size: 13.5px;
  font-weight: 600;
  color: #183553;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.dialog-btn {
  min-height: 44px;
  padding: 0 20px;
  border: 0;
  border-radius: 12px;
  background: #00203b;
  color: #ffffff;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
}

.dialog-btn:focus-visible {
  outline: 3px solid rgba(252, 133, 61, 0.65);
  outline-offset: 2px;
}

@media (min-width: 600px) {
  .readout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
