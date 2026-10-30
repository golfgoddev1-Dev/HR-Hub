<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const READY_ROUTES = ['/meeting/controller/qr', '/set-pin', '/login', '/meeting/controller']

const route = useRoute()
const router = useRouter()
const destination = typeof route.query.to === 'string' ? route.query.to : ''

onMounted(() => {
  if (!destination.startsWith('/')) return
  if (!READY_ROUTES.includes(destination)) return
  router.replace(destination)
})
</script>

<template>
  <main class="pending-page">
    <section class="pending-card">
      <h1>หน้านี้กำลังพัฒนา</h1>
      <p>ปลายทางของคุณ: {{ destination }}</p>
    </section>
  </main>
</template>
