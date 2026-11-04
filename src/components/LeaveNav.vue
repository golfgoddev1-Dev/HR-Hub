<script setup>
import { computed, onMounted, ref } from 'vue'

// The approvals tab appears only while this employee has pending requests, so a
// normal employee never sees an approval menu. The page is still guarded on the
// server: hiding a link is convenience, never access control.
const pendingCount = ref(0)

onMounted(async () => {
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
  if (pendingCount.value > 0) {
    list.push({
      label: `รออนุมัติ (${pendingCount.value})`,
      to: '/leave/approvals',
      icon: 'fact_check',
    })
  }
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
  <header class="leave-nav-wrapper">
    <div class="nav-inner">
      <!-- Brand Segment with Gradient Icon & Live Indicator -->
      <div class="nav-brand">
        <div class="nav-brand-badge">
          <v-icon icon="beach_access" size="22" />
        </div>
        <div class="nav-title-box">
          <div class="nav-title-row">
            <span class="nav-title">ระบบใบลา</span>
            <span class="live-dot" />
          </div>
          <span class="nav-subtitle">Employee Leave Portal</span>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="nav-links">
        <RouterLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          active-class="nav-link-active"
        >
          <v-icon :icon="item.icon" size="18" />
          <span>{{ item.label }}</span>
          <!-- Active Glow Underline Indicator -->
          <span class="active-underline" />
        </RouterLink>

        <div class="nav-divider" />

        <!-- Logout Button with Soft Red Accent -->
        <button type="button" class="nav-link nav-logout" @click="logout">
          <v-icon icon="logout" size="16" />
          <span>ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
/* Glassmorphism & Modern Header Container */
.leave-nav-wrapper {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 16px;
  border: 1px solid rgba(223, 231, 229, 0.8);
  box-shadow: 0 4px 20px rgba(18, 52, 59, 0.05);
  margin: 16px auto;
  max-width: 1120px;
  animation: navEntrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes navEntrance {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.nav-inner {
  padding: 12px 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.nav-brand-badge {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #10504e 0%, #28807d 100%);
  color: #85f8c4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(16, 80, 78, 0.2);
  transition: transform 0.25s ease;
}

.nav-brand-badge:hover {
  transform: scale(1.05);
}

.nav-title-box {
  display: flex;
  flex-direction: column;
}

.nav-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-title {
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* Pulsing Live Dot */
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10504e;
  box-shadow: 0 0 6px rgba(16, 80, 78, 0.6);
  animation: pulseDot 2s ease-in-out infinite;
}

@keyframes pulseDot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.75); opacity: 0.5; }
}

.nav-subtitle {
  font-size: 11px;
  font-weight: 500;
  color: #5c7176;
}

.nav-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  color: #5c7176;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
}

.nav-link:hover {
  background: rgba(231, 242, 240, 0.8);
  color: #10504e;
}

.nav-link-active {
  color: #10504e !important;
  font-weight: 600;
  background: rgba(231, 242, 240, 0.8);
}

/* Mint Glow Underline Indicator */
.active-underline {
  position: absolute;
  bottom: 0;
  left: 12px;
  right: 12px;
  height: 2.5px;
  background: #85f8c4;
  border-radius: 999px;
  box-shadow: 0 0 8px #85f8c4;
  opacity: 0;
  transform: scaleX(0.4);
  transition: all 0.25s ease;
}

.nav-link-active .active-underline {
  opacity: 1;
  transform: scaleX(1);
}

.nav-divider {
  width: 1px;
  height: 20px;
  background: #dfe7e5;
  margin: 0 4px;
}

/* Logout Button Styling */
.nav-logout {
  color: #be123c !important;
  background: #fff1f2;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.nav-logout:hover {
  background: #ffe4e6 !important;
  color: #9f1239 !important;
  transform: translateY(-1px);
}

.nav-logout:active {
  transform: scale(0.97);
}

@media (max-width: 720px) {
  .nav-subtitle {
    display: none;
  }
}
</style>