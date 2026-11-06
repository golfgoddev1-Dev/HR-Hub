<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ControllerNav from './ControllerNav.vue'
import ControllerTopbar from './ControllerTopbar.vue'
import NotificationBanner from './NotificationBanner.vue'
import { homePathByRole } from '../lib/route-access.js'

const NAV_ID = 'controller-nav-panel'

const route = useRoute()
const drawerOpen = ref(false)
// The new-device banner belongs to the landing page of the role only.
const isHome = computed(() => route.path === homePathByRole.meeting_controller)
let restoredOverflow = ''

function closeDrawer() {
  drawerOpen.value = false
}

function toggleDrawer() {
  drawerOpen.value = !drawerOpen.value
}

function onKeydown(event) {
  if (event.key === 'Escape' && drawerOpen.value) closeDrawer()
}

// The drawer locks page scrolling while it is open and always restores the
// value that was there before, so nested overlays keep working.
watch(drawerOpen, (open) => {
  if (open) {
    restoredOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
    return
  }
  document.body.style.overflow = restoredOverflow
  window.removeEventListener('keydown', onKeydown)
})

// Navigating to another page always closes the drawer.
watch(() => route.fullPath, closeDrawer)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (drawerOpen.value) document.body.style.overflow = restoredOverflow
})
</script>

<template>
  <div class="controller-layout">
    <ControllerTopbar
      :menu-expanded="drawerOpen"
      :menu-controls="NAV_ID"
      @toggle-menu="toggleDrawer"
    />

    <div
      class="controller-scrim"
      :class="{ 'is-open': drawerOpen }"
      aria-hidden="true"
      @click="closeDrawer"
    ></div>

    <aside :id="NAV_ID" class="controller-sidebar" :class="{ 'is-open': drawerOpen }">
      <ControllerNav />
    </aside>

    <div class="controller-main">
      <div class="controller-content">
        <NotificationBanner v-if="isHome" />
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');

/* One shared frame for every Meeting Controller page. The two fixed bars and
   the single content max-width keep the menu and the content at the same
   coordinates on every page, at every viewport size. */
.controller-layout {
  /* console palette (used by the dashboard widgets and the topbar) */
  --primary: #004337;
  --primary-container: #105c4d;
  --secondary: #006b56;
  --secondary-container: #98f4d7;
  --on-secondary-container: #00725c;
  --surface: #f3fbf8;
  --surface-low: #edf6f2;
  --surface-container: #e7f0ec;
  --surface-high: #e1eae6;
  --surface-variant: #dce4e1;
  --on-surface: #151d1b;
  --on-surface-variant: #3f4945;
  --outline: #6f7975;
  --outline-variant: #bfc9c4;
  --error: #ba1a1a;
  --error-container: #ffdad6;
  --tertiary-fixed-dim: #eec14b;
  --tertiary-container: #674e00;
  --primary-fixed-dim: #90d4c0;

  /* layout metrics */
  --controller-topbar-height: 64px;
  --controller-sidebar-width: 256px;
  --controller-content-max: 1200px;
  --controller-gutter: 24px;
  --controller-h1-size: 28px;

  box-sizing: border-box;
  min-height: 100vh;
  background: #f4f8f5;
  font-family: 'Sarabun', sans-serif;
  color: var(--on-surface);
}

.controller-sidebar {
  position: fixed;
  top: var(--controller-topbar-height);
  bottom: 0;
  left: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  width: var(--controller-sidebar-width);
  background: #ffffff;
  border-right: 1px solid #e3e8e6;
}

.controller-main {
  box-sizing: border-box;
  min-height: 100vh;
  margin-left: var(--controller-sidebar-width);
  padding: calc(var(--controller-topbar-height) + var(--controller-gutter))
    var(--controller-gutter) calc(var(--controller-gutter) * 2);
}

.controller-content {
  box-sizing: border-box;
  width: 100%;
  max-width: var(--controller-content-max);
  margin: 0 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}

.controller-content > * {
  min-width: 0;
}

/* Pages shared with the dock shells (leave, calendar, profile, PIN) keep their
   own `.content` box. Inside this frame the content wrapper already supplies
   the width and padding, so the page must not add a second, narrower one. */
.controller-content :deep(.content) {
  max-width: none;
  margin: 0;
  padding: 0 0 48px;
}

/* The app shell sets another font on headings and buttons; the Meeting
   Controller console uses Sarabun only, so it is restored here. Scoped
   styles do not reach slotted content, hence :deep(). */
.controller-content :deep(h1),
.controller-content :deep(h2),
.controller-content :deep(h3),
.controller-content :deep(h4),
.controller-content :deep(h5),
.controller-content :deep(h6),
.controller-content :deep(button),
.controller-content :deep(.v-btn) {
  font-family: 'Sarabun', sans-serif;
}

.controller-scrim {
  display: none;
}

/* Tablet and phone: the menu becomes a drawer opened from the topbar button. */
@media (max-width: 1023px) {
  .controller-layout {
    --controller-sidebar-width: min(280px, 85vw);
    --controller-gutter: 20px;
    --controller-h1-size: 26px;
  }

  .controller-main {
    margin-left: 0;
  }

  .controller-sidebar {
    top: var(--controller-topbar-height);
    z-index: 70;
    transform: translateX(-100%);
    visibility: hidden;
    transition: transform 0.22s ease, visibility 0.22s ease;
  }

  .controller-sidebar.is-open {
    transform: translateX(0);
    visibility: visible;
    box-shadow: 0 18px 40px rgba(16, 40, 35, 0.18);
  }

  .controller-scrim {
    display: block;
    position: fixed;
    inset: var(--controller-topbar-height) 0 0;
    z-index: 65;
    background: rgba(11, 28, 24, 0.42);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }

  .controller-scrim.is-open {
    opacity: 1;
    visibility: visible;
  }
}

@media (max-width: 767px) {
  .controller-layout {
    --controller-gutter: 16px;
    --controller-h1-size: 22px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .controller-sidebar,
  .controller-scrim {
    transition: none;
  }
}
</style>
