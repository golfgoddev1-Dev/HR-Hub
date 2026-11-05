<script setup>
import { computed, onMounted, ref } from 'vue'

const LOAD_ERROR = 'โหลดการตั้งค่าไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่'

const loading = ref(true)
const errorMessage = ref('')
const notice = ref('')
const saving = ref(false)
const configured = ref(false)
const limits = ref({ min: 30, max: 365, default: 90 })
const days = ref(90)

const valid = computed(() => {
  const value = Number(days.value)
  return Number.isInteger(value) && value >= limits.value.min && value <= limits.value.max
})

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/leave/hr/settings', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    configured.value = data.configured === true
    days.value = Number(data.certificateRetentionDays)
    if (data.limits) limits.value = data.limits
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
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
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
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
        <code>worker/sql/leave-hr-phase2-draft.sql</code> ก่อนบันทึกค่า
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

.note {
  margin: 16px 0 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f6faf9;
  font-size: 12.5px;
  color: #5c7176;
  line-height: 1.7;
}
</style>
