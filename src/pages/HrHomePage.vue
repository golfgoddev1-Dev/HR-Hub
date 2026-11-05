<script setup>

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
    <div class="page-loader-bar" aria-hidden="true"></div>

    <main class="content">
      <div class="head">
        <h1 class="title">
          <span>หน้าหลัก</span>
          <span class="live-dot" title="ระบบพร้อมใช้งาน"></span>
        </h1>
        <p class="sub">
          เลือกงานที่ต้องการทำ — แต่ละหน้าแสดงเฉพาะข้อมูลที่จำเป็น และไม่แสดงเลขบัตรประชาชน
          ยกเว้นหน้าที่ขอเปิดดูรายคน
        </p>
      </div>

      <div class="cards">
        <RouterLink
          v-for="(card, index) in cards"
          :key="card.to"
          :to="card.to"
          class="card"
          :style="{ '--stagger': index }"
        >
          <span class="card-icon-wrap">
            <span class="material-symbols-outlined card-icon">{{ card.icon }}</span>
          </span>
          <span class="card-title">{{ card.title }}</span>
          <span class="card-desc">{{ card.description }}</span>
          <span class="card-go">เปิดหน้านี้ →</span>
        </RouterLink>
      </div>
    </main>
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

/* แถบความคืบหน้าบนสุดตอนโหลดหน้า */
.page-loader-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, #10504e 0%, #28807d 40%, #85f8c4 70%, #10504e 100%);
  background-size: 200% 100%;
  z-index: 9999;
  transform-origin: left;
  animation: hr-progress-sweep 1.8s cubic-bezier(0.65, 0, 0.35, 1) forwards, hr-gradient-move 1.5s linear infinite;
}

.content {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 0 64px;
}

.head {
  margin-bottom: 22px;
  animation: hr-fade-slide-down 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 10px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10504e;
  box-shadow: 0 0 8px rgba(16, 80, 78, 0.5);
  animation: hr-pulse-dot 2s ease-in-out infinite;
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
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

/* การ์ดทยอยขึ้นทีละใบ */
.card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid #dfe7e5;
  color: inherit;
  text-decoration: none;
  box-shadow: 0 1px 3px rgba(18, 52, 59, 0.04);
  animation: hr-card-entrance 0.75s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--stagger, 0) * 0.12s + 0.3s);
  transition:
    transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.35s ease,
    background-color 0.35s ease;
}

/* เส้นเน้นด้านบนของการ์ด */
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #10504e 0%, #28807d 100%);
  opacity: 0;
  transform: scaleX(0.4);
  transform-origin: left;
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

/* แสงวิ่งผ่านการ์ดตอน hover */
.card::after {
  content: '';
  position: absolute;
  top: -50%;
  left: -150%;
  width: 100%;
  height: 200%;
  background: linear-gradient(
    65deg,
    rgba(255, 255, 255, 0) 20%,
    rgba(16, 80, 78, 0.04) 45%,
    rgba(255, 255, 255, 0.55) 55%,
    rgba(255, 255, 255, 0) 80%
  );
  transform: rotate(25deg);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.card:hover {
  border-color: #b7cecb;
  transform: translateY(-4px);
  box-shadow:
    0 14px 28px -6px rgba(18, 52, 59, 0.09),
    0 4px 12px -2px rgba(18, 52, 59, 0.04);
}

.card:hover::before {
  opacity: 1;
  transform: scaleX(1);
}

.card:hover::after {
  opacity: 1;
  animation: hr-card-sheen 0.85s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.card:active {
  transform: translateY(-1px) scale(0.995);
}

.card-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: #f0f7f6;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
  transition:
    transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    background-color 0.35s ease,
    box-shadow 0.35s ease;
}

.card-icon {
  font-size: 26px;
  color: #10504e;
  transition: color 0.3s ease;
}

.card:hover .card-icon-wrap {
  transform: scale(1.08) translateY(-2px);
  background: #10504e;
  box-shadow: 0 6px 16px rgba(16, 80, 78, 0.28);
}

.card:hover .card-icon {
  color: #ffffff;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  color: #12343b;
  transition: color 0.2s ease;
}

.card:hover .card-title {
  color: #10504e;
}

.card-desc {
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.card-go {
  margin-top: auto;
  padding-top: 14px;
  font-size: 13px;
  font-weight: 600;
  color: #10504e;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: gap 0.25s cubic-bezier(0.16, 1, 0.3, 1), color 0.25s ease;
}

.card:hover .card-go {
  color: #0b3837;
  gap: 8px;
}

/* Keyframes */
@keyframes hr-progress-sweep {
  0% { transform: scaleX(0); opacity: 1; }
  40% { transform: scaleX(0.55); }
  80% { transform: scaleX(0.92); opacity: 1; }
  100% { transform: scaleX(1); opacity: 0; }
}

@keyframes hr-gradient-move {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

@keyframes hr-pulse-dot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.75); opacity: 0.5; }
}

@keyframes hr-fade-slide-down {
  from { opacity: 0; transform: translateY(-14px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes hr-card-entrance {
  from { opacity: 0; transform: translateY(24px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes hr-card-sheen {
  0% { left: -150%; }
  100% { left: 160%; }
}

/* ปิดแอนิเมชันเมื่อผู้ใช้ตั้งค่า reduced motion */
@media (prefers-reduced-motion: reduce) {
  .page-loader-bar,
  .head,
  .card,
  .live-dot {
    animation: none !important;
  }
  .card,
  .card-icon-wrap,
  .card-icon,
  .card-go {
    transition: none !important;
  }
}
</style>