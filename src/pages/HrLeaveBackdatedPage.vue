<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import HrNav from '../components/HrNav.vue'
import EmployeePicker from '../components/EmployeePicker.vue'
import { formatThaiDate } from '../lib/thai-date.js'
import { postJson } from '../api.js'
// Same rules module the Worker stores with, so the preview matches the saved row.
import {
  OT_VALUES,
  computeLeave,
  isDateString,
} from '../../worker/src/leave-rules.js'

const LOAD_ERROR = 'โหลดข้อมูลสำหรับคีย์ใบลาไม่สำเร็จ กรุณาลองใหม่'
const SUBMIT_ERROR = 'บันทึกใบลาไม่สำเร็จ กรุณาลองใหม่'

const loading = ref(true)
const loadError = ref('')
const submitting = ref(false)
const submitError = ref('')
const receipt = ref(null)

const types = ref([])
const shifts = ref([])
const holidaySet = ref(new Set())

const employee = ref(null)
const approver = ref(null)
const leaveTypeId = ref(null)
const shiftCode = ref('')
const startDate = ref('')
const endDate = ref('')
const otOption = ref('')
const otherDetail = ref('')
const reason = ref('')
const hasMedicalCertificate = ref(false)

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


const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!employee.value || !approver.value) return false
  if (employee.value.id === approver.value.id) return false
  if (!selectedType.value || !selectedShift.value) return false
  if (preview.value?.ok !== true) return false
  if (isOther.value && otherDetail.value.trim().length === 0) return false
  if (isHalf.value && !OT_VALUES.includes(otOption.value)) return false
  return true
})

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
    const response = await fetch('/api/leave/hr/catalog', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      loadError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }

    types.value = Array.isArray(data.types) ? data.types : []
    shifts.value = Array.isArray(data.shifts) ? data.shifts : []
    holidaySet.value = new Set(Array.isArray(data.holidays) ? data.holidays : [])

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

  const payload = {
    employeeId: employee.value.id,
    approverId: approver.value.id,
    leaveTypeId: leaveTypeId.value,
    shiftCode: shiftCode.value,
    startDate: startDate.value,
    endDate: isHalf.value ? startDate.value : endDate.value || startDate.value,
    otherTypeDetail: isOther.value ? otherDetail.value.trim() : null,
    reason: reason.value.trim() || null,
    hasMedicalCertificate: hasMedicalCertificate.value,
  }
  if (isHalf.value) payload.otOption = otOption.value

  try {
    const { status, data } = await postJson('/api/leave/hr/requests', payload)
    if (status !== 201 || data.ok !== true) {
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

function startOver() {
  receipt.value = null
  submitError.value = ''
  employee.value = null
  approver.value = null
  startDate.value = ''
  endDate.value = ''
  otOption.value = ''
  otherDetail.value = ''
  reason.value = ''
  hasMedicalCertificate.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">คีย์ใบลาย้อนหลัง</h1>
          <p class="sub">
            บันทึกแทนพนักงานเมื่อเลยกำหนด · ใบลาที่คีย์ย้อนหลังเป็น “อนุมัติแล้ว” ทันที
            และใช้กติกาคำนวณวันเดียวกับที่พนักงานยื่นเอง
          </p>
        </div>
        <RouterLink to="/hr/leave" class="back-link">← จัดการใบลา</RouterLink>
      </div>

      <p v-if="loading" class="hint">กำลังโหลด…</p>
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>

      <section v-else-if="receipt" class="card">
        <h2 class="receipt-title">บันทึกใบลาเรียบร้อย</h2>
        <p class="receipt-code">รหัสใบลา: {{ receipt.requestCode || '—' }}</p>
        <dl class="facts">
          <div class="fact"><dt>สถานะ</dt><dd>อนุมัติแล้ว (คีย์ย้อนหลัง)</dd></div>
          <div class="fact"><dt>จำนวนวัน</dt><dd>{{ receipt.days ?? '—' }}</dd></div>
          <div class="fact">
            <dt>กลับมาทำงาน</dt>
            <dd>{{ formatThaiDate(receipt.returnDate) }} {{ receipt.returnTime || '' }}</dd>
          </div>
          <div class="fact"><dt>เวลาเลิกงาน</dt><dd>{{ receipt.shiftEndOverride || '—' }}</dd></div>
        </dl>
        <div class="actions">
          <RouterLink to="/hr/leave" class="primary-link">ดูรายการใบลา</RouterLink>
          <button type="button" class="ghost-btn" @click="startOver">คีย์อีกใบ</button>
        </div>
      </section>

      <section v-else class="card">
        <EmployeePicker v-model="employee" label="พนักงานที่ลา" />
        <EmployeePicker v-model="approver" label="ผู้อนุมัติ (ต้องไม่ใช่ผู้ลา)" />

        <p v-if="employee && approver && employee.id === approver.id" class="hint error">
          ผู้อนุมัติต้องไม่ใช่ผู้ลาด้วยตนเอง
        </p>

        <div class="field">
          <label class="label">ประเภทการลา</label>
          <v-select
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
          <label class="label">ระบุประเภทการลาอื่น ๆ</label>
          <input v-model="otherDetail" class="input" type="text" maxlength="100" placeholder="เช่น ลาศึกษาต่อ" />
        </div>

        <div class="field">
          <label class="label">กะการทำงาน</label>
          <v-select
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
            <label class="label">วันที่เริ่มลา</label>
            <input v-model="startDate" class="input" type="date" />
          </div>
          <div class="field">
            <label class="label">วันที่สิ้นสุด</label>
            <input
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
              <input v-model="otOption" type="radio" name="hr-ot-option" :value="option" />
              <span>{{ option }}</span>
            </label>
          </div>
        </fieldset>

        <div class="field">
          <label class="label">เหตุผล (ไม่บังคับ)</label>
          <textarea v-model="reason" class="input textarea" rows="3" maxlength="1000" placeholder="ระบุเหตุผลสั้น ๆ"></textarea>
        </div>

        <div class="field">
          <label class="label checkbox">
            <input v-model="hasMedicalCertificate" type="checkbox" />
            <span>มีใบรับรองแพทย์</span>
          </label>
          <p class="hint-small">
            ใบลาที่ย้อนหลังไม่ต้องแนบไฟล์ ระบบจะบันทึกเฉพาะว่ามีใบรับรองแพทย์
          </p>
        </div>

        <div class="preview">
          <template v-if="preview?.ok === true">
            <div class="preview-item">
              <span class="preview-label">จำนวนวัน</span>
              <span class="preview-value">{{ preview.days }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">กลับมาทำงาน</span>
              <span class="preview-value">{{ formatThaiDate(preview.returnDate) }} {{ preview.returnTime }}</span>
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
          <p v-else class="hint-small">เลือกพนักงาน ประเภทการลา และวันที่เพื่อดูผลคำนวณ</p>
        </div>

        <p v-if="submitError" class="error-text" role="alert">{{ submitError }}</p>

        <button type="button" class="primary-btn" :disabled="!canSubmit" @click="submit">
          {{ submitting ? 'กำลังบันทึก…' : 'บันทึกใบลาย้อนหลัง' }}
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; background: #f3f6f5; }

.content {
  max-width: 760px;
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

.title { font-size: 24px; font-weight: 700; color: #12343b; margin: 0 0 6px; }

.sub {
  margin: 0;
  max-width: 600px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.back-link { font-size: 14px; font-weight: 600; color: #10504e; text-decoration: none; }

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 20px;
}

.field { margin-bottom: 16px; }
.row { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

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

.input:disabled { background: #f0f3f2; color: #6b7c80; }
.textarea { resize: vertical; line-height: 1.6; }

.checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.checkbox input { width: 18px; height: 18px; accent-color: #10504e; }

.hint, .hint-small { font-size: 13px; color: #5c7176; line-height: 1.6; }
.hint-small { margin: 6px 0 0; }
.hint.warning, .hint-small.warning { color: #8a4b06; }
.hint.error { color: #a01b1b; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; }

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

.chip input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.chip-active { border-color: #10504e; background: #10504e; color: #ffffff; }

.preview {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 16px;
  padding: 14px;
  border-radius: 12px;
  background: #f6faf9;
}

.preview-item { display: flex; flex-direction: column; gap: 2px; }
.preview-label { font-size: 12px; color: #5c7176; }
.preview-value { font-size: 14px; font-weight: 700; color: #12343b; }
.preview-error { grid-column: 1 / -1; margin: 0; font-size: 13px; color: #a01b1b; }

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

.primary-btn:disabled { background: #d7e0de; color: #7b8b8e; cursor: not-allowed; }

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

.receipt-title { margin: 0; font-size: 19px; font-weight: 700; color: #12343b; }
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

.fact dt { font-size: 12px; color: #5c7176; }
.fact dd { margin: 2px 0 0; font-size: 14px; font-weight: 600; color: #12343b; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
</style>
