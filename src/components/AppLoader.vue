<!-- From Uiverse.io by nawinasokan - https://uiverse.io/nawinasokan/terrible-cheetah-45
     MIT License, Copyright (c) nawinasokan (Nawin)
     Adapted for HR Hub: same six flying files, colours and timing; the sideways travel
     uses transform instead of `left` (motion rule), and reduced motion = still row of files. -->
<template>
  <div class="app-loader" role="status" aria-live="polite">
    <div class="app-loader__con" aria-hidden="true">
      <div v-for="n in 6" :key="n" class="app-loader__file" :style="{ '--i': n - 1 }"></div>
    </div>
    <span class="app-loader__label">{{ label }}</span>
  </div>
</template>

<script setup>
defineProps({ label: { type: String, default: 'กำลังโหลด…' } })
</script>

<style scoped>
.app-loader {
  display: grid;
  justify-items: center;
  gap: 8px;
  width: 100%;
  padding: 24px 0;
}

.app-loader__con {
  position: relative;
  width: min(240px, 100%);
  height: 100px;
  overflow: hidden;
  container-type: inline-size;
}

.app-loader__file {
  position: absolute;
  bottom: 25px;
  left: 0;
  width: 40px;
  height: 50px;
  background: linear-gradient(90deg, #b324db, #ac8dcb);
  border-radius: 4px;
  transform-origin: center;
  animation: app-loader-fly 3s ease-in-out infinite backwards;
  animation-delay: calc(var(--i) * 0.6s);
}

.app-loader__file::before,
.app-loader__file::after {
  content: '';
  position: absolute;
  left: 6px;
  height: 4px;
  background-color: #ffffff;
  border-radius: 2px;
}

.app-loader__file::before {
  top: 6px;
  width: 28px;
}

.app-loader__file::after {
  top: 13px;
  width: 18px;
}

.app-loader__label {
  font-size: 14px;
  color: #475569;
}

@keyframes app-loader-fly {
  0% {
    transform: translateX(-10cqw) scale(0);
    opacity: 0;
  }
  50% {
    transform: translateX(45cqw) scale(1.2);
    opacity: 1;
  }
  100% {
    transform: translateX(100cqw) scale(0);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-loader__file {
    animation: none;
    transform: translateX(calc(var(--i) * 16cqw + 4cqw));
  }
}
</style>
