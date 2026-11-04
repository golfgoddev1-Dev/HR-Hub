<script setup>
import { onMounted, ref } from 'vue'
import HrNav from '../components/HrNav.vue'
import { formatThaiDateLong } from '../lib/thai-date.js'
import { postJson } from '../api.js'

const LOAD_ERROR = 'โหลดวันหยุดไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกไม่สำเร็จ กรุณาลองใหม่'

const loading = ref(true)
const errorMessage = ref('')
const notice = ref('')
const holidays = ref([])

const holidayDate = ref('')
const name = ref('')
const saving = ref(false)
const busyId = ref(null)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/leave/hr/holidays', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    holidays.value = Array.isArray(data.holidays) ? data.holidays : []
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function add() {
  if (saving.value || !holidayDate.value) return
  saving.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    const { status, data } = await postJson('/api/leave/hr/holidays', {
      holiday_date: holidayDate.value,
      name: name.value.trim() || null,
    })
    if (status !== 201 || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    notice.value = 'เพิ่มวันหยุดแล้ว'
    holidayDate.value = ''
    name.value = ''
    await load()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

// holidays is keyed by holiday_date (there is no id column).
async function remove(item) {
  if (busyId.value || !item.holiday_date) return
  busyId.value = item.holiday_date
  notice.value = ''
  errorMessage.value = ''
  try {
    const { status, data } = await postJson(
      `/api/leave/hr/holidays/${encodeURIComponent(item.holiday_date)}/delete`,
      {}
    )
    if (status !== 200 || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    notice.value = 'ลบวันหยุดแล้ว'
    await load()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    busyId.value = null
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
          <h1 class="title">วันหยุดบริษัท</h1>
          <p class="sub">
            วันทำการ = จันทร์–เสาร์ ไม่นับวันอาทิตย์และวันในรายการนี้ ·
            การเพิ่ม/ลบมีผลกับการคำนวณใบลาครั้งถัดไป
          </p>
        </div>
      </div>

      <section class="card">
        <h2 class="card-title">เพิ่มวันหยุด</h2>
        <div class="row">
          <div class="field">
            <label class="label">วันที่</label>
            <input v-model="holidayDate" class="input" type="date" />
          </div>
          <div class="field">
            <label class="label">ชื่อวันหยุด (ไม่บังคับ)</label>
            <input v-model="name" class="input" type="text" maxlength="100" placeholder="เช่น วันสงกรานต์" />
          </div>
        </div>
        <button type="button" class="primary-btn" :disabled="saving || !holidayDate" @click="add">
          {{ saving ? 'กำลังบันทึก…' : 'เพิ่มวันหยุด' }}
        </button>
      </section>

      <section class="card">
        <h2 class="card-title">รายการวันหยุด</h2>

        <p v-if="notice" class="hint success">{{ notice }}</p>
        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3">{{ errorMessage }}</v-alert>

        <p v-if="loading" class="hint">กำลังโหลด…</p>
        <p v-else-if="holidays.length === 0" class="hint">ยังไม่มีวันหยุดในระบบ</p>

        <div v-else class="list">
          <div v-for="item in holidays" :key="item.holiday_date" class="row-item">
            <div class="row-main">
              <span class="row-name">{{ formatThaiDateLong(item.holiday_date) }}</span>
              <span class="row-meta">{{ item.name || 'ไม่ระบุชื่อ' }}</span>
            </div>
            <button
              type="button"
              class="ghost-btn"
              :disabled="!item.holiday_date || busyId === item.holiday_date"
              @click="remove(item)"
            >
              ลบ
            </button>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { min-height: 100vh; background: #f3f6f5; }

.content {
  max-width: 900px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.head { margin-bottom: 16px; }
.title { font-size: 24px; font-weight: 700; color: #12343b; margin: 0 0 6px; }

.sub {
  margin: 0;
  max-width: 680px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 16px;
}

.card-title { margin: 0 0 12px; font-size: 17px; font-weight: 700; color: #12343b; }
.row { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-bottom: 14px; }
.field { min-width: 0; }

.label {
  display: block;
  margin-bottom: 7px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12343b;
}

.input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 14.5px;
}

.primary-btn {
  min-height: 46px;
  padding: 0 20px;
  border: 0;
  border-radius: 12px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn:disabled { background: #d7e0de; color: #7b8b8e; cursor: not-allowed; }

.hint { font-size: 13px; color: #5c7176; margin: 6px 0; }
.hint.success { color: #1c6b3f; }

.list { display: flex; flex-direction: column; }

.row-item {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 4px;
  border-bottom: 1px solid #eef3f2;
}

.row-item:last-child { border-bottom: none; }
.row-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.row-name { font-size: 14px; font-weight: 600; color: #12343b; }
.row-meta { font-size: 12.5px; color: #5c7176; }

.ghost-btn {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #f3c6c6;
  border-radius: 9px;
  background: #fdecec;
  color: #a01b1b;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
