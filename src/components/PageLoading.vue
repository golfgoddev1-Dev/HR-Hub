<template>
  <!-- What RouterView shows while a page chunk downloads. It is content only and
       sits in the same box as a page, so the nav above it never moves. -->
  <main class="content page-loading" role="status" aria-live="polite" aria-label="กำลังโหลดหน้า">
    <span class="page-loading-line" aria-hidden="true"></span>
    <span class="page-loading-text">กำลังโหลด…</span>
  </main>
</template>

<style scoped>
.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.page-loading {
  display: grid;
  gap: 10px;
  align-content: start;
}

.page-loading-line {
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 999px;
  background: linear-gradient(90deg, #e4eeec 0%, #10504e 50%, #e4eeec 100%);
  background-size: 200% 100%;
  animation: page-loading-sweep 1.4s ease-in-out infinite;
}

.page-loading-text {
  font-size: 13px;
  color: #5c7176;
}

@keyframes page-loading-sweep {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-loading-line {
    animation: none;
    background: #dfe7e5;
  }
}
</style>
