<script setup>
// The HR desk: who the page is for, the menus this person pinned, and the three
// everyday tasks. The pinned menus are a card stack because they are a short,
// personal list; the task rows below stay exactly what they were.
//
// Nothing here approves leave. HR reads the queue on /hr/leave and the decision
// itself belongs to the approver, so this page carries no approve or reject
// action at all.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isLiteMode, prefersReducedMotion } from '../lib/lite-mode.js'
import {
  DATA_KEYS,
  PAGE_TTL_MS,
  errorTextOf,
  loaders,
  loadShared,
} from '../lib/shared-data.js'
import { hrMenuShortcutItems } from '../lib/hr-menu-shortcuts.js'

const LOAD_SUGGESTION = 'ยังใช้เมนูตัวอย่างอยู่ เลือกเมนูที่ใช้บ่อยได้ที่หน้าข้อมูลส่วนตัว'

const cards = [
  {
    to: '/hr/employees',
    icon: 'groups',
    title: 'รายชื่อพนักงาน',
    description: 'ค้นหาพนักงานด้วยชื่อหรือรหัสพนักงาน (อย่างน้อย 2 ตัวอักษร) และเปิดดูข้อมูลรายคน',
  },
  {
    to: '/hr/employees/import',
    icon: 'upload_file',
    title: 'นำเข้าพนักงาน',
    description: 'อัปโหลดไฟล์ .xlsx หรือ .csv ตรวจตัวอย่างก่อนบันทึก และดาวน์โหลดแม่แบบไฟล์',
  },
  {
    to: '/hr/employees/manage',
    icon: 'edit',
    title: 'จัดการข้อมูลพนักงาน',
    description: 'เปลี่ยนแผนกและตำแหน่งของพนักงานรายคน และเปลี่ยนชื่อรายการแผนกหรือตำแหน่งที่ใช้ร่วมกัน',
  },
]

// ---- The menu stack -------------------------------------------------------
// Same behaviour contract as the employee stack on /leave: one step every 3s on
// a desktop, by hand everywhere, a touch swipe on a phone, and nothing at all
// under reduced motion. The composition is deliberately different (one card with
// the action as its foot, the pager under the copy, no fan of ghost cards).
const CYCLE_MS = 3000
const SWIPE_MIN = 40
const STACK_TIERS = ['high', 'medium']
// Session-only: the saved preference is a list of routes with a 1-to-5 check, so
// it has nowhere to keep "this person has already swiped". The dismissal lives in
// sessionStorage and is forgotten when the tab closes.
const HINT_KEY = 'hr-menu-shortcuts-hint'

const loading = ref(true)
const shortcutItems = ref([])
const shortcutError = ref('')

const stackIndex = ref(0)
const stackHovered = ref(false)
const stackFocused = ref(false)
const stackTier = ref('high')
const hintVisible = ref(false)
const canCycle = ref(false)
const finePointer = ref(false)

let cycleTimer = null
let tierObserver = null
let swipeStart = null
// A swipe ends on the card, which is the link, so the click the browser sends
// after it must not navigate. The window is short and absolute: a swipe that the
// browser never follows with a click must not swallow the next tap.
const CLICK_GUARD_MS = 400
let suppressClickUntil = 0

const total = computed(() => shortcutItems.value.length)
const current = computed(() => shortcutItems.value[stackIndex.value] ?? null)
const canStep = computed(() => total.value > 1)

function readTier() {
  if (typeof document === 'undefined') return 'high'
  return document.documentElement.getAttribute('data-bg-tier') || 'high'
}

function pageIsVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

function readFinePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches === true
  } catch {
    return false
  }
}

function readTouch() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(pointer: coarse)').matches === true
  } catch {
    return false
  }
}

function hintWasDismissed() {
  try {
    return window.sessionStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

function dismissHint() {
  hintVisible.value = false
  try {
    window.sessionStorage.setItem(HINT_KEY, '1')
  } catch {
    // Private mode with storage blocked: the hint returns next time, which is
    // still only a hint.
  }
}

function stackIsAllowed() {
  return (
    canStep.value &&
    finePointer.value &&
    !isLiteMode() &&
    !prefersReducedMotion() &&
    STACK_TIERS.includes(stackTier.value)
  )
}

function cycleRunning() {
  return stackIsAllowed() && !stackHovered.value && !stackFocused.value && pageIsVisible()
}

function stopCycle() {
  if (cycleTimer === null) return
  clearTimeout(cycleTimer)
  cycleTimer = null
}

// One step every 3s, scheduled one at a time: a chained timeout, never an
// interval, so a pause drops the pending step instead of firing behind it.
function scheduleNextStep() {
  if (cycleTimer !== null || !cycleRunning()) return
  cycleTimer = setTimeout(() => {
    cycleTimer = null
    if (!cycleRunning()) return
    advance(1)
    scheduleNextStep()
  }, CYCLE_MS)
}

function syncCycle() {
  canCycle.value = stackIsAllowed()
  if (cycleRunning()) scheduleNextStep()
  else stopCycle()
}

/** One menu forward or back, wrapping at both ends. */
function advance(delta) {
  if (total.value < 2) return
  stackIndex.value = (stackIndex.value + delta + total.value) % total.value
}

/** A manual move always restarts the full 3s. */
function stepBy(delta) {
  advance(delta)
  stopCycle()
  scheduleNextStep()
}

// Hover pauses only for a real mouse: a touch tap emits a synthesized
// mouseenter with no matching mouseleave, and that must never latch a pause.
function onPointerEnter(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return
  stackHovered.value = true
}

function onPointerLeave(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return
  stackHovered.value = false
}

// Focus pauses only when it came from the keyboard, never from a click.
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
// A mouse drag is a text selection, not a swipe.
function onPointerDown(event) {
  if (event.pointerType === 'mouse') return
  if (event.target?.closest?.('button')) return
  suppressClickUntil = 0
  swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId }
}

function onPointerUp(event) {
  if (!swipeStart || event.pointerId !== swipeStart.id) return
  const dx = event.clientX - swipeStart.x
  const dy = event.clientY - swipeStart.y
  swipeStart = null
  if (Math.abs(dx) < SWIPE_MIN) return
  if (Math.abs(dx) <= Math.abs(dy)) return
  // The card is the link, so the tap that ends a swipe must not also navigate.
  suppressClickUntil = Date.now() + CLICK_GUARD_MS
  if (hintVisible.value) dismissHint()
  stepBy(dx < 0 ? 1 : -1)
}

function onPointerCancel() {
  swipeStart = null
}

function onClickCapture(event) {
  if (suppressClickUntil === 0 || Date.now() > suppressClickUntil) return
  suppressClickUntil = 0
  event.preventDefault()
  event.stopPropagation()
}

function onVisibilityChange() {
  syncCycle()
}

watch(shortcutItems, (items) => {
  if (stackIndex.value >= items.length) stackIndex.value = 0
  syncCycle()
})
watch([stackHovered, stackFocused, stackTier], syncCycle)

async function load() {
  loading.value = true
  shortcutError.value = ''
  try {
    await loadShared(DATA_KEYS.profile, loaders.profile, {
      ttlMs: PAGE_TTL_MS,
      onData: (data) => {
        shortcutItems.value = hrMenuShortcutItems(data)
      },
    })
  } catch (error) {
    shortcutError.value = errorTextOf(error, LOAD_SUGGESTION)
    // The three defaults still stand: a failed read must not empty the page.
    shortcutItems.value = hrMenuShortcutItems({})
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  finePointer.value = readFinePointer()
  hintVisible.value = readTouch() && !hintWasDismissed()
  stackTier.value = readTier()
  load()
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
  if (tierObserver) {
    tierObserver.disconnect()
    tierObserver = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})
</script>

<template>
  <main class="page">
    <!-- The desk: who the page is for, in one breath. The pinned menus sit in
         this same panel — the deck beside the copy on a wide screen, under it on
         a phone. -->
    <section class="hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <p class="eyebrow">ฝ่ายบุคคล</p>
        <h1 id="home-title" class="title">หน้าหลัก</h1>
        <p class="lead">เลือกงานที่ต้องการทำ — แต่ละหน้าแสดงเฉพาะข้อมูลที่จำเป็น</p>
        <p class="note">ไม่แสดงเลขบัตรประชาชน ยกเว้นหน้าที่ขอเปิดดูรายคน</p>
        <p class="state">
          <span class="state-dot" aria-hidden="true"></span>
          <span class="state-text">ระบบพร้อมใช้งาน</span>
        </p>
      </div>

      <div
        v-if="!loading && current"
        class="shortcuts"
        @keydown="onKeydown"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
      >
        <div class="pager">
        <button
          type="button"
          class="step"
          aria-label="เมนูก่อนหน้า"
          :disabled="!canStep"
          @click="stepBy(-1)"
        >
          ←
        </button>
        <p class="counter" aria-live="polite" data-shortcut-counter>
          {{ stackIndex + 1 }} จาก {{ total }}
        </p>
          <button
            type="button"
            class="step"
            aria-label="เมนูถัดไป"
            :disabled="!canStep"
            @click="stepBy(1)"
          >
            →
          </button>
        </div>

        <p v-if="hintVisible" class="swipe-hint" role="note">
          ปัดเพื่อดูเมนูอื่น
        </p>

        <div
          class="deck"
          @pointerenter="onPointerEnter"
          @pointerleave="onPointerLeave"
          @pointerdown="onPointerDown"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @click.capture="onClickCapture"
        >
          <Transition name="deck">
            <RouterLink :key="current.to" :to="current.to" class="deck-card">
              <span class="deck-name">{{ current.label }}</span>
              <span class="deck-desc">{{ current.description }}</span>
              <span class="deck-foot">
                <span class="deck-go">ไปที่เมนูนี้</span>
                <span class="deck-arrow" aria-hidden="true">→</span>
              </span>
            </RouterLink>
          </Transition>
        </div>
      </div>

      <p v-if="shortcutError" class="deck-error">{{ shortcutError }}</p>
    </section>

    <!-- The work: three rows, not three equal boxes. Each row is one link. -->
    <nav class="menu" aria-label="งานของฝ่ายบุคคล">
      <div class="menu-head">
        <h2 class="menu-title">งานประจำวัน</h2>
        <span class="menu-count">{{ cards.length }} หน้า</span>
      </div>
      <ul class="tasks">
        <li v-for="(card, index) in cards" :key="card.to" class="task-row">
          <RouterLink :to="card.to" class="task" :style="{ '--stagger': index }">
            <span class="task-icon" aria-hidden="true">
              <span class="material-symbols-outlined">{{ card.icon }}</span>
            </span>
            <span class="task-copy">
              <span class="task-title">{{ card.title }}</span>
              <span class="task-desc">{{ card.description }}</span>
            </span>
            <span class="task-go">
              <span class="go-label">เปิดหน้านี้</span>
              <span class="go-arrow" aria-hidden="true">→</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </nav>
  </main>
</template>

<!-- Glass tiers. Unscoped so the tint and blur can live on :root next to the tier
     flag AppBackground3D.vue publishes (data-bg-tier). Tint 0.88 on both panels:
     low enough that the field reads through the glass, high enough that slate-600
     keeps 4.5:1 over the darkest scene pixel (measured in
     tests/hr-home-page.test.js). Blur follows the tier: 18px at high, 8px at
     medium and low, none at static. -->
<style>
:root {
  --home-glass: rgba(255, 255, 255, 0.88);
  --home-glass-blur: 18px;
  --home-glass-filter: blur(var(--home-glass-blur)) saturate(1.1);
  --home-edge: rgba(255, 255, 255, 0.66);
  --home-shadow: 0 16px 38px rgba(23, 32, 84, 0.13);
}

:root[data-bg-tier='medium'],
:root[data-bg-tier='low'] {
  --home-glass-blur: 8px;
}

/* No scene to frost on the static tier: the same contrast floor, a slightly
   stronger tint and no backdrop filter at all. */
:root[data-bg-tier='static'] {
  --home-glass-blur: 0px;
  --home-glass-filter: none;
  --home-glass: rgba(255, 255, 255, 0.9);
}
</style>

<style scoped>
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'liga';
}

.page {
  /* The page palette, declared once. Contrast (WCAG AA, normal text) is asserted
     in tests/hr-home-page.test.js and re-measured for the deck in
     tests/hr-menu-shortcuts.test.js, against the frosted backdrop over the
     darkest scene pixel and against every opaque fill:
       indigo-900 on glass 13.4, slate-700 8.4, slate-600 6.2
       indigo-600 on indigo-50 5.60, white on indigo-600 6.29
       indigo-700 on glass 6.4, violet-500 is a focus ring only (3:1 rule)
       deck action #4338ca 7.51-7.84, deck and pager border 3.32-3.39
       (0.52 indigo-900 over the glass), counter and hint #475569 6.86-7.34 */
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-deep: #4338ca;
  --focus: #8b5cf6;
  --tile: #eef2ff;
  --line: rgba(30, 27, 75, 0.12);
  --deck-line: rgba(30, 27, 75, 0.52);
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
     on one of the two frosted panels below. */
  background: transparent;
}

/* Desktop keeps the asymmetry: a wider desk beside the work list, so the pinned
   menu card has room to sit beside the copy instead of under it. */
@media (min-width: 960px) {
  .page {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    align-items: start;
    gap: 24px;
    padding-top: 32px;
  }
}

.hero,
.menu {
  position: relative;
  background-color: var(--home-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--home-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--home-shadow);
  -webkit-backdrop-filter: var(--home-glass-filter);
  backdrop-filter: var(--home-glass-filter);
}

.hero {
  overflow: hidden;
  display: grid;
  gap: 14px;
  padding: 28px;
}

/* Decoration only: a soft violet glow in the empty corner of the desk. */
.hero::after {
  content: '';
  position: absolute;
  right: -60px;
  bottom: -70px;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(139, 92, 246, 0.22) 0%,
    rgba(79, 70, 229, 0.1) 45%,
    rgba(255, 255, 255, 0) 70%
  );
  pointer-events: none;
}

/* The pager, the hint and the deck are one block on a phone and three grid
   items on a wide screen, where the deck sits beside the copy and the pager
   stays directly under it — never straddling the card. */
.shortcuts {
  display: grid;
  gap: 12px;
  min-width: 0;
}

@media (min-width: 960px) {
  .hero {
    grid-template-columns: minmax(0, 1fr) 236px;
    column-gap: 20px;
    align-content: start;
  }

  .shortcuts {
    display: contents;
  }

  .hero-copy {
    grid-column: 1;
    grid-row: 1;
  }

  .pager {
    grid-column: 1;
    grid-row: 2;
  }

  .swipe-hint {
    grid-column: 1;
    grid-row: 3;
  }

  .deck,
  .deck-error {
    grid-column: 2;
    grid-row: 1 / span 3;
    align-self: center;
  }
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
  margin: 0 0 12px;
  font-family: 'Prompt', sans-serif;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.lead {
  margin: 0 0 8px;
  max-width: 44ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink-body);
}

.note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
}

.state-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.14);
}

/* --- the pager ----------------------------------------------------------- */

.pager {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.step {
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  padding: 0;
  border: 1px solid var(--deck-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
  color: var(--accent-deep);
  font-family: 'Prompt', sans-serif;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease;
}

.step:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.step:focus-visible,
.deck-card:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.counter {
  margin: 0;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.swipe-hint {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--ink-muted);
}

/* --- the deck ------------------------------------------------------------- */

.deck {
  min-width: 0;
  touch-action: pan-y;
}

.deck-card {
  display: grid;
  gap: 8px;
  min-height: 100%;
  padding: 18px;
  border: 1px solid var(--deck-line);
  border-radius: 18px;
  /* A hair lighter than the hero so the card reads as a card on the glass. */
  background: rgba(255, 255, 255, 0.72);
  color: inherit;
  text-decoration: none;
  box-shadow: 0 10px 26px rgba(23, 32, 84, 0.1);
}

.deck-name {
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.deck-desc {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-body);
  overflow-wrap: anywhere;
}

/* The foot rule carries the accent, and the action sits inside the card: no
   filled button, unlike the employee stack. */
.deck-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 2px solid var(--accent-deep);
  color: var(--accent-deep);
  font-family: 'Prompt', sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}

.deck-arrow {
  display: inline-block;
  transition: transform 0.18s ease;
}

.deck-error {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-muted);
}

/* The swap: eight pixels of rise and a fade, transform and opacity only. */
.deck-enter-active,
.deck-leave-active {
  transition:
    opacity 0.24s ease,
    transform 0.24s ease;
}

.deck-enter-from {
  opacity: 0;
  transform: translate3d(0, 8px, 0);
}

.deck-leave-to {
  opacity: 0;
  transform: translate3d(0, -8px, 0);
}

@media (hover: hover) and (pointer: fine) {
  .step:hover:not(:disabled) {
    background: var(--tile);
    border-color: var(--accent-deep);
  }

  .deck-card:hover .deck-arrow {
    transform: translateX(3px);
  }
}

/* --- the task rows (unchanged) -------------------------------------------- */

.menu {
  padding: 18px 8px 8px;
}

.menu-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px 12px;
}

.menu-title {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.menu-count {
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tasks {
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-row + .task-row {
  border-top: 1px solid var(--line);
}

/* One row is one link: the whole block is the tap target, not just the arrow. */
.task {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  min-height: var(--tap);
  padding: 16px;
  border-radius: var(--radius-row);
  color: inherit;
  text-decoration: none;
  transition:
    background-color 0.18s ease,
    box-shadow 0.24s ease;
}

.task-icon {
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  border-radius: 12px;
  background: var(--tile);
  color: var(--accent);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.task-icon .material-symbols-outlined {
  font-size: 24px;
}

.task-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.task-title {
  font-family: 'Prompt', sans-serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.task-desc {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-body);
  overflow-wrap: anywhere;
}

.task-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-family: 'Prompt', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--accent-deep);
  white-space: nowrap;
}

.go-arrow {
  display: inline-block;
  transition: transform 0.18s ease;
}

/* Full-width rows take the focus ring inside their own box. */
.task:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/* Hover and press are for a real mouse only: a finger gets no hover state. */
@media (hover: hover) and (pointer: fine) {
  .task {
    transition:
      background-color 0.18s ease,
      box-shadow 0.24s ease,
      transform 0.24s ease;
  }

  .task:hover {
    background-color: rgba(79, 70, 229, 0.055);
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(23, 32, 84, 0.1);
  }

  .task:hover .task-icon {
    background: var(--accent);
    color: #ffffff;
  }

  .task:hover .go-arrow {
    transform: translateX(3px);
  }

  .task:active {
    transform: translateY(-1px) scale(0.995);
  }
}

/* Phones: one column, the row keeps its icon and copy, the words beside the
   arrow step aside so the description stays at 16px. */
@media (max-width: 599px) {
  .page {
    gap: 16px;
    padding: 20px 0 56px;
  }

  .hero {
    padding: 20px;
    border-radius: 18px;
  }

  .title {
    font-size: 28px;
  }

  .menu {
    padding: 14px 6px 6px;
    border-radius: 18px;
  }

  .task {
    gap: 12px;
    padding: 14px 10px;
  }

  .task-title {
    font-size: 16px;
  }

  .go-label {
    display: none;
  }
}

/* The entrance: fourteen pixels of rise and a fade, 50ms apart. It lives
   entirely inside no-preference, so a reduced-motion visitor gets the finished
   page with no animation at all. Transform and opacity only, and the rows are
   already in the DOM at their final state (backwards fill). */
@media (prefers-reduced-motion: no-preference) {
  @keyframes home-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 14px, 0);
    }
  }

  .hero {
    animation: home-rise 0.44s cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }

  .task {
    animation: home-rise 0.42s cubic-bezier(0.16, 1, 0.3, 1) backwards;
    animation-delay: calc(var(--stagger, 0) * 50ms + 80ms);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero,
  .task,
  .task-icon,
  .go-arrow,
  .step,
  .deck-arrow,
  .deck-enter-active,
  .deck-leave-active,
  .deck-enter-from,
  .deck-leave-to {
    animation: none;
    transition: none;
  }

  .deck-enter-from,
  .deck-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
