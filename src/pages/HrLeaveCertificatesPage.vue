<script setup>
// HR certificate access. Pick an employee, then open that employee's sick-leave
// certificates. The list endpoint returns ids, codes, dates and status only; the
// file itself is streamed by the Worker through the HR-only route, never a URL.
import { ref } from 'vue'
import EmployeePicker from '../components/EmployeePicker.vue'
import { formatThaiDateRange } from '../lib/thai-date.js'

const LOAD_ERROR = 'โหลดรายการใบรับรองแพทย์ไม่สำเร็จ กรุณาลองใหม่'
const EMPTY = 'ไม่พบใบรับรองแพทย์ของพนักงานคนนี้'
const STATUS_LABELS = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

const employee = ref(null)
const loading = ref(false)
const errorMessage = ref('')
const results = ref([])

function statusLabel(value) {
  return STATUS_LABELS[value] ?? value ?? '—'
}

// Same-origin, cookie-authenticated: the Worker checks HR again and streams the
// file. A new tab keeps this list in place.
function certificateUrl(id) {
  return `/api/hr/leave-requests/${encodeURIComponent(id)}/medical-certificate`
}

async function load() {
  results.value = []
  errorMessage.value = ''
  if (!employee.value?.id) return

  loading.value = true
  try {
    const response = await fetch(
      `/api/hr/employees/${encodeURIComponent(employee.value.id)}/medical-certificates`,
      { credentials: 'same-origin', cache: 'no-store' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    results.value = Array.isArray(data.results) ? data.results : []
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

function selectEmployee(value) {
  employee.value = value
  if (value?.id) load()
  else results.value = []
}
</script>

<template>
  <main class="content">
    <div class="head">
      <h1 class="title">ใบรับรองแพทย์</h1>
      <p class="sub">
        เลือกพนักงานเพื่อดูใบรับรองแพทย์ของการลาป่วย · ไฟล์เปิดในแท็บใหม่และถูกส่งผ่านระบบ
        โดยตรวจสิทธิ์ทุกครั้ง
      </p>
    </div>

    <section class="card">
      <EmployeePicker
        :model-value="employee"
        label="พนักงาน"
        placeholder="พิมพ์ชื่อหรือรหัสพนักงาน"
        @update:model-value="selectEmployee"
      />
    </section>

    <section v-if="employee" class="card">
      <h2 class="card-title">รายการที่พบ</h2>

      <p v-if="loading" class="hint">กำลังโหลด…</p>
      <p v-else-if="errorMessage" class="hint error">{{ errorMessage }}</p>
      <p v-else-if="results.length === 0" class="hint">{{ EMPTY }}</p>

      <ul v-else class="list">
        <li v-for="item in results" :key="item.id" class="row">
          <div class="row-main">
            <span class="row-code">{{ item.requestCode || '—' }}</span>
            <span class="row-dates">
              {{ formatThaiDateRange(item.startDate, item.endDate) }}
            </span>
            <span class="status-chip">{{ statusLabel(item.status) }}</span>
          </div>
          <a
            class="open-btn"
            :href="certificateUrl(item.id)"
            target="_blank"
            rel="noopener noreferrer"
          >
            เปิดใบรับรองแพทย์
          </a>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.content {
  max-width: 900px;
  margin: 0 auto;
  padding: 28px 0 64px;
}

.head { margin-bottom: 16px; }
.title { margin: 0 0 6px; font-size: 24px; font-weight: 700; color: #12343b; }

.sub {
  margin: 0;
  max-width: 680px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.card {
  margin-bottom: 16px;
  padding: 18px 20px;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
}

.card-title { margin: 0 0 12px; font-size: 17px; font-weight: 700; color: #12343b; }

.hint { margin: 6px 0; font-size: 13px; color: #5c7176; }
.hint.error { color: #a01b1b; }

.list { margin: 0; padding: 0; list-style: none; }

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #eef3f2;
}

.row:last-child { border-bottom: none; }

.row-main {
  display: flex;
  flex: 1 1 220px;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: center;
  min-width: 0;
}

.row-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 600;
  color: #12343b;
  overflow-wrap: anywhere;
}

.row-dates { font-size: 13px; color: #48615e; overflow-wrap: anywhere; }

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 1px 10px;
  border: 1px solid #d9e2e0;
  border-radius: 999px;
  background: #f2f7f5;
  font-size: 12px;
  font-weight: 600;
  color: #10504e;
  white-space: nowrap;
}

.open-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.open-btn:focus-visible { outline: var(--motion-focus-width) solid var(--motion-focus); outline-offset: 2px; }

@media (max-width: 480px) {
  .content { padding: 18px 0 56px; }
  .row { align-items: stretch; }
  .row-main { flex-basis: 100%; }
  .open-btn { width: 100%; }
}
</style>
