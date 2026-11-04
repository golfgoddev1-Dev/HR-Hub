<script setup>
const navItems = [
  { label: 'หน้าหลัก', to: '/hr', icon: 'home' },
  { label: 'รายชื่อพนักงาน', to: '/hr/employees', icon: 'groups' },
  { label: 'นำเข้าพนักงาน', to: '/hr/employees/import', icon: 'upload_file' },
  { label: 'จัดการข้อมูลพนักงาน', to: '/hr/employees/manage', icon: 'edit' },
  { label: 'จัดการรหัสผ่านพนักงาน', to: '/hr/employees/password', icon: 'password' },
  { label: 'ใบลาทั้งหมด', to: '/hr/leave', icon: 'event_note' },
  { label: 'คีย์ใบลาย้อนหลัง', to: '/hr/leave/backdated', icon: 'edit_calendar' },
  { label: 'วันหยุด', to: '/hr/leave/holidays', icon: 'event_busy' },
  { label: 'ผู้อนุมัติ', to: '/hr/leave/approvers', icon: 'how_to_reg' },
  { label: 'ตั้งค่าใบลา', to: '/hr/leave/settings', icon: 'settings' },
]

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    // ignore: navigation still happens
  }
  window.location.assign('/login')
}
</script>

<template>
  <header class="hr-nav-wrapper">
    <div class="nav-inner">
      <!-- Brand Segment with Gradient Icon & Badge -->
      <div class="nav-brand">
        <div class="nav-brand-badge-icon">
          <span class="material-symbols-outlined brand-icon">groups</span>
        </div>
        <div class="nav-title-box">
          <div class="nav-title-row">
            <span class="nav-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
            <span class="nav-badge">HR</span>
          </div>
          <span class="nav-subtitle">HR Management & Welfare Portal</span>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="nav-links">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="nav-link"
          active-class="nav-link-active"
        >
          <span class="material-symbols-outlined link-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <!-- Active Glow Underline Indicator -->
          <span class="active-underline" />
        </RouterLink>

        <div class="nav-divider" />

        <!-- Logout Button with Soft Red Accent -->
        <button type="button" class="nav-link nav-logout" @click="logout">
          <span class="material-symbols-outlined link-icon-sm">logout</span>
          <span>ออกจากระบบ</span>
        </button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'liga';
}

.brand-icon {
  font-size: 22px;
}

.link-icon {
  font-size: 18px;
}

.link-icon-sm {
  font-size: 16px;
}

/* Glassmorphism & Modern Header Container */
.hr-nav-wrapper {
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-radius: 16px;
  border: 1px solid rgba(223, 231, 229, 0.8);
  box-shadow: 0 4px 20px rgba(18, 52, 59, 0.05);
  margin: 16px auto;
  max-width: 1120px;
  animation: navEntrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

@keyframes navEntrance {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.nav-inner {
  padding: 12px 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.nav-brand-badge-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #10504e 0%, #28807d 100%);
  color: #85f8c4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(16, 80, 78, 0.2);
  transition: transform 0.25s ease;
  flex-shrink: 0;
}

.nav-brand-badge-icon:hover {
  transform: scale(1.05);
}

.nav-title-box {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nav-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-title {
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 6px;
  background: #e7f2f0;
  color: #10504e;
  flex-shrink: 0;
}

.nav-subtitle {
  font-size: 11px;
  font-weight: 500;
  color: #5c7176;
}

.nav-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.nav-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  color: #5c7176;
  font-size: 13px;
  font-weight: 500; /* ล็อกน้ำหนักฟอนต์ให้เท่ากันตลอดเพื่อป้องกันข้อความดีด/กระพริบ */
  text-decoration: none;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: background-color 0.2s ease, color 0.2s ease;
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
  white-space: nowrap;
}

.nav-link:hover {
  background: rgba(231, 242, 240, 0.8);
  color: #10504e;
}

.nav-link-active {
  color: #10504e !important;
  background: rgba(231, 242, 240, 0.8);
  font-weight: 500; /* คงค่า 500 ไว้เท่าเดิม ไม่ให้ขนาดตัวอักษรเปลี่ยนไปมาตอนสลับหน้า */
}

/* Mint Glow Underline Indicator */
.active-underline {
  position: absolute;
  bottom: 0;
  left: 10px;
  right: 10px;
  height: 2.5px;
  background: #85f8c4;
  border-radius: 999px;
  box-shadow: 0 0 8px #85f8c4;
  opacity: 0;
  transform: scaleX(0.4);
  transition: transform 0.25s ease, opacity 0.25s ease;
  pointer-events: none;
}

.nav-link-active .active-underline {
  opacity: 1;
  transform: scaleX(1);
}

.nav-divider {
  width: 1px;
  height: 20px;
  background: #dfe7e5;
  margin: 0 4px;
}

/* Logout Button Styling */
.nav-logout {
  color: #be123c !important;
  background: #fff1f2;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.nav-logout:hover {
  background: #ffe4e6 !important;
  color: #9f1239 !important;
}

@media (max-width: 960px) {
  .nav-subtitle {
    display: none;
  }
}

@media (max-width: 720px) {
  .nav-title {
    display: none;
  }
}
</style>