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
  <header class="leave-nav">
    <div class="nav-inner">
      <!-- Brand Segment with Modern Gradient Icon & Live Indicator -->
      <div class="nav-brand">
        <div class="nav-brand-icon">
          <v-icon icon="beach_access" size="22" />
        </div>
        <div class="nav-title-wrap">
          <span class="nav-title">
            ระบบใบลา
            <span class="live-dot" />
          </span>
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
          <!-- Active Indicator Glow Line -->
          <span class="active-indicator" />
        </RouterLink>

        <!-- Logout Button with Soft Red Accent -->
        <button type="button" class="nav-link nav-logout" @click="logout">
          <v-icon icon="logout" size="18" />
          <span>ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
/* Glassmorphism & Entrance Animation */
.leave-nav {
  position: relative;
  z-index: 20;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid #dfe7e5;
  box-shadow: 0 4px 20px rgba(18, 52, 59, 0.05);
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
  max-width: 1120px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.nav-brand-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #10504e 0%, #28807d 100%);
  color: #85f8c4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(16, 80, 78, 0.22);
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-brand-icon:hover {
  transform: scale(1.05);
}

.nav-title-wrap {
  display: flex;
  flex-direction: column;
}

.nav-title {
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: -0.01em;
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
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-link:hover {
  background: rgba(16, 80, 78, 0.08);
  color: #10504e;
  transform: translateY(-1px);
}

.nav-link-active {
  color: #10504e;
  font-weight: 600;
  background: rgba(16, 80, 78, 0.08);
}

/* Animated Active Indicator Underline */
.active-indicator {
  position: absolute;
  bottom: 0;
  left: 12px;
  right: 12px;
  height: 2.5px;
  background: #10504e;
  border-radius: 999px;
  opacity: 0;
  transform: scaleX(0.4);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-link-active .active-indicator {
  opacity: 1;
  transform: scaleX(1);
  background: linear-gradient(90deg, #10504e 0%, #28807d 100%);
  box-shadow: 0 0 8px rgba(133, 248, 196, 0.6);
}

/* Logout Button Styling */
.nav-logout {
  color: #be123c;
  background: rgba(255, 228, 230, 0.6);
  font-weight: 600;
  margin-left: 4px;
}

.nav-logout:hover {
  background: rgba(255, 228, 230, 1);
  color: #9f1239;
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