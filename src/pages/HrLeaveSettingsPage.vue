<script setup>
import { computed, onMounted, ref } from 'vue'
import { getCached } from '../lib/data-cache.js'
import {
  DATA_KEYS,
  SHARED_TTL_MS,
  errorTextOf,
  invalidateLeaveSettings,
  loaders,
} from '../lib/shared-data.js'

const LOAD_ERROR = 'โหลดการตั้งค่าไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่'
const LEAVE_SAVE_ERROR = 'บันทึกการตั้งค่าการเก็บข้อมูลไม่สำเร็จ กรุณาลองใหม่'
const LEAVE_DAYS_ERROR = 'จำนวนวันต้องอยู่ระหว่าง 730 ถึง 3650 วัน'
const PREVIEW_ERROR = 'โหลดตัวอย่างข้อมูลไม่สำเร็จ กรุณาลองใหม่'

const loading = ref(true)
const errorMessage = ref('')
const notice = ref('')
const saving = ref(false)
const configured = ref(false)
const limits = ref({ min: 30, max: 365, default: 90 })
const days = ref(90)

const leaveEnabled = ref(false)
const leaveDays = ref(730)
const savedLeaveDays = ref(730)
const leaveLimits = ref({ min: 730, max: 3650, default: 730 })
const leaveSaving = ref(false)

// Preview + confirmation before enabling, or before changing the window while
// deletion is already on. Nothing is deleted until the daily job runs.
const dialogOpen = ref(false)
const previewLoading = ref(false)
const previewError = ref('')
const preview = ref({ leaveRequests: 0, certificateFiles: 0 })
const pending = ref({ mode: 'enable', enabled: true, days: 730 })

const valid = computed(() => {
  const value = Number(days.value)
  return Number.isInteger(value) && value >= limits.value.min && value <= limits.value.max
})

const leaveDaysValid = computed(() => {
  const value = Number(leaveDays.value)
  return (
    Number.isInteger(value) &&
    value >= leaveLimits.value.min &&
    value <= leaveLimits.value.max
  )
})

const leaveDaysError = computed(() => (leaveDaysValid.value ? '' : LEAVE_DAYS_ERROR))

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const data = await getCached(DATA_KEYS.hrSettings, loaders.hrSettings, {
      ttlMs: SHARED_TTL_MS,
    })
    configured.value = data.configured === true
    days.value = Number(data.certificateRetentionDays)
    if (data.limits) limits.value = data.limits

    leaveEnabled.value = data.leaveRetentionEnabled === true
    leaveDays.value = Number(data.leaveRetentionDays)
    savedLeaveDays.value = Number(data.leaveRetentionDays)
    if (data.leaveRetentionLimits) leaveLimits.value = data.leaveRetentionLimits
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
  } finally {
    loading.value = false
  }
}

async function putSettings(payload) {
  const response = await fetch('/api/leave/hr/settings', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok !== true) {
    errorMessage.value = typeof data.message === 'string' ? data.message : LEAVE_SAVE_ERROR
    return null
  }
  return data
}

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch('/api/leave/hr/settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certificateRetentionDays: Number(days.value) }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    configured.value = true
    days.value = Number(data.certificateRetentionDays)
    notice.value = 'บันทึกการตั้งค่าแล้ว'
    // The leave catalog carries the retention value too.
    invalidateLeaveSettings()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

async function saveLeaveRetention(payload, successText) {
  if (leaveSaving.value) return false
  leaveSaving.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    const data = await putSettings(payload)
    if (!data) return false
    leaveEnabled.value = data.leaveRetentionEnabled === true
    leaveDays.value = Number(data.leaveRetentionDays)
    savedLeaveDays.value = Number(data.leaveRetentionDays)
    notice.value = successText
    invalidateLeaveSettings()
    return true
  } catch {
    errorMessage.value = LEAVE_SAVE_ERROR
    return false
  } finally {
    leaveSaving.value = false
  }
}

async function openConfirmation(mode) {
  if (!leaveDaysValid.value) {
    errorMessage.value = LEAVE_DAYS_ERROR
    return
  }
  const chosen = Number(leaveDays.value)
  pending.value = {
    mode,
    enabled: mode === 'enable' ? true : leaveEnabled.value,
    days: chosen,
  }
  preview.value = { leaveRequests: 0, certificateFiles: 0 }
  previewError.value = ''
  previewLoading.value = true
  dialogOpen.value = true

  try {
    const response = await fetch(
      `/api/leave/hr/settings/leave-retention/preview?days=${encodeURIComponent(chosen)}`,
      { credentials: 'same-origin' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) throw new Error('preview')
    preview.value = {
      leaveRequests: Number(data.leaveRequests) || 0,
      certificateFiles: Number(data.certificateFiles) || 0,
    }
  } catch {
    previewError.value = PREVIEW_ERROR
  } finally {
    previewLoading.value = false
  }
}

async function onLeaveToggle(event) {
  const input = event.target
  const next = input.checked === true
  // The switch only moves after the server confirms; a cancel leaves it off.
  input.checked = false

  if (!next) {
    await saveLeaveRetention({ leaveRetentionEnabled: false }, 'ปิดการลบข้อมูลอัตโนมัติแล้ว')
    input.checked = leaveEnabled.value
    return
  }

  await openConfirmation('enable')
}

async function saveLeaveDays() {
  if (!leaveDaysValid.value) {
    errorMessage.value = LEAVE_DAYS_ERROR
    return
  }
  if (Number(leaveDays.value) === Number(savedLeaveDays.value) && leaveEnabled.value) {
    notice.value = 'จำนวนวันไม่เปลี่ยนแปลง'
    return
  }
  if (leaveEnabled.value) {
    await openConfirmation('days')
    return
  }
  await saveLeaveRetention(
    { leaveRetentionDays: Number(leaveDays.value) },
    'บันทึกจำนวนวันแล้ว'
  )
}

async function confirmLeaveChange() {
  if (previewLoading.value || leaveSaving.value) return
  const action = pending.value
  const payload =
    action.mode === 'enable'
      ? { leaveRetentionEnabled: true, leaveRetentionDays: action.days }
      : { leaveRetentionDays: action.days }
  const ok = await saveLeaveRetention(
    payload,
    action.mode === 'enable' ? 'เปิดการลบข้อมูลอัตโนมัติแล้ว' : 'บันทึกจำนวนวันแล้ว'
  )
  if (ok) dialogOpen.value = false
}

function cancelLeaveChange() {
  if (leaveSaving.value) return
  dialogOpen.value = false
}

onMounted(load)
</script>

<template>

    <main class="content">
      <div class="head">
        <h1 class="title">ตั้งค่าใบลา</h1>
        <p class="sub">
          จำนวนวันเก็บไฟล์ใบรับรองแพทย์ · งานลบไฟล์อัตโนมัติรันวันละครั้ง (09:00 น.)
          และลบเฉพาะไฟล์ที่เกินกำหนด
        </p>
      </div>

      <v-alert v-if="!loading && !configured" type="warning" variant="tonal" class="mb-4">
        ยังไม่มีตาราง <code>leave_settings</code> — กรุณารันไฟล์
        <code>worker/sql/leave-retention-settings.sql</code> ก่อนบันทึกค่า
      </v-alert>

      <section class="card">
        <p v-if="loading" class="hint">กำลังโหลด…</p>

        <template v-else>
          <label class="label" for="retention">เก็บใบรับรองแพทย์ (วัน)</label>
          <input
            id="retention"
            v-model.number="days"
            class="input"
            type="number"
            :min="limits.min"
            :max="limits.max"
          />
          <p class="hint">
            อนุญาต {{ limits.min }}–{{ limits.max }} วัน · ค่าเริ่มต้น {{ limits.default }} วัน
          </p>
          <p v-if="!valid" class="hint error">ค่าที่กรอกอยู่นอกช่วงที่อนุญาต</p>

          <p v-if="notice" class="hint success">{{ notice }}</p>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3">{{ errorMessage }}</v-alert>

          <button type="button" class="primary-btn" :disabled="!valid || saving" @click="save">
            {{ saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า' }}
          </button>

          <p class="note">
            ผลกระทบ: เมื่อไฟล์หมดอายุ ระบบจะลบไฟล์ใน bucket <code>leave-certificates</code>
            แล้วล้างค่า <code>medical_certificate_url</code> ของใบลานั้น (ตัวเลขวันลาและสถานะไม่เปลี่ยน)
          </p>
        </template>
      </section>

      <section v-if="!loading" class="card retention-card">
        <h2 class="section-title">เก็บข้อมูลใบลา</h2>
        <p class="hint">
          ลบใบลาที่อนุมัติแล้ว ปฏิเสธแล้ว หรือยกเลิกแล้ว เมื่อสิ้นสุดเกินจำนวนวันที่กำหนด
          ใบลาที่ยังรออนุมัติจะไม่ถูกลบ · ค่าเริ่มต้นปิดไว้
        </p>

        <label class="toggle-row" for="leave-retention-enabled">
          <input
            id="leave-retention-enabled"
            type="checkbox"
            :checked="leaveEnabled"
            :disabled="leaveSaving"
            @change="onLeaveToggle"
          />
          <span>เปิดการลบข้อมูลใบลาอัตโนมัติ</span>
        </label>
        <p class="hint" :class="leaveEnabled ? 'hint success' : ''">
          สถานะ: {{ leaveEnabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน' }}
        </p>

        <label class="label" for="leave-retention-days">เก็บข้อมูลใบลา (วัน)</label>
        <input
          id="leave-retention-days"
          v-model.number="leaveDays"
          class="input"
          type="number"
          :min="leaveLimits.min"
          :max="leaveLimits.max"
        />
        <p class="hint">
          อนุญาต {{ leaveLimits.min }}–{{ leaveLimits.max }} วัน · ค่าเริ่มต้น
          {{ leaveLimits.default }} วัน (5 ปี)
        </p>
        <p v-if="!leaveDaysValid" class="hint error leave-days-error">{{ leaveDaysError }}</p>

        <button type="button" class="primary-btn" :disabled="leaveSaving" @click="saveLeaveDays">
          {{ leaveSaving ? 'กำลังบันทึก…' : 'บันทึกจำนวนวันเก็บข้อมูล' }}
        </button>

        <p class="note">
          เมื่อเปิดใช้ งานประจำวันเวลา 02:00 UTC จะลบใบลาตามเกณฑ์ข้างต้น
          พร้อมไฟล์ใบรับรองแพทย์ที่เกี่ยวข้อง แถวลูกถูกลบก่อนแถวหลักและจำกัดจำนวนต่อรอบ
          ทุกการเปลี่ยนค่าถูกบันทึกในประวัติการใช้งาน
        </p>
      </section>

      <v-dialog v-model="dialogOpen" max-width="520" :persistent="leaveSaving || previewLoading">
        <div class="dialog-card">
          <h2 class="dialog-title">
            {{
              pending.mode === 'enable'
                ? 'ยืนยันเปิดการลบข้อมูลอัตโนมัติ'
                : 'ยืนยันจำนวนวันเก็บข้อมูล'
            }}
          </h2>
          <p class="dialog-text">
            ข้อมูลใบลาที่สิ้นสุดเกิน <strong>{{ pending.days }}</strong> วัน
            จะถูกลบในรอบประจำวันเวลา 02:00 UTC ครั้งถัดไป
            และไฟล์ใบรับรองแพทย์ที่เกี่ยวข้องจะถูกลบด้วย
          </p>

          <p v-if="previewLoading" class="hint">กำลังตรวจสอบข้อมูล…</p>
          <ul v-else class="dialog-list leave-preview-counts">
            <li>ใบลาที่จะถูกลบตอนนี้: {{ preview.leaveRequests }} รายการ</li>
            <li>ไฟล์ใบรับรองแพทย์ที่จะถูกลบตอนนี้: {{ preview.certificateFiles }} ไฟล์</li>
          </ul>
          <p v-if="previewError" class="hint error">{{ previewError }}</p>

          <div class="dialog-actions">
            <button
              type="button"
              class="dialog-btn cancel"
              :disabled="leaveSaving"
              @click="cancelLeaveChange"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              class="dialog-btn confirm confirm-leave-btn"
              :disabled="previewLoading || leaveSaving"
              @click="confirmLeaveChange"
            >
              {{ leaveSaving ? 'กำลังบันทึก…' : 'ยืนยัน' }}
            </button>
          </div>
        </div>
      </v-dialog>
    </main>
</template>

<style scoped>
.content {
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 0 64px;
}

.head { margin-bottom: 16px; }
.title { font-size: 24px; font-weight: 700; color: #12343b; margin: 0 0 6px; }

.sub {
  margin: 0;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 20px;
}

.retention-card { margin-top: 16px; }
.section-title { margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #12343b; }

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

.primary-btn {
  width: 100%;
  min-height: 46px;
  margin-top: 10px;
  border: 0;
  border-radius: 12px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn:disabled { background: #d7e0de; color: #7b8b8e; cursor: not-allowed; }

.hint { font-size: 13px; color: #5c7176; margin: 8px 0; }
.hint.error { color: #a01b1b; }
.hint.success { color: #1c6b3f; }

.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
  cursor: pointer;
}

.toggle-row input {
  width: 20px;
  height: 20px;
  accent-color: #10504e;
}

.note {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f6faf9;
  font-size: 12.5px;
  color: #5c7176;
  line-height: 1.7;
}

.dialog-card {
  background: #ffffff;
  border-radius: 14px;
  padding: 20px;
}

.dialog-title { margin: 0 0 10px; font-size: 18px; font-weight: 700; color: #12343b; }
.dialog-text { margin: 0 0 10px; font-size: 14px; color: #35575b; line-height: 1.7; }
.dialog-list { margin: 0; padding-left: 20px; font-size: 14px; color: #12343b; line-height: 1.8; }

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.dialog-btn {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  border: 0;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.dialog-btn.cancel { background: #eef3f2; color: #35575b; }
.dialog-btn.confirm { background: #a01b1b; color: #ffffff; }
.dialog-btn:disabled { opacity: 0.7; cursor: not-allowed; }

@media (max-width: 480px) {
  .content { padding: 20px 12px 48px; }
  .dialog-actions { flex-direction: column-reverse; }
  .dialog-btn { width: 100%; }
}
</style>
