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
        <v-progress-circular indeterminate color="primary" size="28" />
        <span>กำลังโหลดข้อมูล…</span>
      </div>

      <div v-else-if="loadError" class="card state-card">
        <h1 class="card-title">ไม่สามารถเปิดแบบฟอร์มได้</h1>
        <p class="card-text">{{ loadError }}</p>
      </div>

      <template v-else>
        <section class="card">
          <div class="meeting-head">
            <h1 class="meeting-name">{{ context?.meetingName }}</h1>
            <div class="window-row">
              <span class="window-label">วัน-เวลาลงทะเบียน</span>
              <span class="window-value">{{ windowLine }}</span>
            </div>
          </div>
        </section>

        <section v-if="receipt" class="card">
          <h2 class="card-title">ลงทะเบียนเรียบร้อย</h2>
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
              <dd>{{ receipt.status }}</dd>
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

        <section v-else-if="state === 'open'" class="card">
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

          <div v-if="needsShift" class="field">
            <span class="field-label">กะที่ลา</span>
            <v-radio-group v-model="shift" class="shift-group" inline hide-details>
              <v-radio v-for="item in shifts" :key="item" :value="item" :label="item" color="primary" />
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
            :disabled="!canSubmit"
            :loading="submitting"
            @click="submitRegistration"
          >
            ยืนยันการลงทะเบียน
          </v-btn>
        </section>

        <section v-else class="card state-card">
          <h2 class="card-title">{{ stateTitle }}</h2>
          <p class="card-text">{{ context?.message }}</p>
          <p v-if="state === 'before' && windowText" class="card-text strong">{{ windowText }}</p>
        </section>
      </template>
    </main>

    <v-dialog :model-value="dialogOpen" max-width="420" persistent>
      <div class="dialog-card">
        <h2 class="dialog-title">{{ stateTitle }}</h2>
        <p class="dialog-text">{{ context?.message }}</p>
        <p v-if="state === 'before' && windowText" class="dialog-window">{{ windowText }}</p>
        <div class="dialog-actions">
          <v-btn color="primary" @click="dialogOpen = false">ตกลง</v-btn>
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
  padding: 20px 16px 40px;
  background: #f7f4ee;
  color: #183553;
  font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', sans-serif;
}

.shell {
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 4px 6px;
}

.brand-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #183553;
  color: #ffffff;
  font: 600 13px/1 'IBM Plex Sans Thai', sans-serif;
}

.brand-label {
  font-size: 14px;
  font-weight: 600;
  color: #183553;
}

.card {
  width: 100%;
  padding: 20px;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(24, 53, 83, 0.08), 0 2px 6px rgba(24, 53, 83, 0.04);
}

.card-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: #183553;
}

.card-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #4a5a6b;
}

.card-text.strong {
  margin-top: 8px;
  font-weight: 600;
  color: #cb5d1c;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.meeting-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meeting-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.35;
  color: #183553;
  overflow-wrap: anywhere;
}

.window-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #fdf1e7;
}

.window-label {
  font-size: 12px;
  font-weight: 500;
  color: #cb5d1c;
}

.window-value {
  font-size: 14px;
  font-weight: 600;
  color: #183553;
  overflow-wrap: anywhere;
}

.field {
  margin-bottom: 18px;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #183553;
}

.readonly-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  margin: -6px 0 18px;
}

.status-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status-option {
  margin: 0;
  padding: 10px 12px;
  border: 1.5px solid #e3ddd2;
  border-radius: 14px;
  background: #ffffff;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.status-option--active {
  border-color: #e7752e;
  background: #fff8f2;
}

.status-label {
  font-size: 14px;
  font-weight: 500;
  color: #183553;
}

.shift-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.error-text {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #fdecec;
  color: #b3261e;
  font-size: 13px;
  line-height: 1.6;
}

.submit-btn {
  margin-top: 4px;
  height: 48px;
  border-radius: 14px;
  font-weight: 600;
  background: #e7752e !important;
  color: #ffffff !important;
}

.submit-btn:hover {
  background: #cb5d1c !important;
}

.receipt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 0;
}

.receipt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0ebe2;
}

.receipt-row dt {
  font-size: 13px;
  color: #6b7a89;
}

.receipt-row dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-align: right;
  color: #183553;
  overflow-wrap: anywhere;
}

.receipt-note {
  margin: 16px 0 0;
  font-size: 13px;
  color: #cb5d1c;
  text-align: center;
}

.dialog-card {
  padding: 22px 20px;
  border-radius: 22px;
  background: #ffffff;
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
  line-height: 1.7;
  color: #4a5a6b;
}

.dialog-window {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: #cb5d1c;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}

@media (min-width: 480px) {
  .page { padding: 28px 20px 48px; }
  .card { padding: 24px; }
  .meeting-name { font-size: 24px; }
}

@media (min-width: 600px) {
  .readonly-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .window-row { flex-direction: row; align-items: baseline; justify-content: space-between; }
}
</style>
