// The shared navigation for the employee and HR systems. On wide screens it is
// one glass bar: brand on the left, labelled menu groups in the centre and the
// logout button on the right. The groups wrap onto new lines, so no menu item is
// ever cut off and nothing scrolls sideways.
//
// On phones the same menu becomes a four-item tab bar plus a full-height sheet,
// which keeps every item reachable at a 44px tap target without shrinking the
// labels.

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { takeDockEntrance } from '../lib/dock-entrance.js'
import { completeLogout, logoutRequestOptions } from '../lib/logout.js'
import { createLogoutFlow, ripplePlacement } from '../lib/logout-flow.js'
import { dockPrimaryItems } from '../lib/nav-config.js'

const props = defineProps({
  brandIcon: { type: String, required: true },
  brandTitle: { type: String, required: true },
  brandSubtitle: { type: String, default: '' },
  sections: { type: Array, required: true },
  showBrandBadge: { type: Boolean, default: false },
  // Only the shell that owns a dock passes this; admin and controller keep
  // their own navigation.
  role: {
    type: String,
    default: 'employee',
    validator: (value) => ['employee', 'hr'].includes(value),
  },
})

const route = useRoute()
const rail = ref(null)
const dockRoot = ref(null)
const logoutButton = ref(null)
const menuTab = ref(null)
const sheetClose = ref(null)
const leaving = ref(false)
const sheetOpen = ref(false)
const dot = ref({ x: 0, y: 0, visible: false })
// Vue owns the ripple element: it appears at the click point and is removed on
// its animationend (or by the safety timer if the animation never fires).
const ripple = ref(null)
let flashTimer = null
let rippleTimer = null
let observer = null
let restoredOverflow = ''

// True only for the first dock mount in this page load; a later mount skips the
// entrance so navigation never replays the slide-down or the item stagger.
const entering = ref(takeDockEntrance())

// Width of the glowing dot under the active item; the rest comes from measuring.
const DOT_WIDTH = 26

// The four primary tabs, and every item of the sheet, come from the same
// sections the desktop groups use: one menu, two presentations.
const primaryItems = computed(() => dockPrimaryItems(props.role, props.sections))

const itemCount = computed(() =>
  props.sections.reduce((total, section) => total + section.items.length, 0)
)

// The one indicator: its x/y come from the active element, never from constants.
const indicatorStyle = computed(() => ({
  transform: `translate(${dot.value.x}px, ${dot.value.y}px)`,
  opacity: dot.value.visible ? '1' : '0',
}))

const rippleStyle = computed(() => ({
  width: `${ripple.value.size}px`,
  height: `${ripple.value.size}px`,
  left: `${ripple.value.x}px`,
  top: `${ripple.value.y}px`,
}))

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function activeItem() {
  const railEl = rail.value
  if (!railEl) return null
  // aria-current="page" is the router's exact match; the active class alone can
  // also sit on a parent route, so it is only the fallback.
  return railEl.querySelector('[aria-current="page"]') ?? railEl.querySelector('.dock-item-active')
}

/** Places the dot under whichever item the router marked active. */
function measure() {
  const railEl = rail.value
  if (!railEl) return

  const active = activeItem()
  if (!active) {
    dot.value = { x: 0, y: 0, visible: false }
    return
  }
  dot.value = {
    x: active.offsetLeft + (active.offsetWidth - DOT_WIDTH) / 2,
    // The groups wrap, so the dot needs the row as well as the column.
    y: active.offsetTop + active.offsetHeight - 5,
    visible: true,
  }
}

onMounted(() => {
  nextTick(measure)
  window.addEventListener('resize', measure)
  if (typeof ResizeObserver !== 'undefined' && rail.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(rail.value)
  }
  // The Thai labels load late and change the wrapping, so measure again then.
  document.fonts?.ready?.then(measure).catch(() => {})
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  window.removeEventListener('keydown', onKeydown)
  if (sheetOpen.value) document.body.style.overflow = restoredOverflow
  observer?.disconnect()
  observer = null
  clearTimeout(flashTimer)
  clearTimeout(rippleTimer)
})

// The dock stays mounted across pages, so the indicator moves with the route
// and an open sheet closes once the item it navigated to is in place.
watch(
  () => route.path,
  () =>
    nextTick(() => {
      measure()
      if (sheetOpen.value) closeSheet()
    })
)

/** Opens the phone menu sheet and puts the first control inside it in focus. */
function openSheet() {
  if (sheetOpen.value) return
  sheetOpen.value = true
  restoredOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  window.addEventListener('keydown', onKeydown)
  nextTick(() => sheetClose.value?.focus())
}

/** Closes the sheet and returns focus to the tab that opened it. */
function closeSheet() {
  if (!sheetOpen.value) return
  sheetOpen.value = false
  document.body.style.overflow = restoredOverflow
  window.removeEventListener('keydown', onKeydown)
  nextTick(() => menuTab.value?.focus())
}

function onKeydown(event) {
  if (event.key === 'Escape') closeSheet()
}

/** A red ripple from the click point, sized to the button's larger side. */
function spawnRipple(event) {
  if (!logoutButton.value) return
  const rect = logoutButton.value.getBoundingClientRect()
  // A keyboard activation reports 0,0, so it ripples from the button's centre.
  const hasPoint = (event?.clientX ?? 0) !== 0 || (event?.clientY ?? 0) !== 0
  const point = hasPoint ? { x: event.clientX, y: event.clientY } : null

  ripple.value = ripplePlacement(rect, point)
  clearTimeout(rippleTimer)
  rippleTimer = setTimeout(() => {
    ripple.value = null
  }, 700)
}

/** Short red glow on the dock; the class is removed when the animation is over. */
function flashDanger() {
  const dockEl = dockRoot.value
  if (!dockEl) return
  dockEl.classList.remove('is-alerting')
  // Without a reflow the browser collapses remove+add and nothing plays.
  void dockEl.offsetWidth
  dockEl.classList.add('is-alerting')
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => dockEl.classList.remove('is-alerting'), 900)
}

// Feedback, request and navigation run as one flow: the POST starts on click,
// but navigation waits for the feedback (and is capped so it cannot hang).
// The server decides whether this browser keeps its push row while signed out.
let keepPushSubscription = false
const logout = createLogoutFlow({
  request: async () => {
    const response = await fetch('/api/auth/logout', await logoutRequestOptions())
    const data = await response.json().catch(() => ({}))
    keepPushSubscription = response.ok && data.keepPushSubscription === true
    return response
  },
  // The cache, web storage and Cache Storage go, then the protected page is
  // replaced in history so Back cannot restore it.
  navigate: () => completeLogout({ keepPushSubscription }),
  isReducedMotion: prefersReducedMotion,
  onStart: () => {
    leaving.value = true
  },
  onRipple: spawnRipple,
  onFlash: flashDanger,
})
</script>

<template>
  <header ref="dockRoot" class="dock" :class="{ 'is-entering': entering }" data-dock>
    <div class="dock-inner">
      <div class="dock-brand">
        <div class="dock-brand-tile">
          <span class="material-symbols-outlined" aria-hidden="true">{{ brandIcon }}</span>
        </div>
        <span class="dock-title">{{ brandTitle }}</span>
        <span v-if="brandSubtitle" class="dock-subtitle">{{ brandSubtitle }}</span>
        <span v-if="showBrandBadge" class="dock-chip">HR</span>
      </div>

      <nav ref="rail" class="dock-menu" :aria-label="brandTitle">
        <span class="dock-indicator" :style="indicatorStyle" aria-hidden="true"></span>

        <div v-for="section in sections" :key="section.id" class="dock-section">
          <span class="dock-section-label">{{ section.label }}</span>

          <div class="dock-section-items">
            <RouterLink
              v-for="(item, index) in section.items"
              :key="item.to"
              :to="item.to"
              class="dock-item"
              active-class="dock-item-active"
              :aria-label="item.ariaLabel"
              :style="{ '--i': index }"
            >
              <span class="dock-tile">
                <span class="material-symbols-outlined" aria-hidden="true">{{ item.icon }}</span>
                <span v-if="item.badge > 0" class="dock-badge">{{ item.badge }}</span>
              </span>
              <span class="dock-label">{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>

      <button
        ref="logoutButton"
        type="button"
        class="dock-item dock-logout"
        :class="{ 'is-leaving': leaving }"
        :style="{ '--i': itemCount }"
        :disabled="leaving"
        :aria-busy="leaving ? 'true' : 'false'"
        @click="logout"
      >
        <span
          v-if="ripple"
          class="logout-ripple"
          :style="rippleStyle"
          aria-hidden="true"
          @animationend="ripple = null"
        ></span>
        <span class="dock-tile">
          <span class="material-symbols-outlined" aria-hidden="true">{{ leaving ? 'sync' : 'logout' }}</span>
        </span>
        <span class="dock-label">{{ leaving ? 'กำลังออก...' : 'ออกจากระบบ' }}</span>
      </button>
    </div>
  </header>

  <nav class="dock-tabs" aria-label="เมนูหลัก">
    <RouterLink
      v-for="item in primaryItems"
      :key="item.to"
      :to="item.to"
      class="dock-tab"
      active-class="dock-tab-active"
      :aria-label="item.ariaLabel"
    >
      <span class="material-symbols-outlined dock-tab-icon" aria-hidden="true">{{ item.icon }}</span>
      <span class="dock-tab-label">{{ item.label }}</span>
      <span v-if="item.badge > 0" class="dock-tab-badge">{{ item.badge }}</span>
    </RouterLink>

    <button
      ref="menuTab"
      type="button"
      class="dock-tab dock-tab-menu"
      :aria-expanded="sheetOpen ? 'true' : 'false'"
      aria-haspopup="dialog"
      @click="openSheet"
    >
      <span class="material-symbols-outlined dock-tab-icon" aria-hidden="true">menu</span>
      <span class="dock-tab-label">เมนู</span>
    </button>
  </nav>

  <Transition name="dock-sheet">
    <div v-if="sheetOpen" class="dock-sheet-layer">
      <div class="dock-sheet-backdrop" aria-hidden="true" @click="closeSheet"></div>

      <div
        class="dock-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="เมนูทั้งหมด"
        tabindex="-1"
      >
        <div class="dock-sheet-head">
          <div class="dock-sheet-brand">
            <span class="dock-brand-tile">
              <span class="material-symbols-outlined" aria-hidden="true">{{ brandIcon }}</span>
            </span>
            <span class="dock-sheet-title">{{ brandTitle }}</span>
          </div>
          <button
            ref="sheetClose"
            type="button"
            class="dock-sheet-close"
            aria-label="ปิดเมนู"
            @click="closeSheet"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div class="dock-sheet-body">
          <section v-for="section in sections" :key="section.id" class="dock-sheet-section">
            <h2 class="dock-sheet-label">{{ section.label }}</h2>

            <RouterLink
              v-for="item in section.items"
              :key="item.to"
              :to="item.to"
              class="dock-sheet-link"
              active-class="dock-sheet-link-active"
              :aria-label="item.ariaLabel"
              @click="closeSheet"
            >
              <span class="material-symbols-outlined dock-sheet-icon" aria-hidden="true">{{
                item.icon
              }}</span>
              <span class="dock-sheet-text">{{ item.label }}</span>
              <span v-if="item.badge > 0" class="dock-badge dock-sheet-badge">{{ item.badge }}</span>
            </RouterLink>
          </section>
        </div>

        <div class="dock-sheet-foot">
          <button
            type="button"
            class="dock-sheet-logout"
            :class="{ 'is-leaving': leaving }"
            :disabled="leaving"
            :aria-busy="leaving ? 'true' : 'false'"
            @click="logout"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ leaving ? 'sync' : 'logout' }}</span>
            <span>{{ leaving ? 'กำลังออก...' : 'ออกจากระบบ' }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

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

/* ---------- Dock shell: one glass card, 24px radius, inner highlight ---------- */
.dock {
  position: relative;
  z-index: 40;
  padding: 8px 10px;
  border-radius: 24px;
  /* Frosted like every other panel, and on the same tier-driven blur: the tint
     floor (0.95 here) is what keeps the menu labels readable over the scene. */
  background: var(--glass-tint-strong, rgba(255, 255, 255, 0.95));
  -webkit-backdrop-filter: var(--glass-filter, blur(18px));
  backdrop-filter: var(--glass-filter, blur(18px));
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow:
    0 18px 40px -24px rgba(16, 80, 78, 0.45),
    0 2px 8px rgba(16, 80, 78, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

/* The entrance runs only while the one-shot flag is true. */
.dock.is-entering {
  animation: dock-enter 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.dock-inner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

/* ---------- Brand: icon, Thai name and the optional HR chip ---------- */
.dock-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 10px 4px 2px;
}

.dock-brand-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: 13px;
  background: linear-gradient(135deg, #10504e 0%, #176562 100%);
  color: #85f8c4;
  box-shadow:
    0 8px 18px -8px rgba(16, 80, 78, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.dock-brand:hover .dock-brand-tile {
  transform: translateY(-2px) scale(1.05);
}

.dock-brand-tile .material-symbols-outlined {
  font-size: 22px;
}

.dock-title {
  max-width: 110px;
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: #12343b;
}

.dock-subtitle {
  max-width: 120px;
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.3;
  color: #5c7176;
}

.dock-chip {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 6px;
  background: #e7f2f0;
  color: #10504e;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

/* ---------- Menu: labelled groups that wrap, never a sideways rail ---------- */
.dock-menu {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 2px 10px;
  min-width: 0;
  padding: 6px 10px;
  box-sizing: border-box;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(16, 80, 78, 0.055), rgba(16, 80, 78, 0.025));
  box-shadow:
    inset 0 1px 2px rgba(16, 80, 78, 0.07),
    inset 0 -1px 0 rgba(255, 255, 255, 0.8);
}

/* ---------- Items: icon tile above a wrapping Thai label ---------- */
.dock-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 3px;
  flex: 0 0 auto;
  min-width: 50px;
  min-height: 44px;
  max-width: 88px;
  padding: 4px 5px 9px;
  box-sizing: border-box;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: #48615e;
  font-family: inherit;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    background-color 0.2s ease,
    color 0.2s ease;
}

/* Stagger belongs to the one-shot entrance, so it cannot replay on navigation. */
.dock.is-entering .dock-item {
  animation: dock-item-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  animation-delay: calc(var(--i, 0) * 40ms + 120ms);
}

.dock-item:hover {
  transform: translateY(-4px) scale(1.04);
  background: rgba(255, 255, 255, 0.72);
}

.dock-item:active {
  transform: translateY(-1px) scale(0.97);
}

.dock-item:focus-visible {
  outline: 3px solid #0f6f63;
  outline-offset: 2px;
}

.dock-tile {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  border: 1px solid rgba(16, 80, 78, 0.09);
  background: rgba(255, 255, 255, 0.9);
  color: #10504e;
  box-shadow: 0 1px 2px rgba(16, 80, 78, 0.05);
  transition:
    background-color 0.22s ease,
    border-color 0.22s ease,
    color 0.22s ease,
    box-shadow 0.28s ease;
}

.dock-tile .material-symbols-outlined {
  font-size: 20px;
}

.dock-item:hover .dock-tile {
  border-color: #10504e;
  background: #10504e;
  color: #85f8c4;
  box-shadow: 0 8px 18px -8px rgba(16, 80, 78, 0.7);
}

.dock-label {
  max-width: 62px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.15;
  overflow-wrap: anywhere;
  color: inherit;
}

/* Active: filled gradient tile, white icon, bold label, glowing dot below. */
.dock-item-active {
  color: #0f3d3e;
}

.dock-item-active .dock-tile {
  border-color: transparent;
  background: linear-gradient(135deg, #10504e 0%, #1bb193 100%);
  color: #ffffff;
  box-shadow:
    0 8px 18px -8px rgba(27, 177, 147, 0.85),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.dock-item-active .dock-label {
  font-weight: 700;
}

.dock-indicator {
  position: absolute;
  left: 0;
  top: 0;
  width: 26px;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, #10504e, #85f8c4);
  box-shadow:
    0 0 10px rgba(27, 177, 147, 0.8),
    0 0 18px rgba(133, 248, 196, 0.5);
  opacity: 0;
  transform: translate(0, 0);
  transition:
    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease;
  pointer-events: none;
}

/* ---------- Sections: a small Thai heading above each group of items ---------- */
.dock-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 0 3px;
}

.dock-section + .dock-section {
  border-left: 1px solid rgba(16, 80, 78, 0.12);
  padding-left: 8px;
}

.dock-section-label {
  padding: 0 5px;
  color: #5c7176;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.dock-section-items {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
}

/* ---------- Badge: real pending count, absent at zero ---------- */
.dock-badge {
  position: absolute;
  top: -5px;
  right: -7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #e11d48;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 2px 6px rgba(225, 29, 72, 0.45);
}

/* ---------- Logout: red accent, fills red on hover, pressed on click ---------- */
.dock-logout {
  flex: 0 0 auto;
  align-self: center;
  color: #be123c;
}

.dock-logout .dock-tile {
  border-color: rgba(190, 18, 60, 0.14);
  background: #fff1f2;
  color: #be123c;
}

.dock-logout:hover {
  background: rgba(255, 241, 242, 0.9);
}

.dock-logout:hover .dock-tile {
  border-color: #e11d48;
  background: #e11d48;
  color: #ffffff;
  box-shadow: 0 8px 18px -8px rgba(225, 29, 72, 0.75);
}

.dock-logout:active {
  transform: scale(0.92);
}

/* The icon leans into the press; the ripple starts at the pointer. */
.dock-logout:active .dock-tile {
  transform: translateX(3px);
}

/* Pending: red tile, spinning sync icon, Thai loading label. */
.dock-logout.is-leaving {
  opacity: 0.9;
}

.dock-logout.is-leaving .dock-tile {
  border-color: #e11d48;
  background: #e11d48;
  color: #ffffff;
}

.dock-logout.is-leaving .material-symbols-outlined {
  animation: logout-spin 0.8s linear infinite;
}

/* Click ripple: red radial gradient that expands past the button and fades. */
.logout-ripple {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(
    circle,
    rgba(225, 29, 72, 0.55) 0%,
    rgba(225, 29, 72, 0.3) 42%,
    rgba(225, 29, 72, 0) 70%
  );
  transform: scale(0.2);
  animation: logout-ripple 600ms ease-out forwards;
}

/* Dock danger flash, on a pseudo-element so it never fights the entrance. */
.dock::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
}

.dock.is-alerting::after {
  animation: dock-danger 900ms ease-out;
}

/* ---------- Phone tab bar: hidden until the wide bar is gone ---------- */
.dock-tabs {
  display: none;
}

/* ---------- Phone sheet: every section, then logout ---------- */
.dock-sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.dock-sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(11, 28, 24, 0.45);
}

.dock-sheet {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding-bottom: env(safe-area-inset-bottom);
  border-radius: 20px 20px 0 0;
  background: #ffffff;
  box-shadow: 0 -18px 40px -20px rgba(11, 28, 24, 0.5);
  outline: none;
}

.dock-sheet-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid rgba(16, 80, 78, 0.1);
}

.dock-sheet-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1 1 auto;
}

.dock-sheet-title {
  min-width: 0;
  font-size: 13.5px;
  font-weight: 700;
  line-height: 1.35;
  color: #12343b;
  overflow-wrap: anywhere;
}

.dock-sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border: 1px solid rgba(16, 80, 78, 0.12);
  border-radius: 12px;
  background: #f3f8f6;
  color: #10504e;
  cursor: pointer;
}

.dock-sheet-close .material-symbols-outlined {
  font-size: 22px;
}

.dock-sheet-close:focus-visible,
.dock-sheet-link:focus-visible,
.dock-sheet-logout:focus-visible,
.dock-tab:focus-visible {
  outline: 3px solid #0f6f63;
  outline-offset: 2px;
}

.dock-sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 14px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dock-sheet-section + .dock-sheet-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(16, 80, 78, 0.1);
}

.dock-sheet-label {
  margin: 0 0 6px;
  padding: 0 4px;
  color: #5c7176;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.dock-sheet-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 10px;
  border-radius: 12px;
  color: #18564a;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.dock-sheet-link + .dock-sheet-link {
  margin-top: 2px;
}

.dock-sheet-link:active {
  background: #eef6f2;
}

.dock-sheet-link-active {
  background: #10504e;
  color: #ffffff;
}

.dock-sheet-icon {
  font-size: 21px;
  flex: 0 0 auto;
}

.dock-sheet-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.dock-sheet-badge {
  position: static;
  border-color: transparent;
  flex: 0 0 auto;
}

.dock-sheet-foot {
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid rgba(16, 80, 78, 0.1);
  background: #ffffff;
}

.dock-sheet-logout {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  border: 1px solid rgba(190, 18, 60, 0.2);
  border-radius: 12px;
  background: #fff1f2;
  color: #be123c;
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.dock-sheet-logout:disabled {
  opacity: 0.75;
  cursor: progress;
}

.dock-sheet-logout .material-symbols-outlined {
  font-size: 20px;
}

.dock-sheet-logout.is-leaving .material-symbols-outlined {
  animation: logout-spin 0.8s linear infinite;
}

.dock-tab-badge {
  position: absolute;
  top: 4px;
  right: calc(50% - 18px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  box-sizing: border-box;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #e11d48;
  color: #ffffff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
}

/* ---------- Motion ---------- */
.dock-sheet-enter-active,
.dock-sheet-leave-active {
  transition: opacity 0.2s ease;
}

.dock-sheet-enter-active .dock-sheet,
.dock-sheet-leave-active .dock-sheet {
  transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.dock-sheet-enter-from,
.dock-sheet-leave-to {
  opacity: 0;
}

.dock-sheet-enter-from .dock-sheet,
.dock-sheet-leave-to .dock-sheet {
  transform: translateY(100%);
}

@keyframes dock-enter {
  from {
    opacity: 0;
    transform: translateY(-16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes dock-item-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes logout-ripple {
  from {
    transform: scale(0.2);
    opacity: 0.9;
  }
  to {
    transform: scale(3.5);
    opacity: 0;
  }
}

@keyframes logout-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dock-danger {
  0% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(225, 29, 72, 0.5);
  }
  40% {
    opacity: 1;
    box-shadow:
      0 0 0 10px rgba(225, 29, 72, 0.26),
      0 0 30px 4px rgba(225, 29, 72, 0.4);
  }
  100% {
    opacity: 0;
    box-shadow: 0 0 0 16px rgba(225, 29, 72, 0);
  }
}

/* ---------- Phones: bottom tab bar plus sheet, no top menu ---------- */
@media (max-width: 720px) {
  .dock {
    display: none;
  }

  .dock-tabs {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    align-items: stretch;
    box-sizing: border-box;
    height: calc(64px + env(safe-area-inset-bottom));
    padding: 0 4px env(safe-area-inset-bottom);
    /* Frosted on the same tier-driven blur as the dock. */
    background: var(--glass-tint-strong, rgba(255, 255, 255, 0.95));
    -webkit-backdrop-filter: var(--glass-filter, blur(18px));
    backdrop-filter: var(--glass-filter, blur(18px));
    border-top: 1px solid rgba(16, 80, 78, 0.12);
    box-shadow: 0 -10px 26px -20px rgba(16, 80, 78, 0.6);
  }

  .dock-tab {
    position: relative;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 0;
    min-height: 44px;
    padding: 6px 2px;
    box-sizing: border-box;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: #48615e;
    font-family: inherit;
    text-decoration: none;
    cursor: pointer;
  }

  .dock-tab-icon {
    font-size: 22px;
  }

  .dock-tab-label {
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .dock-tab-active {
    color: #0d423f;
  }

  .dock-tab-active .dock-tab-icon {
    color: #10504e;
  }

  /* The same mint indicator as the wide menu, kept above the active tab. */
  .dock-tab-active::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 50%;
    width: 26px;
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, #10504e, #85f8c4);
    box-shadow: 0 0 10px rgba(27, 177, 147, 0.8);
    transform: translateX(-50%);
  }

  .dock-tab-menu[aria-expanded='true'] {
    color: #0d423f;
    background: rgba(16, 80, 78, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dock,
  .dock.is-entering,
  .dock.is-entering .dock-item,
  .dock-indicator,
  .dock-brand-tile,
  .dock-tab,
  .dock-tab-active::before {
    animation: none !important;
    transition: none !important;
  }

  /* No sheet slide, no indicator slide: the change is instant. */
  .dock-sheet-layer,
  .dock-sheet,
  .dock-sheet-enter-active,
  .dock-sheet-leave-active,
  .dock-sheet-enter-active .dock-sheet,
  .dock-sheet-leave-active .dock-sheet {
    transition: none !important;
    animation: none !important;
  }

  .dock-item:hover,
  .dock-item:active,
  .dock-logout:active,
  .dock-logout:active .dock-tile,
  .dock-logout.is-leaving,
  .dock-brand:hover .dock-brand-tile {
    transform: none !important;
  }

  /* No ripple motion, no spinning icon, no dock flash in reduced motion. */
  .logout-ripple {
    display: none !important;
  }

  .dock-logout.is-leaving .material-symbols-outlined,
  .dock-sheet-logout.is-leaving .material-symbols-outlined,
  .dock.is-alerting::after {
    animation: none !important;
  }

  .dock.is-entering .dock-item {
    animation-delay: 0s !important;
  }

  .dock-indicator {
    transition: opacity 0.2s ease !important;
  }
}
</style>
