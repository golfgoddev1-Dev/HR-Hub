<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getSession } from '../api.js'
import { approvalsMenuItem } from '../lib/leave-nav-items.js'

// The approvals tab belongs to every active approver, even with an empty queue.
// /api/auth/me carries the read-only `isApprover` signal; the pending count only
// decides the badge. The route itself still answers 403 to a non-approver, so
// hiding the link is convenience, never access control.
const isApprover = ref(false)
const pendingCount = ref(0)
const leaving = ref(false)

const route = useRoute()
const rail = ref(null)
const hasOverflow = ref(false)
const dot = ref({ x: 0, visible: false })

// Width of the glowing dot under the active item; the rest comes from measuring.
const DOT_WIDTH = 26
let observer = null

const items = computed(() => {
  const list = [
    { label: 'ใบลาของฉัน', to: '/leave', icon: 'event_note' },
    { label: 'ยื่นใบลา', to: '/leave/new', icon: 'edit_calendar' },
    { label: 'ปฏิทินการลา', to: '/leave/calendar', icon: 'calendar_month' },
    { label: 'ข้อมูลส่วนตัว', to: '/profile', icon: 'person' },
    { label: 'เปลี่ยน PIN', to: '/change-pin', icon: 'password' },
  ]
  const approvals = approvalsMenuItem({
    isApprover: isApprover.value,
    pendingCount: pendingCount.value,
  })
  if (approvals) list.push(approvals)
  return list
})

// The one indicator: its x comes from the active element, never from a constant.
const indicatorStyle = computed(() => ({
  transform: `translateX(${dot.value.x}px)`,
  opacity: dot.value.visible ? '1' : '0',
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

/** Centres the dot under whichever item the router marked active. */
function measure() {
  const railEl = rail.value
  if (!railEl) return
  hasOverflow.value = railEl.scrollWidth - railEl.clientWidth > 2

  const active = activeItem()
  if (!active) {
    dot.value = { x: 0, visible: false }
    return
  }
  dot.value = {
    x: active.offsetLeft + (active.offsetWidth - DOT_WIDTH) / 2,
    visible: true,
  }
}

/** Brings a newly opened item into the middle of the narrow, scrolling rail. */
function revealActive() {
  const railEl = rail.value
  if (!railEl || railEl.scrollWidth - railEl.clientWidth <= 2) return
  const active = activeItem()
  if (!active) return
  railEl.scrollTo({
    left: Math.max(0, active.offsetLeft - (railEl.clientWidth - active.offsetWidth) / 2),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
}

onMounted(async () => {
  await nextTick()
  measure()
  window.addEventListener('resize', measure)
  if (typeof ResizeObserver !== 'undefined' && rail.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(rail.value)
  }
  document.fonts?.ready?.then(measure).catch(() => {})

  const session = await getSession()
  isApprover.value = session?.isApprover === true
  if (!isApprover.value) return

  try {
    const response = await fetch('/api/leave/approvals', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    pendingCount.value = Array.isArray(data.results) ? data.results.length : 0
  } catch {
    pendingCount.value = 0
  } finally {
    await nextTick()
    measure()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  observer?.disconnect()
  observer = null
})

watch(
  () => route.path,
  () =>
    nextTick(() => {
      measure()
      revealActive()
    })
)

watch(
  () => items.value.length,
  () => nextTick(measure)
)

async function logout() {
  if (leaving.value) return
  leaving.value = true
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // ignore: navigation still happens
  }
  window.location.assign('/login')
}
</script>

<template>
  <header class="dock">
    <div class="dock-inner">
      <div class="dock-brand">
        <div class="dock-brand-tile">
          <span class="material-symbols-outlined">beach_access</span>
        </div>
        <span class="dock-title">ระบบใบลา</span>
        <span class="dock-live" title="ออนไลน์" aria-hidden="true"></span>
      </div>

      <nav
        ref="rail"
        class="dock-rail"
        :class="{ 'is-scrollable': hasOverflow }"
        aria-label="เมนูใบลา"
      >
        <span class="dock-indicator" :style="indicatorStyle" aria-hidden="true"></span>

        <RouterLink
          v-for="(item, index) in items"
          :key="item.to"
          :to="item.to"
          class="dock-item"
          active-class="dock-item-active"
          :aria-label="item.ariaLabel"
          :style="{ '--i': index }"
        >
          <span class="dock-tile">
            <span class="material-symbols-outlined">{{ item.icon }}</span>
            <span v-if="item.badge > 0" class="dock-badge">{{ item.badge }}</span>
          </span>
          <span class="dock-label">{{ item.label }}</span>
        </RouterLink>

        <span class="dock-divider" aria-hidden="true"></span>

        <button
          type="button"
          class="dock-item dock-logout"
          :class="{ 'is-leaving': leaving }"
          :style="{ '--i': items.length }"
          :disabled="leaving"
          :aria-busy="leaving ? 'true' : 'false'"
          @click="logout"
        >
          <span class="dock-tile">
            <span class="material-symbols-outlined">logout</span>
          </span>
          <span class="dock-label">ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

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
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow:
    0 18px 40px -24px rgba(16, 80, 78, 0.45),
    0 2px 8px rgba(16, 80, 78, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  animation: dock-enter 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.dock-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* ---------- Brand: existing icon and Thai name ---------- */
.dock-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 0 10px 0 2px;
  border-right: 1px solid rgba(16, 80, 78, 0.1);
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
  max-width: 150px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: #12343b;
}

.dock-live {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #10504e;
  box-shadow: 0 0 8px rgba(16, 80, 78, 0.6);
  animation: pulse-dot 2s ease-in-out infinite;
}

/* ---------- Rail: the soft inset tray the items sit in ---------- */
.dock-rail {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: safe center;
  gap: 1px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 8px 4px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(16, 80, 78, 0.055), rgba(16, 80, 78, 0.025));
  box-shadow:
    inset 0 1px 2px rgba(16, 80, 78, 0.07),
    inset 0 -1px 0 rgba(255, 255, 255, 0.8);
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}

.dock-rail::-webkit-scrollbar {
  display: none;
}

/* Fades the edge that has hidden items behind it. */
.dock-rail.is-scrollable {
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent 0,
    #000 16px,
    #000 calc(100% - 16px),
    transparent 100%
  );
  mask-image: linear-gradient(
    90deg,
    transparent 0,
    #000 16px,
    #000 calc(100% - 16px),
    transparent 100%
  );
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
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: #48615e;
  font-family: inherit;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  scroll-snap-align: center;
  transition:
    transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    background-color 0.2s ease,
    color 0.2s ease;
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
  bottom: 2px;
  width: 26px;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, #10504e, #85f8c4);
  box-shadow:
    0 0 10px rgba(27, 177, 147, 0.8),
    0 0 18px rgba(133, 248, 196, 0.5);
  opacity: 0;
  transform: translateX(0);
  transition:
    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease;
  pointer-events: none;
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

.dock-divider {
  flex: 0 0 auto;
  width: 1px;
  margin: 6px 4px;
  align-self: stretch;
  border-radius: 999px;
  background: linear-gradient(180deg, transparent, rgba(16, 80, 78, 0.18), transparent);
}

/* ---------- Logout: red accent, fills red on hover, pressed on click ---------- */
.dock-logout {
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
  transform: scale(0.94);
}

.dock-logout.is-leaving {
  opacity: 0.7;
  transform: scale(0.96);
}

/* ---------- Motion ---------- */
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

@keyframes pulse-dot {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.75);
    opacity: 0.4;
  }
}

/* ---------- Narrow: one scrolling row of items, no page-level scroll ---------- */
@media (max-width: 720px) {
  .dock {
    padding: 6px 8px;
    border-radius: 20px;
  }

  .dock-inner {
    gap: 6px;
  }

  .dock-brand {
    padding-right: 0;
    border-right: 0;
  }

  .dock-title,
  .dock-live {
    display: none;
  }

  .dock-brand-tile {
    width: 36px;
    height: 36px;
    border-radius: 11px;
  }

  .dock-rail {
    justify-content: flex-start;
    scroll-snap-type: x mandatory;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dock,
  .dock-item,
  .dock-live,
  .dock-indicator,
  .dock-brand-tile {
    animation: none !important;
    transition: none !important;
  }

  .dock-item:hover,
  .dock-item:active,
  .dock-logout:active,
  .dock-logout.is-leaving,
  .dock-brand:hover .dock-brand-tile {
    transform: none !important;
  }

  .dock-item {
    animation-delay: 0s !important;
  }

  .dock-indicator {
    transition: opacity 0.2s ease !important;
  }
}
</style>
