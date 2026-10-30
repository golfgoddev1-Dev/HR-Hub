<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ControllerNav from '../components/ControllerNav.vue'

const MIN_SEARCH_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 300
const SEARCH_HINT = 'แสดงไม่เกิน 10 รายการ เฉพาะพนักงานที่ใช้งานอยู่และยังไม่อยู่ในรายชื่อนี้'
const LOAD_ERROR_MESSAGE = 'โหลดรายชื่อไม่สำเร็จ กรุณาลองใหม่'
const SAVE_ERROR_MESSAGE = 'ไม่สามารถบันทึกได้ กรุณาลองใหม่'

const members = ref([])
const loadingMembers = ref(true)
const loadError = ref('')
const alertMessage = ref('')
const searchQuery = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
const searchError = ref('')
const hasSearched = ref(false)
const addBusyId = ref('')
const removeBusyId = ref('')

let debounceId = null
let searchSeq = 0

const memberCount = computed(() => members.value.length)

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

async function loadMembers() {
  loadingMembers.value = true
  loadError.value = ''
  try {
    const { ok, data } = await requestJson('GET', '/api/meeting/roster')
    if (!ok || data.ok !== true) {
      loadError.value = LOAD_ERROR_MESSAGE
      return
    }
    members.value = Array.isArray(data.members) ? data.members : []
  } catch {
    loadError.value = LOAD_ERROR_MESSAGE
  } finally {
    loadingMembers.value = false
  }
}

async function runSearch(term) {
  const seq = ++searchSeq
  searchLoading.value = true
  searchError.value = ''
  try {
    const params = new URLSearchParams({ q: term })
    const { ok, data } = await requestJson('GET', `/api/meeting/roster/search?${params.toString()}`)
    if (seq !== searchSeq) return
    if (!ok || data.ok !== true) {
      searchResults.value = []
      searchError.value = typeof data.message === 'string' ? data.message : SAVE_ERROR_MESSAGE
      return
    }
    searchResults.value = Array.isArray(data.results) ? data.results : []
    hasSearched.value = true
  } catch {
    if (seq !== searchSeq) return
    searchResults.value = []
    searchError.value = SAVE_ERROR_MESSAGE
  } finally {
    if (seq === searchSeq) searchLoading.value = false
  }
}

async function addMember(candidate) {
  if (addBusyId.value) return
  addBusyId.value = candidate.employeeId
  alertMessage.value = ''
  try {
    const { ok, data } = await requestJson('POST', '/api/meeting/roster/add', {
      employeeId: candidate.employeeId,
    })
    if (!ok || data.ok !== true) {
      alertMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR_MESSAGE
      return
    }
    searchResults.value = searchResults.value.filter((item) => item.employeeId !== candidate.employeeId)
    await loadMembers()
  } catch {
    alertMessage.value = SAVE_ERROR_MESSAGE
  } finally {
    addBusyId.value = ''
  }
}

async function removeMember(member) {
  if (removeBusyId.value) return
  removeBusyId.value = member.employeeId
  alertMessage.value = ''
  try {
    const { ok, data } = await requestJson('POST', '/api/meeting/roster/remove', {
      employeeId: member.employeeId,
    })
    if (!ok || data.ok !== true) {
      alertMessage.value = typeof data.message === 'string' ? data.message : SAVE_ERROR_MESSAGE
      return
    }
    members.value = members.value.filter((item) => item.employeeId !== member.employeeId)
  } catch {
    alertMessage.value = SAVE_ERROR_MESSAGE
  } finally {
    removeBusyId.value = ''
  }
}

watch(searchQuery, (value) => {
  if (debounceId) clearTimeout(debounceId)
  searchSeq += 1
  searchError.value = ''
  hasSearched.value = false

  const term = value.trim()
  if (term.length < MIN_SEARCH_LENGTH) {
    searchResults.value = []
    searchLoading.value = false
    return
  }

  debounceId = setTimeout(() => {
    debounceId = null
    runSearch(term)
  }, SEARCH_DEBOUNCE_MS)
})

onBeforeUnmount(() => {
  if (debounceId) clearTimeout(debounceId)
})

loadMembers()
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">HR</div>
        <div class="brand-text">
          <span class="brand-title">ระบบบริการงานบุคคลและสวัสดิการพนักงาน</span>
          <span class="brand-sub">Meeting Controller Console</span>
        </div>
      </div>
      <div class="role-chip">
        <span class="material-symbols-outlined role-chip-icon">groups</span>
        <span>ผู้ควบคุมการประชุม</span>
      </div>
    </header>

    <div class="shell">
      <ControllerNav />

      <main class="page-main">
        <RouterLink to="/meeting/controller" class="back-link">
          <span class="material-symbols-outlined back-icon">arrow_back</span>
          กลับหน้าหลัก
        </RouterLink>

        <div class="page-head">
          <h1>รายชื่อผู้เข้าประชุม</h1>
          <p>จัดการรายชื่อที่ใช้ลงทะเบียนของแต่ละรอบประชุม</p>
          <p class="shared-note">รายชื่อนี้ใช้กับทั้งประชุมหัวหน้างานและประชุม Monthly</p>
        </div>

      <v-alert
        v-if="alertMessage"
        type="error"
        variant="tonal"
        density="comfortable"
        closable
        class="page-alert"
        @click:close="alertMessage = ''"
      >
        {{ alertMessage }}
      </v-alert>

      <div class="panels">
        <section class="card roster-card">
          <div class="card-head">
            <h2 class="card-title">รายชื่อที่ใช้งานอยู่</h2>
            <span class="count-tag">{{ memberCount }} คน</span>
          </div>

          <div v-if="loadingMembers" class="state-box">
            <v-progress-circular indeterminate color="primary" size="26" />
            <span>กำลังโหลดรายชื่อ…</span>
          </div>

          <p v-else-if="loadError" class="inline-error" role="alert">{{ loadError }}</p>

          <div v-else-if="!members.length" class="state-box">
            <span>ยังไม่มีรายชื่อในรอบนี้</span>
          </div>

          <ul v-else class="list">
            <li v-for="member in members" :key="member.employeeId" class="row">
              <div class="row-info">
                <span class="row-name">{{ member.fullName }}</span>
                <span class="row-code">{{ member.employeeCode }}</span>
                <span class="row-sub">{{ member.departmentName }} · {{ member.positionName }}</span>
              </div>
              <v-btn
                variant="text"
                color="error"
                size="small"
                :loading="removeBusyId === member.employeeId"
                @click="removeMember(member)"
              >
                นำออก
              </v-btn>
            </li>
          </ul>
        </section>

        <section class="card add-card">
          <h2 class="card-title">เพิ่มพนักงาน</h2>

          <v-text-field
            v-model="searchQuery"
            class="search-field"
            label="ค้นหาพนักงาน"
            placeholder="ชื่อหรือรหัสพนักงาน"
            variant="outlined"
            density="comfortable"
            hide-details
            autocomplete="off"
          />

          <p class="hint">{{ SEARCH_HINT }}</p>

          <p v-if="searchError" class="inline-error" role="alert">{{ searchError }}</p>

          <div v-if="searchLoading" class="state-box small">
            <v-progress-circular indeterminate color="primary" size="22" />
          </div>

          <ul v-else-if="searchResults.length" class="list">
            <li v-for="candidate in searchResults" :key="candidate.employeeId" class="row">
              <div class="row-info">
                <span class="row-name">{{ candidate.fullName }}</span>
                <span class="row-code">{{ candidate.employeeCode }}</span>
                <span class="row-sub">{{ candidate.departmentName }} · {{ candidate.positionName }}</span>
              </div>
              <v-btn
                size="small"
                color="primary"
                :loading="addBusyId === candidate.employeeId"
                @click="addMember(candidate)"
              >
                เพิ่ม
              </v-btn>
            </li>
          </ul>

          <p v-else-if="hasSearched" class="empty-text">ไม่พบพนักงานที่ตรงกัน</p>
        </section>
      </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.page {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  overflow-x: hidden;
  background: #f4f8f5;
  font-family: 'Sarabun', 'IBM Plex Sans Thai', sans-serif;
  color: #12251f;
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined', sans-serif;
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 22px;
  background: #ffffff;
  border-bottom: 1px solid #e3e8e6;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-mark {
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #176c5b;
  color: #ffffff;
  font-family: 'Sarabun', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  color: #115447;
  white-space: normal;
  overflow-wrap: anywhere;
}

.brand-sub {
  font-size: 12px;
  line-height: 1.4;
  color: #6b7a75;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.role-chip-icon {
  font-size: 18px;
}

.shell {
  display: flex;
  gap: 20px;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 22px;
}

.page-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  max-width: 100%;
  padding: 7px 14px;
  border: 1px solid #d8e4de;
  border-radius: 999px;
  background: #ffffff;
  color: #115447;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.back-link:hover {
  background: #eaf3ef;
}

.back-icon {
  font-size: 18px;
  line-height: 1;
}

.page-head h1 {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.35;
  color: #115447;
}

.page-head p {
  margin: 0;
  max-width: 640px;
  color: #3d4f49;
  font-size: 15px;
  line-height: 1.6;
}

.page-head .shared-note {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
}

.page-alert {
  border-radius: 12px;
}

.panels {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}

.card {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e3e8e6;
  border-radius: 18px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(16, 40, 35, 0.06);
}

.card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 14px;
}

.card-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: #115447;
}

.add-card .card-title {
  margin-bottom: 14px;
}

.count-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  background: #eaf3ef;
  color: #115447;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 520px;
  overflow-y: auto;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #eef1ef;
  border-radius: 12px;
  background: #f7faf8;
}

.row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.row-code {
  font-size: 12px;
  color: #6b7a75;
  font-variant-numeric: tabular-nums;
}

.row-sub {
  font-size: 12px;
  color: #6b7a75;
  overflow-wrap: anywhere;
}

.search-field {
  margin-bottom: 8px;
}

.hint {
  margin: 0 0 12px;
  color: #6b7a75;
  font-size: 12px;
  line-height: 1.5;
}

.state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  color: #4b5b55;
  font-size: 14px;
  text-align: center;
}

.state-box.small {
  min-height: 80px;
}

.inline-error {
  margin: 8px 0 0;
  color: #b3261e;
  font-size: 13px;
  line-height: 1.5;
}

.empty-text {
  margin: 4px 0 0;
  color: #6b7a75;
  font-size: 13px;
  text-align: center;
}

@media (min-width: 640px) {
  .card { padding: 22px; }
}

@media (min-width: 900px) {
  .page-head h1 { font-size: 26px; }
  .panels { grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: 20px; }
}

@media (max-width: 899px) {
  .shell { flex-direction: column; padding: 14px; }
  .topbar { padding: 12px 14px; }
  .panels { grid-template-columns: minmax(0, 1fr); }
  .list { max-height: none; }
}
</style>
