<script setup>
import ControllerNav from '../components/ControllerNav.vue'
import EmployeeDirectoryManager from '../components/EmployeeDirectoryManager.vue'
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">HR</div>
        <div class="brand-text">
          <span class="brand-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
          <span class="brand-sub">Meeting Controller Console</span>
        </div>
      </div>
      <div class="role-chip">
        <span class="material-symbols-outlined role-chip-icon">manage_accounts</span>
        <span>ผู้ควบคุมการประชุม</span>
      </div>
    </header>

    <div class="shell">
      <ControllerNav />

      <main class="page-main">
        <div class="page-head">
          <div>
            <h1>จัดการข้อมูลพนักงาน</h1>
            <p class="greeting">
              เปลี่ยนแผนกและตำแหน่งของพนักงานรายคน และเปลี่ยนชื่อรายการแผนก/ตำแหน่งที่ใช้ร่วมกัน
            </p>
            <p class="greeting-note">แสดงเฉพาะข้อมูลที่จำเป็น</p>
          </div>
          <RouterLink to="/meeting/controller" class="back">← กลับหน้าหลัก</RouterLink>
        </div>

        <EmployeeDirectoryManager base="/api/meeting/directory" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: #f4f8f5;
  color: #12251f;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
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
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #176c5b;
  color: #ffffff;
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
  color: #115447;
}

.brand-sub {
  font-size: 12px;
  color: #6b7a75;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
}

.role-chip-icon {
  font-size: 18px;
  line-height: 1;
}

.shell {
  display: flex;
  gap: 20px;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 22px;
}

.page-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
  color: #115447;
}

.greeting {
  margin: 0 0 4px;
  font-size: 14px;
  color: #3d4f49;
  max-width: 620px;
  line-height: 1.6;
}

.greeting-note {
  margin: 0;
  font-size: 13px;
  color: #6b7a75;
}

.back {
  color: #176c5b;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

@media (max-width: 900px) {
  .shell {
    flex-direction: column;
    padding: 14px;
  }

  .topbar {
    padding: 12px 14px;
  }
}
</style>
