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
      <div class="nav-brand">
        <v-icon icon="beach_access" size="22" />
        <span class="nav-title">ระบบใบลา</span>
      </div>

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
        </RouterLink>

        <button type="button" class="nav-link nav-logout" @click="logout">
          <v-icon icon="logout" size="18" />
          <span>ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.leave-nav {
  background: #0f3d3e;
  color: #f5fbf9;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
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
  gap: 8px;
  min-width: 0;
}

.nav-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #d8ece8;
  font-size: 14px;
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.nav-link:hover,
.nav-link-active {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
}

.nav-logout {
  opacity: 0.9;
}

@media (max-width: 720px) {
  .nav-title {
    display: none;
  }
}
</style>
