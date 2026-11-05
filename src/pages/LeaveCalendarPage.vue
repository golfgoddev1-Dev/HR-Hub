<script setup>
// Content only: the layout route owns the dock (the HR dock for role hr via the
// route's meta.hrDock). The page still needs the role to decide whether the
// department filter belongs on the calendar.
import { computed, onMounted, ref } from 'vue'
import LeaveCalendarView from '../components/LeaveCalendarView.vue'
import { getSession } from '../api.js'

const role = ref('')
const ready = ref(false)

const isHr = computed(() => role.value === 'hr')

onMounted(async () => {
  const session = await getSession()
  role.value = typeof session?.role === 'string' ? session.role : ''
  ready.value = true
})
</script>

<template>
  <main class="content">
    <LeaveCalendarView v-if="ready" :is-hr="isHr" />
    <p v-else class="hint">กำลังโหลด…</p>
  </main>
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
