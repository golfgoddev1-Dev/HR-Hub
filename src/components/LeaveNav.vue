<script setup>
import { computed, onMounted, ref } from 'vue'
import { getSession } from '../api.js'
import { approvalsMenuItem } from '../lib/leave-nav-items.js'

// The approvals tab belongs to every active approver, even with an empty queue.
// /api/auth/me carries the read-only `isApprover` signal; the pending count only
// decides the badge. The route itself still answers 403 to a non-approver, so
// hiding the link is convenience, never access control.
const isApprover = ref(false)
const pendingCount = ref(0)

onMounted(async () => {
  const session = await getSession()
  isApprover.value = session?.isApprover === true
  if (!isApprover.value) return

  try {
    const response = await fetch('/api/leave/approvals', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    pendingCount.value = Array.isArray(data.results) ? data.results.length : 0
  } catch {
    pendingCount.value = 0
  }
})

const items = computed(() => {
  const list = [
    { label: 'ใบลาของฉัน', to: '/leave', icon: 'event_note' },
    { label: 'ยื่นใบลา', to: '/leave/new', icon: 'edit_calendar' },
    { label: 'เปลี่ยน PIN', to: '/change-pin', icon: 'password' },
  ]
  const approvals = approvalsMenuItem({
    isApprover: isApprover.value,
    pendingCount: pendingCount.value,
  })
  if (approvals) list.push(approvals)
  return list
})

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // ignore: navigation still happens
  }
  window.location.assign('/login')
}
</script>

<template>
  <header class="leave-nav">
    <!-- Top Ambient Accent Line -->
    <div class="nav-accent-glow" aria-hidden="true"></div>

    <div class="nav-inner">
      <div class="nav-brand">
        <div class="brand-icon-wrap">
          <span class="material-symbols-outlined brand-icon">beach_access</span>
        </div>
        <div class="brand-text">
          <span class="nav-title">ระบบใบลา</span>
          <span class="live-pulse" title="ออนไลน์"></span>
        </div>
      </div>

      <nav class="nav-links">
        <RouterLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          active-class="nav-link-active"
        >
          <span class="material-symbols-outlined link-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <span v-if="item.badge > 0" class="nav-badge">{{ item.badge }}</span>
        </RouterLink>

        <button type="button" class="nav-link nav-logout" @click="logout">
          <span class="material-symbols-outlined link-icon">logout</span>
          <span>ออกจากระบบ</span>
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

.brand-icon {
  font-size: 22px;
}

.link-icon {
  font-size: 18px;
}

/* Pending approvals count, shown only while the queue is not empty. */
.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #10504e;
  color: #85f8c4;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

/* 1. Header Surface & Premium Glassmorphism */
.leave-nav {
  position: relative;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  color: #0b1c30;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow:
    0 10px 30px -10px rgba(15, 33, 55, 0.08),
    0 2px 6px rgba(15, 33, 55, 0.02);
  z-index: 50;
  overflow: hidden;
}

/* 2. Top Prismatic Ambient Accent Glow Line */
.nav-accent-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(
    90deg,
    rgba(16, 80, 78, 0) 0%,
    rgba(16, 80, 78, 0.7) 25%,
    rgba(133, 248, 196, 0.95) 50%,
    rgba(40, 128, 125, 0.7) 75%,
    rgba(16, 80, 78, 0) 100%
  );
  background-size: 200% 100%;
  animation: glowSweep 8s ease-in-out infinite alternate;
}

@keyframes glowSweep {
  0% { background-position: 0% 50%; opacity: 0.7; }
  100% { background-position: 100% 50%; opacity: 1; }
}

.nav-inner {
  padding: 12px 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

/* 3. Brand Identity with Tactile Hover Pop */
.nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  user-select: none;
}

.brand-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #10504e 0%, #176562 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #85f8c4;
  box-shadow: 0 4px 14px rgba(16, 80, 78, 0.25);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s ease;
}

.nav-brand:hover .brand-icon-wrap {
  transform: scale(1.08) rotate(4deg);
  box-shadow: 0 6px 18px rgba(16, 80, 78, 0.35);
}

.brand-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-title {
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.live-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10504e;
  box-shadow: 0 0 8px rgba(16, 80, 78, 0.6);
  animation: pulseDot 2s ease-in-out infinite;
}

@keyframes pulseDot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.75); opacity: 0.4; }
}

/* 4. Navigation Links Grid & Actions */
.nav-links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.nav-link {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 10px;
  color: #48615e;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-link::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.4) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  transform: skewX(-20deg);
  pointer-events: none;
  opacity: 0;
}

.nav-link:hover {
  background: rgba(16, 80, 78, 0.05);
  color: #10504e;
  transform: translateY(-1.5px);
}

.nav-link:hover::after {
  opacity: 1;
  animation: navSheen 0.65s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.nav-link:active {
  transform: translateY(0) scale(0.98);
}

/* Active State */
.nav-link-active {
  background: #f0f7f6;
  border-color: #d1e5e2;
  color: #10504e;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(16, 80, 78, 0.06);
}

.nav-link-active::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 20%;
  right: 20%;
  height: 2px;
  border-radius: 999px;
  background: #10504e;
  box-shadow: 0 0 6px rgba(16, 80, 78, 0.4);
}

/* Logout Button */
.nav-logout {
  color: #ba1a1a;
  background: rgba(186, 26, 26, 0.05);
  border: 1px solid rgba(186, 26, 26, 0.15);
  margin-left: 6px;
}

.nav-logout:hover {
  background: rgba(186, 26, 26, 0.12);
  border-color: rgba(186, 26, 26, 0.3);
  color: #93000a;
  box-shadow: 0 4px 12px rgba(186, 26, 26, 0.12);
}

.nav-logout:hover::after {
  display: none;
}

@keyframes navSheen {
  0% { left: -100%; }
  100% { left: 200%; }
}

@media (max-width: 720px) {
  .nav-title { display: none; }
  .nav-inner { padding: 10px 16px; }
  .nav-link { padding: 7px 10px; font-size: 13px; }
}

@media (prefers-reduced-motion: reduce) {
  .nav-accent-glow, .live-pulse { animation: none !important; }
  .nav-link, .brand-icon-wrap { transition: none !important; }
}
</style>