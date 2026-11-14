<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { focusPanel, restoreFocus, trapTabKey } from '../lib/dialog-focus.js'

const MIN_LENGTH = 2
const SEARCH_ERROR = 'ไม่สามารถค้นหาได้ กรุณาลองใหม่'
const TOO_SHORT = 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา'
const EMPTY = 'ไม่พบพนักงานที่ตรงกับคำค้น'
const DETAIL_ERROR = 'ไม่พบข้อมูลพนักงาน หรือคุณไม่มีสิทธิ์เข้าถึง'
const REVEAL_ERROR = 'ไม่สามารถแสดงเลขบัตรประชาชนได้'
// The split view starts where the rest of the HR pages switch to a rail; below
// it the detail is a sheet over the list.
const WIDE_QUERY = '(min-width: 1080px)'

const router = useRouter()
const route = useRoute()

const query = ref('')
const results = ref([])
const loading = ref(false)
const errorMessage = ref('')
const hint = ref('')
const searched = ref(false)

const searchInput = ref(null)
const detailPanel = ref(null)
const detailClose = ref(null)

const detail = ref(null)
const detailLoading = ref(false)
const detailError = ref('')
const revealError = ref('')
const revealing = ref(false)
const revealedId = ref('')

// The route owns the selection: /hr/employees/:id renders this same page, so the
// list never unmounts and its search text survives the detail.
const selectedId = computed(() => {
  const id = route?.params?.id
  if (typeof id === 'string') return id
  if (Array.isArray(id)) return String(id[0] ?? '')
  return ''
})

const isWide = ref(
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_QUERY).matches
    : true
)

let timer = null
let wideQuery = null
let detailSeq = 0
let firstSelection = true
let detailOpener = null

async function search() {
  const text = query.value.replace(/\s+/g, ' ').trim()
  errorMessage.value = ''

  if (text.length < MIN_LENGTH) {
    results.value = []
    searched.value = false
    hint.value = text.length === 0 ? '' : TOO_SHORT
    return
  }

  hint.value = ''
  loading.value = true
  try {
    const response = await fetch(`/api/hr/employees?q=${encodeURIComponent(text)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      results.value = []
      searched.value = false
      errorMessage.value = typeof data.message === 'string' ? data.message : SEARCH_ERROR
      return
    }
    results.value = Array.isArray(data.results) ? data.results : []
    searched.value = true
  } catch {
    results.value = []
    searched.value = false
    errorMessage.value = SEARCH_ERROR
  } finally {
    loading.value = false
  }
}

watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 300)
})

function openEmployee(id, event) {
  if (!id) return
  const opener = event?.currentTarget
  detailOpener = opener && typeof opener.focus === 'function' ? opener : null
  router.push(`/hr/employees/${encodeURIComponent(id)}`)
}

// full_name of older rows already starts with the prefix; do not repeat it.
function displayName(item) {
  const name = item.fullName || '—'
  const prefix = item.namePrefix
  if (!prefix || name.startsWith(prefix)) return name
  return `${prefix} ${name}`
}

// The detail is the old page's data, fetched the same way: one GET, the same
// credentials, and a last-write-wins guard so a quick A → B switch cannot paint
// A's answer over B.
async function loadDetail(id) {
  const token = (detailSeq += 1)
  detailLoading.value = true
  detailError.value = ''
  revealError.value = ''
  revealedId.value = ''
  try {
    const response = await fetch(`/api/hr/employees/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (token !== detailSeq) return
    if (!response.ok || data.ok !== true) {
      detail.value = null
      detailError.value = typeof data.message === 'string' ? data.message : DETAIL_ERROR
      return
    }
    detail.value = data.employee ?? null
  } catch {
    if (token !== detailSeq) return
    detail.value = null
    detailError.value = DETAIL_ERROR
  } finally {
    if (token === detailSeq) detailLoading.value = false
  }
}

// Audit-only action, kept exactly as the detail page had it: a POST that the API
// counts as one access for the day. No confirmation step existed to keep.
async function reveal() {
  const id = selectedId.value
  if (!id || revealing.value || revealedId.value) return
  revealing.value = true
  revealError.value = ''
  try {
    const response = await fetch(
      `/api/hr/employees/${encodeURIComponent(id)}/reveal-national-id`,
      { method: 'POST', credentials: 'same-origin' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      revealError.value = typeof data.message === 'string' ? data.message : REVEAL_ERROR
      return
    }
    revealedId.value = String(data.nationalId ?? '')
  } catch {
    revealError.value = REVEAL_ERROR
  } finally {
    revealing.value = false
  }
}

function closeDetail() {
  if (!selectedId.value) return
  // Back to the list when the list is the previous entry (a row opened it);
  // a deep link has no list entry to go back to, so it goes forward instead.
  const previous = router?.options?.history?.state?.back
  if (previous === '/hr/employees') {
    router.back()
    return
  }
  router.push('/hr/employees')
}

watch(selectedId, async (id, previous) => {
  if (!id) {
    detailSeq += 1
    detail.value = null
    detailLoading.value = false
    detailError.value = ''
    revealError.value = ''
    revealedId.value = ''
    const opener = detailOpener
    detailOpener = null
    firstSelection = false
    if (previous) {
      await nextTick()
      if (!restoreFocus(opener)) searchInput.value?.focus?.()
    }
    return
  }

  loadDetail(id)

  if (!previous) {
    const deepLink = firstSelection
    firstSelection = false
    if (deepLink) return
    await nextTick()
    focusPanel(detailPanel.value, detailClose.value)
  }
}, { immediate: true })

// Escape closes the sheet; Tab and Shift+Tab stay inside it. The desktop panel is
// not modal (the list beside it stays usable), so neither applies there.
function onKeydown(event) {
  if (!selectedId.value || isWide.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDetail()
    return
  }
  if (event.key === 'Tab') trapTabKey(event, detailPanel.value)
}

function onWideChange(event) {
  isWide.value = event.matches
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  wideQuery = window.matchMedia(WIDE_QUERY)
  isWide.value = wideQuery.matches
  wideQuery.addEventListener?.('change', onWideChange)
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  wideQuery?.removeEventListener?.('change', onWideChange)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <main class="page" :class="{ 'is-split': selectedId && isWide }">
    <!-- The finder: the page's one question, and the way in from a spreadsheet. -->
    <section class="finder" aria-labelledby="employees-title">
      <div class="finder-copy">
        <p class="eyebrow">ฝ่ายบุคคล</p>
        <h1 id="employees-title" class="title">รายชื่อพนักงาน</h1>
        <p class="sub">
          ค้นด้วยชื่อหรือรหัสพนักงาน อย่างน้อย 2 ตัวอักษร · แสดงสูงสุด 50 รายการ ·
          ไม่แสดงเลขบัตรประชาชนในหน้านี้
        </p>
      </div>

      <label class="search">
        <span class="search-icon" aria-hidden="true">
          <span class="material-symbols-outlined">search</span>
        </span>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="พิมพ์ชื่อ หรือรหัสพนักงาน"
          autocomplete="off"
          aria-label="ค้นหาพนักงาน"
        />
      </label>

      <p v-if="hint" class="search-hint">{{ hint }}</p>
      <p v-if="loading" class="search-hint">กำลังค้นหา…</p>

      <RouterLink to="/hr/employees/import" class="import-link">
        <span>นำเข้าข้อมูลพนักงาน</span>
        <span class="import-arrow" aria-hidden="true">→</span>
      </RouterLink>
    </section>

    <!-- The results: one row per person, the whole row the button. -->
    <section class="results" aria-labelledby="results-title">
      <div class="panel-head">
        <h2 id="results-title" class="panel-title">ผลการค้นหา</h2>
        <span class="panel-meta">สูงสุด 50 รายการ</span>
      </div>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
        {{ errorMessage }}
      </v-alert>

      <div v-if="results.length" class="table">
        <div class="list-head" aria-hidden="true">
          <span>รหัสพนักงาน</span>
          <span>ชื่อ-สกุล</span>
          <span>แผนก</span>
          <span>สถานะ</span>
        </div>

        <button
          v-for="(item, index) in results"
          :key="item.id"
          type="button"
          class="list-row"
          :class="{ 'is-selected': selectedId === String(item.id) }"
          :aria-current="selectedId === String(item.id) ? 'true' : undefined"
          :style="{ '--stagger': index }"
          @click="openEmployee(item.id, $event)"
        >
          <span class="cell code" data-label="รหัส">{{ item.employeeCode || '—' }}</span>
          <span class="cell name" data-label="ชื่อ-สกุล">{{ displayName(item) }}</span>
          <span class="cell dept" data-label="แผนก">{{ item.departmentName || '—' }}</span>
          <span class="cell status" data-label="สถานะ">
            <span class="badge" :class="item.isActive ? 'badge-on' : 'badge-off'">
              {{ item.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน' }}
            </span>
          </span>
        </button>
      </div>

      <p v-else-if="searched && !loading" class="empty-line">{{ EMPTY }}</p>
    </section>

    <!-- The selected employee: beside the list from 1080px, a sheet below it. -->
    <!-- Fixed durations: the panel must be gone 180ms after a close, not wait
         on a nested transitionend. -->
    <Transition name="detail-slide" :duration="{ enter: 340, leave: 180 }">
      <div v-if="selectedId" class="detail-layer" :class="{ 'is-sheet': !isWide }">
        <div v-if="!isWide" class="detail-scrim" @click="closeDetail"></div>

        <aside
          ref="detailPanel"
          class="detail"
          :role="isWide ? 'region' : 'dialog'"
          :aria-modal="isWide ? undefined : 'true'"
          aria-labelledby="detail-title"
          tabindex="-1"
        >
          <header class="detail-head">
            <div class="detail-heading">
              <p class="eyebrow">รายละเอียดพนักงาน</p>
              <h2 id="detail-title" class="detail-title">
                {{ detail?.employeeCode || (detailLoading ? 'กำลังโหลด…' : 'พนักงาน') }}
              </h2>
              <p class="detail-sub">
                {{ displayName(detail ?? {}) }}
                <template v-if="detail?.departmentName"> · {{ detail.departmentName }}</template>
              </p>
            </div>
            <button
              ref="detailClose"
              type="button"
              class="detail-close"
              aria-label="ปิดรายละเอียด"
              @click="closeDetail"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </header>

          <p v-if="detailError" class="detail-note error">{{ detailError }}</p>
          <p v-else-if="detailLoading && !detail" class="detail-note">กำลังโหลดข้อมูลพนักงาน…</p>

          <template v-else-if="detail">
            <dl class="facts">
              <div class="fact">
                <dt>รหัสพนักงาน</dt>
                <dd>{{ detail.employeeCode || '—' }}</dd>
              </div>
              <div class="fact">
                <dt>ชื่อ-สกุล</dt>
                <dd>{{ detail.fullName || '—' }}</dd>
              </div>
              <div class="fact">
                <dt>คำนำหน้า</dt>
                <dd>{{ detail.namePrefix || '—' }}</dd>
              </div>
              <div class="fact">
                <dt>แผนก</dt>
                <dd>{{ detail.departmentName || '—' }}</dd>
              </div>
              <div class="fact">
                <dt>ตำแหน่ง</dt>
                <dd>{{ detail.positionName || '—' }}</dd>
              </div>
              <div class="fact">
                <dt>สถานะ</dt>
                <dd>{{ detail.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน' }}</dd>
              </div>
              <div class="fact">
                <dt>เลขบัตรประชาชน</dt>
                <dd>
                  <span class="mono">{{ revealedId || detail.nationalIdMasked || 'ไม่พร้อมแสดง' }}</span>
                  <span v-if="revealedId" class="detail-sub">
                    การดูเลขเต็มถูกนับเป็นการเข้าถึงหนึ่งครั้งในวันนี้
                  </span>
                  <span v-else-if="!detail.nationalIdAvailable" class="detail-sub">
                    รายการนี้ยังไม่มีเลขบัตรที่เข้ารหัสด้วยกุญแจของระบบปัจจุบัน
                  </span>
                </dd>
              </div>
            </dl>

            <p v-if="revealError" class="detail-note error">{{ revealError }}</p>

            <div v-if="detail.nationalIdAvailable && !revealedId" class="detail-actions">
              <button
                type="button"
                class="reveal-btn"
                :disabled="revealing"
                @click="reveal"
              >
                {{ revealing ? 'กำลังแสดง…' : 'ดูเลขเต็ม' }}
              </button>
            </div>
          </template>
        </aside>
      </div>
    </Transition>
  </main>
</template>

<!-- Glass tiers. Unscoped so the tint and blur can live on :root next to the tier
     flag AppBackground3D.vue publishes (data-bg-tier). Tint 0.88: low enough that
     the field reads through the glass, high enough that slate-600 keeps 4.5:1 over
     the darkest scene pixel (measured in tests/hr-employees-ux.test.js). Blur
     follows the tier: 18px at high, 8px at medium and low, none at static. -->
<style>
:root {
  --dir-glass: rgba(255, 255, 255, 0.88);
  --dir-blur: 18px;
  --dir-filter: blur(var(--dir-blur)) saturate(1.1);
  --dir-edge: rgba(255, 255, 255, 0.66);
  --dir-shadow: 0 16px 38px rgba(23, 32, 84, 0.13);
}

:root[data-bg-tier='medium'],
:root[data-bg-tier='low'] {
  --dir-blur: 8px;
}

/* No scene to frost on the static tier: the same contrast floor, a slightly
   stronger tint and no backdrop filter at all. */
:root[data-bg-tier='static'] {
  --dir-blur: 0px;
  --dir-filter: none;
  --dir-glass: rgba(255, 255, 255, 0.9);
}
</style>

<style scoped>
.page {
  /* The page palette, declared once. Contrast (WCAG AA, normal text) is asserted
     in tests/hr-employees-ux.test.js, against the frosted backdrop over the
     darkest scene pixel and against every opaque fill:
       indigo-900 on glass 13.4, slate-700 8.4, slate-600 6.2
       indigo-700 on glass 6.4, white on indigo-600 6.29
       status pairs on their own fills: 5.74 / 5.65 */
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-deep: #4338ca;
  --focus: #8b5cf6;
  --line: rgba(30, 27, 75, 0.12);
  --field-line: rgba(30, 27, 75, 0.52);
  --tap: 44px;
  --radius-panel: 22px;

  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 0 64px;
  color: var(--ink);
  /* No page background: the field is the backdrop and every block of text sits
     on the frosted panels below. */
  background: transparent;
}

/* Wide screens move the finder into a 300px rail beside the results, so the
   list keeps the width it needs. Same 1080px switch as the HR leave console. */
@media (min-width: 1080px) {
  .page {
    grid-template-columns: 300px minmax(0, 1fr);
    align-items: start;
    column-gap: 24px;
    padding-top: 32px;
  }
}

.finder,
.results,
.detail {
  position: relative;
  background-color: var(--dir-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--dir-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--dir-shadow);
  -webkit-backdrop-filter: var(--dir-filter);
  backdrop-filter: var(--dir-filter);
}

.finder {
  display: grid;
  gap: 16px;
  overflow: hidden;
  padding: 24px;
}

/* Decoration only: a soft violet glow in the empty corner of the finder. */
.finder::after {
  content: '';
  position: absolute;
  right: -80px;
  top: -90px;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(139, 92, 246, 0.2) 0%,
    rgba(79, 70, 229, 0.09) 45%,
    rgba(255, 255, 255, 0) 70%
  );
  pointer-events: none;
}

.finder-copy {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 8px;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.08em;
  color: var(--ink-muted);
}

.title {
  margin: 0 0 8px;
  font-family: 'Prompt', sans-serif;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.sub {
  margin: 0;
  max-width: 56ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink-body);
}

/* The field is the page's main control: 44px tall, a boundary that shows on
   glass, and a violet ring when it takes focus. */
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 0 12px;
  border: 1px solid var(--field-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.75);
  color: var(--ink-muted);
}

.search:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.search-icon {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--ink-muted);
}

.search input {
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 16px;
  color: var(--ink);
}

.search input::placeholder {
  color: var(--ink-muted);
  opacity: 1;
}

.search-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.import-link {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: var(--tap);
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--accent-deep);
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.import-arrow {
  display: inline-block;
  transition: transform 0.18s ease;
}

.results {
  padding: 20px 8px 8px;
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 12px;
  padding: 0 14px 12px;
}

.panel-title {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.panel-meta {
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
  white-space: nowrap;
}

.table {
  display: grid;
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1.6fr) minmax(0, 1fr) 130px;
  gap: 12px;
  align-items: center;
  text-align: left;
}

.list-head {
  padding: 6px 8px 10px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
}

/* The whole row is the button, so the tap target is the row, not a cell. */
.list-row {
  width: 100%;
  min-height: var(--tap);
  padding: 12px 8px;
  border: none;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: none;
  color: var(--ink);
  font-family: inherit;
  font-size: 15px;
  line-height: 1.5;
  cursor: pointer;
  transition: background-color 0.18s ease;
}

.list-row:last-child {
  border-bottom: none;
}

/* The open employee keeps a visible mark next to the panel it feeds. */
.list-row.is-selected {
  background-color: rgba(79, 70, 229, 0.1);
  box-shadow: inset 3px 0 0 var(--accent);
}

.list-row:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.cell {
  min-width: 0;
  overflow-wrap: anywhere;
}

.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
}

.name {
  font-weight: 600;
}

.dept {
  color: var(--ink-body);
}

.badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}

.badge-on {
  background: #e6f4ec;
  color: #1c6b3f;
}

.badge-off {
  background: #f1f1f1;
  /* 5.65:1 on the fill; #6a6a6a was 4.79:1. */
  color: #5f5f5f;
}

.empty-line {
  margin: 0;
  padding: 10px 14px 16px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-muted);
}

/* ---- The selected employee ---- */

.detail-layer {
  display: grid;
  min-width: 0;
}

.detail {
  display: grid;
  align-content: start;
  gap: 14px;
  min-height: 0;
  max-height: calc(100vh - 48px);
  padding: 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.detail-heading {
  min-width: 0;
}

.detail-title {
  margin: 0 0 4px;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.detail-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.detail-close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  border: 1px solid var(--field-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--ink);
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.detail-close:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.detail-note {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.detail-note.error {
  color: #8a1c1c;
}

.facts {
  display: grid;
  gap: 0;
  margin: 0;
}

.fact {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.fact:last-child {
  border-bottom: none;
}

.fact dt {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.fact dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reveal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  padding: 0 16px;
  border: 1px solid var(--field-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--accent-deep);
  font-family: 'Prompt', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.reveal-btn:disabled {
  cursor: progress;
  opacity: 0.7;
}

.reveal-btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* Hover and press are for a real mouse only: a finger gets no hover state. */
@media (hover: hover) and (pointer: fine) {
  .list-row:hover {
    background-color: rgba(79, 70, 229, 0.055);
  }

  .list-row:active {
    transform: scale(0.995);
  }

  .import-link:hover {
    background-color: rgba(79, 70, 229, 0.07);
    border-color: rgba(79, 70, 229, 0.35);
  }

  .import-link:hover .import-arrow {
    transform: translateX(3px);
  }

  .import-link:active {
    transform: scale(0.99);
  }

  .detail-close:hover,
  .reveal-btn:hover:not(:disabled) {
    background-color: rgba(79, 70, 229, 0.07);
    border-color: rgba(79, 70, 229, 0.35);
  }
}

/* Desktop split: the list keeps the left column and the detail takes a fixed
   right column. The finder becomes the list column's header so the rows keep
   their four columns. */
@media (min-width: 1080px) {
  .page.is-split {
    grid-template-columns: minmax(0, 1fr) 380px;
  }

  .page.is-split .finder {
    grid-column: 1;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px 16px;
    padding: 16px 18px;
  }

  .page.is-split .finder-copy {
    grid-column: 1 / -1;
  }

  .page.is-split .eyebrow {
    display: none;
  }

  .page.is-split .title {
    margin: 0 0 4px;
    font-size: 24px;
  }

  .page.is-split .sub {
    font-size: 14px;
  }

  .page.is-split .search {
    grid-column: 1;
  }

  .page.is-split .search-hint {
    grid-column: 1 / -1;
  }

  .page.is-split .import-link {
    grid-column: 2;
  }

  .page.is-split .results {
    grid-column: 1;
  }

  .page.is-split .detail-layer {
    position: sticky;
    top: 24px;
    grid-column: 2;
    grid-row: 1 / span 2;
  }
}

/* Phones and tablets: the detail is a full-screen sheet over the untouched list. */
@media (max-width: 1079px) {
  .detail-layer {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: block;
  }

  .detail-scrim {
    position: absolute;
    inset: 0;
    background: rgba(23, 32, 84, 0.34);
  }

  .detail {
    position: relative;
    height: 100%;
    max-height: none;
    border: 0;
    border-radius: 0;
    padding: calc(12px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom));
  }
}

/* Phones: the table becomes cards, one per person, with the column name in
   front of each value. Every row is still a single 44px+ target. */
@media (max-width: 640px) {
  .page {
    gap: 16px;
    padding: 20px 0 56px;
  }

  .finder {
    gap: 14px;
    padding: 18px;
    border-radius: 18px;
  }

  .title {
    font-size: 28px;
  }

  .results {
    padding: 16px 6px 6px;
    border-radius: 18px;
  }

  .list-head {
    display: none;
  }

  .list-row {
    grid-template-columns: 1fr;
    gap: 6px;
    min-height: var(--tap);
    margin-bottom: 10px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
  }

  .list-row:last-child {
    margin-bottom: 0;
  }

  .list-row.is-selected {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .cell {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 8px;
  }

  .cell::before {
    content: attr(data-label);
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-muted);
  }

  /* The pill keeps its own width instead of filling the value column. */
  .list-row .badge {
    justify-self: start;
  }

  .fact {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}

/* The sheet rise: transform and opacity only, well under 600ms. */
.detail-slide-enter-active {
  /* Named easings only: a cubic-bezier() carries commas and reads as extra
     properties in the transition guard. */
  transition:
    opacity 0.24s ease-out,
    transform 0.32s ease-out;
}

.detail-slide-leave-active {
  transition: opacity 0.18s ease;
  /* Fading out must not keep swallowing taps meant for the list. */
  pointer-events: none;
}

.detail-slide-enter-from {
  opacity: 0;
  transform: translate3d(0, 12px, 0);
}

.detail-slide-leave-to {
  opacity: 0;
}

@media (max-width: 1079px) {
  .detail-slide-enter-from,
  .detail-slide-leave-to {
    transform: translate3d(0, 100%, 0);
  }
}

/* The entrance: a short rise and fade, 50ms apart. It lives entirely inside
   no-preference, so a reduced-motion visitor gets the finished page with no
   animation at all. Transform and opacity only, and the content is already in
   the DOM at its final state (backwards fill). */
@media (prefers-reduced-motion: no-preference) {
  @keyframes dir-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 12px, 0);
    }
  }

  .finder {
    animation: dir-rise 0.44s cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }

  .results {
    animation: dir-rise 0.42s cubic-bezier(0.16, 1, 0.3, 1) 80ms backwards;
  }

  .list-row {
    animation: dir-rise 0.42s cubic-bezier(0.16, 1, 0.3, 1) backwards;
    animation-delay: calc(var(--stagger, 0) * 50ms + 120ms);
  }
}

@media (prefers-reduced-motion: reduce) {
  .finder,
  .results,
  .list-row,
  .import-link,
  .import-arrow,
  .detail-close,
  .reveal-btn,
  .detail-slide-enter-active,
  .detail-slide-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
