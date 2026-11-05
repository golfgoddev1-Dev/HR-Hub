<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import LeaveNav from '../components/LeaveNav.vue'
import {
  DEPARTMENT_CHANGE_NOTE,
  departmentOptions,
  formatEmail,
  prefixOptions,
  hasProfileChanges,
  profilePatch,
  profileToForm,
  readProfile,
  validateProfileForm,
} from '../lib/profile-form.js'

const PROFILE_URL = '/api/profile/me'
const DEPARTMENTS_URL = '/api/profile/departments'
const PREFIXES_URL = '/api/profile/name-prefixes'

const LOAD_ERROR = 'โหลดข้อมูลส่วนตัวไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR = 'บันทึกไม่สำเร็จ กรุณาลองใหม่'
const SAVED_MESSAGE = 'บันทึกข้อมูลส่วนตัวแล้ว'
const LEAVE_CONFIRM = 'มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่'

// The Worker answers field errors in its own names; the form uses camelCase.
const SERVER_FIELD_KEYS = {
  name_prefix: 'namePrefix',
  full_name: 'fullName',
  email: 'email',
  phone: 'phone',
  department_id: 'departmentId',
}

const loading = ref(true)
const loadError = ref('')
const departmentsError = ref('')
const successMessage = ref('')
const saveError = ref('')
const saving = ref(false)
const editing = ref(false)

const profile = ref(readProfile({}))
const departments = ref([])
const prefixes = ref([])
const prefixesError = ref('')
const serverErrors = ref({})
const form = reactive(profileToForm(profile.value))

const options = computed(() => departmentOptions(profile.value, departments.value))
const prefixChoices = computed(() => prefixOptions(prefixes.value))
const validation = computed(() =>
  validateProfileForm(profile.value, form, departments.value, prefixes.value)
)
const fieldErrors = computed(() => ({ ...validation.value.errors, ...serverErrors.value }))
const changed = computed(() => hasProfileChanges(profile.value, form))
const canSave = computed(() => !saving.value && validation.value.ok && changed.value)

function mapServerErrors(errors) {
  const mapped = {}
  for (const [key, message] of Object.entries(errors ?? {})) {
    if (typeof message !== 'string') continue
    mapped[SERVER_FIELD_KEYS[key] ?? key] = message
  }
  return mapped
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch(PROFILE_URL, { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      loadError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    profile.value = readProfile(data)
    Object.assign(form, profileToForm(profile.value))
  } catch {
    loadError.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function loadDepartments() {
  departmentsError.value = ''
  try {
    const response = await fetch(DEPARTMENTS_URL, { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      departmentsError.value = 'โหลดรายการแผนกไม่สำเร็จ'
      departments.value = []
      return
    }
    departments.value = Array.isArray(data.departments) ? data.departments : []
  } catch {
    departmentsError.value = 'โหลดรายการแผนกไม่สำเร็จ'
    departments.value = []
  }
}

async function loadPrefixes() {
  prefixesError.value = ''
  try {
    const response = await fetch(PREFIXES_URL, { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      prefixesError.value = 'โหลดรายการคำนำหน้าไม่สำเร็จ'
      prefixes.value = []
      return
    }
    prefixes.value = Array.isArray(data.prefixes) ? data.prefixes : []
  } catch {
    prefixesError.value = 'โหลดรายการคำนำหน้าไม่สำเร็จ'
    prefixes.value = []
  }
}

function startEdit() {
  Object.assign(form, profileToForm(profile.value))
  serverErrors.value = {}
  saveError.value = ''
  successMessage.value = ''
  editing.value = true
}

function cancelEdit() {
  Object.assign(form, profileToForm(profile.value))
  serverErrors.value = {}
  saveError.value = ''
  editing.value = false
}

async function save() {
  if (!canSave.value) return

  saving.value = true
  saveError.value = ''
  serverErrors.value = {}

  try {
    const response = await fetch(PROFILE_URL, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profilePatch(profile.value, form)),
    })
    const data = await response.json().catch(() => ({}))

    if (response.status === 400) {
      serverErrors.value = mapServerErrors(data.errors)
      saveError.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }
    if (!response.ok || data.ok !== true) {
      saveError.value = typeof data.message === 'string' ? data.message : SAVE_ERROR
      return
    }

    profile.value = readProfile(data)
    Object.assign(form, profileToForm(profile.value))
    editing.value = false
    successMessage.value = SAVED_MESSAGE
  } catch {
    saveError.value = SAVE_ERROR
  } finally {
    saving.value = false
  }
}

watch(form, () => {
  serverErrors.value = {}
})

function hasUnsavedChanges() {
  return editing.value && hasProfileChanges(profile.value, form)
}

onBeforeRouteLeave(() => {
  if (!hasUnsavedChanges()) return true
  return window.confirm(LEAVE_CONFIRM)
})

function handleBeforeUnload(event) {
  if (!hasUnsavedChanges()) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  load()
  loadDepartments()
  loadPrefixes()
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <div class="page">
    <LeaveNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">ข้อมูลส่วนตัว</h1>
          <p class="sub">
            แก้ไขคำนำหน้า ชื่อ-นามสกุล อีเมล เบอร์มือถือ และแผนกได้เอง · รหัสพนักงาน เลขบัตรประชาชน และตำแหน่งแก้ไขโดย HR เท่านั้น
          </p>
        </div>
        <button v-if="!editing && !loading && !loadError" type="button" class="primary-btn" @click="startEdit">
          <span class="material-symbols-outlined btn-icon">edit</span>
          แก้ไขข้อมูล
        </button>
      </div>

      <p v-if="loading" class="hint">กำลังโหลด…</p>
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>

      <v-alert v-if="successMessage" type="success" variant="tonal" class="notice">
        {{ successMessage }}
      </v-alert>

      <section v-if="!loading && !loadError && !editing" class="card">
        <dl class="rows">
          <div class="row">
            <dt>รหัสพนักงาน</dt>
            <dd>{{ profile.employeeCode || '—' }}</dd>
          </div>
          <div class="row">
            <dt>คำนำหน้า</dt>
            <dd>{{ profile.namePrefix || '—' }}</dd>
          </div>
          <div class="row">
            <dt>ชื่อ-นามสกุล</dt>
            <dd>{{ profile.fullName || '—' }}</dd>
          </div>
          <div class="row">
            <dt>อีเมล</dt>
            <dd :class="{ muted: !profile.email }">{{ formatEmail(profile) }}</dd>
          </div>
          <div class="row">
            <dt>เบอร์มือถือ</dt>
            <dd>{{ profile.phone || '—' }}</dd>
          </div>
          <div class="row">
            <dt>แผนก</dt>
            <dd>
              {{ profile.departmentName || '—' }}
              <span v-if="profile.departmentActive === false" class="flag">ปิดใช้งาน</span>
            </dd>
          </div>
          <div v-if="profile.positionName" class="row">
            <dt>ตำแหน่ง</dt>
            <dd>{{ profile.positionName }}</dd>
          </div>
        </dl>
      </section>

      <form v-if="!loading && !loadError && editing" class="card" @submit.prevent="save">
        <div class="fields">
          <label class="field">
            <span class="label">คำนำหน้า</span>
            <select v-model="form.namePrefix" class="input">
              <option value="" disabled>เลือกคำนำหน้า</option>
              <option v-for="prefix in prefixChoices" :key="prefix" :value="prefix">
                {{ prefix }}
              </option>
            </select>
            <span v-if="prefixesError" class="field-note warning">{{ prefixesError }}</span>
            <span v-if="fieldErrors.namePrefix" class="field-error">
              {{ fieldErrors.namePrefix }}
            </span>
          </label>

          <label class="field">
            <span class="label">ชื่อ-นามสกุล</span>
            <input
              v-model="form.fullName"
              class="input"
              type="text"
              maxlength="120"
              autocomplete="name"
            />
            <span v-if="fieldErrors.fullName" class="field-error">{{ fieldErrors.fullName }}</span>
          </label>

          <label class="field">
            <span class="label">อีเมล</span>
            <input
              v-model="form.email"
              class="input"
              type="email"
              inputmode="email"
              autocomplete="email"
              :placeholder="'ยังไม่ได้ระบุอีเมล'"
            />
            <span class="field-note">เว้นว่างได้ หากยังไม่มีอีเมล</span>
            <span v-if="fieldErrors.email" class="field-error">{{ fieldErrors.email }}</span>
          </label>

          <label class="field">
            <span class="label">เบอร์มือถือ</span>
            <input
              v-model="form.phone"
              class="input"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              placeholder="08X-XXX-XXXX"
            />
            <span v-if="fieldErrors.phone" class="field-error">{{ fieldErrors.phone }}</span>
          </label>

          <label class="field">
            <span class="label">แผนก</span>
            <select v-model="form.departmentId" class="input">
              <option value="" disabled>เลือกแผนก</option>
              <option
                v-for="option in options"
                :key="option.id"
                :value="option.id"
                :disabled="option.inactive"
              >
                {{ option.inactive ? `${option.name} (ปิดใช้งาน)` : option.name }}
              </option>
            </select>
            <span v-if="profile.departmentActive === false" class="field-note warning">
              แผนกปัจจุบันปิดใช้งาน กรุณาเลือกแผนกที่ใช้งานอยู่เพื่อบันทึกการเปลี่ยนแปลง
            </span>
            <span class="field-note">{{ DEPARTMENT_CHANGE_NOTE }}</span>
            <span v-if="departmentsError" class="field-note warning">{{ departmentsError }}</span>
            <span v-if="fieldErrors.departmentId" class="field-error">
              {{ fieldErrors.departmentId }}
            </span>
          </label>
        </div>

        <v-alert v-if="saveError" type="error" variant="tonal" class="notice">{{ saveError }}</v-alert>

        <div class="actions">
          <button type="submit" class="primary-btn" :disabled="!canSave">
            {{ saving ? 'กำลังบันทึก…' : 'บันทึก' }}
          </button>
          <button type="button" class="ghost-btn" :disabled="saving" @click="cancelEdit">
            ยกเลิก
          </button>
        </div>
      </form>
    </main>
  </div>
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

.page {
  min-height: 100vh;
  background: #f3f6f5;
  padding: 16px;
  box-sizing: border-box;
}

.content {
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 0 48px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  margin: 8px 4px 18px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
}

.sub {
  margin: 0;
  max-width: 560px;
  font-size: 13px;
  line-height: 1.6;
  color: #5c7176;
}

.hint {
  font-size: 14px;
  color: #5c7176;
  padding: 8px 4px;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 18px 20px;
}

.notice {
  margin: 0 0 14px;
}

.rows {
  display: grid;
  gap: 14px;
  margin: 0;
  grid-template-columns: 1fr;
}

.row {
  min-width: 0;
}

.row dt {
  font-size: 12px;
  color: #5c7176;
}

.row dd {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: #12343b;
  overflow-wrap: anywhere;
}

.row dd.muted {
  font-weight: 500;
  color: #8b9c9a;
}

.flag {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fdecec;
  color: #a01b1b;
  font-size: 11px;
  font-weight: 700;
}

.fields {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: #12343b;
}

.input {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 15px;
}

.input:focus {
  outline: 2px solid rgba(16, 80, 78, 0.35);
  outline-offset: 1px;
}

.field-note {
  font-size: 12px;
  line-height: 1.5;
  color: #5c7176;
}

.field-note.warning {
  color: #a05b06;
}

.field-error {
  font-size: 12px;
  font-weight: 600;
  color: #a01b1b;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.primary-btn,
.ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}

.primary-btn {
  background: #10504e;
  color: #ffffff;
}

.primary-btn:hover:not(:disabled) {
  background: #0d423f;
}

.ghost-btn {
  background: #ffffff;
  border-color: #cfdcda;
  color: #10504e;
}

.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 18px;
}

@media (min-width: 620px) {
  .rows {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .page {
    padding: 12px;
  }

  .card {
    padding: 14px 14px;
  }

  .head {
    flex-direction: column;
  }

  .actions {
    flex-direction: column;
  }

  .primary-btn,
  .ghost-btn {
    width: 100%;
  }
}
</style>
