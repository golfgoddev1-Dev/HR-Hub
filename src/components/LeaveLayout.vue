<script setup>
// Kept because the leave pages ask for it by name. The bar position lives in
// AppLayout now, so this only says "use the leave menu".
import AppLayout from './AppLayout.vue'
</script>

<template>
  <AppLayout nav="leave">
    <slot />
  </AppLayout>
</template>
