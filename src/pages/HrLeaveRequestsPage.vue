<script setup>
import { onMounted, ref } from 'vue'
import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import {
  CERTIFICATE_OPEN_LABEL,
  certificateStatus,
  retentionNotice,
} from '../leave-certificate.js'
import { getCached, peekCached } from '../lib/data-cache.js'
import {
  DATA_KEYS,
  PAGE_TTL_MS,
  SHARED_TTL_MS,
  dataKey,
  errorTextOf,
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

const detail = ref(null)
const detailLoading = ref(false)

// The certificate is private: the Worker issues a signed URL for 60 seconds.
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
    const [catalog, leave] = await Promise.all([
      getCached(
        dataKey.directoryCatalog('/api/hr/directory/catalog'),
        loaders.directoryCatalog('/api/hr/directory/catalog'),
        { ttlMs: SHARED_TTL_MS }
      ),
      getCached(DATA_KEYS.hrCatalog, loaders.hrCatalog, { ttlMs: SHARED_TTL_MS }),
    ])
    departments.value = Array.isArray(catalog.departments) ? catalog.departments : []
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

          <button
            v-for="item in results"
            :key="item.id"
            type="button"
            class="list-row"
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
            <a
              v-if="certificateOf(detail).canOpen"
              href="#"
              @click.prevent="openAttachment(detail.id)"
            >{{ CERTIFICATE_OPEN_LABEL }}</a>
            <span v-else>{{ certificateOf(detail).label }}</span>
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
          </div>
        </template>
      </section>
    </main>
</template>

<style scoped>
.content {
  max-width: 1120px;
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

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.filters {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  align-items: end;
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 16px;
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
  color: #12343b;
}

.input {
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid #cfdcda;
  border-radius: 9px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 14px;
}

.filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.primary-btn,
.ghost-btn {
  min-height: 40px;
  padding: 0 16px;
  border-radius: 9px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn {
  background: #10504e;
  color: #ffffff;
  border: 0;
}

.ghost-btn {
  background: #ffffff;
  color: #12343b;
  border: 1px solid #cfdcda;
}

.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.primary-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 9px;
  background: #10504e;
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
}

.hint,
.empty {
  font-size: 13.5px;
  color: #5c7176;
  padding: 6px 2px;
}

.hint.warning {
  color: #8a4b06;
}

.hint.error {
  color: #a01b1b;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 8px 16px 4px;
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
  color: #5c7176;
  padding: 8px 4px;
  border-bottom: 1px solid #e6edeb;
}

.list-row {
  width: 100%;
  border: none;
  border-bottom: 1px solid #eef3f2;
  background: none;
  padding: 10px 4px;
  font-family: inherit;
  font-size: 13.5px;
  color: #12343b;
  cursor: pointer;
}

.list-row:hover,
.list-row:focus-visible {
  background: #f4f8f7;
  outline: none;
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
  color: #5c7176;
}

.name {
  font-weight: 600;
}

.meta {
  font-size: 11.5px;
  color: #5c7176;
}

.tag {
  align-self: flex-start;
  margin-top: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #eef3f2;
  font-size: 11px;
  color: #41585c;
}

.badge {
  display: inline-block;
  padding: 3px 9px;
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
  color: #5c7176;
}

.detail {
  margin-top: 20px;
  background: #ffffff;
  border: 1px solid #dfe7e5;
  border-radius: 14px;
  padding: 18px 20px;
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
  color: #12343b;
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  margin: 0;
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
  margin: 10px 0 0;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.note a {
  color: #10504e;
  font-weight: 600;
}

@media (max-width: 760px) {
  .list-head { display: none; }
  .list-row {
    grid-template-columns: 1fr;
    gap: 4px;
    border: 1px solid #e6edeb;
    border-radius: 10px;
    margin-bottom: 8px;
    padding: 12px;
  }
}
</style>
