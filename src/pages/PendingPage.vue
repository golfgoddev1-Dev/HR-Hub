<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const destination = typeof route.query.to === 'string' ? route.query.to : ''

// The API still wraps the employee landing path in /pending?to=… A hardcoded list
// of finished pages went stale as soon as /leave was built, so the route table is
// the only source of truth: a destination with a real page is forwarded to, and
// only a path that matches nothing but the catch-all keeps this placeholder.
function hasPage(path) {
  try {
    return router.resolve(path).matched.some((record) => record.meta?.catchAll !== true)
  } catch {
    return false
  }
}

const forwarding = computed(() => {
  if (!destination.startsWith('/')) return false
  if (destination.startsWith('/pending')) return false
  return hasPage(destination)
})

onMounted(() => {
  if (forwarding.value) router.replace(destination)
})
</script>

<template>
  <main v-if="!forwarding" class="pending-page">
    <section class="pending-card">
      <h1>หน้านี้กำลังพัฒนา</h1>
      <p>ปลายทางของคุณ: {{ destination }}</p>
    </section>
  </main>
</template>
