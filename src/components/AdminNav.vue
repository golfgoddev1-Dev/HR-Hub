<script setup>
// Same shell as AppDock.vue. Only /admin exists today, so the
// other two items are disabled labels: no to/href may point at a missing page.
import { completeLogout, logoutRequestOptions } from '../lib/logout.js'
defineProps({
  sections: { type: Array, required: true },
})

async function logout() {
  try {
    await fetch('/api/auth/logout', await logoutRequestOptions())
  } catch {
    // ignore: navigation still happens
  }
  // Drop every cached read and the browser's copies, then replace this page.
  await completeLogout()
}
</script>

<template>
  <header class="admin-nav">
    <div class="nav-inner">
      <div class="nav-brand">
        <span class="material-symbols-outlined brand-icon">admin_panel_settings</span>
        <span class="nav-title">ผู้ดูแลระบบ</span>
      </div>

      <nav class="nav-links">
        <div v-for="section in sections" :key="section.id" class="nav-section">
          <span class="nav-section-label">{{ section.label }}</span>

          <div class="nav-section-items">
            <template v-for="item in section.items" :key="item.to ?? item.label">
              <RouterLink
                v-if="!item.disabled"
                :to="item.to"
                class="nav-link"
                active-class="nav-link-active"
                :aria-label="item.ariaLabel"
              >
                <span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
                <span v-if="item.badge > 0" class="nav-badge">{{ item.badge }}</span>
              </RouterLink>

              <span
                v-else
                class="nav-link nav-link-disabled"
                aria-disabled="true"
                title="เร็วๆ นี้"
              >
                <span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
                <span class="nav-badge">เร็วๆ นี้</span>
              </span>
            </template>
          </div>
        </div>

        <button type="button" class="nav-link nav-logout" @click="logout">
          <span class="material-symbols-outlined nav-icon">logout</span>
          <span>ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.admin-nav {
  background: #0f3d3e;
  color: #f5fbf9;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.12);
}

.nav-inner {
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
  gap: 10px;
  align-items: flex-end;
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.nav-section-label {
  padding: 0 12px;
  color: #a9cbc4;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.nav-section-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.brand-icon {
  font-size: 22px;
  line-height: 1;
}

.nav-icon {
  font-family: 'Material Symbols Outlined';
  font-size: 18px;
  line-height: 1;
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

.nav-link-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.nav-link-disabled:hover {
  background: none;
  color: #d8ece8;
}

.nav-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
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
