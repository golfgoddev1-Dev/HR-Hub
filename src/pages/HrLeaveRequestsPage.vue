<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
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

// The order of the summary strip. Counts are read from the page the list already
// shows, so the strip never costs another request.
const STATUS_ORDER = ['pending', 'approved', 'rejected', 'cancelled']

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

const statStrip = ref(null)

const stats = computed(() =>
  STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: results.value.filter((row) => row?.status === status).length,
  }))
)

const visibleSummary = computed(() =>
  results.value.length
    ? `แสดง ${results.value.length} รายการในหน้านี้`
    : 'ไม่พบใบลาตามเงื่อนไขที่เลือก'
)

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

// The numbers in the summary strip count up to the value the list already
// painted. motion.js is fetched on demand, so the page chunk does not pull it
// into the shared module graph (and the entry bundle stays exactly as it was).
// It shows the final number at once for reduced motion, and this script leaves
// the rendered value alone until GSAP has a number to write.
async function animateStats() {
  await nextTick()
  const strip = statStrip.value
  if (!strip) return
  let countUp = null
  try {
    ;({ countUp } = await import('../lib/motion.js'))
  } catch {
    return
  }
  if (typeof countUp !== 'function') return
  for (const element of strip.querySelectorAll('[data-count-to]')) {
    countUp(element, Number(element.dataset.countTo) || 0)
  }
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

  // The list is already painted: the count-up is decoration, so it starts after
  // the render and never holds the list back.
  void animateStats()
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

function closeDetail() {
  detail.value = null
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
    <header class="masthead">
      <div class="masthead-copy">
        <p class="eyebrow">งานบุคคล · ใบลา</p>
        <h1 class="title">จัดการใบลา</h1>
        <p class="sub">
          ดูใบลาทั้งหมดของทุกแผนก · หน้านี้ไม่เปลี่ยนสถานะใบลา ใช้ได้เฉพาะการดูและคีย์ย้อนหลัง
        </p>
        <div class="masthead-actions">
          <RouterLink to="/hr/leave/backdated" class="primary-link">
            <span class="material-symbols-outlined btn-icon" aria-hidden="true">edit_calendar</span>
            คีย์ใบลาย้อนหลัง
          </RouterLink>
        </div>
      </div>

      <div class="masthead-stats">
        <p class="stat-caption">ภาพรวมในหน้านี้</p>
        <div ref="statStrip" class="stat-strip">
          <div
            v-for="stat in stats"
            :key="stat.status"
            class="summary-item"
            :class="`stat--${stat.status}`"
          >
            <span class="stat-count" :data-count-to="stat.count">{{ stat.count }}</span>
            <span class="stat-label">
              <span class="stat-dot" aria-hidden="true"></span>
              {{ stat.label }}
            </span>
          </div>
        </div>
      </div>
    </header>

    <!-- Decorative only: lite devices keep the gradient, never a canvas. -->
    <HrLeave3DScene class="hero-scene" />

    <div class="console">
      <aside class="rail">
        <section class="filter-deck" aria-labelledby="hr-leave-filter-title">
          <div class="deck-head">
            <h2 id="hr-leave-filter-title" class="deck-title">ตัวกรอง</h2>
            <p class="deck-hint">กรองตามแผนก สถานะ ประเภท และช่วงวันที่</p>
          </div>

          <div class="filter-grid">
            <label class="field field--wide">
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
          </div>

          <div class="filter-actions">
            <button type="button" class="primary-btn" @click="load(1)">
              <span class="material-symbols-outlined btn-icon" aria-hidden="true">search</span>
              ค้นหา
            </button>
            <button type="button" class="ghost-btn" @click="resetFilters">ล้างตัวกรอง</button>
          </div>
        </section>
      </aside>

      <section class="results" aria-labelledby="hr-leave-results-title">
        <header class="results-head">
          <div>
            <h2 id="hr-leave-results-title" class="results-title">รายการใบลา</h2>
            <p class="results-sub">{{ visibleSummary }}</p>
          </div>
          <span class="page-chip">หน้า {{ page }}</span>
        </header>

        <p v-if="loading" class="state-note">กำลังโหลด…</p>

        <v-alert v-else-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>

        <template v-else>
          <p v-if="scanCapped" class="state-note warning">
            การกรองตามแผนกอ่านได้สูงสุด 1,000 รายการแรก กรุณาเพิ่มช่วงวันที่เพื่อผลที่ครบถ้วน
          </p>

          <div class="list-head" aria-hidden="true">
            <span>รหัส / พนักงาน</span>
            <span>ประเภท</span>
            <span>ช่วงวันที่ / จำนวนวัน</span>
            <span>สถานะ</span>
            <span></span>
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
              <span class="cell cell--who">
                <span class="code">{{ item.requestCode || '—' }}</span>
                <span class="name">{{ item.requester?.fullName || '—' }}</span>
                <span class="meta">
                  {{ item.requester?.employeeCode || '' }}
                  <template v-if="item.departmentName"> · {{ item.departmentName }}</template>
                </span>
              </span>

              <span class="cell cell--type">
                <span class="type">{{ item.leaveTypeName || '—' }}</span>
                <span v-if="item.source === 'hr_backdated'" class="tag">คีย์ย้อนหลัง</span>
              </span>

              <span class="cell cell--dates">
                <span class="dates">{{ formatThaiDateRange(item.startDate, item.endDate) }}</span>
                <span class="days">{{ item.days ?? '—' }} วัน</span>
              </span>

              <span class="cell cell--status">
                <span class="badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
              </span>

              <span class="row-cue material-symbols-outlined" aria-hidden="true">chevron_right</span>
            </button>
          </TransitionGroup>

          <p v-if="results.length === 0" class="empty-state">ไม่พบใบลาตามเงื่อนไขที่เลือก</p>
        </template>

        <footer class="pager">
          <button type="button" class="ghost-btn" :disabled="page <= 1" @click="previousPage">
            ← ก่อนหน้า
          </button>
          <span class="pager-note">แสดงทีละ {{ PAGE_SIZE }} รายการ</span>
          <button type="button" class="ghost-btn" :disabled="!hasMore" @click="nextPage">
            ถัดไป →
          </button>
        </footer>
      </section>
    </div>

    <Transition name="leave-detail">
      <div v-if="detail" class="detail-layer">
        <div class="detail-scrim" @click="closeDetail"></div>

        <section
          class="detail"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hr-leave-detail-title"
        >
          <header class="detail-head">
            <div class="detail-heading">
              <p class="eyebrow">รายละเอียดใบลา</p>
              <h2 id="hr-leave-detail-title" class="detail-title">
                {{ detail.requestCode || 'ใบลา' }}
              </h2>
              <p v-if="detail.requester?.fullName" class="detail-sub">
                {{ detail.requester.fullName }}
                <template v-if="detail.requester?.employeeCode">
                  · {{ detail.requester.employeeCode }}
                </template>
              </p>
              <div v-if="detail.status" class="detail-tags">
                <span class="badge" :class="statusClass(detail.status)">
                  {{ statusLabel(detail.status) }}
                </span>
              </div>
            </div>
            <button type="button" class="icon-btn" aria-label="ปิดรายละเอียด" @click="closeDetail">
              <span class="material-symbols-outlined btn-icon" aria-hidden="true">close</span>
            </button>
          </header>

          <p v-if="detail.error" class="state-note error">{{ detail.error }}</p>
          <p v-else-if="detailLoading && !detail.requestCode" class="state-note">กำลังโหลด…</p>
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

            <p v-if="resendError" class="state-note error">{{ resendError }}</p>
            <p v-if="resendMessage" class="state-note">{{ resendMessage }}</p>
          </template>
        </section>
      </div>
    </Transition>
  </main>
</template>

<!-- Glass tiers. Unscoped so the tokens can live on :root, next to the tier flag
     that AppBackground3D.vue publishes (data-bg-tier). Tint 0.86 on the panels and
     0.90 on the detail dialog: low enough that the field reads through the glass,
     high enough that slate-600 ink keeps 4.5:1 over the darkest scene pixel
     (measured values are in tests/hr-leave-pilot.test.js). Blur follows the tier:
     16px at high, 8px at medium and low, none at static. -->
<style>
:root {
  --leave-glass: rgba(255, 255, 255, 0.86);
  --leave-glass-strong: rgba(255, 255, 255, 0.9);
  --leave-glass-blur: 16px;
  --leave-glass-filter: blur(var(--leave-glass-blur)) saturate(1.12);
  --leave-edge: rgba(255, 255, 255, 0.62);
  --leave-hairline: rgba(30, 27, 75, 0.1);
  --leave-line: rgba(30, 27, 75, 0.58);
  --leave-shadow: 0 18px 40px rgba(23, 32, 84, 0.12);
}

:root[data-bg-tier='medium'],
:root[data-bg-tier='low'] {
  --leave-glass-blur: 8px;
}

/* The static tier has no scene to frost, so it keeps the same contrast floor
   with a slightly stronger tint and no backdrop filter at all. */
:root[data-bg-tier='static'] {
  --leave-glass-blur: 0px;
  --leave-glass-filter: none;
  --leave-glass: rgba(255, 255, 255, 0.9);
  --leave-glass-strong: rgba(255, 255, 255, 0.9);
}
</style>

<style scoped>
.content {
  /* Approved palette, declared once on the page root. Contrast (WCAG AA, normal
     text) is asserted in tests/hr-leave-3d.test.js and, against the frosted
     backdrop, in tests/hr-leave-pilot.test.js:
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
  --slate-700: #334155;
  --tap-target: 44px;
  --radius-panel: 20px;
  --radius-card: 14px;
  --radius-control: 12px;

  position: relative;
  padding: 6px 0 56px;
  color: var(--indigo-900);
  /* No page background: the 3D field is the backdrop, and every block of text
     below sits on its own frosted panel. */
  background: transparent;
}

/* One glass recipe for the four panels this page owns. The tint and blur come
   from the tier tokens above, so the frost thins out with the scene. */
.masthead,
.filter-deck,
.results,
.detail {
  background-color: var(--leave-glass);
  background-image: linear-gradient(
    152deg,
    rgba(255, 255, 255, 0.16) 0%,
    rgba(255, 255, 255, 0) 58%
  );
  border: 1px solid var(--leave-edge);
  border-radius: var(--radius-panel);
  -webkit-backdrop-filter: var(--leave-glass-filter);
  backdrop-filter: var(--leave-glass-filter);
  box-shadow: var(--leave-shadow);
}

/* ---- Masthead: title on the left, the page's own numbers on the right ---- */
.masthead {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 22px 28px;
  align-items: end;
  padding: 22px 24px;
  margin-bottom: 16px;
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--slate-600);
}

.title {
  margin: 0;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--indigo-900);
}

.sub {
  margin: 8px 0 0;
  max-width: 48ch;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--slate-600);
}

.masthead-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.masthead-stats {
  min-width: 0;
}

.stat-caption {
  margin: 0 0 8px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--slate-600);
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--leave-hairline);
  border-radius: var(--radius-card);
  background: rgba(255, 255, 255, 0.46);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition:
    transform 220ms cubic-bezier(0.22, 0.75, 0.35, 1),
    box-shadow 220ms ease,
    background-color 220ms ease;
}

.stat-count {
  font: 700 24px/1 'Prompt', sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--indigo-900);
}

.stat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--slate-600);
}

.stat-dot {
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}

.stat--pending .stat-dot {
  background: #d97706;
}

.stat--approved .stat-dot {
  background: #16a34a;
}

.stat--rejected .stat-dot {
  background: #dc2626;
}

/* ---- The decorative band keeps its own place under the masthead ---- */
.hero-scene {
  display: block;
  margin-bottom: 16px;
}

/* ---- Console: filter rail beside the list from 1080px up ---- */
.console {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.rail {
  min-width: 0;
}

.filter-deck {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.deck-head {
  display: grid;
  gap: 4px;
}

.deck-title {
  margin: 0;
  font: 700 15px/1.3 'Prompt', sans-serif;
  color: var(--indigo-900);
}

.deck-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--slate-600);
}

.filter-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--indigo-900);
}

.input {
  width: 100%;
  min-height: var(--tap-target);
  padding: 8px 12px;
  border: 1px solid var(--leave-line);
  border-radius: var(--radius-control);
  background: rgba(255, 255, 255, 0.74);
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
  background: rgba(255, 255, 255, 0.74);
}

.field :deep(.v-field__input) {
  min-height: var(--tap-target);
  padding-top: 0;
  padding-bottom: 0;
  color: var(--indigo-900);
  font-size: 14px;
}

/* 0.58 of indigo-900 stays above 3:1 against the input fill, which is what a
   control boundary needs (WCAG 1.4.11). Vuetify paints the outlined border in
   currentColor at 38% opacity, so the opacity is raised to 1 here. */
.field :deep(.v-field__outline) {
  color: var(--leave-line);
  --v-field-border-opacity: 1;
}

.field :deep(.v-field--focused .v-field__outline) {
  color: var(--indigo-600);
}

.filter-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.primary-btn,
.ghost-btn,
.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--tap-target);
  padding: 0 18px;
  border-radius: var(--radius-control);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 180ms cubic-bezier(0.22, 0.75, 0.35, 1),
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 180ms ease,
    color 160ms ease;
}

.primary-btn,
.primary-link {
  background: var(--indigo-600);
  border: 1px solid var(--indigo-600);
  color: #ffffff;
  box-shadow: 0 10px 22px rgba(79, 70, 229, 0.24);
}

.ghost-btn {
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid var(--leave-line);
  color: var(--indigo-900);
}

.icon-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  min-height: var(--tap-target);
  border: 1px solid var(--leave-line);
  border-radius: var(--radius-control);
  background: rgba(255, 255, 255, 0.6);
  color: var(--indigo-900);
  cursor: pointer;
}

.btn-icon {
  font-size: 18px;
  line-height: 1;
}

.primary-btn:focus-visible,
.ghost-btn:focus-visible,
.primary-link:focus-visible,
.icon-btn:focus-visible {
  outline: 2px solid var(--violet-500);
  outline-offset: 2px;
}

.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

/* Hover is a bonus for precise pointers only; every action is a real button, so
   a touch device loses nothing. */
@media (hover: hover) and (pointer: fine) {
  .primary-btn:hover,
  .primary-link:hover {
    background: var(--indigo-700);
    border-color: var(--indigo-700);
  }

  .ghost-btn:hover,
  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.92);
    border-color: rgba(30, 27, 75, 0.72);
  }

  .summary-item:hover {
    background: rgba(255, 255, 255, 0.76);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 10px 22px rgba(23, 32, 84, 0.1);
  }

  .list-row:hover {
    background: rgba(79, 70, 229, 0.07);
  }

  /* A small follow of the pointer, only where lite mode left the tilt on. */
  .list-row.row-tilt:hover {
    z-index: 2;
    transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))
      translate3d(0, -2px, 6px);
    box-shadow:
      0 2px 4px rgba(30, 27, 75, 0.08),
      0 12px 24px rgba(30, 27, 75, 0.1);
  }

  .note a:hover {
    text-decoration: underline;
  }
}

/* ---- Results panel ---- */
.results {
  --row-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.2fr) 108px 20px;
  display: grid;
  align-content: start;
  min-width: 0;
  padding: 6px 18px 12px;
}

.results-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 2px;
  border-bottom: 1px solid var(--leave-hairline);
}

.results-title {
  margin: 0;
  font: 700 17px/1.3 'Prompt', sans-serif;
  color: var(--indigo-900);
}

.results-sub {
  margin: 3px 0 0;
  font-size: 12.5px;
  color: var(--slate-600);
}

.page-chip {
  flex: 0 0 auto;
  padding: 5px 12px;
  border: 1px solid var(--leave-hairline);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  font-weight: 600;
  color: var(--indigo-700);
}

.state-note {
  margin: 12px 2px 2px;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  background: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  line-height: 1.6;
  color: var(--slate-600);
}

.state-note.warning {
  color: #92400e;
}

.state-note.error {
  color: #b91c1c;
}

.results :deep(.v-alert) {
  margin: 12px 0;
  border-radius: var(--radius-control);
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: var(--row-columns);
  gap: 12px;
  align-items: center;
}

.list-head {
  padding: 10px 12px 8px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--slate-600);
}

.list-body {
  display: grid;
  gap: 2px;
  padding: 6px 0 4px;
  perspective: 1000px;
}

.list-row {
  width: 100%;
  min-height: 58px;
  padding: 12px;
  border: 0;
  border-radius: var(--radius-card);
  background: none;
  text-align: left;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--indigo-900);
  cursor: pointer;
  transform: rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  transform-style: preserve-3d;
  /* A hairline between rows keeps a five-column table scannable; the last row
     drops it, and the phone cards below replace it with their own surface. */
  box-shadow: inset 0 -1px 0 var(--leave-hairline);
  transition:
    transform 220ms cubic-bezier(0.22, 0.75, 0.35, 1),
    box-shadow 220ms ease,
    background-color 160ms ease;
}

.list-row:focus-visible {
  background: rgba(79, 70, 229, 0.09);
  outline: 2px solid var(--violet-500);
  outline-offset: -2px;
}

.list-row:active {
  transform: scale(0.995);
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.cell--status {
  align-items: flex-start;
}

.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  letter-spacing: 0.01em;
  color: var(--slate-600);
}

.name {
  font-size: 14px;
  font-weight: 600;
  color: var(--indigo-900);
}

.meta {
  font-size: 11.5px;
  color: var(--slate-600);
}

.type {
  font-size: 13.5px;
  font-weight: 600;
}

.cell--dates .dates {
  font-size: 13px;
}

.cell--dates .days {
  font-size: 11.5px;
  color: var(--slate-600);
}

.tag {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--indigo-50);
  color: var(--indigo-700);
  font-size: 11px;
  font-weight: 600;
}

.row-cue {
  justify-self: center;
  font-size: 18px;
  color: var(--slate-600);
  opacity: 0.7;
}

.badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  /* A status that changes after a refresh fades between its two paints. */
  transition:
    background-color 200ms ease,
    color 200ms ease;
}

.badge-pending { background: #fff2df; color: #8a4b06; }
.badge-approved { background: #e6f4ec; color: #1c6b3f; }
.badge-rejected { background: #fdecec; color: #a01b1b; }
.badge-cancelled { background: #f1f1f1; color: #6a6a6a; }

/* Entrance: the cards rise in with a short stagger. Transform and opacity only,
   so the list never changes size. */
.leave-card-enter-active {
  transition:
    opacity 240ms ease,
    transform 260ms cubic-bezier(0.22, 0.75, 0.35, 1);
  transition-delay: calc(var(--row-index, 0) * 24ms);
}

.leave-card-enter-from {
  opacity: 0;
  transform: translate3d(0, 10px, 0) scale(0.992);
}

.leave-card-leave-active {
  transition: opacity 140ms ease;
}

.leave-card-leave-to {
  opacity: 0;
}

.list-row:last-of-type {
  box-shadow: none;
}

.empty-state {
  margin: 14px 2px 6px;
  padding: 30px 12px;
  border-radius: var(--radius-card);
  background: rgba(255, 255, 255, 0.42);
  text-align: center;
  font-size: 13.5px;
  color: var(--slate-600);
}

.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
  padding: 12px 2px 2px;
  border-top: 1px solid var(--leave-hairline);
}

.pager-note {
  font-size: 12px;
  color: var(--slate-600);
}

/* ---- Detail dialog ---- */
.detail-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.detail-scrim {
  position: absolute;
  inset: 0;
  background: rgba(23, 32, 84, 0.34);
}

.detail {
  position: relative;
  width: min(760px, 100%);
  max-height: min(88vh, 820px);
  padding: 22px 24px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background-color: var(--leave-glass-strong);
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--leave-hairline);
}

.detail-heading {
  min-width: 0;
}

.detail-title {
  margin: 0;
  font: 700 21px/1.3 'Prompt', sans-serif;
  letter-spacing: -0.01em;
  color: var(--indigo-900);
  overflow-wrap: anywhere;
}

.detail-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--slate-600);
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 10px;
  margin: 0;
  padding: 0;
}

.fact {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: var(--radius-control);
  background: rgba(255, 255, 255, 0.52);
}

.fact dt {
  font-size: 11.5px;
  color: var(--slate-600);
}

.fact dd {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--indigo-900);
  overflow-wrap: anywhere;
}

.note {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-left: 3px solid rgba(79, 70, 229, 0.4);
  border-radius: 0 var(--radius-control) var(--radius-control) 0;
  background: rgba(255, 255, 255, 0.42);
  font-size: 13px;
  line-height: 1.6;
  color: var(--slate-600);
  overflow-wrap: anywhere;
}

.note-sub {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--slate-600);
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
  padding-top: 14px;
  border-top: 1px solid var(--leave-hairline);
}

/* The layer fades; the panel is what moves. */
.leave-detail-enter-active {
  transition: opacity 200ms ease;
}

.leave-detail-enter-active .detail {
  transition:
    opacity 220ms ease,
    transform 260ms cubic-bezier(0.22, 0.75, 0.35, 1);
}

.leave-detail-enter-from {
  opacity: 0;
}

.leave-detail-enter-from .detail {
  opacity: 0;
  transform: translate3d(0, 12px, 0) scale(0.99);
}

.leave-detail-leave-active {
  transition: opacity 160ms ease;
}

.leave-detail-leave-active .detail {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.leave-detail-leave-to {
  opacity: 0;
}

.leave-detail-leave-to .detail {
  transform: scale(0.995);
}

/* Tablets: the console stacks, so the filter deck becomes a wide rail and the
   list keeps its full width. */
@media (max-width: 1079px) {
  .filter-grid {
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
    gap: 12px 14px;
  }
}

@media (max-width: 860px) {
  .masthead {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
  }

  .stat-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (min-width: 1080px) {
  .console {
    grid-template-columns: 304px minmax(0, 1fr);
    align-items: start;
  }
}

/* Phones: the rows ARE the cards, so the wrapper steps back. */
@media (max-width: 760px) {
  .list-head {
    display: none;
  }

  .results {
    padding: 4px 12px 10px;
    border-radius: 18px;
  }

  .results-head {
    padding: 12px 2px 10px;
  }

  .list-body {
    gap: 8px;
    padding: 8px 0;
  }

  .list-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'who status'
      'type type'
      'dates dates';
    gap: 8px 10px;
    min-height: var(--tap-target);
    padding: 14px;
    background: rgba(255, 255, 255, 0.42);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  .cell--who {
    grid-area: who;
  }

  .cell--type {
    grid-area: type;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .cell--dates {
    grid-area: dates;
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .cell--status {
    grid-area: status;
    align-self: start;
  }

  .row-cue {
    display: none;
  }

  .badge {
    font-size: 12px;
    padding: 5px 11px;
  }

  .pager {
    flex-wrap: wrap;
  }
}

/* Below 600px the detail dialog is a full-screen sheet: no chance of a sideways
   overflow, and the page underneath cannot be tapped by accident. */
@media (max-width: 599px) {
  .masthead {
    padding: 18px 16px;
  }

  .title {
    font-size: 26px;
  }

  .stat-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .field--wide {
    grid-column: 1 / -1;
  }

  .filter-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .detail-layer {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 70;
    padding: 0;
  }

  .detail {
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
    padding: calc(10px + env(safe-area-inset-top)) 16px
      calc(28px + env(safe-area-inset-bottom));
    overflow-y: auto;
  }

  .detail-head {
    position: sticky;
    top: 0;
    z-index: 1;
    margin-bottom: 14px;
    padding: 10px 0 12px;
    background: var(--leave-glass-strong);
    -webkit-backdrop-filter: var(--leave-glass-filter);
    backdrop-filter: var(--leave-glass-filter);
    border-bottom: 1px solid var(--leave-hairline);
  }

  .detail-title {
    font-size: 18px;
  }

  .facts {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .detail-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  /* A sheet slides up rather than opening on a perspective, so it cannot paint
     outside the viewport. */
  .leave-detail-enter-from .detail {
    opacity: 1;
    transform: translate3d(0, 16px, 0);
  }

  .leave-detail-leave-to .detail {
    transform: none;
  }
}

/* Reduced motion: no tilt, no rise, no scale, no slide. The list, the counts and
   the dialog still render, just without movement. */
@media (prefers-reduced-motion: reduce) {
  .list-row,
  .list-row:active,
  .list-row.row-tilt:hover,
  .summary-item,
  .leave-card-enter-active,
  .leave-card-leave-active,
  .leave-detail-enter-active,
  .leave-detail-enter-active .detail,
  .leave-detail-leave-active,
  .leave-detail-leave-active .detail,
  .primary-btn,
  .ghost-btn,
  .primary-link,
  .icon-btn {
    transition: none;
    transform: none;
    animation: none;
  }

  .leave-card-enter-from,
  .leave-card-leave-to,
  .leave-detail-enter-from {
    opacity: 1;
    transform: none;
  }

  .leave-detail-enter-from .detail,
  .leave-detail-leave-to .detail {
    opacity: 1;
    transform: none;
  }
}
</style>
