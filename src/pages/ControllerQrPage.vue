<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import ControllerNav from '../components/ControllerNav.vue'

const route = useRoute()
const router = useRouter()

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
const LOAD_ERROR_MESSAGE = 'ไม่สามารถโหลดข้อมูลการประชุมได้ กรุณาลองใหม่'

const types = ref([])
const loading = ref(true)
const loadError = ref('')
const qrDataUrl = ref('')
const qrError = ref('')
const copyNotice = ref('')
const confirmOpen = ref(false)
const rotateBusy = ref(false)
const rotateError = ref('')
const windowOpenTime = ref('')
const windowCutoffTime = ref('')
const windowError = ref('')
const windowNotice = ref('')
const windowBusy = ref(false)
const monthlySessions = ref([])
const monthlyLoading = ref(true)
const monthlyError = ref('')
const monthlyNotice = ref('')
const monthlySaving = ref(false)
const monthlyDate = ref(todayInBangkok())
const monthlyOpenTime = ref('')
const monthlyCutoffTime = ref('')

const activeCode = computed(() => (route.query.type === 'monthly' ? 'monthly' : 'sup'))
const tab = computed({
  get: () => activeCode.value,
  set: (value) => {
    if (value === activeCode.value) return
    router.replace({ query: { ...route.query, type: value } })
  },
})
const selectedType = computed(() => types.value.find((type) => type.code === activeCode.value) ?? null)
const weekdayText = computed(() => {
  const day = selectedType.value?.weekday
  if (typeof day !== 'number' || day < 0 || day > 6) return 'ไม่ระบุ'
  return `วัน${THAI_DAYS[day]}`
})

if (route.query.type !== 'sup' && route.query.type !== 'monthly') {
  router.replace({ query: { ...route.query, type: 'sup' } })
}

async function sendJson(method, url, body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  return { status: response.status, data }
}

async function renderQr() {
  const url = selectedType.value?.registerUrl
  qrError.value = ''
  if (!url) {
    qrDataUrl.value = ''
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, { width: 240, margin: 2 })
  } catch {
    qrDataUrl.value = ''
    qrError.value = 'ไม่สามารถสร้าง QR ได้ กรุณาลองใหม่'
  }
}

async function loadTypes() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch('/api/meeting/types', {
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
      loadError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR_MESSAGE
      return
    }
    types.value = Array.isArray(data.types) ? data.types : []
  } catch {
    loadError.value = LOAD_ERROR_MESSAGE
  } finally {
    loading.value = false
  }
}

function downloadQr() {
  if (!qrDataUrl.value) return
  const link = document.createElement('a')
  link.href = qrDataUrl.value
  link.download = `meeting-qr-${activeCode.value}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function copyLink() {
  const url = selectedType.value?.registerUrl
  if (!url) return
  copyNotice.value = ''
  try {
    await navigator.clipboard.writeText(url)
    copyNotice.value = 'คัดลอกลิงก์แล้ว'
  } catch {
    copyNotice.value = 'คัดลอกลิงก์ไม่สำเร็จ กรุณาลองใหม่'
  }
}

function openRotateDialog() {
  rotateError.value = ''
  confirmOpen.value = true
}

async function confirmRotate() {
  if (rotateBusy.value) return
  rotateBusy.value = true
  rotateError.value = ''
  copyNotice.value = ''
  try {
    const { status, data } = await sendJson('POST', '/api/meeting/qr/rotate', {
      code: activeCode.value,
    })
    if (status === 200 && data.ok === true) {
      const target = types.value.find((type) => type.code === activeCode.value)
      if (target) target.registerUrl = data.registerUrl
      confirmOpen.value = false
      return
    }
    rotateError.value = typeof data.message === 'string'
      ? data.message
      : 'ไม่สามารถสร้าง QR ใหม่ได้ กรุณาลองใหม่'
  } catch {
    rotateError.value = 'ไม่สามารถสร้าง QR ใหม่ได้ กรุณาลองใหม่'
  } finally {
    rotateBusy.value = false
  }
}

async function saveWindow() {
  if (windowBusy.value || activeCode.value !== 'sup') return
  windowBusy.value = true
  windowError.value = ''
  windowNotice.value = ''
  try {
    const { status, data } = await sendJson('PUT', '/api/meeting/window', {
      openTime: windowOpenTime.value,
      cutoffTime: windowCutoffTime.value,
    })
    if (status === 200 && data.ok === true) {
      const target = types.value.find((type) => type.code === 'sup')
      if (target) {
        target.openTime = windowOpenTime.value
        target.cutoffTime = windowCutoffTime.value
      }
      windowNotice.value = 'บันทึกเวลาแล้ว'
      return
    }
    windowError.value = typeof data.message === 'string'
      ? data.message
      : 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
  } catch {
    windowError.value = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
  } finally {
    windowBusy.value = false
  }
}

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

function formatCycleWindow(session) {
  const open = session?.openTime ?? '--:--'
  const cutoff = session?.cutoffTime ?? '--:--'
  return `${open}–${cutoff} น.`
}

async function loadMonthlySessions() {
  monthlyLoading.value = true
  monthlyError.value = ''
  try {
    const response = await fetch('/api/meeting/monthly-session', {
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
      monthlyError.value = 'ไม่สามารถโหลดรอบประชุมได้ กรุณาลองใหม่'
      return
    }
    monthlySessions.value = Array.isArray(data.sessions) ? data.sessions : []
  } catch {
    monthlyError.value = 'ไม่สามารถโหลดรอบประชุมได้ กรุณาลองใหม่'
  } finally {
    monthlyLoading.value = false
  }
}

async function saveMonthlySession() {
  if (monthlySaving.value) return
  monthlySaving.value = true
  monthlyError.value = ''
  monthlyNotice.value = ''
  try {
    const response = await fetch('/api/meeting/monthly-session', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sessionDate: monthlyDate.value,
        openTime: monthlyOpenTime.value,
        cutoffTime: monthlyCutoffTime.value,
      }),
    })
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    if (!response.ok || data.ok !== true) {
      monthlyError.value = typeof data.message === 'string'
        ? data.message
        : 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
      return
    }
    monthlyNotice.value = 'บันทึกรอบแล้ว'
    await loadMonthlySessions()
  } catch {
    monthlyError.value = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
  } finally {
    monthlySaving.value = false
  }
}

watch(selectedType, (type) => {
  windowOpenTime.value = type?.openTime ?? ''
  windowCutoffTime.value = type?.cutoffTime ?? ''
  windowError.value = ''
  windowNotice.value = ''
  copyNotice.value = ''
  renderQr()
}, { immediate: true })

watch(() => selectedType.value?.registerUrl, renderQr)

watch([windowOpenTime, windowCutoffTime], () => {
  windowError.value = ''
  windowNotice.value = ''
})

loadTypes()
loadMonthlySessions()
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
        <span class="material-symbols-outlined role-chip-icon">qr_code_2</span>
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
          <h1>QR ลงทะเบียนเข้าประชุม</h1>
          <p>สร้างและหมุน QR สำหรับผู้เข้าประชุม พร้อมกำหนดช่วงเวลาเปิดรับของรอบประชุม</p>
        </div>

      <v-tabs v-model="tab" class="type-tabs" color="primary" density="comfortable">
        <v-tab value="sup">ประชุมหัวหน้างาน</v-tab>
        <v-tab value="monthly">ประชุม Monthly</v-tab>
      </v-tabs>

      <v-alert
        v-if="loadError"
        type="error"
        variant="tonal"
        density="comfortable"
        class="page-alert"
      >
        {{ loadError }}
      </v-alert>

      <div class="panels">
        <section class="card qr-card">
          <div v-if="loading" class="state-box">
            <v-progress-circular indeterminate color="primary" size="28" />
            <span>กำลังโหลดข้อมูล…</span>
          </div>

          <div v-else-if="!selectedType" class="state-box">
            <span>ไม่พบข้อมูลการประชุมสำหรับรอบนี้</span>
          </div>

          <template v-else>
            <div class="card-head">
              <div class="card-head-text">
                <h2>{{ selectedType.name }}</h2>
                <p>ให้ผู้เข้าประชุมสแกน QR นี้เพื่อลงทะเบียน</p>
              </div>
              <span class="live-tag">
                <span class="live-dot" aria-hidden="true" />
                ใช้ได้ต่อเนื่อง
              </span>
            </div>

            <div class="qr-box">
              <img
                v-if="qrDataUrl"
                :src="qrDataUrl"
                class="qr-image"
                width="240"
                height="240"
                alt="QR ลงทะเบียนเข้าประชุม"
              />
              <div v-else class="qr-placeholder">กำลังสร้าง QR…</div>
            </div>

            <p v-if="qrError" class="inline-error" role="alert">{{ qrError }}</p>
            <p v-else-if="copyNotice" class="inline-notice">{{ copyNotice }}</p>

            <div class="qr-actions">
              <v-btn color="primary" :disabled="!qrDataUrl" @click="downloadQr">
                ดาวน์โหลด QR (PNG)
              </v-btn>
              <v-btn variant="outlined" color="primary" @click="copyLink">คัดลอกลิงก์</v-btn>
              <v-btn variant="text" color="primary" @click="openRotateDialog">สร้าง QR ใหม่</v-btn>
            </div>
          </template>
        </section>

        <section class="card window-card">
          <h2 class="card-title">ช่วงเวลาเปิดรับลงทะเบียน</h2>

          <div v-if="loading" class="state-box">
            <v-progress-circular indeterminate color="primary" size="24" />
          </div>

          <template v-else-if="selectedType && selectedType.code === 'sup'">
            <p class="day-line">วันประชุม: {{ weekdayText }}</p>

            <div class="time-grid">
              <v-text-field
                v-model="windowOpenTime"
                class="time-field"
                type="time"
                step="60"
                label="เวลาเปิดรับ"
                variant="outlined"
                density="comfortable"
                hide-details
              />
              <v-text-field
                v-model="windowCutoffTime"
                class="time-field"
                type="time"
                step="60"
                label="เวลาปิดรับ"
                variant="outlined"
                density="comfortable"
                hide-details
              />
            </div>

            <p v-if="windowError" class="inline-error" role="alert">{{ windowError }}</p>
            <p v-else-if="windowNotice" class="inline-notice">{{ windowNotice }}</p>

            <v-btn
              color="primary"
              class="window-save"
              :loading="windowBusy"
              @click="saveWindow"
            >
              บันทึกเวลา
            </v-btn>
          </template>

          <p v-else-if="selectedType" class="monthly-note">กำหนดรายรอบในหน้า ประชุม Monthly</p>
          <div v-else class="state-box">
            <span>ไม่พบข้อมูลการประชุมสำหรับรอบนี้</span>
          </div>
        </section>
      </div>

      <section v-if="activeCode === 'monthly'" class="card monthly-card">
        <div class="card-head">
          <div class="card-head-text">
            <h2>รอบประชุม Monthly</h2>
            <p>กำหนดวันและช่วงเวลาเปิดรับลงทะเบียนของแต่ละรอบ</p>
          </div>
        </div>

        <div v-if="monthlyLoading" class="state-box small">
          <v-progress-circular indeterminate color="primary" size="24" />
        </div>

        <ul v-else-if="monthlySessions.length" class="cycle-list">
          <li v-for="session in monthlySessions" :key="session.id" class="cycle-row">
            <span class="cycle-date">{{ formatThaiDate(session.sessionDate) }}</span>
            <span class="cycle-time">{{ formatCycleWindow(session) }}</span>
          </li>
        </ul>

        <p v-else class="empty-text">ยังไม่มีรอบประชุมที่กำหนดไว้</p>

        <p v-if="monthlyError" class="inline-error" role="alert">{{ monthlyError }}</p>
        <p v-else-if="monthlyNotice" class="inline-notice">{{ monthlyNotice }}</p>

        <div class="cycle-form">
          <v-text-field
            v-model="monthlyDate"
            type="date"
            label="วันที่ประชุม"
            variant="outlined"
            density="comfortable"
            hide-details
          />
          <v-text-field
            v-model="monthlyOpenTime"
            type="time"
            step="60"
            label="เวลาเปิดรับ"
            variant="outlined"
            density="comfortable"
            hide-details
          />
          <v-text-field
            v-model="monthlyCutoffTime"
            type="time"
            step="60"
            label="เวลาปิดรับ"
            variant="outlined"
            density="comfortable"
            hide-details
          />
        </div>

        <v-btn
          color="primary"
          class="monthly-save"
          :loading="monthlySaving"
          @click="saveMonthlySession"
        >
          บันทึกรอบ
        </v-btn>
      </section>
      </main>
    </div>

    <v-dialog v-model="confirmOpen" max-width="440" :persistent="rotateBusy">
      <div class="dialog-body">
        <h2 class="dialog-title">สร้าง QR ใหม่</h2>
        <p class="dialog-text">
          QR เดิมจะใช้ไม่ได้ทันที ต้องแจกจ่าย QR ใหม่ให้ผู้เข้าประชุม ยืนยันหรือไม่
        </p>
        <p v-if="rotateError" class="inline-error" role="alert">{{ rotateError }}</p>
        <div class="dialog-actions">
          <v-btn variant="text" :disabled="rotateBusy" @click="confirmOpen = false">ยกเลิก</v-btn>
          <v-btn color="primary" :loading="rotateBusy" @click="confirmRotate">ยืนยัน</v-btn>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.page {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: #f4f8f5;
  font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif;
  color: #12251f;
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

/* Header */
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
  font-family: 'Sarabun', sans-serif;
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
  white-space: normal;
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

/* Main */
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
  line-height: 1;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.35;
  color: #115447;
}

.page-head p {
  margin: 0;
  max-width: 640px;
  color: #3d4f49;
  font-size: 15px;
  line-height: 1.6;
}

.type-tabs {
  border-bottom: 1px solid #e3e8e6;
}

.page-alert {
  border-radius: 12px;
}

.panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}

.card {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e3e8e6;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(16, 40, 35, 0.06);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 18px;
}

.card-head-text {
  min-width: 0;
}

.card-head-text h2,
.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: #115447;
}

.card-head-text p {
  margin: 4px 0 0;
  color: #6b7a75;
  font-size: 13px;
  line-height: 1.5;
}

.live-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: #e4f5ec;
  color: #176c5b;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #176c5b;
}

.qr-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 16px;
  border: 1px dashed #dfe7e3;
  border-radius: 12px;
  background: #f7faf8;
}

.qr-image {
  display: block;
  width: 240px;
  height: auto;
  max-width: 100%;
  aspect-ratio: 1 / 1;
  background: #ffffff;
}

.qr-placeholder {
  color: #6b7a75;
  font-size: 13px;
}

.qr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.qr-actions .v-btn {
  flex: 1 1 auto;
  min-width: 0;
}

.window-card .card-title {
  margin-bottom: 14px;
}

.day-line {
  margin: 0 0 14px;
  color: #12251f;
  font-size: 14px;
  font-weight: 500;
}

.time-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.time-field :deep(input) {
  font-variant-numeric: tabular-nums;
}

.window-save {
  margin-top: 16px;
  width: 100%;
}

.monthly-note {
  margin: 0;
  padding: 14px;
  border-radius: 12px;
  background: #eaf3ef;
  color: #115447;
  font-size: 14px;
  line-height: 1.6;
}

.monthly-card {
  margin-top: 20px;
}

.cycle-list {
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.cycle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #eef1ef;
  border-radius: 12px;
  background: #f7faf8;
}

.cycle-date {
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.cycle-time {
  font-size: 13px;
  color: #6b7a75;
  font-variant-numeric: tabular-nums;
}

.cycle-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  margin-top: 6px;
}

.monthly-save {
  margin-top: 16px;
  width: 100%;
}

.empty-text {
  margin: 0;
  color: #6b7a75;
  font-size: 13px;
}

.state-box.small {
  min-height: 80px;
}

.inline-error {
  margin: 10px 0 0;
  color: #b3261e;
  font-size: 13px;
  line-height: 1.5;
}

.inline-notice {
  margin: 10px 0 0;
  color: #176c5b;
  font-size: 13px;
  line-height: 1.5;
}

.state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  color: #4b5b55;
  font-size: 14px;
  text-align: center;
}

/* Dialog */
.dialog-body {
  padding: 22px 20px;
  border-radius: 18px;
  background: #ffffff;
}

.dialog-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
  color: #115447;
}

.dialog-text {
  margin: 0;
  color: #3d4f49;
  font-size: 14px;
  line-height: 1.7;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

@media (min-width: 640px) {
  .card { padding: 22px; }
}

@media (min-width: 900px) {
  .page-head h1 { font-size: 26px; }
  .panels { grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 20px; }
  .qr-actions .v-btn { flex: 0 1 auto; }
  .cycle-form { grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) minmax(0, 0.8fr); }
  .monthly-save { width: auto; }
}

@media (max-width: 899px) {
  .shell { flex-direction: column; padding: 14px; }
  .topbar { padding: 12px 14px; }
  .panels { grid-template-columns: minmax(0, 1fr); }
  .time-grid { grid-template-columns: minmax(0, 1fr); }
  .qr-actions .v-btn { width: 100%; }
}
</style>
