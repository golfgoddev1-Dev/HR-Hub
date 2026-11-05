<script setup>
// The shell for both persistent layout routes. It owns the dock (so the dock
// mounts once per system and survives page changes) and the approvals lookup
// (so pages no longer fetch it), then renders the matched page below.
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AdminNav from './AdminNav.vue'
import AppDock from './AppDock.vue'
import { getSession } from '../api.js'
import { approvalsMenuItem } from '../lib/leave-nav-items.js'
import { hrNavItems, leaveNavItems } from '../lib/nav-config.js'
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

// /leave/calendar is reachable by HR and then shows the HR dock. The route says
// so through meta.hrDock, so the page itself never chooses a shell.
const dockNav = computed(() => {
  if (route.meta.hrDock === true && session.value?.role === 'hr') return 'hr'
  return props.nav
})

const isHrDock = computed(() => dockNav.value === 'hr')

const items = computed(() => {
  if (props.nav === 'admin') return []
  if (isHrDock.value) return hrNavItems()

  const list = leaveNavItems()
  const approvals = approvalsMenuItem({
    isApprover: isApprover.value,
    pendingCount: pendingCount.value,
  })
  if (approvals) list.push(approvals)
  return list
})

const brand = computed(() =>
  isHrDock.value
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
  if (!isApprover.value || props.nav !== 'leave') return

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
      <AdminNav v-if="nav === 'admin'" />
      <AppDock
        v-else
        :brand-icon="brand.icon"
        :brand-title="brand.title"
        :brand-subtitle="brand.subtitle"
        :items="items"
        :show-brand-badge="brand.badge"
      />
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
</style>
