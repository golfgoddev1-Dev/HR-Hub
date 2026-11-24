<template>
  <!-- What RouterView shows while a page chunk downloads. It is content only and
       sits in the same box as a page, so the nav above it never moves. The loader
       inside drops its own status role: this main already announces it. -->
  <main class="content page-loading" role="status" aria-live="polite" aria-label="กำลังโหลดหน้า">
    <AppLoader role="none" aria-live="off" label="กำลังโหลด…" />
  </main>
</template>

<script setup>
import AppLoader from './AppLoader.vue'
</script>

<style scoped>
.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}
</style>
