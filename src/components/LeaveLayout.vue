<script setup>
// The single outer layout for pages that show the leave menu. Every page used
// to bring its own padded wrapper, so the bar landed at a different x/y on each
// route. The container below is now the only thing positioning LeaveNav.
import LeaveNav from './LeaveNav.vue'
</script>

<template>
  <div class="leave-layout">
    <div class="leave-layout-inner">
      <LeaveNav />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.leave-layout {
  min-height: 100vh;
  background: #f3f6f5;
}

/* Matches the nav's own 1120px width, centred, with one padding for every
   breakpoint so the bar sits in exactly the same place on every page. */
.leave-layout-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px 20px 0;
  box-sizing: border-box;
}
</style>
