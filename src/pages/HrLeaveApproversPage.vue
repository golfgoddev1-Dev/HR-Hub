<script setup>
import { computed, onMounted, ref } from 'vue'
import EmployeePicker from '../components/EmployeePicker.vue'
import ShiftLeadsSection from '../components/ShiftLeadsSection.vue'
import { postJson } from '../api.js'
import {
  applyApproverToggle,
  approverRows,
  approverStatusText,
  approverToggleLabel,
  approverToggleNotice,
  approverTogglePath,
} from '../lib/leave-approvers-view.js'
import { peekCached } from '../lib/data-cache.js'
import {
  APPROVALS_TTL_MS,
  dataKey,
  errorTextOf,
  invalidateApprovals,
  invalidateApproverConfig,
  loadHrDepartments,
  loaders,
  loadShared,
} from '../lib/shared-data.js'

const LOAD_ERROR = 'โหลดรายการผู้อนุมัติไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกไม่สำเร็จ กรุณาลองใหม่'
const DEPARTMENTS_ERROR = 'โหลดรายชื่อแผนกไม่สำเร็จ กรุณาลองใหม่'

const scope = ref('department')
const rows = ref([])
const departments = ref([])
const departmentsLoading = ref(false)
const departmentsError = ref('')
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
const selectedDepartmentName = computed(
  () => departments.value.find((item) => item.id === departmentId.value)?.name || ''
)
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

// Departments come from the one shared HR loader (active rows only). A failed
// read clears the list and shows a retry instead of an empty "ไม่พบแผนก" picker.
async function loadDepartments() {
  departmentsError.value = ''
  departmentsLoading.value = true
  try {
    departments.value = await loadHrDepartments()
  } catch (error) {
    departments.value = []
    departmentsError.value = errorTextOf(error, DEPARTMENTS_ERROR)
  } finally {
    departmentsLoading.value = false
  }
}

async function load(options) {
  const quiet = options?.quiet === true
  const departmentId =
    scope.value === 'department' && departmentFilter.value ? departmentFilter.value : null
  const key = dataKey.hrApprovers(scope.value, departmentId)
  if (!quiet) {
    loading.value = !peekCached(key)
    errorMessage.value = ''
  }
  try {
    await loadShared(key, loaders.hrApprovers(scope.value, departmentId), {
      // The list carries pending counts, so it is only trusted for a minute.
      ttlMs: APPROVALS_TTL_MS,
      onData: (data) => {
        rows.value = approverRows(data.results)
      },
    })
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
    if (!quiet) rows.value = []
  } finally {
    if (!quiet) loading.value = false
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
    invalidateApproverConfig()
    invalidateApprovals()
    await load()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

// Switches one row either way: active rows are deactivated, inactive rows are
// switched back on. The row stays in the list in both cases.
async function toggle(item) {
  if (busyId.value) return
  busyId.value = item.id
  notice.value = ''
  errorMessage.value = ''

  try {
    const { status, data } = await postJson(
      approverTogglePath(item.id, scope.value, item.isActive),
      {}
    )
    if (status !== 200 || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    // Update the row straight away; the reload below only reconciles the rest.
    if (!applyApproverToggle(item, data)) {
      errorMessage.value = SAVE_ERROR
      return
    }
    notice.value = approverToggleNotice(item.isActive, item.pendingCount)
    invalidateApproverConfig()
    invalidateApprovals()
    await load({ quiet: true })
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    busyId.value = null
  }
}

onMounted(async () => {
  await loadDepartments()
  await load()
})
</script>

<template>

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">ตั้งค่าผู้อนุมัติ</h1>
          <p class="sub">
            รายบุคคลจะถูกใช้ก่อนระดับแผนก · เลข priority น้อยกว่าถูกเลือกก่อน ·
            สลับเปิด/ปิดใช้งานได้ (ไม่ลบแถว) เพื่อไม่ให้ใบลาค้างอ้างถึงแถวที่หายไป
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
          <p v-if="departmentsError" class="hint error departments-error">
            {{ departmentsError }}
            <button type="button" class="retry-btn" @click="loadDepartments">ลองใหม่</button>
          </p>
          <v-select
            v-else
            v-model="departmentId"
            :items="departments"
            item-title="name"
            item-value="id"
            variant="outlined"
            density="comfortable"
            hide-details
            placeholder="เลือกแผนก"
            :no-data-text="departmentsLoading ? 'กำลังโหลด…' : 'ไม่พบแผนก'"
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

      <!-- Per-department setup: who hears about every decision in this
           department. The section owns its own read and save. -->
      <ShiftLeadsSection
        v-if="!isEmployeeScope && departmentId"
        :key="departmentId"
        :department-id="departmentId"
        :department-name="selectedDepartmentName"
      />
      <p v-else-if="!isEmployeeScope" class="hint">
        เลือกแผนกเพื่อตั้งหัวหน้ากะที่รับแจ้งทราบ
      </p>

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
              <span class="row-name-line">
                <span class="row-name">
                  <template v-if="isEmployeeScope">
                    {{ item.employeeName || '—' }} → {{ item.approverName || '—' }}
                  </template>
                  <template v-else>
                    {{ item.departmentName || '—' }} → {{ item.employeeName || '—' }}
                  </template>
                </span>
                <span class="status-chip" :class="item.isActive ? 'chip-on' : 'chip-off'">
                  {{ approverStatusText(item.isActive) }}
                </span>
              </span>
              <span class="row-meta"> priority {{ item.priority }} · ใบลาค้าง {{ item.pendingCount }} ใบ </span>
            </div>
            <button
              type="button"
              class="toggle-btn"
              :class="item.isActive ? 'toggle-btn-off' : 'toggle-btn-on'"
              :disabled="busyId === item.id"
              @click="toggle(item)"
            >
              <svg
                v-if="item.isActive"
                class="btn-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="currentColor"
                  d="M17 7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h10c2.76 0 5-2.24 5-5s-2.24-5-5-5zM7 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"
                />
              </svg>
              <svg
                v-else
                class="btn-icon"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="currentColor"
                  d="M17 7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h10c2.76 0 5-2.24 5-5s-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"
                />
              </svg>
              <span class="btn-label">
                {{ busyId === item.id ? 'กำลังบันทึก…' : approverToggleLabel(item.isActive) }}
              </span>
            </button>
          </div>
        </div>
      </section>
    </main>
</template>

<style scoped>
.content {
  max-width: 900px;
  margin: 0 auto;
  padding: 28px 0 64px;
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

.departments-error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.retry-btn {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid #e2b6b6;
  border-radius: 8px;
  background: #ffffff;
  color: #a01b1b;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.retry-btn:focus-visible { outline: 3px solid #0f6f63; outline-offset: 2px; }

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

/* A switched-off approver keeps normal text; only a faint tint marks the row. */
.row-off { background: #fafbfb; }

.row-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 220px; }
.row-name-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.row-name { font-size: 14px; font-weight: 600; color: #12343b; overflow-wrap: anywhere; }
.row-meta { font-size: 12.5px; color: #5c7176; }

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 1px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.chip-on { background: #e3f1ec; border-color: #b9d9cf; color: #10504e; }
.chip-off { background: #edf1f1; border-color: #d9e2e0; color: #5c7176; }

.toggle-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 15px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.toggle-btn-on { background: #10504e; border-color: #10504e; color: #ffffff; }
.toggle-btn-on:hover { background: #0b3f3d; border-color: #0b3f3d; box-shadow: 0 3px 10px rgba(16, 80, 78, 0.3); }
.toggle-btn-on:active { background: #08302f; }

.toggle-btn-off { background: #ffffff; border-color: #e2b6b6; color: #a01b1b; }
.toggle-btn-off:hover { background: #fdf1f1; border-color: #c48181; box-shadow: 0 3px 10px rgba(160, 27, 27, 0.14); }
.toggle-btn-off:active { background: #fbe6e6; }

.toggle-btn:focus-visible { outline: 3px solid #0f6f63; outline-offset: 2px; }
.toggle-btn:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }

.btn-icon { flex: 0 0 auto; }

@media (max-width: 520px) {
  .row { align-items: flex-start; }
  .row-main { flex-basis: 100%; }
  .toggle-btn { width: 100%; }
}
</style>
