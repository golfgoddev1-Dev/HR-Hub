<template>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">HR</div>
      <div class="brand-text">
        <span class="brand-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
        <span class="brand-sub">Meeting Controller Console</span>
      </div>
    </div>
    <div class="role-chip">
      <span class="material-symbols-outlined role-chip-icon">insights</span>
      <span>ผู้ควบคุมการประชุม</span>
    </div>
  </header>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

/* Same markup and style as the header in ControllerDashboardPage, so every
   Meeting Controller page shows one identical topbar. Colours fall back to the
   console palette on pages that do not define the CSS variables themselves. */
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined', sans-serif;
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
  width: 100%;
  padding: 16px 22px;
  background: #ffffff;
  border-bottom: 1px solid #e3e8e6;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-mark {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--primary, #004337);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--secondary, #006b56);
  overflow-wrap: anywhere;
}

.brand-sub {
  font-size: 12px;
  line-height: 1.4;
  color: var(--outline, #6f7975);
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #eaf3ef;
  color: var(--primary, #004337);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.role-chip-icon {
  font-size: 18px;
}

@media (max-width: 899px) {
  .topbar {
    padding: 12px 14px;
  }
}
</style>
