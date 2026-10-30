<script setup>
import { computed } from 'vue'
import { formatBangkokDate, formatBangkokTime } from '../../server/time.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  lockedUntil: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const unlockText = computed(() => {
  if (!props.lockedUntil) return ''
  return `${formatBangkokTime(props.lockedUntil)} (${formatBangkokDate(props.lockedUntil)})`
})
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="420" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="lockout-card">
      <v-card-title class="lockout-title">บัญชีถูกล็อกชั่วคราว</v-card-title>
      <v-card-text>
        ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ ปลดล็อกได้อีกครั้งเวลา {{ unlockText }}
      </v-card-text>
      <v-card-actions class="lockout-actions">
        <v-btn color="primary" @click="emit('update:modelValue', false)">ตกลง</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
