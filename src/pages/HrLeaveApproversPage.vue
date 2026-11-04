<script setup>
import { computed, onMounted, ref } from 'vue'
import HrNav from '../components/HrNav.vue'
import EmployeePicker from '../components/EmployeePicker.vue'
import { postJson } from '../api.js'

const LOAD_ERROR = 'โหลดรายการผู้อนุมัติไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกไม่สำเร็จ กรุณาลองใหม่'

const scope = ref('department')
const rows = ref([])
const departments = ref([])
const departmentFilter = ref(null)
const loading = ref(true)
const errorMessage = ref('')
const notice = ref('')
const saving = ref(false)
const busyId = ref(null)

const approver = ref(null)
const applicant = ref(null)
const departmentId = ref(null)
const priority = ref(100)

const isEmployeeScope = computed(() => scope.value === 'employee')
const canAdd = computed(() => {
  if (saving.value) return false
  if (!approver.value) return false
  if (isEmployeeScope.value) {
    if (!applicant.value) return false
    return applicant.value.id !== approver.value.id
  }
  return Boolean(departmentId.value)
})

function employeeName(item) {
  if (!item?.fullName) return '—'
  const prefix = item.namePrefix
  return prefix && !item.fullName.startsWith(prefix) ? `${prefix} ${item.fullName}` : item.fullName
}

async function loadOptions() {
  try {
    const response = await fetch('/api/hr/directory/catalog', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    departments.value = Array.isArray(data.departments) ? data.departments : []
  } catch {
    departments.value = []
  }
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams({ scope: scope.value })
    if (scope.value === 'department' && departmentFilter.value) {
      params.set('departmentId', departmentFilter.value)
    }
    const response = await fetch(`/api/leave/hr/approvers?${params.toString()}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      rows.value = []
      return
    }
    rows.value = Array.isArray(data.results) ? data.results : []
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function switchScope(next) {
  scope.value = next
  notice.value = ''
  approver.value = null
  applicant.value = null
  await load()
}

async function add() {
  if (!canAdd.value) return
  saving.value = true
  notice.value = ''
  errorMessage.value = ''

  const body = {
    scope: scope.value,
    employeeId: approver.value.id,
    priority: Number(priority.value),
  }
  if (isEmployeeScope.value) body.applicantId = applicant.value.id
  else body.departmentId = departmentId.value

  try {
    const { status, data } = await postJson('/api/leave/hr/approvers', body)
    if (status !== 201 || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    notice.value = 'เพิ่มผู้อนุมัติแล้ว'
    approver.value = null
    applicant.value = null
    await load()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

async function deactivate(item) {
  if (busyId.value) return
  busyId.value = item.id
  notice.value = ''
  errorMessage.value = ''
  try {
    const { status, data } = await postJson(
      `/api/leave/hr/approvers/${encodeURIComponent(item.id)}/deactivate?scope=${scope.value}`,
      {}
    )
    if (status !== 200 || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    notice.value =
      data.pendingCount > 0
        ? `ปิดใช้งานแล้ว · ยังมีใบลาค้าง ${data.pendingCount} ใบ (เก็บแถวไว้ ไม่ลบ)`
        : 'ปิดใช้งานแล้ว'
    await load()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    busyId.value = null
  }
}

onMounted(async () => {
  await loadOptions()
  await load()
})
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">ตั้งค่าผู้อนุมัติ</h1>
          <p class="sub">
            รายบุคคลจะถูกใช้ก่อนระดับแผนก · เลข priority น้อยกว่าถูกเลือกก่อน ·
            ปิดใช้งานได้อย่างเดียว (ไม่ลบแถว) เพื่อไม่ให้ใบลาค้างอ้างถึงแถวที่หายไป
          </p>
        </div>
      </div>

      <div class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': scope === 'department' }"
          @click="switchScope('department')"
        >
          ระดับแผนก
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': scope === 'employee' }"
          @click="switchScope('employee')"
        >
          รายบุคคล
        </button>
      </div>

      <section class="card">
        <h2 class="card-title">เพิ่มผู้อนุมัติ</h2>

        <div v-if="!isEmployeeScope" class="field">
          <label class="label">แผนก</label>
          <v-select
            v-model="departmentId"
            :items="departments"
            item-title="name"
            item-value="id"
            variant="outlined"
            density="comfortable"
            hide-details
            placeholder="เลือกแผนก"
            no-data-text="ไม่พบแผนก"
          />
        </div>

        <EmployeePicker v-if="isEmployeeScope" v-model="applicant" label="พนักงานที่ต้องการตั้งผู้อนุมัติ" />
        <EmployeePicker v-model="approver" label="ผู้อนุมัติ" />

        <div class="field">
          <label class="label">ลำดับความสำคัญ (1–999, น้อยก่อน)</label>
          <input v-model.number="priority" class="input" type="number" min="1" max="999" />
        </div>

        <p v-if="isEmployeeScope && applicant && approver && applicant.id === approver.id" class="hint error">
          ผู้อนุมัติต้องไม่ใช่พนักงานคนเดียวกัน
        </p>

        <button type="button" class="primary-btn" :disabled="!canAdd" @click="add">
          {{ saving ? 'กำลังบันทึก…' : 'เพิ่มผู้อนุมัติ' }}
        </button>
      </section>

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">รายการผู้อนุมัติ</h2>
          <div v-if="!isEmployeeScope" class="filter">
            <v-select
              v-model="departmentFilter"
              :items="departments"
              item-title="name"
              item-value="id"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              placeholder="ทุกแผนก"
              @update:model-value="load"
            />
          </div>
        </div>

        <p v-if="notice" class="hint success">{{ notice }}</p>
        <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-3">{{ errorMessage }}</v-alert>

        <p v-if="loading" class="hint">กำลังโหลด…</p>
        <p v-else-if="rows.length === 0" class="hint">ยังไม่มีรายการในขอบเขตนี้</p>

        <div v-else class="list">
          <div v-for="item in rows" :key="item.id" class="row" :class="{ 'row-off': !item.isActive }">
            <div class="row-main">
              <span class="row-name">
                <template v-if="isEmployeeScope">
                  {{ item.employeeName || '—' }} → {{ item.approverName || '—' }}
                </template>
                <template v-else>
                  {{ item.departmentName || '—' }} → {{ item.employeeName || '—' }}
                </template>
              </span>
              <span class="row-meta">
                priority {{ item.priority }} · ใบลาค้าง {{ item.pendingCount }} ใบ ·
                {{ item.isActive ? 'ใช้งานอยู่' : 'ปิดใช้งานแล้ว' }}
              </span>
            </div>
            <button
              type="button"
              class="ghost-btn"
              :disabled="!item.isActive || busyId === item.id"
              @click="deactivate(item)"
            >
              {{ item.isActive ? 'ปิดใช้งาน' : 'ปิดใช้งานแล้ว' }}
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

.tabs { display: flex; gap: 8px; margin-bottom: 16px; }

.tab {
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid #cfdcda;
  border-radius: 999px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.tab-active { background: #10504e; border-color: #10504e; color: #ffffff; }

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 16px;
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.card-title { margin: 0 0 12px; font-size: 17px; font-weight: 700; color: #12343b; }
.card-head .card-title { margin: 0; }

.filter { min-width: 220px; }
.field { margin-bottom: 16px; }

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
  width: 100%;
  min-height: 46px;
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
.hint.error { color: #a01b1b; }

.list { display: flex; flex-direction: column; }

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 4px;
  border-bottom: 1px solid #eef3f2;
}

.row:last-child { border-bottom: none; }
.row-off { opacity: 0.6; }

.row-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.row-name { font-size: 14px; font-weight: 600; color: #12343b; }
.row-meta { font-size: 12.5px; color: #5c7176; }

.ghost-btn {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid #cfdcda;
  border-radius: 9px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
