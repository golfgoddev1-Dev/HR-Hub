<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  // API base for this role, e.g. /api/hr/directory or /api/meeting/directory.
  base: { type: String, required: true },
})

const MIN_SEARCH_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 300
const NAME_MAX_LENGTH = 100

const HINT_TOO_SHORT = 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา'
const EMPTY_TEXT = 'ไม่พบพนักงานที่ตรงกับคำค้น'
const SEARCH_ERROR = 'ไม่สามารถค้นหาได้ กรุณาลองใหม่'
const CATALOG_ERROR = 'โหลดรายการแผนกและตำแหน่งไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'
const SAVED_TEXT = 'บันทึกข้อมูลพนักงานแล้ว'
const RENAMED_TEXT = 'บันทึกชื่อใหม่แล้ว'
const RENAME_NOTE = 'การนำเข้าไฟล์ต้องใช้ชื่อใหม่ตามที่เปลี่ยนแล้ว'
const RENAME_HINT = 'ชื่อต้องไม่ว่าง ยาวไม่เกิน 100 ตัวอักษร และห้ามซ้ำกับรายการอื่น'

const query = ref('')
const results = ref([])
const searching = ref(false)
const searchError = ref('')
const searched = ref(false)

const catalog = ref({ departments: [], positions: [] })
const catalogLoading = ref(true)
const catalogError = ref('')

const selected = ref(null)
const form = ref({ departmentId: '', positionId: '' })
const saving = ref(false)
const saveError = ref('')
const saveMessage = ref('')

const renaming = ref({ kind: '', id: '' })
const renameValue = ref('')
const renameBusy = ref(false)
const renameError = ref('')
const renameMessage = ref('')

let debounceId = null
let searchSeq = 0

async function requestJson(method, url, body) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  let data = {}
  try {
    data = await response.json()
  } catch {
    data = {}
  }
  return { ok: response.ok, data }
}

async function loadCatalog() {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const { ok, data } = await requestJson('GET', `${props.base}/catalog`)
    if (!ok || data.ok !== true) {
      catalogError.value = typeof data.message === 'string' ? data.message : CATALOG_ERROR
      return
    }
    catalog.value = {
      departments: Array.isArray(data.departments) ? data.departments : [],
      positions: Array.isArray(data.positions) ? data.positions : [],
    }
  } catch {
    catalogError.value = CATALOG_ERROR
  } finally {
    catalogLoading.value = false
  }
}

async function runSearch(term) {
  const seq = ++searchSeq
  searching.value = true
  searchError.value = ''
  try {
    const params = new URLSearchParams({ q: term })
    const { ok, data } = await requestJson('GET', `${props.base}/employees?${params.toString()}`)
    if (seq !== searchSeq) return
    if (!ok || data.ok !== true) {
      results.value = []
      searched.value = false
      searchError.value = typeof data.message === 'string' ? data.message : SEARCH_ERROR
      return
    }
    results.value = Array.isArray(data.results) ? data.results : []
    searched.value = true
  } catch {
    if (seq !== searchSeq) return
    results.value = []
    searched.value = false
    searchError.value = SEARCH_ERROR
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}

watch(query, (value) => {
  if (debounceId) clearTimeout(debounceId)
  searchSeq += 1
  searchError.value = ''
  searched.value = false

  const term = value.trim()
  if (term.length < MIN_SEARCH_LENGTH) {
    results.value = []
    searching.value = false
    return
  }

  debounceId = setTimeout(() => {
    debounceId = null
    runSearch(term)
  }, SEARCH_DEBOUNCE_MS)
})

const hint = computed(() => {
  const term = query.value.trim()
  if (term.length === 0) return ''
  if (term.length < MIN_SEARCH_LENGTH) return HINT_TOO_SHORT
  return ''
})

const hasCatalog = computed(
  () => catalog.value.departments.length > 0 && !catalogLoading.value
)

function departmentName(id) {
  if (!id) return '—'
  const found = catalog.value.departments.find((item) => item.id === id)
  return found ? found.name : '—'
}

function positionName(id) {
  if (!id) return 'ไม่ระบุ'
  const found = catalog.value.positions.find((item) => item.id === id)
  return found ? found.name : '—'
}

// Older rows already carry the prefix inside full_name; do not repeat it.
function displayName(item) {
  const name = item.fullName || '—'
  const prefix = item.namePrefix
  if (!prefix || name.startsWith(prefix)) return name
  return `${prefix} ${name}`
}

function openEmployee(item) {
  if (!item) return
  selected.value = item
  form.value = {
    departmentId: item.departmentId ?? '',
    positionId: item.positionId ?? '',
  }
  saveError.value = ''
  saveMessage.value = ''
}

function closeEditor() {
  if (saving.value) return
  selected.value = null
  form.value = { departmentId: '', positionId: '' }
  saveError.value = ''
  saveMessage.value = ''
}

const canSave = computed(() => {
  if (!selected.value || saving.value || !hasCatalog.value) return false
  if (!form.value.departmentId) return false
  const departmentChanged = form.value.departmentId !== (selected.value.departmentId ?? '')
  const positionChanged = (form.value.positionId || '') !== (selected.value.positionId ?? '')
  return departmentChanged || positionChanged
})

async function saveEmployee() {
  if (!canSave.value) return
  saving.value = true
  saveError.value = ''
  saveMessage.value = ''
  try {
    const { ok, data } = await requestJson(
      'PATCH',
      `${props.base}/employees/${encodeURIComponent(selected.value.id)}`,
      {
        departmentId: form.value.departmentId,
        positionId: form.value.positionId ? form.value.positionId : null,
      }
    )
    if (!ok || data.ok !== true) {
      saveError.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    const employee = data.employee
    if (employee) {
      selected.value = employee
      form.value = {
        departmentId: employee.departmentId ?? '',
        positionId: employee.positionId ?? '',
      }
      results.value = results.value.map((row) => (row.id === employee.id ? employee : row))
    }
    saveMessage.value = SAVED_TEXT
  } catch {
    saveError.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

function listOf(kind) {
  return kind === 'departments' ? catalog.value.departments : catalog.value.positions
}

function startRename(kind, item) {
  renaming.value = { kind, id: item.id }
  renameValue.value = item.name
  renameError.value = ''
  renameMessage.value = ''
}

function cancelRename() {
  if (renameBusy.value) return
  renaming.value = { kind: '', id: '' }
  renameValue.value = ''
  renameError.value = ''
}

const renamingCurrentName = computed(() => {
  if (!renaming.value.id) return ''
  const found = listOf(renaming.value.kind).find((item) => item.id === renaming.value.id)
  return found ? found.name : ''
})

const trimmedRename = computed(() => renameValue.value.trim())

const canRename = computed(() => {
  if (!renaming.value.id || renameBusy.value) return false
  if (trimmedRename.value.length === 0) return false
  if (Array.from(trimmedRename.value).length > NAME_MAX_LENGTH) return false
  return trimmedRename.value !== renamingCurrentName.value
})

async function submitRename() {
  if (!canRename.value) return
  const { kind, id } = renaming.value
  renameBusy.value = true
  renameError.value = ''
  renameMessage.value = ''
  try {
    const { ok, data } = await requestJson(
      'PATCH',
      `${props.base}/${kind}/${encodeURIComponent(id)}`,
      { name: trimmedRename.value }
    )
    if (!ok || data.ok !== true) {
      renameError.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    const saved = data.item
    if (saved) {
      const key = kind === 'departments' ? 'departments' : 'positions'
      catalog.value = {
        ...catalog.value,
        [key]: catalog.value[key]
          .map((item) => (item.id === saved.id ? { ...item, name: saved.name } : item))
          .sort((a, b) => a.name.localeCompare(b.name, 'th')),
      }
    }
    renaming.value = { kind: '', id: '' }
    renameValue.value = ''
    renameMessage.value = RENAMED_TEXT
  } catch {
    renameError.value = SAVE_ERROR
  } finally {
    renameBusy.value = false
  }
}

onMounted(loadCatalog)

onBeforeUnmount(() => {
  if (debounceId) clearTimeout(debounceId)
})
</script>

<template>
  <div class="manager">
    <section class="card">
      <h2 class="card-title">ค้นหาพนักงาน</h2>
      <p class="card-sub">
        ค้นด้วยชื่อหรือรหัสพนักงาน อย่างน้อย 2 ตัวอักษร · แสดงสูงสุด 50 รายการ ·
        แสดงเฉพาะข้อมูลที่จำเป็นต่อการแก้ไข
      </p>

      <label class="search">
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </span>
        <input
          v-model="query"
          type="search"
          placeholder="พิมพ์ชื่อ หรือรหัสพนักงาน"
          autocomplete="off"
          aria-label="ค้นหาพนักงาน"
        />
      </label>

      <p v-if="hint" class="hint">{{ hint }}</p>
      <p v-if="searching" class="hint">กำลังค้นหา…</p>
      <p v-if="searchError" class="inline-error" role="alert">{{ searchError }}</p>
    </section>

    <section v-if="results.length" class="card">
      <div class="list-head">
        <span>รหัสพนักงาน</span>
        <span>ชื่อ-สกุล</span>
        <span>แผนก</span>
        <span>ตำแหน่ง</span>
        <span class="col-action">แก้ไข</span>
      </div>

      <div v-for="item in results" :key="item.id" class="list-row">
        <span class="cell code" data-label="รหัส">{{ item.employeeCode || '—' }}</span>
        <span class="cell name" data-label="ชื่อ-สกุล">{{ displayName(item) }}</span>
        <span class="cell" data-label="แผนก">{{ departmentName(item.departmentId) }}</span>
        <span class="cell" data-label="ตำแหน่ง">{{ positionName(item.positionId) }}</span>
        <span class="cell cell-action">
          <button type="button" class="btn btn-ghost" @click="openEmployee(item)">แก้ไข</button>
        </span>
      </div>
    </section>

    <p v-else-if="searched && !searching" class="empty">{{ EMPTY_TEXT }}</p>

    <section v-if="selected" class="card">
      <div class="card-head">
        <h2 class="card-title">แก้ไขข้อมูลพนักงาน</h2>
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="closeEditor">ปิด</button>
      </div>

      <dl class="who">
        <div class="who-row">
          <dt>ชื่อ-สกุล</dt>
          <dd>{{ displayName(selected) }}</dd>
        </div>
        <div class="who-row">
          <dt>รหัสพนักงาน</dt>
          <dd class="code">{{ selected.employeeCode || '—' }}</dd>
        </div>
      </dl>

      <p v-if="catalogLoading" class="hint">กำลังโหลดรายการแผนกและตำแหน่ง…</p>
      <p v-else-if="catalogError" class="inline-error" role="alert">{{ catalogError }}</p>

      <div class="form-grid">
        <label class="field">
          <span class="field-label">แผนก</span>
          <select v-model="form.departmentId" :disabled="saving || !hasCatalog">
            <option value="" disabled>เลือกแผนก</option>
            <option v-for="dept in catalog.departments" :key="dept.id" :value="dept.id">
              {{ dept.name }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">ตำแหน่ง <span class="field-hint">(ไม่บังคับ)</span></span>
          <select v-model="form.positionId" :disabled="saving || !hasCatalog">
            <option value="">— ไม่ระบุตำแหน่ง —</option>
            <option v-for="pos in catalog.positions" :key="pos.id" :value="pos.id">
              {{ pos.name }}
            </option>
          </select>
        </label>
      </div>

      <p class="note">ระบบบันทึกเฉพาะแผนกและตำแหน่งของพนักงานคนนี้ ไม่แตะข้อมูลอื่น</p>

      <p v-if="saveError" class="inline-error" role="alert">{{ saveError }}</p>
      <p v-if="saveMessage" class="inline-ok" role="status">{{ saveMessage }}</p>

      <div class="actions">
        <button type="button" class="btn btn-primary" :disabled="!canSave" @click="saveEmployee">
          {{ saving ? 'กำลังบันทึก…' : 'บันทึก' }}
        </button>
        <button type="button" class="btn btn-ghost" :disabled="saving" @click="closeEditor">ยกเลิก</button>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">รายการแผนกและตำแหน่ง</h2>
      <p class="card-sub">เปลี่ยนชื่อรายการที่ใช้ร่วมกันทั้งระบบ · ไม่มีการลบรายการ</p>
      <p class="note note-strong">{{ RENAME_NOTE }}</p>
      <p class="hint">{{ RENAME_HINT }}</p>

      <p v-if="catalogLoading" class="hint">กำลังโหลดรายการ…</p>
      <p v-else-if="catalogError" class="inline-error" role="alert">{{ catalogError }}</p>

      <p v-if="renameError" class="inline-error" role="alert">{{ renameError }}</p>
      <p v-if="renameMessage" class="inline-ok" role="status">{{ renameMessage }}</p>

      <div v-if="!catalogLoading && !catalogError" class="catalog-grid">
        <div class="catalog-block">
          <h3 class="catalog-title">แผนก</h3>
          <p v-if="!catalog.departments.length" class="hint">ยังไม่มีรายการแผนก</p>
          <ul v-else class="catalog-list">
            <li v-for="dept in catalog.departments" :key="dept.id" class="catalog-item">
              <template v-if="renaming.kind === 'departments' && renaming.id === dept.id">
                <input
                  v-model="renameValue"
                  type="text"
                  class="rename-input"
                  :maxlength="NAME_MAX_LENGTH"
                  aria-label="ชื่อแผนกใหม่"
                  @keyup.enter="submitRename"
                />
                <div class="catalog-actions">
                  <button
                    type="button"
                    class="btn btn-primary btn-small"
                    :disabled="!canRename"
                    @click="submitRename"
                  >
                    {{ renameBusy ? 'กำลังบันทึก…' : 'บันทึก' }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-small" :disabled="renameBusy" @click="cancelRename">
                    ยกเลิก
                  </button>
                </div>
              </template>
              <template v-else>
                <span class="catalog-name">{{ dept.name }}</span>
                <button type="button" class="btn btn-ghost btn-small" @click="startRename('departments', dept)">
                  เปลี่ยนชื่อ
                </button>
              </template>
            </li>
          </ul>
        </div>

        <div class="catalog-block">
          <h3 class="catalog-title">ตำแหน่ง</h3>
          <p v-if="!catalog.positions.length" class="hint">ยังไม่มีรายการตำแหน่ง</p>
          <ul v-else class="catalog-list">
            <li v-for="pos in catalog.positions" :key="pos.id" class="catalog-item">
              <template v-if="renaming.kind === 'positions' && renaming.id === pos.id">
                <input
                  v-model="renameValue"
                  type="text"
                  class="rename-input"
                  :maxlength="NAME_MAX_LENGTH"
                  aria-label="ชื่อตำแหน่งใหม่"
                  @keyup.enter="submitRename"
                />
                <div class="catalog-actions">
                  <button
                    type="button"
                    class="btn btn-primary btn-small"
                    :disabled="!canRename"
                    @click="submitRename"
                  >
                    {{ renameBusy ? 'กำลังบันทึก…' : 'บันทึก' }}
                  </button>
                  <button type="button" class="btn btn-ghost btn-small" :disabled="renameBusy" @click="cancelRename">
                    ยกเลิก
                  </button>
                </div>
              </template>
              <template v-else>
                <span class="catalog-name">{{ pos.name }}</span>
                <button type="button" class="btn btn-ghost btn-small" @click="startRename('positions', pos)">
                  เปลี่ยนชื่อ
                </button>
              </template>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 18px 20px;
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.card-head .card-title {
  margin: 0;
}

.card-sub {
  margin: 0 0 12px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.search {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #5c7176;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  padding: 10px 12px;
  background: #f8fbfa;
}

.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 15px;
  color: #12343b;
}

.search-icon {
  display: inline-flex;
}

.hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: #5c7176;
}

.note {
  margin: 12px 0 0;
  font-size: 13px;
  color: #5c7176;
}

.note-strong {
  color: #8a4b00;
  font-weight: 600;
}

.empty {
  font-size: 14px;
  color: #5c7176;
  padding: 4px;
}

.inline-error {
  margin: 10px 0 0;
  font-size: 13px;
  color: #b3261e;
}

.inline-ok {
  margin: 10px 0 0;
  font-size: 13px;
  color: #1c6b3f;
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr) 84px;
  gap: 10px;
  align-items: center;
  text-align: left;
}

.list-head {
  font-size: 12px;
  font-weight: 700;
  color: #5c7176;
  padding: 4px 6px 10px;
  border-bottom: 1px solid #e6edeb;
}

.list-row {
  padding: 10px 6px;
  border-bottom: 1px solid #eef3f2;
  font-size: 14px;
  color: #12343b;
}

.list-row:last-child {
  border-bottom: none;
}

.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: 0.03em;
}

.name {
  font-weight: 600;
  word-break: break-word;
}

.who {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f6faf8;
  border: 1px solid #eef3f2;
}

.who-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 8px;
  font-size: 14px;
  padding: 3px 0;
}

.who-row dt {
  color: #5c7176;
  font-size: 13px;
}

.who-row dd {
  margin: 0;
  color: #12343b;
  font-weight: 600;
  word-break: break-word;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: #3d4f49;
}

.field-hint {
  font-weight: 400;
  color: #5c7176;
}

.field select {
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #ffffff;
  font-family: inherit;
  font-size: 14px;
  color: #12343b;
}

.field select:disabled {
  background: #f2f4f6;
  color: #8a9793;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.btn {
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  border-radius: 10px;
  padding: 10px 16px;
  cursor: pointer;
  border: 1px solid transparent;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.btn-primary {
  background: #176c5b;
  color: #ffffff;
}

.btn-ghost {
  background: #ffffff;
  border-color: #cfdcda;
  color: #115447;
}

.btn-small {
  padding: 6px 10px;
  font-size: 13px;
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 14px;
}

.catalog-block {
  border: 1px solid #eef3f2;
  border-radius: 12px;
  padding: 12px 14px;
  min-width: 0;
}

.catalog-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  color: #115447;
}

.catalog-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.catalog-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f8fbfa;
  border: 1px solid #eef1ef;
}

.catalog-name {
  font-size: 14px;
  color: #12343b;
  font-weight: 600;
  word-break: break-word;
  min-width: 0;
}

.catalog-actions {
  display: flex;
  gap: 6px;
}

.rename-input {
  flex: 1;
  min-width: 140px;
  padding: 8px 10px;
  border: 1px solid #176c5b;
  border-radius: 8px;
  font-family: inherit;
  font-size: 14px;
  color: #12343b;
}

@media (max-width: 860px) {
  .form-grid,
  .catalog-grid {
    grid-template-columns: 1fr;
  }

  .list-head {
    display: none;
  }

  .list-row {
    grid-template-columns: 1fr;
    gap: 4px;
    border: 1px solid #e6edeb;
    border-radius: 10px;
    margin-bottom: 8px;
    padding: 12px;
  }

  .cell {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 8px;
  }

  .cell::before {
    content: attr(data-label);
    font-size: 12px;
    color: #5c7176;
    font-weight: 500;
  }

  .cell-action,
  .col-action {
    display: block;
  }

  .cell-action::before {
    content: none;
  }
}
</style>
