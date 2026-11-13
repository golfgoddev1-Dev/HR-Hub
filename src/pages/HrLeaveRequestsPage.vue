<script setup>
import { onMounted, ref } from 'vue'
import { postJson } from '../api.js'
import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import { certificateStatus, retentionNotice } from '../leave-certificate.js'
import { getCached, peekCached } from '../lib/data-cache.js'
import HrLeave3DScene from '../components/HrLeave3DScene.vue'
import { allowsPointerTilt } from '../lib/lite-mode.js'
import {
  DATA_KEYS,
  PAGE_TTL_MS,
  SHARED_TTL_MS,
  dataKey,
  errorTextOf,
  loadHrDepartments,
  loaders,
  loadShared,
} from '../lib/shared-data.js'

const LOAD_ERROR = 'โหลดรายการใบลาไม่สำเร็จ กรุณาลองใหม่'
const PAGE_SIZE = 20

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
const page = ref(1)
const hasMore = ref(false)
const scanCapped = ref(false)

const departments = ref([])
const types = ref([])
const retentionDays = ref(0)

const filters = ref({
  departmentId: null,
  status: null,
  leaveTypeId: null,
  from: '',
  to: '',
})

// Pointer tilt on the rows: a 6-degree follow of the pointer, off on lite
// devices and wherever the visitor asked for reduced motion.
const TILT_MAX_DEG = 6
const tiltEnabled = ref(false)

function tiltCard(event) {
  if (!tiltEnabled.value) return
  const el = event.currentTarget
  if (!el || typeof el.getBoundingClientRect !== 'function') return
  const rect = el.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const across = (event.clientX - rect.left) / rect.width
  const down = (event.clientY - rect.top) / rect.height
  el.style.setProperty('--tilt-y', `${((across - 0.5) * 2 * TILT_MAX_DEG).toFixed(2)}deg`)
  el.style.setProperty('--tilt-x', `${((0.5 - down) * 2 * TILT_MAX_DEG).toFixed(2)}deg`)
}

function resetCardTilt(event) {
  const el = event.currentTarget
  if (!el || !el.style) return
  el.style.removeProperty('--tilt-y')
  el.style.removeProperty('--tilt-x')
}

const detail = ref(null)
const detailLoading = ref(false)
const resendBusy = ref(false)
const resendMessage = ref('')
const resendError = ref('')

function statusLabel(value) {
  return STATUS_LABELS[value] ?? value ?? '—'
}

function statusClass(value) {
  return STATUS_CLASSES[value] ?? 'badge-cancelled'
}

function buildQuery() {
  const params = new URLSearchParams()
  if (filters.value.departmentId) params.set('departmentId', filters.value.departmentId)
  if (filters.value.status) params.set('status', filters.value.status)
  if (filters.value.leaveTypeId) params.set('leaveTypeId', filters.value.leaveTypeId)
  if (filters.value.from) params.set('from', filters.value.from)
  if (filters.value.to) params.set('to', filters.value.to)
  params.set('page', String(page.value))
  params.set('pageSize', String(PAGE_SIZE))
  return params.toString()
}

async function load(targetPage = page.value) {
  const query = buildQuery()
  const key = dataKey.hrRequests(query)
  loading.value = !peekCached(key)
  errorMessage.value = ''
  try {
    await loadShared(key, loaders.hrRequests(query), {
      ttlMs: PAGE_TTL_MS,
      onData: (data) => {
        page.value = targetPage
        results.value = Array.isArray(data.results) ? data.results : []
        hasMore.value = data.hasMore === true
        scanCapped.value = data.scanCapped === true
      },
    })
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
    results.value = []
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  try {
    const [departmentList, leave] = await Promise.all([
      loadHrDepartments(),
      getCached(DATA_KEYS.hrCatalog, loaders.hrCatalog, { ttlMs: SHARED_TTL_MS }),
    ])
    departments.value = departmentList
    types.value = Array.isArray(leave.types) ? leave.types : []
    retentionDays.value = Number(leave.certificateRetentionDays) || 0
  } catch {
    departments.value = []
    types.value = []
  }
}

async function openDetail(item) {
  detailLoading.value = true
  detail.value = { id: item.id, loading: true }
  resendMessage.value = ''
  resendError.value = ''
  try {
    const response = await fetch(`/api/leave/hr/requests/${encodeURIComponent(item.id)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      detail.value = { id: item.id, error: typeof data.message === 'string' ? data.message : LOAD_ERROR }
      return
    }
    detail.value = data.request
  } catch {
    detail.value = { id: item.id, error: LOAD_ERROR }
  } finally {
    detailLoading.value = false
  }
}

function certificateOf(request) {
  return certificateStatus(request, { retentionDays: retentionDays.value })
}

function openPrint(id) {
  if (!id) return
  window.open(`/leave/hr/requests/${encodeURIComponent(id)}/print`, '_blank', 'noopener')
}

// HR replaces the request's open email links with one new 72-hour link. The
// response carries no token or URL, only the new expiry.
async function resendApprovalLink(id) {
  if (!id || resendBusy.value) return
  resendBusy.value = true
  resendMessage.value = ''
  resendError.value = ''
  try {
    const { status, data } = await postJson(
      `/api/leave/hr/requests/${encodeURIComponent(id)}/approval-link`,
      {}
    )
    if (status !== 200 || data.ok !== true) {
      resendError.value =
        typeof data.message === 'string'
          ? data.message
          : 'ส่งลิงก์อนุมัติใหม่ไม่สำเร็จ กรุณาลองใหม่'
      return
    }
    resendMessage.value = 'ส่งลิงก์อนุมัติใหม่แล้ว (ลิงก์ใหม่มีอายุ 72 ชั่วโมง)'
  } catch {
    resendError.value = 'ส่งลิงก์อนุมัติใหม่ไม่สำเร็จ กรุณาลองใหม่'
  } finally {
    resendBusy.value = false
  }
}

function resetFilters() {
  filters.value = { departmentId: null, status: null, leaveTypeId: null, from: '', to: '' }
  page.value = 1
  load(1)
}

function nextPage() {
  if (!hasMore.value) return
  load(page.value + 1)
}

function previousPage() {
  if (page.value <= 1) return
  load(page.value - 1)
}

onMounted(async () => {
  // Read once on mount: a lite device keeps the list flat for the whole visit.
  tiltEnabled.value = allowsPointerTilt()
  await loadOptions()
  await load(1)
})
</script>

<template>

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">จัดการใบลา</h1>
          <p class="sub">
            ดูใบลาทั้งหมดของทุกแผนก · หน้านี้ไม่เปลี่ยนสถานะใบลา ใช้ได้เฉพาะการดูและคีย์ย้อนหลัง
          </p>
        </div>
        <div class="head-actions">
          <RouterLink to="/hr/leave/backdated" class="primary-link">คีย์ใบลาย้อนหลัง</RouterLink>
        </div>
      </div>

      <!-- Decorative only: lite devices keep the gradient, never a canvas. -->
      <HrLeave3DScene class="hero-scene" />

      <section class="filters">
        <label class="field">
          <span class="label">แผนก</span>
          <v-select
            v-model="filters.departmentId"
            :items="departments"
            item-title="name"
            item-value="id"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            placeholder="ทุกแผนก"
          />
        </label>

        <label class="field">
          <span class="label">สถานะ</span>
          <v-select
            v-model="filters.status"
            :items="[
              { title: 'รออนุมัติ', value: 'pending' },
              { title: 'อนุมัติแล้ว', value: 'approved' },
              { title: 'ไม่อนุมัติ', value: 'rejected' },
              { title: 'ยกเลิก', value: 'cancelled' },
            ]"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            placeholder="ทุกสถานะ"
          />
        </label>

        <label class="field">
          <span class="label">ประเภทการลา</span>
          <v-select
            v-model="filters.leaveTypeId"
            :items="types"
            item-title="name"
            item-value="id"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            placeholder="ทุกประเภท"
          />
        </label>

        <label class="field">
          <span class="label">ตั้งแต่วันที่</span>
          <input v-model="filters.from" class="input" type="date" />
        </label>

        <label class="field">
          <span class="label">ถึงวันที่</span>
          <input v-model="filters.to" class="input" type="date" />
        </label>

        <div class="filter-actions">
          <button type="button" class="primary-btn" @click="load(1)">ค้นหา</button>
          <button type="button" class="ghost-btn" @click="resetFilters">ล้างตัวกรอง</button>
        </div>
      </section>

      <p v-if="loading" class="hint">กำลังโหลด…</p>

      <v-alert v-else-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>

      <template v-else>
        <p v-if="scanCapped" class="hint warning">
          การกรองตามแผนกอ่านได้สูงสุด 1,000 รายการแรก กรุณาเพิ่มช่วงวันที่เพื่อผลที่ครบถ้วน
        </p>

        <section class="card">
          <div class="list-head">
            <span>รหัส / พนักงาน</span>
            <span>ประเภท</span>
            <span>ช่วงวันที่</span>
            <span>วัน</span>
            <span>สถานะ</span>
          </div>

          <TransitionGroup name="leave-card" tag="div" class="list-body">
            <button
              v-for="(item, index) in results"
              :key="item.id"
              type="button"
              class="list-row"
              :class="{ 'row-tilt': tiltEnabled }"
              :style="{ '--row-index': index }"
              @pointermove="tiltCard"
              @pointerleave="resetCardTilt"
              @focus="resetCardTilt"
              @blur="resetCardTilt"
              @click="openDetail(item)"
            >
              <span class="cell">
                <span class="code">{{ item.requestCode || '—' }}</span>
                <span class="name">{{ item.requester?.fullName || '—' }}</span>
                <span class="meta">
                  {{ item.requester?.employeeCode || '' }}
                  <template v-if="item.departmentName"> · {{ item.departmentName }}</template>
                </span>
              </span>
              <span class="cell">
                {{ item.leaveTypeName || '—' }}
                <span v-if="item.source === 'hr_backdated'" class="tag">คีย์ย้อนหลัง</span>
              </span>
              <span class="cell">{{ formatThaiDateRange(item.startDate, item.endDate) }}</span>
              <span class="cell">{{ item.days ?? '—' }}</span>
              <span class="cell">
                <span class="badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
              </span>
            </button>
          </TransitionGroup>

          <p v-if="results.length === 0" class="empty">ไม่พบใบลาตามเงื่อนไขที่เลือก</p>
        </section>

        <div class="pager">
          <button type="button" class="ghost-btn" :disabled="page <= 1" @click="previousPage">
            ← ก่อนหน้า
          </button>
          <span class="page-number">หน้า {{ page }}</span>
          <button type="button" class="ghost-btn" :disabled="!hasMore" @click="nextPage">
            ถัดไป →
          </button>
        </div>
      </template>

      <Transition name="leave-detail">
        <section v-if="detail" class="detail">
          <div class="detail-head">
            <h2 class="detail-title">รายละเอียดใบลา</h2>
            <button type="button" class="ghost-btn" @click="detail = null">ปิด</button>
          </div>

          <p v-if="detail.error" class="hint error">{{ detail.error }}</p>
          <p v-else-if="detailLoading && !detail.requestCode" class="hint">กำลังโหลด…</p>
          <template v-else>
            <dl class="facts">
              <div class="fact"><dt>รหัส</dt><dd>{{ detail.requestCode || '—' }}</dd></div>
              <div class="fact"><dt>พนักงาน</dt><dd>{{ detail.requester?.fullName || '—' }}</dd></div>
              <div class="fact"><dt>แผนก</dt><dd>{{ detail.departmentName || '—' }}</dd></div>
              <div class="fact"><dt>ประเภท</dt><dd>{{ detail.leaveTypeName || '—' }}</dd></div>
              <div class="fact"><dt>ช่วงวันที่</dt><dd>{{ formatThaiDateRange(detail.startDate, detail.endDate) }}</dd></div>
              <div class="fact"><dt>จำนวนวัน</dt><dd>{{ detail.days ?? '—' }}</dd></div>
              <div class="fact">
                <dt>กลับมาทำงาน</dt>
                <dd>
                  {{ detail.returnDate ? `${formatThaiDate(detail.returnDate)} ${detail.returnTime || ''}` : '—' }}
                </dd>
              </div>
              <div class="fact"><dt>กะ / OT</dt><dd>{{ detail.shiftCode || '—' }} · {{ detail.otOption || '—' }}</dd></div>
              <div class="fact"><dt>ผู้อนุมัติ</dt><dd>{{ detail.approver?.fullName || '—' }}</dd></div>
              <div class="fact"><dt>ที่มา</dt><dd>{{ detail.source === 'hr_backdated' ? 'HR คีย์ย้อนหลัง' : 'พนักงานยื่นเอง' }}</dd></div>
              <div class="fact"><dt>ตัดสินเมื่อ</dt><dd>{{ formatThaiDate(detail.decidedAt) }}</dd></div>
              <div class="fact"><dt>บันทึกเมื่อ</dt><dd>{{ formatThaiDate(detail.createdAt) }}</dd></div>
            </dl>

            <p v-if="detail.otherTypeDetail" class="note">ประเภทอื่น ๆ: {{ detail.otherTypeDetail }}</p>
            <p v-if="detail.reason" class="note">เหตุผล: {{ detail.reason }}</p>
            <p v-if="detail.decisionNote" class="note">หมายเหตุการตัดสิน: {{ detail.decisionNote }}</p>
            <p v-if="certificateOf(detail).has" class="note">
              <span>{{ certificateOf(detail).label }}</span>
              <span
                v-if="certificateOf(detail).state === 'stored' && certificateOf(detail).expiry"
                class="note-sub"
              >
                · {{ certificateOf(detail).expiry.label }}
              </span>
            </p>
            <p v-if="retentionDays > 0" class="note-sub">{{ retentionNotice(retentionDays) }}</p>

            <div class="detail-actions">
              <button type="button" class="ghost-btn" @click="openPrint(detail.id)">
                พิมพ์ / บันทึกเป็น PDF
              </button>
              <button
                v-if="detail.status === 'pending'"
                type="button"
                class="primary-btn"
                :disabled="resendBusy"
                @click="resendApprovalLink(detail.id)"
              >
                ส่งลิงก์อนุมัติใหม่
              </button>
            </div>

            <p v-if="resendError" class="hint error">{{ resendError }}</p>
            <p v-if="resendMessage" class="hint">{{ resendMessage }}</p>
          </template>
        </section>
      </Transition>
    </main>
</template>

<style scoped>
.content {
  /* Approved palette, declared once on the page root. Contrast (WCAG AA, normal
     text) is asserted in tests/hr-leave-3d.test.js:
       indigo-900 on white 15.99, on slate-50 15.28, on slate-100 14.59
       slate-600 on white 7.58, on slate-50 7.24, on slate-100 6.92
       white on indigo-600 6.29, white on indigo-700 7.90
       indigo-600 on white 6.29, on slate-50 6.01
       indigo-700 on indigo-50 7.07
       violet-500 is decorative only (4.23 on white): never used for text.
     Status colours stay semantic and unchanged. */
  --indigo-600: #4f46e5;
  --indigo-700: #4338ca;
  --indigo-900: #1e1b4b;
  --indigo-50: #eef2ff;
  --violet-500: #8b5cf6;
  --slate-50: #f8fafc;
  --slate-100: #f1f5f9;
  --slate-200: #e2e8f0;
  --slate-600: #475569;
  --tap-target: 44px;
  --radius-card: 16px;
  --radius-control: 10px;

  position: relative;
  /* The shell already caps and centres its inner box, so the page background is
     pulled out to those edges instead of sitting inside the shell padding. */
  margin: 0 -20px;
  padding: 24px 20px 64px;
  color: var(--indigo-900);
  background: var(--slate-50);
  border-radius: 18px;
}

@media (max-width: 720px) {
  .content {
    margin: 0 -14px;
    padding: 16px 14px 40px;
    border-radius: 0 0 16px 16px;
  }
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: var(--indigo-900);
  margin: 0 0 6px;
  letter-spacing: -0.01em;
}

.sub {
  margin: 0;
  max-width: 640px;
  font-size: 13px;
  color: var(--slate-600);
  line-height: 1.6;
}

/* The decorative 3D layer sits above the filters as its own band, so no leave
   text ever shares space with it. */
.hero-scene {
  display: block;
  margin-bottom: 16px;
}

.filters {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  align-items: end;
  background: #ffffff;
  border: 1px solid var(--slate-200);
  border-radius: var(--radius-card);
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(30, 27, 75, 0.05);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--indigo-900);
}

.input {
  width: 100%;
  min-height: var(--tap-target);
  padding: 8px 12px;
  border: 1px solid var(--slate-200);
  border-radius: var(--radius-control);
  background: var(--slate-50);
  color: var(--indigo-900);
  font-family: inherit;
  font-size: 14px;
}

/* Vuetify paints placeholders at 38% opacity (about 2.4:1 on white). The page
   sets them to slate-600 instead, which is 7.58:1. */
.input::placeholder,
.field :deep(input::placeholder) {
  color: var(--slate-600);
  opacity: 1;
}

.input:focus-visible {
  border-color: var(--indigo-600);
  outline: 2px solid var(--violet-500);
  outline-offset: 2px;
}

/* The Vuetify fields follow the same 44px tap target on every screen. */
.field :deep(.v-field) {
  min-height: var(--tap-target);
  border-radius: var(--radius-control);
}

.filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.primary-btn,
.ghost-btn {
  min-height: var(--tap-target);
  padding: 0 18px;
  border-radius: var(--radius-control);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
}

.primary-btn {
  background: var(--indigo-600);
  color: #ffffff;
  border: 1px solid var(--indigo-600);
  box-shadow: 0 6px 14px rgba(79, 70, 229, 0.2);
}

.ghost-btn {
  background: #ffffff;
  color: var(--indigo-900);
  border: 1px solid var(--slate-200);
}

.primary-btn:focus-visible,
.ghost-btn:focus-visible,
.primary-link:focus-visible {
  outline: 2px solid var(--violet-500);
  outline-offset: 2px;
}

.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-target);
  padding: 0 18px;
  border-radius: var(--radius-control);
  background: var(--indigo-600);
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 6px 14px rgba(79, 70, 229, 0.2);
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

/* Hover is a bonus for precise pointers only; every action is a real button, so
   a touch device loses nothing. */
@media (hover: hover) and (pointer: fine) {
  .primary-btn:hover {
    background: var(--indigo-700);
    border-color: var(--indigo-700);
  }

  .primary-link:hover {
    background: var(--indigo-700);
  }

  .ghost-btn:hover {
    background: var(--indigo-50);
    border-color: #c7d2fe;
  }

  .list-row:hover {
    background: var(--indigo-50);
  }

  /* A small follow of the pointer, only where lite mode left the tilt on. */
  .list-row.row-tilt:hover {
    z-index: 2;
    transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg)) translateZ(6px);
    box-shadow:
      0 2px 4px rgba(30, 27, 75, 0.08),
      0 10px 22px rgba(30, 27, 75, 0.1),
      0 22px 44px rgba(30, 27, 75, 0.06);
  }

  .note a:hover {
    text-decoration: underline;
  }
}

.hint,
.empty {
  font-size: 13.5px;
  color: var(--slate-600);
  padding: 6px 2px;
}

.hint.warning {
  color: #92400e;
}

.hint.error {
  color: #b91c1c;
}

.card {
  background: #ffffff;
  border: 1px solid var(--slate-200);
  border-radius: var(--radius-card);
  padding: 8px 16px 4px;
  box-shadow: 0 1px 2px rgba(30, 27, 75, 0.05);
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.2fr) 56px 110px;
  gap: 10px;
  align-items: center;
  text-align: left;
}

.list-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--slate-600);
  padding: 8px 4px;
  border-bottom: 1px solid var(--slate-200);
}

.list-body {
  perspective: 1000px;
}

.list-row {
  width: 100%;
  min-height: var(--tap-target);
  border: none;
  border-bottom: 1px solid var(--slate-100);
  background: none;
  padding: 10px 4px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--indigo-900);
  cursor: pointer;
  transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  transform-style: preserve-3d;
  transition:
    transform 240ms ease,
    box-shadow 240ms ease,
    background-color 160ms ease;
  box-shadow: 0 1px 1px rgba(30, 27, 75, 0.03);
}

.list-row:focus-visible {
  background: var(--indigo-50);
  outline: 2px solid var(--violet-500);
  outline-offset: -2px;
}

/* Entrance: the cards rise in with a short stagger, 280ms at the slowest.
   Transform and opacity only, so the list never changes size. */
.leave-card-enter-active {
  transition:
    opacity 260ms ease,
    transform 260ms cubic-bezier(0.22, 0.75, 0.35, 1);
  transition-delay: calc(var(--row-index, 0) * 28ms);
}

.leave-card-enter-from {
  opacity: 0;
  transform: translate3d(0, 12px, 0) rotateX(-4deg) scale(0.985);
}

.leave-card-leave-active {
  transition: opacity 140ms ease;
}

.leave-card-leave-to {
  opacity: 0;
}

.list-row:last-of-type {
  border-bottom: none;
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--slate-600);
}

.name {
  font-weight: 600;
  color: var(--indigo-900);
}

.meta {
  font-size: 11.5px;
  color: var(--slate-600);
}

.tag {
  align-self: flex-start;
  margin-top: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--indigo-50);
  font-size: 11px;
  color: var(--indigo-700);
}

.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}

.badge-pending { background: #fff2df; color: #8a4b06; }
.badge-approved { background: #e6f4ec; color: #1c6b3f; }
.badge-rejected { background: #fdecec; color: #a01b1b; }
.badge-cancelled { background: #f1f1f1; color: #6a6a6a; }

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}

.page-number {
  font-size: 13px;
  color: var(--slate-600);
}

.detail {
  margin-top: 20px;
  background: #ffffff;
  border: 1px solid var(--slate-200);
  border-radius: var(--radius-card);
  padding: 20px;
  transform-origin: top center;
  box-shadow: 0 10px 30px rgba(30, 27, 75, 0.08);
}

/* The detail panel opens from the top: a slight scale and a small rotateX. */
.leave-detail-enter-active {
  transition:
    opacity 240ms ease,
    transform 240ms cubic-bezier(0.22, 0.75, 0.35, 1);
}

.leave-detail-enter-from {
  opacity: 0;
  transform-origin: top center;
  transform: perspective(900px) scale(0.96) rotateX(-6deg);
}

.leave-detail-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.leave-detail-leave-to {
  opacity: 0;
  transform: perspective(900px) scale(0.98);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.detail-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--indigo-900);
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin: 0;
  padding: 14px;
  border-radius: 12px;
  background: var(--slate-50);
  border: 1px solid var(--slate-100);
}

.fact dt {
  font-size: 12px;
  color: var(--slate-600);
}

.fact dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--indigo-900);
  overflow-wrap: anywhere;
}

.note {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--slate-600);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.note-sub {
  margin: 8px 0 0;
  font-size: 12.5px;
  color: var(--slate-600);
  overflow-wrap: anywhere;
}

.note a {
  color: var(--indigo-600);
  font-weight: 600;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

/* Phones and small tablets: the rows ARE the cards, so the wrapper steps back. */
@media (max-width: 760px) {
  .list-head {
    display: none;
  }

  .card {
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 0;
  }

  .list-row {
    grid-template-columns: 1fr;
    gap: 4px;
    border: 1px solid var(--slate-200);
    border-radius: 12px;
    margin-bottom: 8px;
    padding: 12px 14px;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(30, 27, 75, 0.05);
  }

  .badge {
    font-size: 12px;
    padding: 4px 10px;
  }

  .pager {
    justify-content: space-between;
  }
}

/* Below 600px the detail panel is a full-screen sheet: no chance of a sideways
   overflow, and the page underneath cannot be tapped by accident. */
@media (max-width: 599px) {
  .detail {
    position: fixed;
    inset: 0;
    z-index: 70;
    margin: 0;
    border: 0;
    border-radius: 0;
    padding: calc(10px + env(safe-area-inset-top)) 16px
      calc(28px + env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
    box-shadow: none;
    background: #ffffff;
  }

  .detail-head {
    position: sticky;
    top: 0;
    z-index: 1;
    margin-bottom: 14px;
    padding: 10px 0 12px;
    background: #ffffff;
    border-bottom: 1px solid var(--slate-200);
  }

  .detail-title {
    font-size: 17px;
  }

  .facts {
    grid-template-columns: 1fr 1fr;
    gap: 8px 12px;
  }

  .detail-actions button {
    flex: 1 1 100%;
  }

  /* A sheet slides up rather than opening from the top: no perspective, so it
     cannot paint outside the viewport. */
  .leave-detail-enter-from {
    opacity: 0;
    transform: translate3d(0, 16px, 0);
  }

  .leave-detail-leave-to {
    opacity: 0;
    transform: none;
  }
}

/* Reduced motion: no tilt, no rise, no scale, no slide. The list and the panel
   still render, just without movement. */
@media (prefers-reduced-motion: reduce) {
  .list-row,
  .list-row.row-tilt:hover,
  .leave-card-enter-active,
  .leave-card-leave-active,
  .leave-detail-enter-active,
  .leave-detail-leave-active,
  .primary-btn,
  .ghost-btn,
  .primary-link {
    transition: none;
    transform: none;
  }

  .leave-card-enter-from,
  .leave-card-leave-to,
  .leave-detail-enter-from,
  .leave-detail-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
