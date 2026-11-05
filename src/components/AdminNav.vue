<script setup>
// Same shell as AppDock.vue. Only /admin exists today, so the
// other two items are disabled labels: no to/href may point at a missing page.
const disabledItems = [
  { label: 'จัดการผู้ใช้', icon: 'manage_accounts' },
  { label: 'ตั้งค่าระบบ', icon: 'settings' },
]

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
  <header class="admin-nav">
    <div class="nav-inner">
      <div class="nav-brand">
        <v-icon icon="admin_panel_settings" size="22" />
        <span class="nav-title">ผู้ดูแลระบบ</span>
      </div>

      <nav class="nav-links">
        <RouterLink to="/admin" class="nav-link" active-class="nav-link-active">
          <v-icon icon="space_dashboard" size="18" />
          <span>ภาพรวมผู้ดูแล</span>
        </RouterLink>

        <RouterLink
          to="/admin/permissions"
          class="nav-link"
          active-class="nav-link-active"
        >
          <span class="material-symbols-outlined nav-icon">manage_accounts</span>
          <span>สิทธิ์ผู้ใช้</span>
        </RouterLink>

        <span
          v-for="item in disabledItems"
          :key="item.label"
          class="nav-link nav-link-disabled"
          aria-disabled="true"
          title="เร็วๆ นี้"
        >
          <v-icon :icon="item.icon" size="18" />
          <span>{{ item.label }}</span>
          <span class="nav-badge">เร็วๆ นี้</span>
        </span>

        <button type="button" class="nav-link nav-logout" @click="logout">
          <v-icon icon="logout" size="18" />
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
  gap: 4px;
  align-items: center;
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
