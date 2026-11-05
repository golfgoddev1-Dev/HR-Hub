<script setup>
// The single outer shell for every page that shows a top navigation bar. The
// bar used to be positioned by each page's own wrapper (or by the nav's own
// margin), so it landed at a different x/y per route. Positioning lives here
// alone: a centred 1120px box with one padding, then the nav, then the page.
import { computed } from 'vue'
import AdminNav from './AdminNav.vue'
import HrNav from './HrNav.vue'
import LeaveNav from './LeaveNav.vue'

const props = defineProps({
  nav: {
    type: String,
    default: 'leave',
    validator: (value) => ['leave', 'hr', 'admin'].includes(value),
  },
})

const NAVS = { leave: LeaveNav, hr: HrNav, admin: AdminNav }

const navComponent = computed(() => NAVS[props.nav] ?? LeaveNav)
</script>

<template>
  <div class="app-layout">
    <div class="app-layout-inner">
      <component :is="navComponent" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  background: #f3f6f5;
  overflow-x: hidden;
}

/* Same 1120px box, centring and single padding for every route: the nav is the
   first child, so its x/y/width no longer depends on the page around it. */
.app-layout-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px 20px 0;
  box-sizing: border-box;
}
</style>
