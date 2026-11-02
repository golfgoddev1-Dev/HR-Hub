<script setup>
import HrNav from '../components/HrNav.vue'
import EmployeeDirectoryManager from '../components/EmployeeDirectoryManager.vue'
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">จัดการข้อมูลพนักงาน</h1>
          <p class="sub">
            เปลี่ยนแผนกและตำแหน่งของพนักงานรายคน และเปลี่ยนชื่อรายการแผนก/ตำแหน่งที่ใช้ร่วมกัน ·
            แสดงเฉพาะข้อมูลที่จำเป็น
          </p>
        </div>
        <RouterLink to="/hr/employees" class="link">ไปที่รายชื่อพนักงาน →</RouterLink>
      </div>

      <EmployeeDirectoryManager base="/api/hr/directory" />
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
}

.sub {
  margin: 0;
  max-width: 660px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.link {
  color: #10504e;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}
</style>
