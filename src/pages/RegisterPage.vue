<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

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
        <div class="brand-mark">HR</div>
        <span class="brand-label">ลงทะเบียนเข้าประชุม</span>
      </header>

      <div v-if="loading" class="card state-card">
        <v-progress-circular indeterminate color="#e7752e" size="36" width="3" />
        <span class="state-card__loading-text">กำลังโหลดข้อมูล…</span>
      </div>

      <div v-else-if="loadError" class="card state-card">
        <div class="state-icon error-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h1 class="card-title">ไม่สามารถเปิดแบบฟอร์มได้</h1>
        <p class="card-text">{{ loadError }}</p>
      </div>

      <template v-else>
        <section class="card hero-card">
          <div class="meeting-head">
            <h1 class="meeting-name">{{ context?.meetingName }}</h1>
            <div class="window-row">
              <span class="window-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="window-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                วัน-เวลาลงทะเบียน
              </span>
              <span class="window-value">{{ windowLine }}</span>
            </div>
          </div>
        </section>

        <!-- Dynamic Transition Between Receipt and Form -->
        <transition name="fade-slide" mode="out-in">
          <section v-if="receipt" key="receipt-section" class="card receipt-card">
            <div class="receipt-success-badge-wrap">
              <div class="badge-pulse-ring"></div>
              <div class="receipt-success-badge">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" class="check-svg"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              </div>
            </div>
            <h2 class="card-title text-center">ลงทะเบียนเรียบร้อย</h2>
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
                <dd class="status-highlight">{{ receipt.status }}</dd>
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
                :items="employees"
                item-title="fullName"
                item-value="employeeId"
                placeholder="เลือกชื่อของท่าน"
                variant="outlined"
                density="comfortable"
                hide-details
                no-data-text="ไม่พบรายชื่อ"
              />
            </div>

            <div v-if="selectedEmployee" class="readonly-grid">
              <v-text-field
                :model-value="selectedEmployee.departmentName"
                label="แผนก"
                variant="outlined"
                density="comfortable"
                hide-details
                readonly
              />
              <v-text-field
                :model-value="selectedEmployee.positionName"
                label="ตำแหน่ง"
                variant="outlined"
                density="comfortable"
                hide-details
                readonly
              />
            </div>

            <div class="field">
              <span class="field-label">สถานะการเข้าร่วม</span>
              <v-radio-group v-model="statusCode" class="status-group" hide-details>
                <v-radio
                  v-for="status in statuses"
                  :key="status"
                  :value="status"
                  :color="STATUS_COLORS[status] ?? 'primary'"
                  class="status-option"
                  :class="{ 'status-option--active': statusCode === status }"
                >
                  <template #label>
                    <span class="status-label">{{ status }}</span>
                  </template>
                </v-radio>
              </v-radio-group>
            </div>

            <div v-if="needsShift" class="field shift-container">
              <span class="field-label">กะที่ลา</span>
              <v-radio-group v-model="shift" class="shift-group" inline hide-details>
                <v-radio v-for="item in shifts" :key="item" :value="item" :label="item" color="primary" class="shift-chip" />
              </v-radio-group>
            </div>

            <div v-if="needsReason" class="field">
              <span class="field-label">เหตุผล</span>
              <v-text-field
                v-model="reason"
                type="textarea"
                :maxlength="REASON_MAX_LENGTH"
                counter
                rows="3"
                placeholder="ระบุเหตุผลสั้น ๆ"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
              />
            </div>

            <p v-if="submitError" class="error-text" role="alert">{{ submitError }}</p>

            <v-btn
              color="primary"
              block
              class="submit-btn"
              :class="{ 'submit-btn--loading': submitting }"
              :disabled="!canSubmit"
              :loading="submitting"
              @click="submitRegistration"
            >
              ยืนยันการลงทะเบียน
            </v-btn>
          </section>

          <section v-else key="other-state-section" class="card state-card">
            <div class="state-icon warning-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
            </div>
            <h2 class="card-title">{{ stateTitle }}</h2>
            <p class="card-text">{{ context?.message }}</p>
            <p v-if="state === 'before' && windowText" class="card-text strong">{{ windowText }}</p>
          </section>
        </transition>
      </template>
    </main>

    <v-dialog :model-value="dialogOpen" max-width="420" persistent>
      <div class="dialog-card">
        <h2 class="dialog-title">{{ stateTitle }}</h2>
        <p class="dialog-text">{{ context?.message }}</p>
        <p v-if="state === 'before' && windowText" class="dialog-window">{{ windowText }}</p>
        <div class="dialog-actions">
          <v-btn color="primary" class="dialog-btn" @click="dialogOpen = false">ตกลง</v-btn>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap');

.page {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  padding: 24px 16px 48px;
  background: #f8fafc;
  background-image: 
    radial-gradient(at 0% 0%, rgba(231, 117, 46, 0.05) 0px, transparent 50%),
    radial-gradient(at 100% 100%, rgba(24, 53, 83, 0.04) 0px, transparent 50%);
  color: #1e293b;
  font-family: 'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.shell {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Brand header */
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 6px 8px;
}

.brand-mark {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: linear-gradient(135deg, #183553 0%, #0d2137 100%);
  color: #ffffff;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 6px rgba(24, 53, 83, 0.2);
}

.brand-label {
  font-size: 15px;
  font-weight: 600;
  color: #183553;
  letter-spacing: -0.2px;
}

/* Cards */
.card {
  width: 100%;
  padding: 22px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.8);
  box-shadow: 0 4px 20px -2px rgba(24, 53, 83, 0.05), 0 2px 6px -1px rgba(24, 53, 83, 0.03);
}

.hero-card {
  border-top: 3px solid #e7752e;
}

.card-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  color: #183553;
  letter-spacing: -0.3px;
}

.card-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #64748b;
}

.card-text.strong {
  margin-top: 10px;
  font-weight: 600;
  color: #cb5d1c;
  display: inline-block;
  padding: 4px 12px;
  background: #fff7ed;
  border-radius: 8px;
  border: 1px solid #ffedd5;
}

/* State cards */
.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 36px 24px;
  text-align: center;
}

.state-card__loading-text {
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
}

.state-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  margin-bottom: 4px;
}

.error-icon {
  background: #fef2f2;
  color: #ef4444;
}

.warning-icon {
  background: #fff7ed;
  color: #ea580c;
}

/* Meeting Head */
.meeting-head {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.meeting-name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.35;
  color: #183553;
  letter-spacing: -0.4px;
  overflow-wrap: anywhere;
}

.window-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fff8f2;
  border: 1px solid #fed7aa;
}

.window-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #c2410c;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.window-icon {
  flex-shrink: 0;
}

.window-value {
  font-size: 13.5px;
  font-weight: 600;
  color: #183553;
  overflow-wrap: anywhere;
}

/* Form Styles */
.field {
  margin-bottom: 20px;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: #334155;
}

.readonly-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  margin: -8px 0 20px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 14px;
  border: 1px dashed #cbd5e1;
}

/* Radio status items */
.status-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-option {
  margin: 0;
  padding: 8px 12px;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}

.status-option:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
  transform: translateY(-1px);
}

.status-option--active {
  border-color: #e7752e !important;
  background: #fff8f2 !important;
  box-shadow: 0 3px 10px rgba(231, 117, 46, 0.12);
  transform: translateY(-1px);
}

.status-label {
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
}

.shift-container {
  padding: 12px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.shift-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.shift-chip {
  margin-right: 8px;
}

.error-text {
  margin: 0 0 16px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  animation: shake 0.35s ease;
}

/* ----------------------------------------------------
   SUBMIT BUTTON ANIMATIONS & MICRO-INTERACTIONS
---------------------------------------------------- */
.submit-btn {
  margin-top: 8px;
  height: 48px !important;
  border-radius: 12px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  letter-spacing: 0.2px !important;
  background: linear-gradient(135deg, #e7752e 0%, #cb5d1c 100%) !important;
  color: #ffffff !important;
  box-shadow: 0 4px 14px rgba(231, 117, 46, 0.3) !important;
  position: relative;
  overflow: hidden;
  transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, opacity 0.2s ease !important;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1.5px);
  box-shadow: 0 6px 20px rgba(231, 117, 46, 0.4) !important;
}

.submit-btn:active:not(:disabled) {
  transform: scale(0.97) translateY(0);
  box-shadow: 0 2px 8px rgba(231, 117, 46, 0.25) !important;
}

.submit-btn:disabled {
  opacity: 0.6;
  box-shadow: none !important;
  cursor: not-allowed;
}

/* Pulsing aura when submitting */
.submit-btn--loading {
  animation: pulse-aura 1.5s infinite;
}

@keyframes pulse-aura {
  0% { box-shadow: 0 0 0 0 rgba(231, 117, 46, 0.5); }
  70% { box-shadow: 0 0 0 10px rgba(231, 117, 46, 0); }
  100% { box-shadow: 0 0 0 0 rgba(231, 117, 46, 0); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

/* ----------------------------------------------------
   RECEIPT CARD ANIMATIONS & DETAILS
---------------------------------------------------- */
.receipt-card {
  border-top: 4px solid #16a34a;
  padding: 30px 22px 24px;
  animation: receipt-pop 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.receipt-success-badge-wrap {
  position: relative;
  width: 58px;
  height: 58px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.receipt-success-badge {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #dcfce7;
  color: #16a34a;
  display: grid;
  place-items: center;
  position: relative;
  z-index: 2;
  box-shadow: 0 4px 12px rgba(22, 163, 74, 0.2);
  animation: check-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
}

.check-svg {
  stroke-dasharray: 50;
  stroke-dashoffset: 50;
  animation: draw-check 0.5s ease-out 0.35s forwards;
}

.badge-pulse-ring {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(22, 163, 74, 0.25);
  animation: pulse-ring 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite;
  z-index: 1;
}

.receipt-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 18px 0 0;
  padding: 16px;
  background: #f8fafc;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
}

.receipt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
  animation: row-fade-in 0.4s ease both;
}

/* Stagger effect for rows */
.receipt-row:nth-child(1) { animation-delay: 0.1s; }
.receipt-row:nth-child(2) { animation-delay: 0.15s; }
.receipt-row:nth-child(3) { animation-delay: 0.2s; }
.receipt-row:nth-child(4) { animation-delay: 0.25s; }
.receipt-row:nth-child(5) { animation-delay: 0.3s; }
.receipt-row:nth-child(6) { animation-delay: 0.35s; }
.receipt-row:nth-child(7) { animation-delay: 0.4s; }

.receipt-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.receipt-row dt {
  font-size: 13px;
  color: #64748b;
  font-weight: 500;
}

.receipt-row dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.status-highlight {
  color: #e7752e !important;
  font-weight: 700 !important;
}

.receipt-note {
  margin: 18px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: #16a34a;
  text-align: center;
  animation: row-fade-in 0.4s ease 0.45s both;
}

/* Keyframes */
@keyframes receipt-pop {
  0% {
    opacity: 0;
    transform: scale(0.96) translateY(12px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes check-bounce {
  0% {
    transform: scale(0);
  }
  70% {
    transform: scale(1.15);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes draw-check {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes pulse-ring {
  0% {
    transform: scale(0.9);
    opacity: 0.8;
  }
  80%, 100% {
    transform: scale(1.45);
    opacity: 0;
  }
}

@keyframes row-fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Vue Transition (fade-slide) */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Dialog */
.dialog-card {
  padding: 24px;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}

.dialog-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 700;
  color: #183553;
}

.dialog-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #475569;
}

.dialog-window {
  margin: 12px 0 0;
  font-size: 13.5px;
  font-weight: 600;
  color: #c2410c;
  background: #fff8f2;
  padding: 6px 12px;
  border-radius: 8px;
  display: inline-block;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.dialog-btn {
  border-radius: 10px !important;
  font-weight: 600 !important;
  padding: 0 20px !important;
}

/* Responsiveness */
@media (min-width: 480px) {
  .page { padding: 32px 20px 56px; }
  .card { padding: 26px; }
  .meeting-name { font-size: 22px; }
}

@media (min-width: 600px) {
  .readonly-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .window-row { flex-direction: row; align-items: center; justify-content: space-between; }
}
</style>