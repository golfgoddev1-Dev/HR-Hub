<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import PushToggle from '../components/PushToggle.vue'
import { getSession } from '../api.js'
import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import { peekCached } from '../lib/data-cache.js'
import { isLiteMode, prefersReducedMotion } from '../lib/lite-mode.js'
import {
  APPROVALS_TTL_MS,
  DATA_KEYS,
  PAGE_TTL_MS,
  errorTextOf,
  loaders,
  loadShared,
} from '../lib/shared-data.js'
import {
  OWN_CERTIFICATE_OPEN_LABEL,
  canOpenOwnCertificate,
  certificateStatus,
} from '../leave-certificate.js'
import { setApprovalCount } from '../lib/approval-count.js'
import { countUp } from '../lib/motion.js'

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
// Own request counts come from the Worker, scoped to this employee.
const counts = ref({ pending: 0, approved: 0 })
// The two totals count up to the Worker's numbers through the shared GSAP helper;
// only their text changes, so the row keeps its height while the digits climb.
// The DOM already holds the real numbers, so the page is correct with no motion.
const pendingValue = ref(null)
const approvedValue = ref(null)

function paintCounts() {
  countUp(pendingValue.value, counts.value.pending)
  countUp(approvedValue.value, counts.value.approved)
}

onMounted(paintCounts)
watch(() => [counts.value.pending, counts.value.approved], paintCounts, { flush: 'post' })
const retentionDays = ref(0)

// ---- The card stack -------------------------------------------------------
// The employee's own newest requests, shown one at a time in the desk's corner.
// It reads the list the page already loaded: no extra request, no new endpoint.
const CYCLE_MS = 3000
// A swipe needs this much horizontal travel, and must be flatter than it is tall.
const SWIPE_MIN = 40
// Cycling is for a capable device only. A lite device, a reduced-motion visitor
// and the low or static tier all keep the first card still.
const STACK_TIERS = ['high', 'medium']

// Every request is one card, in the Worker's order. No grouping, no slicing.
const stackItems = computed(() => results.value)
const stackIndex = ref(0)
const stackHovered = ref(false)
const stackFocused = ref(false)
const stackPaused = ref(false)
const stackTier = ref('high')
const stackCanCycle = ref(false)

let cycleTimer = null
let tierObserver = null
let swipeStart = null

const stackCard = computed(() => stackItems.value[stackIndex.value] ?? null)
const showStack = computed(() => !loading.value && stackItems.value.length > 0)
const canStep = computed(() => stackItems.value.length > 1)

function readTier() {
  if (typeof document === 'undefined') return 'high'
  return document.documentElement.getAttribute('data-bg-tier') || 'high'
}

function pageIsVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function tierAllowsCycle() {
  return STACK_TIERS.includes(stackTier.value)
}

function stackIsAllowed() {
  return (
    stackItems.value.length > 1 &&
    !isLiteMode() &&
    !prefersReducedMotion() &&
    tierAllowsCycle()
  )
}

function cycleRunning() {
  return (
    stackIsAllowed() &&
    !stackHovered.value &&
    !stackFocused.value &&
    !stackPaused.value &&
    pageIsVisible()
  )
}

function stopCycle() {
  if (cycleTimer === null) return
  clearTimeout(cycleTimer)
  cycleTimer = null
}

// One step every 3s, scheduled one at a time. Chained timeouts rather than an
// interval: the page owns no polling timer (tests/approval-count.test.js keeps
// that to src/lib/approval-count.js), and a pause can drop the pending step
// instead of letting it fire behind the pointer.
function scheduleNextStep() {
  if (cycleTimer !== null || !cycleRunning()) return
  cycleTimer = setTimeout(() => {
    cycleTimer = null
    if (!cycleRunning()) return
    advance(1)
    scheduleNextStep()
  }, CYCLE_MS)
}

/** One place decides whether the stack is auto-advances; every trigger calls it. */
function syncCycle() {
  stackCanCycle.value = stackIsAllowed()
  if (cycleRunning()) scheduleNextStep()
  else stopCycle()
}

/** One request forward or back, wrapping at both ends. */
function advance(delta) {
  const total = stackItems.value.length
  if (total < 2) return
  stackIndex.value = (stackIndex.value + delta + total) % total
}

/** A manual move always restarts the full 3s, and never touches stackPaused. */
function stepBy(delta) {
  advance(delta)
  stopCycle()
  scheduleNextStep()
}

// Hover pauses only for a real mouse. A touch tap emits a synthesized mouseenter
// with no matching mouseleave, and that used to latch the pause on for good while
// the pause button still read "หยุดสลับการ์ด". Pointer events carry the type, so a
// finger or a pen can never pause the cycle.
function onPointerEnter(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return
  stackHovered.value = true
}

function onPointerLeave(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return
  stackHovered.value = false
}

// Focus pauses only when the focus came from the keyboard. A mouse click on one
// of the stack's buttons leaves focus inside the showcase too, and that used to
// freeze the stack with the pause button still offering to stop it.
function keyboardFocus(target) {
  try {
    return target?.matches?.(':focus-visible') === true
  } catch {
    return false
  }
}

function onFocusIn(event) {
  if (keyboardFocus(event.target)) stackFocused.value = true
}

function onFocusOut() {
  stackFocused.value = false
}

function onKeydown(event) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    stepBy(-1)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    stepBy(1)
  }
}

// A touch drag on the card: horizontal travel wins only when it is both long
// enough and flatter than it is tall, so a vertical page scroll is never eaten.
function onPointerDown(event) {
  // A mouse drag is a text selection, not a swipe: this gesture is for touch.
  if (event.pointerType === 'mouse') return
  if (event.target?.closest?.('button')) return
  swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId, type: event.pointerType }
}

function onPointerUp(event) {
  if (!swipeStart || event.pointerId !== swipeStart.id) return
  const dx = event.clientX - swipeStart.x
  const dy = event.clientY - swipeStart.y
  swipeStart = null
  if (Math.abs(dx) < SWIPE_MIN) return
  if (Math.abs(dx) <= Math.abs(dy)) return
  stepBy(dx < 0 ? 1 : -1)
}

function onPointerCancel() {
  swipeStart = null
}

function onVisibilityChange() {
  syncCycle()
}

watch(stackItems, (items) => {
  if (stackIndex.value >= items.length) stackIndex.value = 0
  syncCycle()
})
watch([stackHovered, stackFocused, stackPaused, stackTier], syncCycle)

const route = useRoute()
const focusId = computed(() => (typeof route.query.focus === 'string' ? route.query.focus : ''))
// The in-app list is always the fallback source of truth, push or no push.

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
  // A cached list paints at once and refreshes in the background only when old.
  loading.value = !peekCached(DATA_KEYS.myRequests)
  errorMessage.value = ''
  try {
    await loadShared(DATA_KEYS.myRequests, loaders.myRequests, {
      ttlMs: PAGE_TTL_MS,
      onData: (data) => {
        results.value = Array.isArray(data.results) ? data.results : []
        retentionDays.value = Number(data.certificateRetentionDays) || 0
        counts.value = {
          pending: Number(data.counts?.pending) || 0,
          approved: Number(data.counts?.approved) || 0,
        }
      },
    })
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
  } finally {
    loading.value = false
  }
}

async function loadPendingApprovals() {
  try {
    // The dock reads the same key, so opening /leave does not fetch it twice.
    await loadShared(DATA_KEYS.approvals, loaders.approvals, {
      ttlMs: APPROVALS_TTL_MS,
      onData: (data) => {
        setApprovalCount(Array.isArray(data.results) ? data.results.length : 0)
      },
    })
  } catch {
    setApprovalCount(0)
  }
}

// The Worker streams the certificate itself; this is never a signed URL.
function attachmentUrl(id) {
  return `/api/leave/requests/${encodeURIComponent(id)}/attachment`
}

onMounted(async () => {
  load()
  // Only an approver has a queue; other employees must not trigger the 403.
  const session = await getSession()
  if (session?.isApprover === true) await loadPendingApprovals()
})

// The stack follows the tier the 3D layer publishes. A drop to low or static
// stops the cycle instead of animating on a device that asked for less.
onMounted(() => {
  stackTier.value = readTier()
  syncCycle()
  if (typeof document === 'undefined') return
  document.addEventListener('visibilitychange', onVisibilityChange)
  if (typeof MutationObserver !== 'function') return
  tierObserver = new MutationObserver(() => {
    stackTier.value = readTier()
  })
  tierObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-bg-tier'],
  })
})

onBeforeUnmount(() => {
  stopCycle()
  tierObserver?.disconnect()
  tierObserver = null
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})
</script>

<template>
  <main class="page">
    <!-- The desk: the page's own two numbers and the one action that starts work. -->
    <section class="hero" aria-labelledby="leave-title">
      <div class="hero-head">
        <div class="hero-copy">
          <p class="eyebrow">พนักงาน</p>
          <h1 id="leave-title" class="title">ใบลาของฉัน</h1>
          <p class="sub">ดูสถานะใบลาที่เคยยื่นไว้ · คำนวณวันทำการและวันกลับมาทำงานโดยระบบ</p>
        </div>
        <RouterLink to="/leave/new" class="primary-link">
          <span>ยื่นใบลาใหม่</span>
          <span class="primary-arrow" aria-hidden="true">→</span>
        </RouterLink>
      </div>

      <dl class="stats">
        <div class="stat stat-pending">
          <dt class="stat-label">ใบลารออนุมัติ</dt>
          <dd class="stat-figure">
            <span ref="pendingValue" class="stat-value">{{ counts.pending }}</span>
            <span class="stat-unit">ใบ</span>
          </dd>
        </div>
        <div class="stat stat-approved">
          <dt class="stat-label">ใบลาอนุมัติแล้ว</dt>
          <dd class="stat-figure">
            <span ref="approvedValue" class="stat-value">{{ counts.approved }}</span>
            <span class="stat-unit">ใบ</span>
          </dd>
        </div>
      </dl>

      <!-- The desk's one bold element: the employee's own newest requests, one
           card at a time. It moves only while the page is watched, on a device
           that can afford it, and never for a reduced-motion visitor. -->
      <div
        v-if="showStack"
        class="showcase"
        role="group"
        aria-labelledby="showcase-title"
        @pointerenter="onPointerEnter"
        @pointerleave="onPointerLeave"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
        @keydown="onKeydown"
      >
        <div class="showcase-head">
          <h2 id="showcase-title" class="showcase-title">ใบลาล่าสุด</h2>
          <div class="stack-controls">
            <button
              v-if="canStep"
              type="button"
              class="stack-step"
              aria-label="ใบลาก่อนหน้า"
              @click="stepBy(-1)"
            >
              <span aria-hidden="true">←</span>
            </button>
            <p class="showcase-meta" aria-live="off">
              ใบที่ {{ stackIndex + 1 }} จาก {{ stackItems.length }}
            </p>
            <button
              v-if="canStep"
              type="button"
              class="stack-step"
              aria-label="ใบลาถัดไป"
              @click="stepBy(1)"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <div
          class="stack"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
        >
          <template v-if="stackCanCycle">
            <span class="stack-ghost stack-ghost-two" aria-hidden="true"></span>
            <span class="stack-ghost stack-ghost-one" aria-hidden="true"></span>
          </template>

          <Transition name="stack">
            <article v-if="stackCard" :key="stackCard.id" class="stack-card">
              <div class="stack-top">
                <span class="code">{{ stackCard.requestCode || '—' }}</span>
                <span class="badge" :class="statusClass(stackCard.status)">
                  {{ statusLabel(stackCard.status) }}
                </span>
              </div>
              <h3 class="stack-type">{{ stackCard.leaveTypeName || 'ไม่ระบุประเภท' }}</h3>
              <dl class="stack-facts">
                <div class="stack-fact">
                  <dt>ช่วงวันที่</dt>
                  <dd>{{ formatThaiDateRange(stackCard.startDate, stackCard.endDate) }}</dd>
                </div>
                <div class="stack-fact">
                  <dt>จำนวนวัน</dt>
                  <dd>{{ daysText(stackCard) }}</dd>
                </div>
              </dl>
            </article>
          </Transition>
        </div>

        <!-- WCAG 2.2.2: an auto-switching card needs a way to stop it that a
             finger can reach, not only a mouse or a focused key. -->
        <button
          v-if="stackCanCycle"
          type="button"
          class="stack-toggle"
          :aria-pressed="stackPaused ? 'true' : 'false'"
          @click="stackPaused = !stackPaused"
        >
          {{ stackPaused ? 'สลับการ์ดต่อ' : 'หยุดสลับการ์ด' }}
        </button>
      </div>
    </section>

    <!-- Notifications sit beside the list on a wide screen, above it on a phone. -->
    <section class="rail" aria-label="การแจ้งเตือน">
      <PushToggle />
    </section>

    <!-- The shelf: every request as one row, newest first (the Worker's order). -->
    <section class="list-panel" aria-labelledby="requests-title">
      <div class="panel-head">
        <h2 id="requests-title" class="panel-title">รายการใบลา</h2>
      </div>

      <p v-if="loading" class="status-line">กำลังโหลด…</p>

      <v-alert v-else-if="errorMessage" type="error" variant="tonal" class="mb-4">
        {{ errorMessage }}
      </v-alert>

      <p v-else-if="results.length === 0" class="empty-line">{{ EMPTY }}</p>

      <div v-else class="rows">
        <article
          v-for="(item, index) in results"
          :key="item.id"
          :class="['row', { 'card-focus': item.id === focusId }]"
          :style="{ '--stagger': index }"
        >
          <header class="row-head">
            <div class="row-id">
              <span class="code">{{ item.requestCode || '—' }}</span>
              <h3 class="type">{{ item.leaveTypeName || 'ไม่ระบุประเภท' }}</h3>
              <p v-if="item.otherTypeDetail" class="detail">{{ item.otherTypeDetail }}</p>
            </div>
            <span class="badge" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</span>
          </header>

          <dl class="facts">
            <div class="fact">
              <dt>ช่วงวันที่</dt>
              <dd>{{ formatThaiDateRange(item.startDate, item.endDate) }}</dd>
            </div>
            <div class="fact">
              <dt>จำนวนวัน</dt>
              <dd>{{ daysText(item) }}</dd>
            </div>
            <div class="fact">
              <dt>กลับมาทำงาน</dt>
              <dd>
                {{ item.returnDate ? `${formatThaiDate(item.returnDate)} ${item.returnTime || ''}` : '—' }}
              </dd>
            </div>
            <div class="fact">
              <dt>ยื่นเมื่อ</dt>
              <dd>{{ formatThaiDate(item.createdAt) }}</dd>
            </div>
          </dl>

          <p v-if="certificate(item).has" class="note">
            <a
              v-if="canOpenOwnCertificate(item)"
              :href="attachmentUrl(item.id)"
              target="_blank"
              rel="noopener noreferrer"
            >{{ OWN_CERTIFICATE_OPEN_LABEL }}</a>
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
      </div>
    </section>
  </main>
</template>

<!-- Glass tiers. Unscoped so the tint and blur can live on :root next to the tier
     flag AppBackground3D.vue publishes (data-bg-tier). Tint 0.88: low enough that
     the field reads through the glass, high enough that slate-600 keeps 4.5:1 over
     the darkest scene pixel (measured in tests/leave-home-ux.test.js). Blur follows
     the tier: 18px at high, 8px at medium and low, none at static. -->
<style>
:root {
  --leave-home-glass: rgba(255, 255, 255, 0.88);
  --leave-home-blur: 18px;
  --leave-home-filter: blur(var(--leave-home-blur)) saturate(1.1);
  --leave-home-edge: rgba(255, 255, 255, 0.66);
  --leave-home-shadow: 0 16px 38px rgba(23, 32, 84, 0.13);
}

:root[data-bg-tier='medium'],
:root[data-bg-tier='low'] {
  --leave-home-blur: 8px;
}

/* No scene to frost on the static tier: the same contrast floor, a slightly
   stronger tint and no backdrop filter at all. */
:root[data-bg-tier='static'] {
  --leave-home-blur: 0px;
  --leave-home-filter: none;
  --leave-home-glass: rgba(255, 255, 255, 0.9);
}
</style>

<style scoped>
.page {
  /* The page palette, declared once. Contrast (WCAG AA, normal text) is asserted
     in tests/leave-home-ux.test.js, against the frosted backdrop over the darkest
     scene pixel and against every opaque fill:
       indigo-900 on glass 13.4, slate-700 8.4, slate-600 6.2
       pending #8a4b06 on glass 5.5, approved #1c6b3f on glass 5.2
       indigo-700 on glass 6.4, white on indigo-600 6.29
       status pairs on their own fills: 6.16 / 5.74 / 6.89 / 5.65
     The card stack, sampled in the browser (2%/98% backdrop, high @1280):
       card title 15.85, fact label 7.47, fact value 15.85, counter 7.02,
       step buttons 7.64, pause 7.77, their borders 3.43 */
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-deep: #4338ca;
  --focus: #8b5cf6;
  --line: rgba(30, 27, 75, 0.12);
  --pending-ink: #8a4b06;
  --approved-ink: #1c6b3f;
  /* The card stack's boundary: 3.2:1 over the card glass, a real edge. */
  --stack-line: rgba(30, 27, 75, 0.52);
  --danger: #a01b1b;
  --warning: #92400e;
  --tap: 44px;
  --radius-panel: 22px;
  --radius-row: 14px;

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

/* Wide screens put the notifications in a rail beside the list; the desk spans
   both columns above them. */
@media (min-width: 1024px) {
  .page {
    grid-template-columns: 320px minmax(0, 1fr);
    grid-template-areas:
      'hero hero'
      'rail list';
    align-items: start;
    column-gap: 24px;
    row-gap: 20px;
    padding-top: 32px;
  }

  .hero {
    grid-area: hero;
  }

  .rail {
    grid-area: rail;
  }

  .list-panel {
    grid-area: list;
  }
}

.hero,
.list-panel {
  position: relative;
  background-color: var(--leave-home-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--leave-home-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--leave-home-shadow);
  -webkit-backdrop-filter: var(--leave-home-filter);
  backdrop-filter: var(--leave-home-filter);
}

.hero {
  display: grid;
  gap: 20px;
  overflow: hidden;
  padding: 26px 28px;
}

/* Decoration only: a soft violet glow in the empty corner of the desk. */
.hero::after {
  content: '';
  position: absolute;
  right: -70px;
  top: -80px;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(139, 92, 246, 0.2) 0%,
    rgba(79, 70, 229, 0.09) 45%,
    rgba(255, 255, 255, 0) 70%
  );
  pointer-events: none;
}

.hero-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px 24px;
}

.hero-copy {
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

/* The page's one primary action: indigo, 44px tall, and reachable by thumb. */
.primary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 0 20px;
  border-radius: 12px;
  background: var(--accent);
  color: #ffffff;
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background-color var(--motion-release) ease,
    box-shadow var(--motion-hover) ease;
}

.primary-arrow {
  display: inline-block;
  transition: transform var(--motion-release) ease;
}

/* The two counts are the page's headline numbers, on a hairline under the desk. */
.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

.stat {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.stat-label {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink-muted);
}

.stat-figure {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
}

.stat-value {
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 34px;
  font-weight: 600;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.stat-pending .stat-value {
  color: var(--pending-ink);
}

.stat-approved .stat-value {
  color: var(--approved-ink);
}

.stat-unit {
  font-size: 13px;
  color: var(--ink-muted);
}

/* ---- The card stack: the one bold element on this page ------------------- */

/* The hero takes a second column only when a stack exists, so a page with no
   requests keeps the composition it had. */
@media (min-width: 900px) {
  .hero:has(.showcase) {
    grid-template-columns: minmax(0, 1fr) 300px;
    align-items: start;
  }

  .hero:has(.showcase) .hero-head,
  .hero:has(.showcase) .stats {
    grid-column: 1;
  }

  .hero:has(.showcase) .showcase {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
  }
}

.showcase {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.showcase-head {
  display: grid;
  gap: 8px;
}

/* The counter sits between its two buttons, like a pager: the buttons are 44px
   squares, so a finger hits them on the sheet as well as on the desktop panel. */
.stack-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.showcase-title {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.showcase-meta {
  flex: 1;
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* Manual step controls: a real button, 44px on every width, with the same
   boundary and focus ring as the pause control beside them. */
.stack-step {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  padding: 0;
  border: 1px solid var(--stack-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--accent-deep);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color var(--motion-release) ease,
    border-color var(--motion-release) ease;
}

.stack-step:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* A fixed box with absolute cards: a switch never moves the page around it.
   The height fits the two-fact card with its padding, and the bottom margin
   leaves room for the two ghost edges to show under it. */
.stack {
  position: relative;
  min-height: 176px;
  margin-bottom: 26px;
  /* A horizontal drag is ours to read; a vertical one stays the page's scroll. */
  touch-action: pan-y;
}

.stack-ghost {
  position: absolute;
  inset: 0;
  border: 1px solid var(--stack-line);
  border-radius: var(--radius-row);
  background-color: var(--leave-home-glass);
  pointer-events: none;
}

.stack-ghost-one {
  transform: translate3d(0, 10px, 0) rotate(-1.8deg) scale(0.985);
}

.stack-ghost-two {
  transform: translate3d(0, 20px, 0) rotate(2.6deg) scale(0.968);
  opacity: 0.66;
}

.stack-card {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--stack-line);
  border-radius: var(--radius-row);
  background-color: var(--leave-home-glass);
  -webkit-backdrop-filter: var(--leave-home-filter);
  backdrop-filter: var(--leave-home-filter);
  /* Depth is what separates the live card from the two edges under it; the
     glass itself stays the page's single tint. */
  box-shadow:
    0 18px 36px rgba(23, 32, 84, 0.2),
    0 2px 6px rgba(23, 32, 84, 0.12);
}

.stack-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stack-type {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.stack-facts {
  display: grid;
  gap: 8px;
  margin: 4px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.stack-fact {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.stack-fact dt {
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink-muted);
}

.stack-fact dd {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--ink);
  text-align: right;
  overflow-wrap: anywhere;
}

.stack-toggle {
  justify-self: start;
  align-self: start;
  min-width: var(--tap);
  min-height: var(--tap);
  padding: 0 12px;
  border: 1px solid var(--stack-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--accent-deep);
  font-family: 'Prompt', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--motion-release) ease,
    border-color var(--motion-release) ease;
}

.stack-toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* A switch is one card leaving upward while the next arrives from below: two
   properties, under 600ms, and nothing else on the page moves. */
.stack-enter-active,
.stack-leave-active {
  transition:
    opacity var(--motion-route) var(--motion-ease),
    transform var(--motion-route) var(--motion-ease);
}

.stack-enter-from {
  opacity: 0;
  transform: translate3d(0, 26px, 0) scale(0.98);
}

.stack-leave-to {
  opacity: 0;
  transform: translate3d(0, -20px, 0) scale(0.99);
}

/* Notifications are a component of their own; the page gives it the same glass
   and readable inks as its panels, without touching the component. */
.rail :deep(.push-card) {
  margin-bottom: 0;
  padding: 18px 20px;
  background-color: var(--leave-home-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--leave-home-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--leave-home-shadow);
  -webkit-backdrop-filter: var(--leave-home-filter);
  backdrop-filter: var(--leave-home-filter);
}

.rail :deep(.push-title) {
  font-size: 16px;
  color: var(--ink);
}

.rail :deep(.push-text),
.rail :deep(.push-hint) {
  font-size: 13px;
  color: var(--ink-muted);
}

.rail :deep(.push-warning) {
  font-size: 13px;
  color: var(--warning);
}

.rail :deep(.push-error) {
  font-size: 13px;
  color: var(--danger);
}

/* The switch is one action on this page, so it takes the page's 44px tap target
   and a boundary that is visible against the glass. */
.rail :deep(.notify-state) {
  font-size: 13px;
  color: var(--ink-muted);
}

.rail :deep(.notify-switch) {
  height: var(--tap);
  min-width: var(--tap);
  border-color: var(--ink-muted);
  background: #e2e8f0;
}

.rail :deep(.notify-switch-on) {
  border-color: var(--accent);
  background: var(--accent);
}

.rail :deep(.notify-thumb) {
  top: 50%;
  margin-top: -10px;
}

.list-panel {
  padding: 20px 8px 8px;
}

.panel-head {
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

.status-line,
.empty-line {
  margin: 0;
  padding: 10px 14px 14px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.rows {
  display: grid;
}

.row {
  padding: 16px 14px;
  border-radius: var(--radius-row);
}

.row + .row {
  border-top: 1px solid var(--line);
}

/* The row linked from ?focus= keeps a violet ring, decoration only. */
.card-focus {
  box-shadow: inset 0 0 0 2px var(--focus);
}

.row-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.row-id {
  min-width: 0;
}

.code {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.4;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.type {
  margin: 2px 0 0;
  font-family: 'Prompt', sans-serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.detail {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.badge {
  display: inline-block;
  flex: 0 0 auto;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
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
  /* 5.65:1 on the fill; #6a6a6a was 4.79:1. */
  color: #5f5f5f;
}

/* Two facts per line, four on a wide row: the dates are the longest value. */
.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

@media (min-width: 720px) {
  .facts {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.fact {
  min-width: 0;
}

.fact dt {
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink-muted);
}

.fact dd {
  margin: 2px 0 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.note {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.note a {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  color: var(--accent-deep);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.note-sub {
  margin-left: 2px;
  color: var(--ink-muted);
}

/* Hover and press are for a real mouse only: a finger gets no hover state. */
@media (hover: hover) and (pointer: fine) {
  .primary-link:hover {
    background: var(--accent-deep);
    box-shadow: 0 10px 24px rgba(23, 32, 84, 0.18);
    transform: translateY(-1px);
  }

  .primary-link:hover .primary-arrow {
    transform: translateX(3px);
  }

  .primary-link:active {
    transform: scale(0.98);
  }

  .note a:hover {
    color: var(--ink);
  }
}

/* Phones: one column, the action is a full-width thumb target, and the numbers
   stay the largest thing on the page after the title. */
@media (max-width: 599px) {
  .page {
    gap: 16px;
    padding: 20px 0 56px;
  }

  .hero {
    gap: 16px;
    padding: 18px;
    border-radius: 18px;
  }

  .hero-head {
    gap: 14px;
  }

  .title {
    font-size: 28px;
  }

  .primary-link {
    width: 100%;
  }

  .stats {
    padding-top: 14px;
  }

  .stat-value {
    font-size: 30px;
  }

  .stack {
    min-height: 184px;
    margin-bottom: 24px;
  }

  .list-panel {
    padding: 16px 6px 6px;
    border-radius: 18px;
  }

  .row {
    padding: 14px 10px;
  }

  .fact dd {
    font-size: 16px;
  }
}

/* The entrance: a short rise and fade, 50ms apart. It lives entirely inside
   no-preference, so a reduced-motion visitor gets the finished page with no
   animation at all. Transform and opacity only, and the content is already in
   the DOM at its final state (backwards fill). */
@media (prefers-reduced-motion: no-preference) {
  @keyframes leave-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 12px, 0);
    }
  }

  .hero {
    animation: leave-rise var(--motion-entrance) var(--motion-ease) backwards;
  }

  .rail {
    animation: leave-rise 0.42s var(--motion-ease) 60ms backwards;
  }

  .list-panel {
    animation: leave-rise 0.42s var(--motion-ease) 100ms backwards;
  }

  .row {
    animation: leave-rise 0.42s var(--motion-ease) backwards;
    animation-delay: calc((var(--stagger, 0) + 3) * var(--motion-stagger));
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero,
  .rail,
  .list-panel,
  .row,
  .primary-link,
  .note a,
  .stack-card,
  .stack-toggle,
  .stack-step,
  .stack-enter-active,
  .stack-leave-active {
    animation: none;
    transition: none;
  }
}
</style>
