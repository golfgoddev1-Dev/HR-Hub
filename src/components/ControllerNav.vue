<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { postLogout } from '../api.js'

const route = useRoute()
const router = useRouter()
const logoutBusy = ref(false)

const items = [
  { label: 'หน้าหลัก', to: '/meeting/controller', icon: 'dashboard', ready: true },
  { label: 'QR และรอบประชุม', to: '/meeting/controller/qr', icon: 'qr_code_2', ready: true },
  { label: 'รายชื่อประชุม', to: '/meeting/controller/roster', icon: 'groups', ready: true },
  { label: 'จัดการข้อมูลพนักงาน', to: '/meeting/controller/employees', icon: 'manage_accounts', ready: true },
  { label: 'ผู้เข้าร่วม', to: '/meeting/controller/registrants', icon: 'badge', ready: true },
  { label: 'ข้อมูลย้อนหลัง', to: '/meeting/controller/backfill', icon: 'history', ready: true },
  { label: 'นำเข้าข้อมูลย้อนหลัง', to: '/meeting/controller/backfill/import', icon: 'upload_file', ready: true },
  { label: 'แดชบอร์ด', to: '/meeting/controller/dashboard', icon: 'insights', ready: true },
]

function isActive(item) {
  if (!item.ready) return false
  return route.path === item.to
}

async function logout() {
  if (logoutBusy.value) return
  logoutBusy.value = true
  try {
    await postLogout()
  } finally {
    logoutBusy.value = false
    router.replace('/login')
  }
}
</script>

<template>
  <nav class="controller-nav" aria-label="เมนูผู้ควบคุมการประชุม">
    <ul class="nav-list">
      <li v-for="item in items" :key="item.label" class="nav-item">
        <RouterLink
          v-if="item.ready"
          :to="item.to"
          class="nav-link"
          :class="{ 'nav-link-active': isActive(item) }"
        >
          <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>

        <span v-else class="nav-link nav-link-disabled" aria-disabled="true">
          <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-chip">เร็ว ๆ นี้</span>
        </span>
      </li>

      <li class="nav-item nav-item-logout">
        <button
          type="button"
          class="nav-link nav-logout"
          :disabled="logoutBusy"
          @click="logout"
        >
          <span class="material-symbols-outlined nav-icon" aria-hidden="true">logout</span>
          <span class="nav-label">{{ logoutBusy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ' }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

/* The nav no longer sizes itself: it fills the sidebar/drawer box that
   ControllerLayout owns, and scrolls on its own when the list is taller
   than the viewport. */
.controller-nav {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-family: 'Sarabun', sans-serif;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav-item {
  display: flex;
}

.nav-link {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 12px;
  color: #18564a;
  font-family: 'Sarabun', sans-serif;
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}

.nav-link:hover {
  background: #eef6f2;
  color: #115447;
}

.nav-link-active {
  background: #176c5b;
  color: #ffffff;
}

.nav-link-active:hover {
  background: #115447;
  color: #ffffff;
}

.nav-link-disabled {
  color: #9aa8a3;
  cursor: default;
  flex-wrap: wrap;
}

.nav-link-disabled:hover {
  background: transparent;
  color: #9aa8a3;
}

.nav-icon {
  font-size: 21px;
  line-height: 1;
}

.nav-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.nav-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: #f1f4f2;
  color: #7c8b86;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.nav-logout {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.nav-logout:disabled {
  cursor: progress;
  opacity: 0.7;
}

.nav-item-logout {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid #eef1ef;
}
</style>
