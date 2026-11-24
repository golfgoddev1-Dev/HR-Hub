<script setup>
// Read-only policy page: static text, no request, no state.
const VACATION_TIERS = [
  { years: 'อายุงาน 1-3 ปี', days: 6, no: '3.1' },
  { years: 'อายุงานมากกว่า 3-6 ปี', days: 7, no: '3.2' },
  { years: 'อายุงานมากกว่า 6-9 ปี', days: 8, no: '3.3' },
  { years: 'อายุงาน 9 ปี', days: 9, no: '3.4' },
]
</script>

<template>
  <main class="content rules">
    <div class="head">
      <h1 class="title">กฎระเบียบและวินัยการลางาน</h1>
      <p class="sub">อ่านให้เข้าใจก่อนยื่นใบลา สิทธิการลาทั้งหมดนับตามข้อกำหนดด้านล่างนี้</p>
    </div>

    <ol class="rule-list">
      <li class="rule">
        <span class="rule-no" aria-hidden="true">1</span>
        <div class="rule-body">
          <h2 class="rule-title">วันทำงาน</h2>
          <p class="figure"><span class="figure-num">6</span> วันต่อสัปดาห์</p>
          <p class="text">ทำงานวันจันทร์ถึงวันเสาร์ ตามปฏิทินประจำปี</p>
        </div>
      </li>

      <li class="rule">
        <span class="rule-no" aria-hidden="true">2</span>
        <div class="rule-body">
          <h2 class="rule-title">วันหยุดประเพณี</h2>
          <p class="figure"><span class="figure-num">13</span> วันต่อปี</p>
          <ul class="points">
            <li>ได้รับค่าแรงปกติ</li>
            <li>กรณีมาทำงานในวันหยุดประเพณี ได้รับค่าแรงเพิ่มอีก 1 แรง</li>
          </ul>
        </div>
      </li>

      <li class="rule">
        <span class="rule-no" aria-hidden="true">3</span>
        <div class="rule-body">
          <h2 class="rule-title">วันหยุดพนักงาน (ลาพักร้อน)</h2>
          <p class="text">สิทธิต่อปี นับอายุงานถึงวันที่ 31 ธันวาคม</p>
          <ul class="tiers">
            <li v-for="tier in VACATION_TIERS" :key="tier.no" class="tier">
              <span class="tier-no">{{ tier.no }}</span>
              <span class="tier-years">{{ tier.years }}</span>
              <span class="tier-days"><span class="figure-num">{{ tier.days }}</span> วันต่อปี</span>
            </li>
          </ul>
        </div>
      </li>

      <li class="rule">
        <span class="rule-no" aria-hidden="true">4</span>
        <div class="rule-body">
          <h2 class="rule-title">การลาป่วย</h2>
          <p class="figure"><span class="figure-num">30</span> วันต่อปี</p>
          <ul class="points">
            <li><span class="tier-no">4.1</span>ได้ค่าจ้างปกติ เมื่อมีใบรับรองแพทย์แผนปัจจุบันชั้น 1</li>
          </ul>
        </div>
      </li>

      <li class="rule">
        <span class="rule-no" aria-hidden="true">5</span>
        <div class="rule-body">
          <h2 class="rule-title">การลากิจ</h2>
          <span class="pay pay-unpaid">ไม่คิดค่าจ้าง</span>
          <ul class="points">
            <li>
              <span class="tier-no">5.1</span>ต้องยื่นใบลากิจล่วงหน้า 1 วัน หรือตามความเหมาะสมกับกิจธุระประเภทนั้นๆ
            </li>
            <li><span class="tier-no">5.2</span>ในวันที่ลากิจ ทางบริษัทไม่คิดค่าจ้างให้</li>
          </ul>
        </div>
      </li>

      <li class="rule">
        <span class="rule-no" aria-hidden="true">6</span>
        <div class="rule-body">
          <h2 class="rule-title">การลากิจพิเศษ</h2>
          <span class="pay pay-paid">คิดค่าจ้างให้</span>
          <ul class="points">
            <li><span class="tier-no">6.1</span>พนักงานอายุงานครบ 1 ปีขึ้นไป ได้สิทธิ 3 วันต่อปี</li>
            <li><span class="tier-no">6.2</span>ในวันที่ลากิจพิเศษ ทางบริษัทคิดค่าจ้างให้</li>
          </ul>
        </div>
      </li>
    </ol>
  </main>
</template>

<style scoped>
.rules {
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4338ca;
  --wash: #eef2ff;

  max-width: 840px;
  margin: 0 auto;
  padding: 24px 0 64px;
  display: grid;
  gap: 24px;
  color: var(--ink);
}

.title {
  margin: 0 0 8px;
  font-family: 'Prompt', 'Sarabun', sans-serif;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--ink);
}

.sub {
  margin: 0;
  max-width: 560px;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.rule-list {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rule {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  gap: 16px;
  padding: 24px;
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  background-color: var(--glass-tint);
  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);
  box-shadow: var(--glass-shadow);
}

.rule-no {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--wash);
  color: var(--accent);
  font-family: 'Prompt', 'Sarabun', sans-serif;
  font-size: 20px;
  font-weight: 600;
}

.rule-body {
  min-width: 0;
  display: grid;
  gap: 8px;
  align-content: start;
}

.rule-title {
  margin: 0;
  font-family: 'Prompt', 'Sarabun', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--ink);
}

.figure,
.text {
  margin: 0;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-body);
}

.figure-num {
  font-family: 'Prompt', 'Sarabun', sans-serif;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--accent);
}

.points {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-body);
  overflow-wrap: anywhere;
}

.points li {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.tier-no {
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.7;
  color: var(--ink-muted);
}

.tiers {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tier {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--wash);
  font-size: 16px;
  color: var(--ink-body);
}

.tier-years {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tier-days {
  white-space: nowrap;
  font-weight: 600;
  color: var(--ink);
}

.pay {
  justify-self: start;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
}

/* Text on its own fill: white on #4338ca 7.90:1, #334155 on #f1f5f9 9.45:1 */
.pay-paid {
  background: var(--accent);
  color: #ffffff;
}

.pay-unpaid {
  background: #f1f5f9;
  color: var(--ink-body);
  border: 1px solid rgba(30, 27, 75, 0.35);
}

@media (max-width: 720px) {
  .rule {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 16px;
  }

  .tier {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .tier-days {
    grid-column: 2;
  }
}
</style>
