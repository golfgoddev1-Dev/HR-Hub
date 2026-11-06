<script setup>
// System-admin only page: search one employee and set the four permission flags
// that exist in this system. All rules live in src/lib/admin-permissions.js; this
// file is the screen: a debounced search, four switches, a confirm step before
// the system admin flag is switched off, and a save that only runs on a change.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  MIN_SEARCH_LENGTH,
  PERMISSION_FIELDS,
  SEARCH_DEBOUNCE_MS,
  buildPermissionSearchUrl,
  changedFlags,
  emptyPermissionFlags,
  hasPermissionChanges,
  isSearchable,
  permissionToggleBody,
  requiresSystemAdminConfirm,
  searchResultRows,
} from '../lib/admin-permissions.js'
import { invalidateSession } from '../lib/shared-data.js'

const LOAD_ERROR = 'ค้นหาไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกสิทธิ์ไม่สำเร็จ กรุณาลองใหม่'
const SAVED_MESSAGE = 'บันทึกสิทธิ์แล้ว'

const query = ref('')
const results = ref([])
const searching = ref(false)
const searched = ref(false)
const searchError = ref('')

const selected = ref(null)
const saved = ref(null)
const draft = ref(null)
const loadingPerson = ref(false)
const saving = ref(false)
const pendingSystemOff = ref(false)
const statusMessage = ref('')
const errorMessage = ref('')

let debounceTimer = null
let searchTicket = 0

const canSearch = computed(() => isSearchable(query.value))
const hasChanges = computed(() =>
  Boolean(saved.value) && hasPermissionChanges(saved.value, draft.value)
)
const canSave = computed(
  () => Boolean(selected.value) && !saving.value && !pendingSystemOff.value && hasChanges.value
)

// 300 ms after the last keystroke; a shorter query clears the list instead of
// asking the API for something it would refuse.
watch(query, () => {
  window.clearTimeout(debounceTimer)
  resetMessages()
  if (!isSearchable(query.value)) {
    results.value = []
    searched.value = false
    searchError.value = ''
    searching.value = false
    return
  }
  debounceTimer = window.setTimeout(runSearch, SEARCH_DEBOUNCE_MS)
})

function resetMessages() {
  statusMessage.value = ''
  errorMessage.value = ''
}

async function runSearch() {
  const ticket = ++searchTicket
  searching.value = true
  searchError.value = ''

  try {
    const response = await fetch(buildPermissionSearchUrl(query.value), {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (ticket !== searchTicket) return

    if (!response.ok || data.ok !== true) {
      results.value = []
      searched.value = false
      searchError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }

    results.value = searchResultRows(data.results)
    searched.value = true
  } catch {
    if (ticket !== searchTicket) return
    results.value = []
    searched.value = false
    searchError.value = LOAD_ERROR
  } finally {
    if (ticket === searchTicket) searching.value = false
  }
}

async function select(person) {
  if (!person || loadingPerson.value) return
  loadingPerson.value = true
  pendingSystemOff.value = false
  resetMessages()

  try {
    const response = await fetch(`/api/admin/permissions/${encodeURIComponent(person.id)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }

    selected.value = data.employee
    saved.value = { ...emptyPermissionFlags(), ...data.employee.flags }
    draft.value = { ...saved.value }
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loadingPerson.value = false
  }
}

// Switching the system admin flag off shows the confirm block first; every
// other switch applies to the draft immediately.
function onToggle(key, checked) {
  if (!draft.value) return
  resetMessages()

  const next = { ...draft.value, [key]: checked === true }
  if (requiresSystemAdminConfirm(draft.value, next)) {
    draft.value = next
    pendingSystemOff.value = true
    return
  }

  draft.value = next
}

function confirmSystemOff() {
  pendingSystemOff.value = false
}

function cancelSystemOff() {
  if (draft.value) draft.value = { ...draft.value, systemAdmin: true }
  pendingSystemOff.value = false
}

function resetDraft() {
  if (saved.value) draft.value = { ...saved.value }
  pendingSystemOff.value = false
  resetMessages()
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  resetMessages()

  try {
    const response = await fetch(
      `/api/admin/permissions/${encodeURIComponent(selected.value.id)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(permissionToggleBody(draft.value)),
      }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }

    if (data.employee) {
      selected.value = data.employee
      saved.value = { ...emptyPermissionFlags(), ...data.employee.flags }
    } else {
      saved.value = { ...draft.value }
    }
    draft.value = { ...saved.value }
    pendingSystemOff.value = false
    statusMessage.value = SAVED_MESSAGE
    // The edited user's role rights changed, so the cached session (and the
    // admin landing counts) must be read again by their next page.
    invalidateSession()
  } catch {
    errorMessage.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(() => window.clearTimeout(debounceTimer))
</script>

<template>
  <main class="content">
    <header class="head">
      <span class="eyebrow">
        <span class="material-symbols-outlined eyebrow-icon">shield_person</span>
        ศูนย์ควบคุมระบบ
      </span>
      <h1 class="title">จัดการสิทธิ์ผู้ใช้</h1>
      <p class="sub">
        ค้นหาพนักงานด้วยชื่อหรือรหัสพนักงาน แล้วกำหนดสิทธิ์ทั้งสี่ประเภท
        การเปลี่ยนแปลงมีผลกับคำขอถัดไปของผู้ใช้คนนั้นทันที
      </p>
    </header>

    <section class="card">
      <label class="label" for="permission-search">ค้นหาพนักงาน</label>
      <div class="search-box">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          id="permission-search"
          v-model="query"
          class="input"
          type="search"
          autocomplete="off"
          placeholder="ชื่อ หรือรหัสพนักงาน"
        />
      </div>

      <p v-if="query.length > 0 && !canSearch" class="hint">
        พิมพ์อย่างน้อย {{ MIN_SEARCH_LENGTH }} ตัวอักษรเพื่อค้นหา
      </p>
      <p v-if="searching" class="hint" role="status">กำลังค้นหา…</p>
      <p v-else-if="searchError" class="hint error" role="alert">{{ searchError }}</p>

      <ul v-if="results.length > 0" class="results">
        <li v-for="person in results" :key="person.id">
          <button
            type="button"
            class="result"
            :class="{ 'result-active': selected !== null && selected.id === person.id }"
            @click="select(person)"
          >
            <span class="result-name">{{ person.fullName || '—' }}</span>
            <span class="result-meta">
              <span class="material-symbols-outlined meta-icon">badge</span>
              {{ person.employeeCode || '—' }}
              <span class="dot">·</span>
              {{ person.departmentName || '—' }}
            </span>
            <span v-if="person.isActive === false" class="chip chip-off">ปิดใช้งาน</span>
          </button>
        </li>
      </ul>
      <p v-else-if="searched && !searching && !searchError" class="hint">
        ไม่พบพนักงานที่ตรงกับคำค้น
      </p>
    </section>

    <section v-if="selected && draft" class="card" :aria-busy="loadingPerson ? 'true' : 'false'">
      <div class="card-head">
        <div class="person">
          <span class="material-symbols-outlined avatar">person</span>
          <span class="person-text">
            <span class="person-name">{{ selected.fullName || '—' }}</span>
            <span class="person-meta">
              {{ selected.employeeCode || '—' }} · {{ selected.departmentName || '—' }}
            </span>
          </span>
        </div>
        <span v-if="selected.isActive === false" class="chip chip-off">ปิดใช้งาน</span>
      </div>

      <p v-if="selected.isActive === false" class="notice">
        <span class="material-symbols-outlined notice-icon">info</span>
        <span>พนักงานคนนี้ปิดใช้งานอยู่ จึงเพิ่มสิทธิ์ใหม่ไม่ได้ (ถอดสิทธิ์เดิมได้)</span>
      </p>

      <div class="switches">
        <label
          v-for="field in PERMISSION_FIELDS"
          :key="field.key"
          class="switch-row"
          :for="`permission-${field.key}`"
        >
          <span class="switch-text">
            <span class="switch-title">
              <span class="material-symbols-outlined switch-icon">{{ field.icon }}</span>
              {{ field.label }}
            </span>
            <span class="switch-desc">{{ field.description }}</span>
          </span>
          <span class="switch-control">
            <input
              :id="`permission-${field.key}`"
              class="switch-input"
              type="checkbox"
              role="switch"
              :checked="draft[field.key] === true"
              :disabled="saving || loadingPerson"
              @change="onToggle(field.key, $event.target.checked)"
            />
            <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
          </span>
        </label>
      </div>

      <div v-if="pendingSystemOff" class="confirm">
        <p class="confirm-text">
          ยืนยันถอดสิทธิ์ “ผู้ดูแลระบบ” ของ {{ selected.fullName || 'พนักงานคนนี้' }}?
          ผู้ใช้จะไม่สามารถเข้าถึงหน้าผู้ดูแลได้อีก
        </p>
        <div class="confirm-actions">
          <button type="button" class="danger-btn" @click="confirmSystemOff">
            ยืนยันถอดสิทธิ์
          </button>
          <button type="button" class="ghost-btn" @click="cancelSystemOff">ยกเลิก</button>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="primary-btn" :disabled="!canSave" @click="save">
          {{ saving ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์' }}
        </button>
        <button
          type="button"
          class="ghost-btn"
          :disabled="saving || !hasChanges"
          @click="resetDraft"
        >
          ยกเลิกการแก้ไข
        </button>
      </div>

      <p v-if="statusMessage" class="status" role="status">{{ statusMessage }}</p>
      <p v-if="errorMessage" class="hint error" role="alert">{{ errorMessage }}</p>
    </section>
  </main>
</template>

<style scoped>

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

.content {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 0 64px;
}

.content,
.content * {
  box-sizing: border-box;
}

.head {
  margin-bottom: 18px;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(133, 248, 196, 0.18);
  border: 1px solid rgba(16, 80, 78, 0.12);
  color: #10504e;
  font-size: 12px;
  font-weight: 600;
}

.eyebrow-icon {
  font-size: 15px;
}

.title {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  letter-spacing: -0.01em;
}

.sub {
  margin: 0;
  max-width: 640px;
  font-size: 13px;
  line-height: 1.65;
  color: #5c7176;
}

.card {
  margin-bottom: 16px;
  padding: 18px;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(18, 52, 59, 0.05);
}

.label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #12343b;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 12px;
  border: 1px solid #cfdcda;
  border-radius: 12px;
  background: #ffffff;
}

.search-icon {
  font-size: 19px;
  color: #5c7176;
  flex: 0 0 auto;
}

.input {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  padding: 12px 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  color: #12343b;
}

.search-box:focus-within {
  border-color: #0f6f63;
  box-shadow: 0 0 0 3px rgba(15, 111, 99, 0.12);
}

.hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #7c8f93;
  overflow-wrap: anywhere;
}

.hint.error {
  color: #b3261e;
}

.results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid #e4ecea;
  border-radius: 12px;
  background: #ffffff;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.result:hover {
  border-color: #b7cecb;
  background: #f7fbfa;
}

.result-active {
  border-color: #0f6f63;
  background: #f0f7f6;
}

.result-name {
  flex: 1 1 140px;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
  overflow-wrap: anywhere;
}

.result-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  font-size: 12.5px;
  color: #5c7176;
  overflow-wrap: anywhere;
}

.meta-icon {
  font-size: 15px;
  color: #7c8f93;
}

.dot {
  color: #b3c2c0;
}

.chip {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.chip-off {
  border: 1px solid #e2c7a6;
  background: #fdf5ea;
  color: #8a5a17;
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 14px;
}

.person {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: #f0f7f6;
  color: #10504e;
  font-size: 21px;
}

.person-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.person-name {
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
  overflow-wrap: anywhere;
}

.person-meta {
  font-size: 12.5px;
  color: #5c7176;
  overflow-wrap: anywhere;
}

.notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #f0d6a8;
  border-radius: 12px;
  background: #fffaf0;
  color: #7a5216;
  font-size: 12.5px;
  line-height: 1.6;
}

.notice-icon {
  font-size: 18px;
  flex: 0 0 auto;
}

.switches {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.switch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e8efed;
  border-radius: 12px;
  background: #ffffff;
  cursor: pointer;
}

.switch-text {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.switch-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.switch-icon {
  font-size: 18px;
  color: #10504e;
}

.switch-desc {
  font-size: 12px;
  line-height: 1.5;
  color: #7c8f93;
}

.switch-control {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 26px;
}

.switch-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.switch-track {
  display: block;
  width: 46px;
  height: 26px;
  border-radius: 999px;
  background: #cfdad8;
  transition: background-color 0.18s ease;
}

.switch-knob {
  display: block;
  width: 20px;
  height: 20px;
  margin: 3px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.18s ease;
}

.switch-input:checked + .switch-track {
  background: #0f6f63;
}

.switch-input:checked + .switch-track .switch-knob {
  transform: translateX(20px);
}

.switch-input:focus-visible + .switch-track {
  outline: 3px solid #0f6f63;
  outline-offset: 2px;
}

.switch-input:disabled {
  cursor: not-allowed;
}

.switch-input:disabled + .switch-track {
  opacity: 0.55;
}

.confirm {
  margin-top: 14px;
  padding: 12px;
  border: 1px solid #f0d6a8;
  border-radius: 12px;
  background: #fffaf0;
}

.confirm-text {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.6;
  color: #7a5216;
  overflow-wrap: anywhere;
}

.confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.primary-btn,
.danger-btn,
.ghost-btn {
  padding: 10px 16px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn {
  border: 1px solid #0f6f63;
  background: #0f6f63;
  color: #ffffff;
}

.primary-btn:disabled {
  border-color: #cfdad8;
  background: #e6edec;
  color: #94a5a7;
  cursor: not-allowed;
}

.danger-btn {
  border: 1px solid #b3261e;
  background: #b3261e;
  color: #ffffff;
}

.ghost-btn {
  border: 1px solid #cfdcda;
  background: #ffffff;
  color: #12343b;
}

.ghost-btn:disabled {
  color: #94a5a7;
  cursor: not-allowed;
}

.status {
  margin: 12px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: #0f6f63;
}

@media (max-width: 420px) {
  .title {
    font-size: 21px;
  }

  .card {
    padding: 14px;
  }
}
</style>
