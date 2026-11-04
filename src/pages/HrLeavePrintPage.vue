<script setup>



import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { leavePrintModel } from '../leave-print.js'

const LOAD_ERROR = 'โหลดใบลาไม่สำเร็จ กรุณาลองใหม่'

const route = useRoute()
const loading = ref(true)
const errorMessage = ref('')
const request = ref(null)
const model = computed(() => leavePrintModel(request.value))

async function load() {
  loading.value = true
  errorMessage.value = ''
  const id = typeof route.params.id === 'string' ? route.params.id : ''
  try {
    const response = await fetch(`/api/leave/hr/requests/${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true || !data.request) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    request.value = data.request
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

function printPage() {
  window.print()
}

onMounted(load)
</script>

<template>
  <div class="print-page">
    <div class="toolbar no-print">
      <RouterLink to="/hr/leave" class="back-link">← กลับไปหน้าใบลา</RouterLink>
      <button type="button" class="print-btn" :disabled="loading || Boolean(errorMessage)" @click="printPage">
        พิมพ์ / บันทึกเป็น PDF
      </button>
    </div>

    <p v-if="loading" class="status no-print">กำลังโหลด…</p>
    <v-alert v-else-if="errorMessage" type="error" variant="tonal" class="no-print">
      {{ errorMessage }}
    </v-alert>

    <article v-else class="sheet">
      <header class="sheet-head">
        <p class="org">ฝ่ายทรัพยากรบุคคล · {{ model.requesterDepartment }}</p>
        <h1 class="doc-title">ใบขออนุญาตลางาน</h1>
        <p class="doc-title-en">Leave Request Form</p>
      </header>

      <p v-if="model.isBackdated" class="backdated">
        บันทึกย้อนหลังโดยฝ่ายทรัพยากรบุคคล
      </p>

      <dl class="meta">
        <div class="meta-item">
          <dt>เลขที่ใบลา</dt>
          <dd>{{ model.requestCode }}</dd>
        </div>
        <div class="meta-item">
          <dt>สถานะ</dt>
          <dd>{{ model.status }}</dd>
        </div>
        <div class="meta-item">
          <dt>วันที่กรอกใบลา</dt>
          <dd>{{ model.createdAt }}</dd>
        </div>
      </dl>

      <section class="block">
        <h2 class="block-title">1) ข้อมูลผู้ขอลา</h2>
        <table class="rows">
          <tbody>
            <tr>
              <th scope="row">ชื่อ-นามสกุล</th>
              <td>{{ model.requesterName }}</td>
            </tr>
            <tr>
              <th scope="row">ส่วน/แผนก</th>
              <td>{{ model.requesterDepartment }}</td>
            </tr>
            <tr>
              <th scope="row">เบอร์โทรศัพท์</th>
              <td>{{ model.requesterPhone }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="block">
        <h2 class="block-title">2) รายละเอียดการลา</h2>
        <table class="rows">
          <tbody>
            <tr>
              <th scope="row">ประเภทการลา</th>
              <td>{{ model.leaveType }}</td>
            </tr>
            <tr v-if="model.otherTypeDetail !== '-'">
              <th scope="row">ระบุประเภทอื่น</th>
              <td>{{ model.otherTypeDetail }}</td>
            </tr>
            <tr>
              <th scope="row">เวลาที่ลา</th>
              <td>{{ model.shiftText }}</td>
            </tr>
            <tr>
              <th scope="row">OT</th>
              <td>{{ model.ot }}</td>
            </tr>
            <tr>
              <th scope="row">วันที่เริ่มลา</th>
              <td>{{ model.startDate }}</td>
            </tr>
            <tr>
              <th scope="row">วันที่สิ้นสุด</th>
              <td>{{ model.endDate }}</td>
            </tr>
            <tr>
              <th scope="row">จำนวนวัน</th>
              <td>{{ model.days }}</td>
            </tr>
            <tr>
              <th scope="row">วันกลับมาทำงาน</th>
              <td>{{ model.returnDate }} เวลา {{ model.returnTime }}</td>
            </tr>
            <tr v-if="model.shiftEndTime !== '-'">
              <th scope="row">เวลาเลิกงานวันนั้น</th>
              <td>{{ model.shiftEndTime }}</td>
            </tr>
            <tr>
              <th scope="row">เหตุผล</th>
              <td>{{ model.reason }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="block">
        <h2 class="block-title">3) การพิจารณาอนุมัติ</h2>
        <table class="rows">
          <tbody>
            <tr>
              <th scope="row">ผู้อนุมัติ</th>
              <td>{{ model.approverName }}</td>
            </tr>
            <tr>
              <th scope="row">วันที่อนุมัติ</th>
              <td>{{ model.decidedAt }}</td>
            </tr>
            <tr>
              <th scope="row">แจ้งทราบ (ผู้จัดการ CC)</th>
              <td>{{ model.cc }}</td>
            </tr>
            <tr>
              <th scope="row">สถานะ</th>
              <td>{{ model.status }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="block">
        <h2 class="block-title">4) เอกสารแนบ</h2>
        <table class="rows">
          <tbody>
            <tr>
              <th scope="row">มีใบรับรองแพทย์แนบ</th>
              <td>{{ model.certificate }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer class="sheet-foot">
        <p>เอกสารนี้สร้างโดยระบบอัตโนมัติ การอนุมัติมีผลเมื่อผู้อนุมัติดำเนินการในระบบแล้วเท่านั้น</p>
        <p>เอกสารนี้เก็บรักษาตามนโยบาย PDPA</p>
      </footer>
    </article>
  </div>
</template>

<style scoped>
@font-face {
  font-family: 'Sarabun';
  src: url('/fonts/Sarabun-Regular.ttf') format('truetype');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Sarabun';
  src: url('/fonts/Sarabun-Bold.ttf') format('truetype');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

.print-page {
  min-height: 100vh;
  padding: 24px 16px 64px;
  background: #f3f6f5;
  font-family: 'Sarabun', 'Noto Sans Thai', system-ui, sans-serif;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  max-width: 210mm;
  margin: 0 auto 16px;
}

.back-link { font-size: 14px; font-weight: 600; color: #10504e; text-decoration: none; }

.print-btn {
  min-height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.print-btn:disabled { background: #d7e0de; color: #7b8b8e; cursor: not-allowed; }

.status { max-width: 210mm; margin: 0 auto; font-size: 14px; color: #5c7176; }

.sheet {
  max-width: 210mm;
  margin: 0 auto;
  padding: 16mm 16mm 14mm;
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 8px;
  color: #12343b;
  font-size: 11.5pt;
  line-height: 1.55;
}

.sheet-head { text-align: center; border-bottom: 1.5pt solid #12343b; padding-bottom: 8px; }

.org { margin: 0 0 6px; font-size: 10.5pt; color: #5c7176; }
.doc-title { margin: 0; font-size: 16pt; font-weight: 700; }
.doc-title-en { margin: 2px 0 0; font-size: 10.5pt; color: #5c7176; letter-spacing: 0.4pt; }

.backdated {
  margin: 10px 0 0;
  padding: 6px 10px;
  border: 0.75pt solid #8a4b06;
  border-radius: 4px;
  color: #8a4b06;
  font-size: 10.5pt;
}

.meta {
  display: grid;
  gap: 6px 18px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin: 12px 0 0;
  padding: 8px 10px;
  background: #f6faf9;
}

.meta-item { display: flex; flex-direction: column; gap: 1px; }
.meta-item dt { font-size: 9.5pt; color: #5c7176; }
.meta-item dd { margin: 0; font-weight: 700; }

.block { margin-top: 14px; page-break-inside: avoid; }
.block-title { margin: 0 0 6px; font-size: 12pt; font-weight: 700; }

.rows { width: 100%; border-collapse: collapse; }
.rows tr { page-break-inside: avoid; break-inside: avoid; }
.rows th,
.rows td {
  padding: 5px 8px;
  border: 0.75pt solid #cfdcda;
  text-align: left;
  vertical-align: top;
}
.rows th { width: 34%; background: #f6faf9; font-weight: 600; }

.sheet-foot {
  margin-top: 18px;
  padding-top: 8px;
  border-top: 0.75pt solid #cfdcda;
  font-size: 9.5pt;
  color: #5c7176;
}
.sheet-foot p { margin: 2px 0; }

@page {
  size: A4;
  margin: 14mm 12mm;
}

@media print {
  .no-print { display: none !important; }
  .print-page { min-height: 0; padding: 0; background: #ffffff; }
  .sheet {
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    font-size: 11pt;
  }
  .block, .rows tr { page-break-inside: avoid; break-inside: avoid; }
  .sheet-head { border-bottom-color: #000000; }
}
</style>
