<script setup>
import { computed, ref, watch } from 'vue'

import EmployeePicker from './EmployeePicker.vue'
import { putJson } from '../api.js'
import {
  SHIFT_LABEL_DUPLICATE,
  SHIFT_LABEL_MAX_LENGTH,
  SHIFT_LEADS_ADD_LABEL,
  SHIFT_LEADS_LIMIT,
  SHIFT_LEADS_SAVE_LABEL,
  SHIFT_LEAD_EMAIL_WARNING,
  hasDuplicateShiftLabels,
  normalizeShiftLabel,
  shiftLabelError,
  shiftLabelLength,
  shiftLeadEmployee,
  shiftLeadPayload,
  shiftLeadRowFromApi,
  shiftLeadsPath,
} from '../lib/shift-leads.js'

const props = defineProps({
  departmentId: { type: String, default: '' },
  departmentName: { type: String, default: '' },
})

const LOAD_ERROR = 'โหลดหัวหน้ากะไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกไม่สำเร็จ กรุณาลองใหม่'
const SAVED_NOTICE = 'บันทึกหัวหน้ากะแล้ว'

const rows = ref([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const notice = ref('')
const loadError = ref('')

const canAdd = computed(() => !saving.value && rows.value.length < SHIFT_LEADS_LIMIT)

const duplicateLabel = computed(() =>
  hasDuplicateShiftLabels(rows.value.map((row) => row.shiftLabel))
)

const canSave = computed(() => {
  if (saving.value) return false
  if (duplicateLabel.value) return false
  return rows.value.every(
    (row) => row.employee && shiftLabelError(row.shiftLabel) === '' && row.shiftLabel
  )
})

function rowFromApi(row) {
  return shiftLeadRowFromApi(row)
}

async function load() {
  rows.value = []
  errorMessage.value = ''
  notice.value = ''
  loadError.value = ''
  if (!props.departmentId) return

  loading.value = true
  try {
    const response = await fetch(shiftLeadsPath(props.departmentId), {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      loadError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    rows.value = (Array.isArray(data.leads) ? data.leads : []).map(rowFromApi)
  } catch {
    loadError.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

watch(
  () => props.departmentId,
  () => {
    load()
  },
  { immediate: true }
)

function addRow() {
  if (!canAdd.value) return
  errorMessage.value = ''
  notice.value = ''
  rows.value.push({ employee: null, shiftLabel: '' })
}

function removeRow(index) {
  rows.value.splice(index, 1)
  errorMessage.value = ''
  notice.value = ''
}

function selectEmployee(row, person) {
  row.employee = shiftLeadEmployee(person)
  errorMessage.value = ''
  notice.value = ''
}

function labelProblem(row) {
  if (duplicateLabel.value) return SHIFT_LABEL_DUPLICATE
  return shiftLabelError(row.shiftLabel)
}

async function save() {
  if (!canSave.value) {
    if (duplicateLabel.value) errorMessage.value = SHIFT_LABEL_DUPLICATE
    return
  }

  saving.value = true
  errorMessage.value = ''
  notice.value = ''
  loadError.value = ''

  try {
    const { status, data } = await putJson(shiftLeadsPath(props.departmentId), shiftLeadPayload(rows.value))
    if (status !== 200 || data.ok !== true) {
      // Keep exactly what the user typed; only the message changes.
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    rows.value = (Array.isArray(data.leads) ? data.leads : []).map(rowFromApi)
    notice.value = SAVED_NOTICE
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

function employeeLabel(row) {
  return row.employee?.fullName || ''
}

function labelCount(row) {
  return `${shiftLabelLength(row.shiftLabel)}/${SHIFT_LABEL_MAX_LENGTH}`
}
</script>

<template>
  <section class="card shift-card">
    <div class="card-head">
      <h2 class="card-title">หัวหน้ากะที่รับแจ้งทราบ</h2>
      <span class="limit-chip">{{ rows.length }}/{{ SHIFT_LEADS_LIMIT }}</span>
    </div>
    <p class="sub">
      {{ departmentName ? `แผนก ${departmentName} · ` : '' }}
      แจ้งเตือนอัตโนมัติเมื่อใบลาได้รับการอนุมัติหรือไม่อนุมัติ · ตั้งได้สูงสุด
      {{ SHIFT_LEADS_LIMIT }} คน
    </p>

    <p v-if="loading" class="hint">กำลังโหลด…</p>

    <template v-else>
      <p v-if="loadError" class="hint error">
        {{ loadError }}
        <button type="button" class="retry-btn" @click="load">ลองใหม่</button>
      </p>

      <p v-if="rows.length === 0 && !loadError" class="hint">
        ยังไม่มีหัวหน้ากะสำหรับแผนกนี้
      </p>

      <div v-for="(row, index) in rows" :key="index" class="lead-row">
        <div class="lead-fields">
          <EmployeePicker
            :model-value="row.employee"
            :department-id="departmentId"
            :label="`หัวหน้ากะคนที่ ${index + 1}`"
            placeholder="พิมพ์ชื่อหรือรหัสพนักงาน"
            @update:model-value="selectEmployee(row, $event)"
          />

          <label class="label" :for="`shift-label-${index}`">ชื่อกะ</label>
          <div class="label-line">
            <input
              :id="`shift-label-${index}`"
              v-model="row.shiftLabel"
              class="label-input"
              type="text"
              :maxlength="SHIFT_LABEL_MAX_LENGTH"
              autocomplete="off"
              placeholder="เช่น กะ A, กะเช้า"
            />
            <span class="counter">{{ labelCount(row) }}</span>
          </div>
          <p v-if="row.shiftLabel && labelProblem(row)" class="hint error">
            {{ labelProblem(row) }}
          </p>

          <p v-if="row.employee && row.employee.hasEmail === false" class="hint warning">
            {{ SHIFT_LEAD_EMAIL_WARNING }}
          </p>
        </div>

        <div class="lead-actions">
          <button
            type="button"
            class="ghost-btn"
            :disabled="saving"
            :aria-label="`ลบหัวหน้ากะคนที่ ${index + 1}`"
            @click="removeRow(index)"
          >
            ลบ
          </button>
        </div>
      </div>

      <p v-if="duplicateLabel" class="hint error">{{ SHIFT_LABEL_DUPLICATE }}</p>
      <p v-if="errorMessage" class="hint error" role="alert">{{ errorMessage }}</p>
      <p v-if="notice" class="hint success">{{ notice }}</p>

      <div class="actions">
        <button type="button" class="ghost-btn add-btn" :disabled="!canAdd" @click="addRow">
          {{ SHIFT_LEADS_ADD_LABEL }}
        </button>
        <button type="button" class="primary-btn" :disabled="!canSave" @click="save">
          {{ saving ? 'กำลังบันทึก…' : SHIFT_LEADS_SAVE_LABEL }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 16px;
  box-sizing: border-box;
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.limit-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 1px 10px;
  border-radius: 999px;
  background: #e3f1ec;
  color: #10504e;
  font-size: 12px;
  font-weight: 700;
}

.sub {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: #5c7176;
  overflow-wrap: anywhere;
}

.lead-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid #eef3f2;
}

.lead-fields {
  min-width: 0;
}

.label {
  display: block;
  margin-bottom: 7px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12343b;
}

.label-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.label-input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 16px;
}

.counter {
  flex: 0 0 auto;
  font-size: 12px;
  color: #5c7176;
}

.lead-actions {
  display: grid;
  align-content: start;
}

.ghost-btn {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.ghost-btn:hover { background: #f4f8f7; }
.ghost-btn:focus-visible { outline: 3px solid #0f6f63; outline-offset: 2px; }
.ghost-btn:disabled { opacity: 0.55; cursor: not-allowed; }

.primary-btn {
  min-height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 700;
  cursor: pointer;
}

.primary-btn:disabled { background: #d7e0de; color: #7b8b8e; cursor: not-allowed; }

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.add-btn { flex: 1 1 160px; }
.primary-btn { flex: 1 1 160px; }

.hint { margin: 6px 0; font-size: 13px; color: #5c7176; }
.hint.error { color: #a01b1b; }
.hint.warning { color: #8a5a00; }
.hint.success { color: #1c6b3f; }

.retry-btn {
  min-height: 32px;
  margin-left: 8px;
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

/* The shared picker's search input follows the mobile text rule here. */
.shift-card :deep(.picker .input) { font-size: 16px; }

@media (max-width: 480px) {
  .lead-row { grid-template-columns: 1fr; }
  .lead-actions { grid-template-columns: 1fr; }
  .ghost-btn { width: 100%; }
  .actions { flex-direction: column; }
  .add-btn,
  .primary-btn { flex-basis: auto; width: 100%; }
}
</style>
