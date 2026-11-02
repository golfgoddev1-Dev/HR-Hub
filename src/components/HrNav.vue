<script setup>
const navItems = [
  { label: 'รายชื่อพนักงาน', to: '/hr/employees', icon: 'groups' },
  { label: 'นำเข้าพนักงาน', to: '/hr/employees/import', icon: 'upload_file' },
  { label: 'จัดการข้อมูลพนักงาน', to: '/hr/employees/manage', icon: 'edit' },
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
  <header class="hr-nav">
    <div class="nav-inner">
      <div class="nav-brand">
        <v-icon icon="groups" size="22" />
        <span class="nav-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
        <span class="nav-badge">HR</span>
      </div>

      <nav class="nav-links">
        <RouterLink
          v-for="item in navItems"
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
.hr-nav {
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

.nav-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.16);
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
