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
  { label: 'ข้อมูลย้อนหลัง', to: '', icon: 'history', ready: false },
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
          <span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>

        <span v-else class="nav-link nav-link-disabled" aria-disabled="true">
          <span class="material-symbols-outlined nav-icon">{{ item.icon }}</span>
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
          <span class="material-symbols-outlined nav-icon">logout</span>
          <span class="nav-label">{{ logoutBusy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ' }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.controller-nav {
  flex: 0 0 252px;
  width: 252px;
  font-family: 'IBM Plex Sans Thai', sans-serif;
}

.nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 10px;
  list-style: none;
  background: #ffffff;
  border: 1px solid #e3e8e6;
  border-radius: 18px;
  box-shadow: 0 10px 24px rgba(16, 40, 35, 0.06);
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

@media (max-width: 900px) {
  .controller-nav {
    flex: 1 1 auto;
    width: 100%;
  }

  .nav-list {
    flex-direction: row;
    flex-wrap: wrap;
    padding: 8px;
  }

  .nav-item {
    flex: 1 1 auto;
  }

  .nav-item-logout {
    margin-top: 0;
    padding-top: 0;
    border-top: 0;
  }
}
</style>
