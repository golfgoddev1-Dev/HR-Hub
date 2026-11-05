<script setup>
// HR opens this page with the HR bar; employee and approver get the leave bar.
// Both are positioned by AppLayout, so the bar keeps the same place.
import { computed, onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import LeaveCalendarView from '../components/LeaveCalendarView.vue'
import { getSession } from '../api.js'

const role = ref('')
const ready = ref(false)

const isHr = computed(() => role.value === 'hr')
const nav = computed(() => (isHr.value ? 'hr' : 'leave'))

onMounted(async () => {
  const session = await getSession()
  role.value = typeof session?.role === 'string' ? session.role : ''
  ready.value = true
})
</script>

<template>
  <AppLayout :nav="nav">
    <main class="content">
      <LeaveCalendarView v-if="ready" :is-hr="isHr" />
      <p v-else class="hint">กำลังโหลด…</p>
    </main>
  </AppLayout>
</template>

<style scoped>
.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px 0 64px;
}

.hint {
  color: #5c7176;
}
</style>
