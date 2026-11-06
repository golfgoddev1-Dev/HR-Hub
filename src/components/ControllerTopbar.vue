<script setup>
defineProps({
  menuExpanded: { type: Boolean, default: false },
  menuControls: { type: String, default: 'controller-nav-panel' },
})

defineEmits(['toggle-menu'])
</script>

<template>
  <header class="topbar">
    <button
      type="button"
      class="menu-btn"
      :aria-label="menuExpanded ? 'ปิดเมนูนำทาง' : 'เปิดเมนูนำทาง'"
      :aria-expanded="String(menuExpanded)"
      :aria-controls="menuControls"
      @click="$emit('toggle-menu')"
    >
      <span class="material-symbols-outlined" aria-hidden="true">menu</span>
    </button>

    <div class="brand">
      <div class="brand-mark" aria-hidden="true">HR</div>
      <div class="brand-text">
        <span class="brand-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
        <span class="brand-sub">Meeting Controller Console</span>
      </div>
    </div>

    <div class="role-chip">
      <span class="material-symbols-outlined role-chip-icon" aria-hidden="true">insights</span>
      <span>ผู้ควบคุมการประชุม</span>
    </div>
  </header>
</template>

<style scoped>

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

/* Fixed bar: ControllerLayout offsets the content by the same height. */
.topbar {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 80;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--controller-topbar-height, 64px);
  padding: 0 20px;
  background: #ffffff;
  border-bottom: 1px solid #e3e8e6;
  font-family: 'Sarabun', sans-serif;
}

.menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  padding: 0;
  border: 1px solid #d8e4de;
  border-radius: 12px;
  background: #ffffff;
  color: var(--primary, #004337);
  font-family: 'Sarabun', sans-serif;
  cursor: pointer;
}

.menu-btn:hover {
  background: #eaf3ef;
}

.menu-btn:focus-visible {
  outline: 3px solid rgba(0, 107, 86, 0.35);
  outline-offset: 2px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 auto;
  min-width: 0;
}

.brand-mark {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: var(--primary, #004337);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.brand-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--secondary, #006b56);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-sub {
  font-size: 12px;
  color: var(--outline, #6f7975);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
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

/* The menu button only exists while the navigation is a drawer. */
@media (max-width: 1023px) {
  .menu-btn {
    display: inline-flex;
  }

  .topbar {
    padding: 0 16px;
  }
}

@media (max-width: 767px) {
  .role-chip {
    display: none;
  }

  .brand-sub {
    display: none;
  }
}
</style>
