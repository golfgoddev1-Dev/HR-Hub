<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import LeaveNav from '../components/LeaveNav.vue'
import PushToggle from '../components/PushToggle.vue'
import { CERTIFICATE_OPEN_LABEL, certificateStatus } from '../leave-certificate.js'

const LOAD_ERROR = 'โหลดรายการใบลาไม่สำเร็จ กรุณาลองใหม่'
const EMPTY = 'ยังไม่มีรายการใบลา'

const STATUS_LABELS = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
}

const STATUS_CLASSES = {
  pending: 'badge-pending',
  approved: 'badge-approved',
  rejected: 'badge-rejected',
  cancelled: 'badge-cancelled',
}

const loading = ref(true)
const errorMessage = ref('')
const results = ref([])
const pendingApprovals = ref(0)
const retentionDays = ref(0)

const route = useRoute()
const focusId = computed(() => (typeof route.query.focus === 'string' ? route.query.focus : ''))
// The in-app list is always the fallback source of truth, push or no push.
const myPending = computed(() => results.value.filter((item) => item.status === 'pending').length)

function thaiDate(value) {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function rangeText(item) {
  if (!item.startDate) return '—'
  if (item.endDate && item.endDate !== item.startDate) {
    return `${thaiDate(item.startDate)} – ${thaiDate(item.endDate)}`
  }
  return thaiDate(item.startDate)
}

function statusLabel(value) {
  return STATUS_LABELS[value] ?? value ?? '—'
}

function statusClass(value) {
  return STATUS_CLASSES[value] ?? 'badge-cancelled'
}

function certificate(item) {
  return certificateStatus(item, { retentionDays: retentionDays.value })
}

function daysText(item) {
  const days = Number(item.days)
  if (!Number.isFinite(days)) return '—'
  return Number.isInteger(days) ? `${days} วัน` : `${days} วัน (ครึ่งวัน)`
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/leave/requests/mine', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    results.value = Array.isArray(data.results) ? data.results : []
    retentionDays.value = Number(data.certificateRetentionDays) || 0
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function loadPendingApprovals() {
  try {
    const response = await fetch('/api/leave/approvals', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    pendingApprovals.value = Array.isArray(data.results) ? data.results.length : 0
  } catch {
    pendingApprovals.value = 0
  }
}

async function openAttachment(id) {
  if (!id) return
  errorMessage.value = ''
  try {
    const response = await fetch(
      `/api/leave/requests/${encodeURIComponent(id)}/attachment`,
      { credentials: 'same-origin' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true || typeof data.url !== 'string') {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    window.open(data.url, '_blank', 'noopener')
  } catch {
    errorMessage.value = LOAD_ERROR
  }
}

onMounted(() => {
  load()
  loadPendingApprovals()
})
</script>

<template>
  <div class="page">
    <LeaveNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">ใบลาของฉัน</h1>
          <p class="sub">ดูสถานะใบลาที่เคยยื่นไว้ · คำนวณวันทำการและวันกลับมาทำงานโดยระบบ</p>
        </div>
        <RouterLink to="/leave/new" class="primary-link">ยื่นใบลาใหม่ →</RouterLink>
      </div>

      <section class="summary">
        <div class="summary-item">
          <span class="summary-label">ใบลาของฉันที่รอดำเนินการ</span>
          <span class="summary-value">{{ myPending }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">ใบลารอฉันอนุมัติ</span>
          <RouterLink v-if="pendingApprovals > 0" to="/leave/approvals" class="summary-link">
            {{ pendingApprovals }} รายการ →
          </RouterLink>
          <span v-else class="summary-value">0</span>
        </div>
      </section>

      <PushToggle />

      <p v-if="loading" class="hint">กำลังโหลด…</p>

      <v-alert v-else-if="errorMessage" type="error" variant="tonal" class="mb-4">
        {{ errorMessage }}
      </v-alert>

      <p v-else-if="results.length === 0" class="empty">{{ EMPTY }}</p>

      <section v-else class="list">
        <article
          v-for="item in results"
          :key="item.id"
          :class="['card', { 'card-focus': item.id === focusId }]"
        >
          <div class="card-head">
            <div>
              <span class="code">{{ item.requestCode || '—' }}</span>
              <h2 class="type">{{ item.leaveTypeName || 'ไม่ระบุประเภท' }}</h2>
              <p v-if="item.otherTypeDetail" class="detail">{{ item.otherTypeDetail }}</p>
            </div>
            <span class="badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
          </div>

          <dl class="facts">
            <div class="fact">
              <dt>ช่วงวันที่</dt>
              <dd>{{ rangeText(item) }}</dd>
            </div>
            <div class="fact">
              <dt>จำนวนวัน</dt>
              <dd>{{ daysText(item) }}</dd>
            </div>
            <div class="fact">
              <dt>กลับมาทำงาน</dt>
              <dd>{{ item.returnDate ? `${thaiDate(item.returnDate)} ${item.returnTime || ''}` : '—' }}</dd>
            </div>
            <div class="fact">
              <dt>ยื่นเมื่อ</dt>
              <dd>{{ thaiDate(item.createdAt) }}</dd>
            </div>
          </dl>

          <p v-if="certificate(item).has" class="note">
            <a
              v-if="certificate(item).canOpen"
              href="#"
              @click.prevent="openAttachment(item.id)"
            >{{ CERTIFICATE_OPEN_LABEL }}</a>
            <span v-else>{{ certificate(item).label }}</span>
            <span
              v-if="certificate(item).state === 'stored' && certificate(item).expiry"
              class="note-sub"
            >
              · {{ certificate(item).expiry.label }}
            </span>
          </p>

          <p v-if="item.decisionNote" class="note">
            เหตุผลจากผู้อนุมัติ: {{ item.decisionNote }}
          </p>
        </article>
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
  max-width: 1120px;
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
  max-width: 640px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  min-height: 42px;
  padding: 0 18px;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.hint,
.empty {
  font-size: 14px;
  color: #5c7176;
  padding: 8px 4px;
}

.summary {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  margin-bottom: 16px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e0e8e6;
}

.summary-label {
  font-size: 12.5px;
  color: #5c7176;
}

.summary-value {
  font-size: 22px;
  font-weight: 700;
  color: #12343b;
}

.summary-link {
  font-size: 17px;
  font-weight: 700;
  color: #10504e;
  text-decoration: none;
}

.card-focus {
  border-color: #10504e;
  box-shadow: 0 0 0 2px rgba(16, 80, 78, 0.18);
}

.list {
  display: grid;
  gap: 14px;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 16px 20px;
}

.card-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.code {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  letter-spacing: 0.03em;
  color: #5c7176;
}

.type {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.detail {
  margin: 4px 0 0;
  font-size: 13px;
  color: #5c7176;
}

.badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.badge-pending {
  background: #fff2df;
  color: #8a4b06;
}

.badge-approved {
  background: #e6f4ec;
  color: #1c6b3f;
}

.badge-rejected {
  background: #fdecec;
  color: #a01b1b;
}

.badge-cancelled {
  background: #f1f1f1;
  color: #6a6a6a;
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  margin: 14px 0 0;
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

.note {
  margin: 12px 0 0;
  font-size: 13px;
  color: #5c7176;
}
</style>
