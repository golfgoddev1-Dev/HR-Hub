<script setup>
import ControllerNav from '../components/ControllerNav.vue'
import ControllerTopbar from '../components/ControllerTopbar.vue'
import EmployeeDirectoryManager from '../components/EmployeeDirectoryManager.vue'
</script>

<template>
  <div class="page">
    <ControllerTopbar />

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

}
</style>
