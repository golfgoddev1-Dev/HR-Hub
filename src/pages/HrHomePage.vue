<script setup>
import HrNav from '../components/HrNav.vue'

// No summary API exists for HR yet, so this page is links only: every card goes
// to a page that already works (employees list, import, directory management).
const cards = [
  {
    to: '/hr/employees',
    icon: 'groups',
    title: 'รายชื่อพนักงาน',
    description: 'ค้นหาพนักงานด้วยชื่อหรือรหัสพนักงาน (อย่างน้อย 2 ตัวอักษร) และเปิดดูข้อมูลรายคน',
  },
  {
    to: '/hr/employees/import',
    icon: 'upload_file',
    title: 'นำเข้าพนักงาน',
    description: 'อัปโหลดไฟล์ .xlsx หรือ .csv ตรวจตัวอย่างก่อนบันทึก และดาวน์โหลดแม่แบบไฟล์',
  },
  {
    to: '/hr/employees/manage',
    icon: 'edit',
    title: 'จัดการข้อมูลพนักงาน',
    description: 'เปลี่ยนแผนกและตำแหน่งของพนักงานรายคน และเปลี่ยนชื่อรายการแผนกหรือตำแหน่งที่ใช้ร่วมกัน',
  },
]
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="head">
        <h1 class="title">หน้าหลัก</h1>
        <p class="sub">
          เลือกงานที่ต้องการทำ — แต่ละหน้าแสดงเฉพาะข้อมูลที่จำเป็น และไม่แสดงเลขบัตรประชาชน
          ยกเว้นหน้าที่ขอเปิดดูรายคน
        </p>
      </div>

      <div class="cards">
        <RouterLink v-for="card in cards" :key="card.to" :to="card.to" class="card">
          <v-icon :icon="card.icon" size="28" class="card-icon" />
          <span class="card-title">{{ card.title }}</span>
          <span class="card-desc">{{ card.description }}</span>
          <span class="card-go">เปิดหน้านี้ →</span>
        </RouterLink>
      </div>
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

.cards {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #dfe7e5;
  color: inherit;
  text-decoration: none;
  transition: box-shadow 0.2s, transform 0.2s;
}

.card:hover {
  box-shadow: 0 6px 20px rgba(15, 33, 55, 0.08);
  transform: translateY(-1px);
}

.card-icon {
  color: #10504e;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  color: #12343b;
}

.card-desc {
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.card-go {
  margin-top: auto;
  padding-top: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #10504e;
}
</style>
