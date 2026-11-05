<script setup>
// HR opens this page with HrNav; employee and approver use LeaveLayout, so the
// leave bar keeps the same position it has on the other leave pages.
import { computed, onMounted, ref } from 'vue'
import HrNav from '../components/HrNav.vue'
import LeaveCalendarView from '../components/LeaveCalendarView.vue'
import LeaveLayout from '../components/LeaveLayout.vue'
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
  <LeaveLayout v-if="ready && !isHr">
    <LeaveCalendarView :is-hr="false" />
  </LeaveLayout>

  <div v-else-if="ready" class="page">
    <HrNav />
    <main class="content">
      <LeaveCalendarView :is-hr="true" />
    </main>
  </div>

  <LeaveLayout v-else>
    <main class="content">
      <p class="hint">กำลังโหลด…</p>
    </main>
  </LeaveLayout>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px 20px 64px;
}

.hint {
  color: #5c7176;
}
</style>
