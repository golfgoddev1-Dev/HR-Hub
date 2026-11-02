<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import HrNav from '../components/HrNav.vue'

const route = useRoute()
const employee = ref(null)
const loading = ref(true)
const errorMessage = ref('')
const revealError = ref('')
const revealing = ref(false)
const revealedId = ref('')

const LOAD_ERROR = 'ไม่พบข้อมูลพนักงาน หรือคุณไม่มีสิทธิ์เข้าถึง'
const REVEAL_ERROR = 'ไม่สามารถแสดงเลขบัตรประชาชนได้'

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/hr/employees/${encodeURIComponent(route.params.id)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    employee.value = data.employee
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function reveal() {
  if (revealing.value || revealedId.value) return
  revealing.value = true
  revealError.value = ''
  try {
    const response = await fetch(
      `/api/hr/employees/${encodeURIComponent(route.params.id)}/reveal-national-id`,
      { method: 'POST', credentials: 'same-origin' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      revealError.value = typeof data.message === 'string' ? data.message : REVEAL_ERROR
      return
    }
    revealedId.value = String(data.nationalId ?? '')
  } catch {
    revealError.value = REVEAL_ERROR
  } finally {
    revealing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">รายละเอียดพนักงาน</h1>
          <p class="sub">ข้อมูลสำหรับ HR · เลขบัตรประชาชนแสดงเฉพาะ 4 หลักท้ายตามค่าเริ่มต้น</p>
        </div>
        <RouterLink to="/hr/employees/import" class="back">← กลับไปหน้านำเข้า</RouterLink>
      </div>

      <v-alert v-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>
      <p v-else-if="loading" class="hint">กำลังโหลด…</p>

      <section v-if="employee" class="card">
        <dl class="rows">
          <div class="row">
            <dt>รหัสพนักงาน</dt>
            <dd>{{ employee.employeeCode || '—' }}</dd>
          </div>
          <div class="row">
            <dt>ชื่อ-สกุล</dt>
            <dd>{{ employee.fullName || '—' }}</dd>
          </div>
          <div class="row">
            <dt>คำนำหน้า</dt>
            <dd>{{ employee.namePrefix || '—' }}</dd>
          </div>
          <div class="row">
            <dt>แผนก</dt>
            <dd>{{ employee.departmentName || '—' }}</dd>
          </div>
          <div class="row">
            <dt>ตำแหน่ง</dt>
            <dd>{{ employee.positionName || '—' }}</dd>
          </div>
          <div class="row">
            <dt>สถานะ</dt>
            <dd>{{ employee.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน' }}</dd>
          </div>
          <div class="row">
            <dt>เลขบัตรประชาชน</dt>
            <dd>
              <span class="mono">{{ revealedId || employee.nationalIdMasked || 'ไม่พร้อมแสดง' }}</span>
              <v-btn
                v-if="employee.nationalIdAvailable && !revealedId"
                size="small"
                variant="outlined"
                class="reveal"
                :loading="revealing"
                @click="reveal"
              >
                ดูเลขเต็ม
              </v-btn>
              <span v-if="revealedId" class="note">การดูเลขเต็มถูกนับเป็นการเข้าถึงหนึ่งครั้งในวันนี้</span>
              <span v-if="!employee.nationalIdAvailable" class="note">
                รายการนี้ยังไม่มีเลขบัตรที่เข้ารหัสด้วยกุญแจของระบบปัจจุบัน
              </span>
            </dd>
          </div>
        </dl>

        <v-alert v-if="revealError" type="warning" variant="tonal" class="mt-4">
          {{ revealError }}
        </v-alert>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 820px;
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
  font-size: 13px;
  color: #5c7176;
}

.back {
  color: #10504e;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 20px;
}

.rows {
  margin: 0;
}

.row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #eef3f2;
}

.row:last-child {
  border-bottom: none;
}

dt {
  font-size: 13px;
  color: #5c7176;
}

dd {
  margin: 0;
  font-size: 14px;
  color: #12343b;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
}

.note {
  font-size: 12px;
  color: #5c7176;
}

.hint {
  color: #5c7176;
  font-size: 14px;
}

@media (max-width: 560px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>
