<script setup>
// The approval page route: reads the token from the URL fragment (/approve#t=...,
// never sent to a server) and hands it to the content component. No shell and
// no redirect; the API checks the signed-in approver.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ApprovalLinkView from '../components/ApprovalLinkView.vue'

const route = useRoute()
const token = computed(() => new URLSearchParams(route.hash.replace(/^#/, '')).get('t') ?? '')
</script>

<template>
  <ApprovalLinkView :token="token" />
</template>
