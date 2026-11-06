<script setup>
defineProps({
  checked: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  label: { type: String, required: true },
})
defineEmits(['toggle'])
</script>

<template>
  <div class="notify-control">
    <span class="notify-state">{{ checked ? 'เปิดอยู่' : 'ปิดอยู่' }}</span>
    <button
      type="button"
      role="switch"
      class="notify-switch"
      :class="{ 'notify-switch-on': checked }"
      :aria-checked="checked"
      :aria-label="label"
      :disabled="disabled || busy"
      @click="$emit('toggle')"
    >
      <span class="notify-thumb" aria-hidden="true"></span>
    </button>
  </div>
</template>

<style scoped>
.notify-control {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.notify-state {
  font-size: 12px;
  font-weight: 600;
  color: #5c7176;
  white-space: nowrap;
}

.notify-switch {
  position: relative;
  width: 46px;
  height: 26px;
  box-sizing: border-box;
  padding: 0;
  border: 1px solid #cfdcda;
  border-radius: 999px;
  background: #dfe8e6;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.notify-switch-on {
  border-color: #10504e;
  background: #10504e;
}

.notify-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(18, 52, 59, 0.25);
  transition: transform 0.2s ease;
}

.notify-switch-on .notify-thumb {
  transform: translateX(20px);
}

.notify-switch:focus-visible {
  outline: 2px solid rgba(16, 80, 78, 0.35);
  outline-offset: 2px;
}

.notify-switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 360px) {
  .notify-control {
    gap: 6px;
  }

  .notify-state {
    font-size: 11px;
  }
}
</style>
