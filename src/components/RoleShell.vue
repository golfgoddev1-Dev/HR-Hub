<script setup>
// One parent route for every page a signed-in user can open, so the shell is
// chosen by the signed-in role rather than by the URL. A meeting controller
// stays inside the controller sidebar on /leave, and an HR user stays inside the
// HR dock; moving between pages only swaps the routed page below the nav.
import { computed, onMounted, ref } from 'vue'
import AppLayout from './AppLayout.vue'
import ControllerShell from './ControllerShell.vue'
import { getSession } from '../api.js'
import { peekCached } from '../lib/data-cache.js'
import { DATA_KEYS } from '../lib/shared-data.js'

const NAV_BY_ROLE = {
  employee: 'leave',
  hr: 'hr',
  system_admin: 'admin',
}

// The router guard has already loaded the session, so the cached value is here
// synchronously: the first paint is the correct shell, never a swap.
const session = ref(peekCached(DATA_KEYS.session) ?? null)
const role = computed(() => session.value?.role ?? '')

onMounted(async () => {
  const current = await getSession()
  if (current) session.value = current
})
</script>

<template>
  <ControllerShell v-if="role === 'meeting_controller'" />
  <AppLayout v-else :nav="NAV_BY_ROLE[role] ?? 'leave'" />
</template>
