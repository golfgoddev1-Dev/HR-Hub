<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import LeaveNav from '../components/LeaveNav.vue'
import { retentionNotice } from '../leave-certificate.js'
// The same pure rules module the Worker stores with, so the live preview can
// never disagree with the saved row.
import {
  OT_VALUES,
  attachmentRequiredFor,
  computeLeave,
  isDateString,
} from '../../worker/src/leave-rules.js'

const LOAD_ERROR = 'โหลดข้อมูลสำหรับยื่นใบลาไม่สำเร็จ กรุณาลองใหม่'
const SUBMIT_ERROR = 'ยื่นใบลาไม่สำเร็จ กรุณาลองใหม่'
const REASON_MAX = 1000
const OTHER_MAX = 100

const loading = ref(true)
const loadError = ref('')
const submitting = ref(false)
const submitError = ref('')
const receipt = ref(null)

const types = ref([])
const shifts = ref([])
const holidaySet = ref(new Set())

const leaveTypeId = ref(null)
const shiftCode = ref('')
const startDate = ref('')
const endDate = ref('')
const otOption = ref('')
const otherDetail = ref('')
const reason = ref('')
const attachmentFile = ref(null)
const attachmentName = ref('')
// From leave_settings.certificate_retention_days, read on every load.
const retentionDays = ref(0)

const selectedType = computed(() => types.value.find((type) => type.id === leaveTypeId.value) ?? null)
const selectedShift = computed(() => shifts.value.find((shift) => shift.code === shiftCode.value) ?? null)
const isHalf = computed(() => selectedShift.value?.isHalf === true)
const isOther = computed(() => selectedType.value?.isOther === true)

const preview = computed(() => {
  if (!selectedType.value || !selectedShift.value) return null
  if (!isDateString(startDate.value)) return null
  const last = isHalf.value ? startDate.value : endDate.value || startDate.value
  if (!isDateString(last)) return null
  return computeLeave({
    startDate: startDate.value,
    endDate: last,
    shift: selectedShift.value,
    otOption: otOption.value,
    holidays: holidaySet.value,
  })
})

const previewDays = computed(() => (preview.value?.ok === true ? preview.value.days : null))
const needsAttachment = computed(
  () => previewDays.value !== null && attachmentRequiredFor(selectedType.value, previewDays.value)
)
const otherTooLong = computed(() => Array.from(otherDetail.value.trim()).length > OTHER_MAX)

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!selectedType.value || !selectedShift.value) return false
  if (preview.value?.ok !== true) return false
  if (isOther.value && (otherDetail.value.trim().length === 0 || otherTooLong.value)) return false
  if (isHalf.value && !OT_VALUES.includes(otOption.value)) return false
  if (needsAttachment.value && !attachmentFile.value) return false
  return true
})

function thaiDate(value) {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

// A half day is always one date, so the end field follows the start field.
watch(isHalf, (half) => {
  if (half) endDate.value = startDate.value
  if (!half) otOption.value = ''
})

watch(startDate, (value) => {
  if (isHalf.value) endDate.value = value
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [typesResponse, shiftsResponse, holidaysResponse] = await Promise.all([
      fetch('/api/leave/types', { credentials: 'same-origin' }),
      fetch('/api/leave/shifts', { credentials: 'same-origin' }),
      fetch('/api/leave/holidays', { credentials: 'same-origin' }),
    ])

    const typesData = await typesResponse.json().catch(() => ({}))
    const shiftsData = await shiftsResponse.json().catch(() => ({}))
    const holidaysData = await holidaysResponse.json().catch(() => ({}))

    if (!typesResponse.ok || typesData.ok !== true) {
      loadError.value = typeof typesData.message === 'string' ? typesData.message : LOAD_ERROR
      return
    }

    types.value = Array.isArray(typesData.types) ? typesData.types : []
    shifts.value = Array.isArray(shiftsData.shifts) ? shiftsData.shifts : []
    retentionDays.value = Number(typesData.certificateRetentionDays) || 0

    // Holidays are required: without them the day count would be wrong, so the
    // form refuses to calculate (the Worker refuses too).
    if (!holidaysResponse.ok || holidaysData.ok !== true) {
      loadError.value =
        typeof holidaysData.message === 'string'
          ? holidaysData.message
          : 'ระบบวันหยุดยังไม่พร้อม กรุณาติดต่อฝ่ายบุคคล'
      return
    }

    const dates = Array.isArray(holidaysData.dates) ? holidaysData.dates : []
    holidaySet.value = new Set(dates)

    leaveTypeId.value = types.value[0]?.id ?? null
    const fullDay =
      shifts.value.find((shift) => shift.code === 'DAY_FULL') ??
      shifts.value.find((shift) => shift.isHalf !== true) ??
      shifts.value[0] ??
      null
    shiftCode.value = fullDay?.code ?? ''
  } catch {
    loadError.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''

  // Multipart, because the certificate is uploaded with the same request. The
  // browser sets the boundary, so Content-Type is not set by hand.
  const form = new FormData()
  form.append('leaveTypeId', leaveTypeId.value ?? '')
  form.append('shiftCode', shiftCode.value)
  form.append('startDate', startDate.value)
  form.append('endDate', isHalf.value ? startDate.value : endDate.value || startDate.value)
  if (isOther.value) form.append('otherTypeDetail', otherDetail.value.trim())
  const trimmedReason = reason.value.trim()
  if (trimmedReason.length > 0) form.append('reason', trimmedReason)
  if (isHalf.value) form.append('otOption', otOption.value)
  if (attachmentFile.value) form.append('certificate', attachmentFile.value)

  try {
    const response = await fetch('/api/leave/requests', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    })
    const data = await response.json().catch(() => ({}))
    if (response.status !== 201 || data.ok !== true) {
      submitError.value = typeof data.message === 'string' ? data.message : SUBMIT_ERROR
      return
    }
    receipt.value = data.request ?? {}
  } catch {
    submitError.value = SUBMIT_ERROR
  } finally {
    submitting.value = false
  }
}

function onFileChange(event) {
  const file = event?.target?.files?.[0] ?? null
  attachmentFile.value = file
  attachmentName.value = file?.name ?? ''
}

function startOver() {
  receipt.value = null
  submitError.value = ''
  startDate.value = ''
  endDate.value = ''
  otOption.value = ''
  otherDetail.value = ''
  reason.value = ''
  attachmentFile.value = null
  attachmentName.value = ''
}

onMounted(load)
</script>

<template>
  <div class="page">
    <LeaveNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">ยื่นใบลา</h1>
          <p class="sub">
            ระบบคำนวณวันทำการ (จันทร์–เสาร์ ไม่นับวันอาทิตย์และวันหยุด) และวันกลับมาทำงานให้อัตโนมัติ
          </p>
        </div>
        <RouterLink to="/leave" class="back-link">← ใบลาของฉัน</RouterLink>
      </div>

      <p v-if="loading" class="hint">กำลังโหลด…</p>

      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>

      <section v-else-if="receipt" class="card receipt">
        <h2 class="receipt-title">ยื่นใบลาเรียบร้อย</h2>
        <p class="receipt-code">รหัสใบลา: {{ receipt.requestCode || '—' }}</p>
        <dl class="facts">
          <div class="fact">
            <dt>ประเภท</dt>
            <dd>{{ receipt.leaveTypeName || '—' }}</dd>
          </div>
          <div class="fact">
            <dt>ช่วงวันที่</dt>
            <dd>
              {{ thaiDate(receipt.startDate) }}
              <template v-if="receipt.endDate && receipt.endDate !== receipt.startDate">
                – {{ thaiDate(receipt.endDate) }}
              </template>
            </dd>
          </div>
          <div class="fact">
            <dt>จำนวนวัน</dt>
            <dd>{{ receipt.days }}</dd>
          </div>
          <div class="fact">
            <dt>กลับมาทำงาน</dt>
            <dd>{{ thaiDate(receipt.returnDate) }} {{ receipt.returnTime || '' }}</dd>
          </div>
        </dl>
        <p class="receipt-note">รอผู้อนุมัติตรวจสอบ สถานะจะแสดงในหน้า “ใบลาของฉัน”</p>
        <div class="actions">
          <RouterLink to="/leave" class="primary-link">ดูรายการใบลา</RouterLink>
          <button type="button" class="ghost-btn" @click="startOver">ยื่นอีกใบ</button>
        </div>
      </section>

      <section v-else class="card">
        <div class="field">
          <label class="label" for="leave-type">ประเภทการลา</label>
          <v-select
            id="leave-type"
            v-model="leaveTypeId"
            :items="types"
            item-title="name"
            item-value="id"
            variant="outlined"
            density="comfortable"
            hide-details
            no-data-text="ไม่พบประเภทการลา"
          />
        </div>

        <div v-if="isOther" class="field">
          <label class="label" for="other-detail">ระบุประเภทการลาอื่น ๆ</label>
          <input
            id="other-detail"
            v-model="otherDetail"
            class="input"
            type="text"
            :maxlength="OTHER_MAX"
            placeholder="เช่น ลาศึกษาต่อ"
          />
          <p class="counter">{{ otherDetail.length }}/{{ OTHER_MAX }}</p>
        </div>

        <div class="field">
          <label class="label" for="shift">กะการทำงาน</label>
          <v-select
            id="shift"
            v-model="shiftCode"
            :items="shifts"
            item-title="label"
            item-value="code"
            variant="outlined"
            density="comfortable"
            hide-details
            no-data-text="ไม่พบกะการทำงาน"
          />
        </div>

        <div class="row">
          <div class="field">
            <label class="label" for="start-date">วันที่เริ่มลา</label>
            <input id="start-date" v-model="startDate" class="input" type="date" />
          </div>
          <div class="field">
            <label class="label" for="end-date">วันที่สิ้นสุด</label>
            <input
              id="end-date"
              v-model="endDate"
              class="input"
              type="date"
              :disabled="isHalf"
              :min="startDate || undefined"
            />
          </div>
        </div>

        <fieldset v-if="isHalf" class="field">
          <legend class="label">ใช้ OT หรือไม่</legend>
          <div class="chips">
            <label
              v-for="option in OT_VALUES"
              :key="option"
              class="chip"
              :class="{ 'chip-active': otOption === option }"
            >
              <input v-model="otOption" type="radio" name="ot-option" :value="option" />
              <span>{{ option }}</span>
            </label>
          </div>
        </fieldset>

        <div class="field">
          <label class="label" for="reason">เหตุผล (ไม่บังคับ)</label>
          <textarea
            id="reason"
            v-model="reason"
            class="input textarea"
            rows="3"
            :maxlength="REASON_MAX"
            placeholder="ระบุเหตุผลสั้น ๆ"
          ></textarea>
          <p class="counter">{{ reason.length }}/{{ REASON_MAX }}</p>
        </div>

        <div v-if="needsAttachment" class="field">
          <label class="label" for="attachment">
            ใบรับรองแพทย์ (JPG, PNG หรือ PDF ไม่เกิน 10 MB)
          </label>
          <input
            id="attachment"
            class="input"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            @change="onFileChange"
          />
          <p v-if="attachmentName" class="hint-small">เลือกไฟล์: {{ attachmentName }}</p>
          <p v-else class="hint-small">การลาครั้งนี้ต้องแนบใบรับรองแพทย์</p>
          <p v-if="retentionDays > 0" class="hint-small">{{ retentionNotice(retentionDays) }}</p>
        </div>

        <div class="preview">
          <template v-if="preview?.ok === true">
            <div class="preview-item">
              <span class="preview-label">จำนวนวัน</span>
              <span class="preview-value">{{ preview.days }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">กลับมาทำงาน</span>
              <span class="preview-value">{{ thaiDate(preview.returnDate) }} {{ preview.returnTime }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">เวลาเลิกงาน</span>
              <span class="preview-value">{{ preview.shiftEndOverride || '—' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">OT</span>
              <span class="preview-value">{{ preview.otOption }}</span>
            </div>
          </template>
          <p v-else-if="preview" class="preview-error">{{ preview.message }}</p>
          <p v-else class="hint-small">เลือกประเภทการลาและวันที่เพื่อดูผลคำนวณ</p>
        </div>

        <p v-if="submitError" class="error-text" role="alert">{{ submitError }}</p>

        <button type="button" class="primary-btn" :disabled="!canSubmit" @click="submit">
          {{ submitting ? 'กำลังบันทึก…' : 'ยืนยันการยื่นใบลา' }}
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
}

.sub {
  margin: 0;
  max-width: 560px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.back-link {
  font-size: 14px;
  font-weight: 600;
  color: #10504e;
  text-decoration: none;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 20px;
}

.field {
  margin-bottom: 18px;
}

.row {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.label {
  display: block;
  margin-bottom: 7px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12343b;
}

.input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 14.5px;
}

.input:disabled {
  background: #f0f3f2;
  color: #6b7c80;
}

.textarea {
  resize: vertical;
  line-height: 1.6;
}

.counter {
  margin: 6px 0 0;
  text-align: right;
  font-size: 12px;
  color: #5c7176;
}

.hint,
.hint-small {
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.hint-small {
  margin: 6px 0 0;
}

.warning {
  color: #8a4b06;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  min-height: 42px;
  padding: 8px 16px;
  border: 1.5px solid #cfdcda;
  border-radius: 999px;
  background: #f8fbfa;
  font-size: 14px;
  font-weight: 500;
  color: #12343b;
  cursor: pointer;
}

.chip input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.chip-active {
  border-color: #10504e;
  background: #10504e;
  color: #ffffff;
}

.preview {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 16px;
  padding: 14px;
  border-radius: 12px;
  background: #f6faf9;
}

.preview-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.preview-label {
  font-size: 12px;
  color: #5c7176;
}

.preview-value {
  font-size: 14px;
  font-weight: 700;
  color: #12343b;
}

.preview-error {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 13px;
  color: #a01b1b;
}

.error-text {
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fdecec;
  border: 1px solid #f3c6c6;
  color: #a01b1b;
  font-size: 13px;
}

.primary-btn {
  width: 100%;
  min-height: 48px;
  border: 0;
  border-radius: 12px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn:disabled {
  background: #d7e0de;
  color: #7b8b8e;
  cursor: not-allowed;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.ghost-btn {
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.receipt-title {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  color: #12343b;
}

.receipt-code {
  margin: 6px 0 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: #5c7176;
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f6faf9;
}

.fact dt {
  font-size: 12px;
  color: #5c7176;
}

.fact dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.receipt-note {
  margin: 14px 0 0;
  font-size: 13px;
  color: #5c7176;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}
</style>
