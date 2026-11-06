<script setup>
// The dock/admin shell drawn by RoleShell. It owns the dock (so the dock mounts
// once per system and survives page changes) and the approvals lookup (so pages
// no longer fetch it), then renders the matched page below.
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AdminNav from './AdminNav.vue'
import AppDock from './AppDock.vue'
import NotificationBanner from './NotificationBanner.vue'
import { getSession } from '../api.js'
import { navSections } from '../lib/nav-config.js'
import { homePathByRole } from '../lib/route-access.js'
import { APPROVALS_TTL_MS, DATA_KEYS, loaders, loadShared } from '../lib/shared-data.js'

const props = defineProps({
  nav: {
    type: String,
    default: 'leave',
    validator: (value) => ['leave', 'hr', 'admin'].includes(value),
  },
})

const route = useRoute()
const session = ref(null)
const isApprover = ref(false)
const pendingCount = ref(0)

// RoleShell passes the nav for the signed-in role, so the menu is the same on
// every page that role can open: an HR user on /leave still sees both
// "งานของฉัน" and "งาน HR".
const sessionRole = computed(() => {
  if (props.nav === 'admin') return 'system_admin'
  if (typeof session.value?.role === 'string') return session.value.role
  return props.nav === 'hr' ? 'hr' : 'employee'
})

const sections = computed(() =>
  navSections({
    role: sessionRole.value,
    isApprover: isApprover.value,
    pendingCount: pendingCount.value,
  })
)

// The dock shows the phone tab bar for the two roles it serves; the admin menu
// is a separate component.
const dockRole = computed(() => (sessionRole.value === 'hr' ? 'hr' : 'employee'))

// The new-device banner belongs to the landing page of the role only.
const isHome = computed(() => route.path === homePathByRole[sessionRole.value])

const brand = computed(() =>
  props.nav === 'hr'
    ? { icon: 'groups', title: 'ระบบบริการงานบุคคลและสวัสดิการพนักงาน', subtitle: '', badge: true }
    : { icon: 'beach_access', title: 'ระบบใบลา', subtitle: '', badge: false }
)

// One session read and one approvals read for the whole system, not per page.
// Both are cached, so the leave pages that show the same numbers read these
// values instead of asking the Worker again.
onMounted(async () => {
  const current = await getSession()
  session.value = current
  isApprover.value = current?.isApprover === true
  if (!isApprover.value) return

  try {
    await loadShared(DATA_KEYS.approvals, loaders.approvals, {
      ttlMs: APPROVALS_TTL_MS,
      onData: (data) => {
        pendingCount.value = Array.isArray(data.results) ? data.results.length : 0
      },
    })
  } catch {
    pendingCount.value = 0
  }
})
</script>

<template>
  <div class="app-layout">
    <div class="app-layout-inner">
      <AdminNav v-if="nav === 'admin'" :sections="sections" />
      <AppDock
        v-else
        :brand-icon="brand.icon"
        :brand-title="brand.title"
        :brand-subtitle="brand.subtitle"
        :sections="sections"
        :show-brand-badge="brand.badge"
        :role="dockRole"
      />
      <NotificationBanner v-if="isHome" />
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: #f3f6f5;
  overflow-x: hidden;
}

/* Same 1120px box, centring and single padding for every route: the dock is the
   first child, so its x/y/width no longer depends on the page around it. */
.app-layout-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px 20px 0;
  box-sizing: border-box;
}

/* Phones: the dock becomes a fixed bottom bar, so the page reserves its height
   (plus the device safe area) and no content hides underneath it. */
@media (max-width: 720px) {
  .app-layout-inner {
    padding: 12px 14px 0;
    padding-bottom: calc(64px + env(safe-area-inset-bottom) + 16px);
  }
}
</style>
