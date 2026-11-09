<script setup>
// The public page route: reads the token from /approve/:token and hands it to
// the content component. No shell, no session, no redirect.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ApprovalLinkView from '../components/ApprovalLinkView.vue'

const route = useRoute()
const token = computed(() => (typeof route.params.token === 'string' ? route.params.token : ''))
</script>

<template>
  <ApprovalLinkView :token="token" />
</template>
