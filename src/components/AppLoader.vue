<!-- From Uiverse.io by TemRevil - https://uiverse.io/TemRevil/mean-panda-76
     MIT License, Copyright (c) TemRevil (Tem Revil)
     Adapted for HR Hub: six-tile grid kept, indigo palette, compact size, and the
     colour fade is done with opacity (no animated paint, reduced motion = still). -->
<template>
  <div class="app-loader" role="status" aria-live="polite">
    <div class="app-loader__grid" aria-hidden="true">
      <div v-for="n in 6" :key="n" class="app-loader__tile" :class="`app-loader__tile--${n}`"></div>
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
  gap: 12px;
  width: 100%;
  padding: 24px 0;
}

.app-loader__grid {
  width: min(240px, 100%);
  display: grid;
  grid-template-rows: repeat(3, 40px);
  grid-template-areas:
    'l1 l2 l3'
    'l1 l2 l4'
    'l6 l6 l5';
  gap: 8px;
}

.app-loader__tile {
  position: relative;
  border-radius: 5px;
  background: #e0e7ff;
}

/* The dark phase of the original colour fade, faded in and out with opacity. */
.app-loader__tile::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: #4f46e5;
  opacity: 0;
  animation: app-loader-fade 6s 0s infinite linear;
}

.app-loader__tile--1 { grid-area: l1; }
.app-loader__tile--2 { grid-area: l2; }
.app-loader__tile--3 { grid-area: l3; }
.app-loader__tile--4 { grid-area: l4; }
.app-loader__tile--5 { grid-area: l5; }
.app-loader__tile--6 { grid-area: l6; }

.app-loader__tile--1::after { animation: app-loader-fade 6s 0s infinite linear; }
.app-loader__tile--2::after { animation: app-loader-fade 5s 1s infinite linear; }
.app-loader__tile--3::after { animation: app-loader-fade 4s 2s infinite linear; }
.app-loader__tile--4::after { animation: app-loader-fade 3s 3s infinite linear; }
.app-loader__tile--5::after { animation: app-loader-fade 2s 4s infinite linear; }
.app-loader__tile--6::after { animation: app-loader-fade 1s 5s infinite linear; }

.app-loader__label {
  font-size: 14px;
  color: #475569;
}

@keyframes app-loader-fade {
  0% { opacity: 0; }
  50% { opacity: 1; }
  100% { opacity: 0; }
}

@media (max-width: 400px) {
  .app-loader__grid {
    grid-template-rows: repeat(3, 32px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-loader__tile::after {
    animation: none;
  }
}
</style>
