<script setup>
import { onBeforeUnmount, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import EmployeePicker from '../components/EmployeePicker.vue'
import { postJson } from '../api.js'

// The Worker returns the raw value exactly once. It is kept in memory only and
// dropped when this page is left or reloaded; nothing is written to storage.
const INITIAL_ERROR = 'สร้างรหัสผ่านเริ่มต้นไม่สำเร็จ กรุณาลองใหม่'
const RESET_ERROR = 'สร้างรหัสรีเซ็ตไม่สำเร็จ กรุณาลองใหม่'

const initialEmployee = ref(null)
const resetEmployee = ref(null)
const initialBusy = ref(false)
const resetBusy = ref(false)
const initialError = ref('')
const resetError = ref('')
const initialResult = ref(null)
const resetResult = ref(null)
const copyNotice = ref('')

function employeeLabel(item) {
  if (!item) return ''
  const name = item.fullName || ''
  const prefix = item.namePrefix
  const withPrefix = prefix && name && !name.startsWith(prefix) ? `${prefix} ${name}` : name
  const label = withPrefix || '—'
  return item.employeeCode ? `${label} (${item.employeeCode})` : label
}

function formatExpiry(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value ?? ''
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

async function issueInitialPin() {
  if (initialBusy.value || !initialEmployee.value) return
  const employee = initialEmployee.value
  initialBusy.value = true
  initialError.value = ''
  initialResult.value = null
  copyNotice.value = ''
  try {
    const { status, data } = await postJson(
      `/api/hr/employees/${encodeURIComponent(employee.id)}/initial-pin`,
      {}
    )
    if (status !== 200 || data.ok !== true) {
      initialError.value = typeof data.message === 'string' ? data.message : INITIAL_ERROR
      return
    }
    initialResult.value = {
      value: String(data.pin ?? ''),
      employee: employeeLabel(employee),
    }
    initialEmployee.value = null
  } catch {
    initialError.value = INITIAL_ERROR
  } finally {
    initialBusy.value = false
  }
}

async function issueResetCode() {
  if (resetBusy.value || !resetEmployee.value) return
  const employee = resetEmployee.value
  resetBusy.value = true
  resetError.value = ''
  resetResult.value = null
  copyNotice.value = ''
  try {
    const { status, data } = await postJson(
      `/api/hr/employees/${encodeURIComponent(employee.id)}/reset-code`,
      {}
    )
    if (status !== 200 || data.ok !== true) {
      resetError.value = typeof data.message === 'string' ? data.message : RESET_ERROR
      return
    }
    resetResult.value = {
      value: String(data.code ?? ''),
      expiresAt: data.expiresAt,
      employee: employeeLabel(employee),
    }
    resetEmployee.value = null
  } catch {
    resetError.value = RESET_ERROR
  } finally {
    resetBusy.value = false
  }
}

async function copyValue(value, label) {
  try {
    await navigator.clipboard.writeText(value)
    copyNotice.value = `คัดลอก${label}แล้ว`
  } catch {
    copyNotice.value = 'คัดลอกอัตโนมัติไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง'
  }
}

// Leaving or reloading the page clears the one-time values.
onBeforeUnmount(() => {
  initialResult.value = null
  resetResult.value = null
  initialError.value = ''
  resetError.value = ''
  copyNotice.value = ''
})
</script>

<template>
  <AppLayout nav="hr">

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">จัดการรหัสผ่านพนักงาน</h1>
          <p class="sub">
            ค่าที่สร้างจะแสดงเพียงครั้งเดียว เมื่อออกจากหน้านี้หรือโหลดใหม่จะไม่แสดงอีก
          </p>
        </div>
        <RouterLink to="/hr/employees" class="back">← กลับไปรายชื่อพนักงาน</RouterLink>
      </div>

      <p v-if="copyNotice" class="notice">{{ copyNotice }}</p>

      <section class="card">
        <h2 class="card-title">1) รหัสผ่านเริ่มต้น (PIN 6 หลัก)</h2>
        <p class="card-sub">
          สำหรับพนักงานที่ยังไม่เคยตั้ง PIN · ระบบจะตั้งค่าบังคับให้เปลี่ยน PIN เมื่อเข้าใช้งานครั้งแรก
        </p>

        <EmployeePicker v-model="initialEmployee" label="พนักงาน" />

        <v-btn
          color="primary"
          class="action"
          :disabled="!initialEmployee || initialBusy"
          :loading="initialBusy"
          @click="issueInitialPin"
        >
          สร้างรหัสผ่านเริ่มต้น
        </v-btn>

        <v-alert v-if="initialError" type="error" variant="tonal" class="mt-4">
          {{ initialError }}
        </v-alert>

        <div v-if="initialResult" class="result">
          <p class="result-label">PIN สำหรับ {{ initialResult.employee }}</p>
          <div class="value-row">
            <code class="value">{{ initialResult.value }}</code>
            <v-btn
              size="small"
              variant="outlined"
              @click="copyValue(initialResult.value, ' PIN')"
            >
              คัดลอก
            </v-btn>
          </div>
          <p class="warning">
            ค่านี้จะไม่แสดงอีก · กรุณาส่งให้พนักงานด้วยช่องทางที่ปลอดภัย และให้เปลี่ยน PIN ทันทีเมื่อเข้าใช้งาน
          </p>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">2) รหัสรีเซ็ต PIN (8 หลัก)</h2>
        <p class="card-sub">
          ใช้ได้ 24 ชั่วโมง และใช้ได้ครั้งเดียว · การสร้างรหัสใหม่จะทำให้รหัสเก่าของพนักงานคนนี้ใช้ไม่ได้ทันที
        </p>

        <EmployeePicker v-model="resetEmployee" label="พนักงาน" />

        <v-btn
          color="primary"
          class="action"
          :disabled="!resetEmployee || resetBusy"
          :loading="resetBusy"
          @click="issueResetCode"
        >
          สร้างรหัสรีเซ็ต
        </v-btn>

        <v-alert v-if="resetError" type="error" variant="tonal" class="mt-4">
          {{ resetError }}
        </v-alert>

        <div v-if="resetResult" class="result">
          <p class="result-label">รหัสสำหรับ {{ resetResult.employee }}</p>
          <div class="value-row">
            <code class="value">{{ resetResult.value }}</code>
            <v-btn
              size="small"
              variant="outlined"
              @click="copyValue(resetResult.value, 'รหัส')"
            >
              คัดลอก
            </v-btn>
          </div>
          <p class="warning">
            ใช้ได้ถึง {{ formatExpiry(resetResult.expiresAt) }} · ใช้ได้ครั้งเดียว · ค่านี้จะไม่แสดงอีก
          </p>
        </div>
      </section>
    </main>
  </AppLayout>
</template>

<style scoped>
.content {
  max-width: 820px;
  margin: 0 auto;
  padding: 28px 0 64px;
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
  font-size: 13px;
  color: #5c7176;
}

.back {
  color: #10504e;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 20px;
}

.card + .card {
  margin-top: 18px;
}

.card-title {
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
}

.card-sub {
  margin: 0 0 14px;
  font-size: 13px;
  color: #5c7176;
}

.action {
  margin-top: 4px;
}

.notice {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #e8f3ef;
  color: #10504e;
  font-size: 13px;
}

.result {
  margin-top: 16px;
  padding: 14px;
  border: 1px dashed #b9cfc9;
  border-radius: 12px;
  background: #f7fbf9;
}

.result-label {
  margin: 0 0 8px;
  font-size: 13px;
  color: #12343b;
  font-weight: 600;
}

.value-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.value {
  padding: 8px 14px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #cfdcda;
  color: #12343b;
  font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
  font-size: 22px;
  letter-spacing: 0.16em;
}

.warning {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: #8a4b00;
}
</style>
