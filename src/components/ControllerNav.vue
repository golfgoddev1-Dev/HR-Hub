<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getSession, postLogout } from '../api.js'
import { completeLogout } from '../lib/logout.js'
import { navSections } from '../lib/nav-config.js'
import {
  APPROVALS_TTL_MS,
  DATA_KEYS,
  loaders,
  loadShared,
  notificationSettingEnabled,
} from '../lib/shared-data.js'
import { setBadgeAllowed } from '../lib/app-badge.js'
import {
  approvalCount,
  retainApprovalCountSync,
  setApprovalCount,
} from '../lib/approval-count.js'

const route = useRoute()
const logoutBusy = ref(false)
const isApprover = ref(false)
let releaseApprovals = () => {}

// The controller keeps its own sidebar, but the items and the "งานของฉัน" /
// "งานหัวหน้า" groups come from the same config the dock uses. The badge reads
// the shared count, so a decision repaints the sidebar without a reload.
const sections = computed(() =>
  navSections({
    role: 'meeting_controller',
    isApprover: isApprover.value,
    pendingCount: approvalCount.value,
  })
)

function isActive(item) {
  if (item.disabled === true) return false
  return route.path === item.to
}

onMounted(async () => {
  const session = await getSession()
  if (session?.isApprover !== true) {
    // A previous account on this device may have left a number on the icon.
    setBadgeAllowed(false)
    return
  }
  isApprover.value = true

  // The icon badge follows the account's notification setting. Decide before
  // any count paints, so an account with notifications off is cleared here.
  setBadgeAllowed(await notificationSettingEnabled())

  // The controller shell has no dock, so this is the only owner of the check.
  releaseApprovals = retainApprovalCountSync()

  try {
    await loadShared(DATA_KEYS.approvals, loaders.approvals, {
      ttlMs: APPROVALS_TTL_MS,
      onData: (data) => {
        setApprovalCount(Array.isArray(data.results) ? data.results.length : 0)
      },
    })
  } catch {
    setApprovalCount(0)
  }
})

onBeforeUnmount(() => releaseApprovals())

async function logout() {
  if (logoutBusy.value) return
  logoutBusy.value = true
  let keepPushSubscription = false
  try {
    const result = await postLogout()
    keepPushSubscription = result.keepPushSubscription === true
  } finally {
    logoutBusy.value = false
    // A full replace, so the protected page is not kept in history.
    await completeLogout({ keepPushSubscription })
  }
}
</script>

<template>
  <nav class="controller-nav" aria-label="เมนูผู้ควบคุมการประชุม">
    <div v-for="section in sections" :key="section.id" class="nav-section">
      <span class="nav-section-label">{{ section.label }}</span>

      <ul class="nav-list">
        <li v-for="item in section.items" :key="item.to ?? item.label" class="nav-item">
          <RouterLink
            v-if="!item.disabled"
            :to="item.to"
            class="nav-link"
            :class="{ 'nav-link-active': isActive(item) }"
            :aria-label="item.ariaLabel"
          >
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.badge > 0" class="nav-chip nav-chip-badge">{{ item.badge }}</span>
          </RouterLink>

          <span v-else class="nav-link nav-link-disabled" aria-disabled="true">
            <span class="material-symbols-outlined nav-icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
            <span class="nav-chip">เร็ว ๆ นี้</span>
          </span>
        </li>
      </ul>
    </div>

    <ul class="nav-list nav-list-logout">
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

.nav-section + .nav-section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #eef1ef;
}

.nav-section-label {
  display: block;
  padding: 0 12px 4px;
  color: #6b7f79;
  font-family: 'Sarabun', sans-serif;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.nav-list-logout {
  margin-top: auto;
  padding-top: 8px;
}

.nav-chip-badge {
  background: #fef3c7;
  color: #7c2d12;
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
