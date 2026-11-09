<script setup>
import EmployeeDirectoryManager from '../components/EmployeeDirectoryManager.vue'
</script>

<template>

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">จัดการข้อมูลพนักงาน</h1>
          <p class="sub">
            แก้ไขข้อมูลส่วนตัวของพนักงานรายคน ทั้งรหัสพนักงาน ชื่อ-นามสกุล เลขบัตรประชาชน
            อีเมล เบอร์โทร แผนก ตำแหน่ง และสถานะ · การแก้ไขทุกครั้งจะถูกบันทึกไว้ในประวัติระบบ
          </p>
        </div>
        <RouterLink to="/hr/employees" class="link">ไปที่รายชื่อพนักงาน →</RouterLink>
      </div>

      <EmployeeDirectoryManager base="/api/hr/directory" full />
    </main>
</template>

<style scoped>
.content {
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 0 64px;
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
