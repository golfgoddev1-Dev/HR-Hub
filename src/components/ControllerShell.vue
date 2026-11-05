<script setup>
// Route parent for the meeting controller. ControllerLayout (topbar, sidebar and
// content box) mounts once here, and only the routed page changes inside it, so
// the menu never remounts between controller pages and their leave pages.
import ControllerLayout from './ControllerLayout.vue'
</script>

<template>
  <ControllerLayout>
    <RouterView />
  </ControllerLayout>
</template>
