<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import ControllerNav from '../components/ControllerNav.vue'

const LOAD_ERROR = 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'

const tab = ref('rounds') // rounds | person
const meta = ref({ types: [], departments: [], positions: [], statuses: [], shifts: [] })
const errorMessage = ref('')

const filters = reactive({
  year: '',
  month: '',
  from: '',
  to: '',
  type: '',
  location: '',
  dept: '',
  position: '',
  status: '',
  shift: '',
})

const roundsState = reactive({ page: 1, hasMore: false, rows: [], loading: false })

const personQuery = ref('')
const people = ref([])
const peopleError = ref('')
const person = ref(null)
const personState = reactive({ page: 1, hasMore: false, items: [], loading: false })

const filterQuery = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    const text = String(value ?? '').trim()
    if (text !== '') params.set(key, text)
  }
  return params
})

const exportHref = computed(() => {
  const params = new URLSearchParams(filterQuery.value)
  if (person.value) params.set('employeeId', person.value.id)
  const query = params.toString()
  return `/api/meeting/backfill/history/export${query ? `?${query}` : ''}`
})

async function loadMeta() {
  try {
    const response = await fetch('/api/meeting/backfill/meta', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (response.ok && data.ok === true) meta.value = data
  } catch {
    meta.value = { types: [], departments: [], positions: [], statuses: [], shifts: [] }
  }
}

async function loadRounds(page = 1) {
  roundsState.loading = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams(filterQuery.value)
    params.set('page', String(page))
    const response = await fetch(`/api/meeting/backfill/history/rounds?${params.toString()}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    roundsState.rows = data.rounds ?? []
    roundsState.page = data.page ?? page
    roundsState.hasMore = data.hasMore === true
    if (data.departments?.length) meta.value = { ...meta.value, departments: data.departments, positions: data.positions ?? meta.value.positions }
    if (data.types?.length) meta.value = { ...meta.value, types: data.types }
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    roundsState.loading = false
  }
}

async function searchPeople() {
  peopleError.value = ''
  people.value = []
  if (personQuery.value.trim().length < 2) {
    peopleError.value = 'กรุณาพิมพ์อย่างน้อย 2 ตัวอักษร'
    return
  }
  try {
    const params = new URLSearchParams({ q: personQuery.value.trim() })
    const response = await fetch(`/api/meeting/backfill/history/people?${params.toString()}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      peopleError.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    people.value = data.people ?? []
    if (people.value.length === 0) peopleError.value = 'ไม่พบพนักงานที่ค้นหา'
  } catch {
    peopleError.value = LOAD_ERROR
  }
}

async function loadPerson(page = 1) {
  if (!person.value) return
  personState.loading = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams(filterQuery.value)
    params.set('employeeId', person.value.id)
    params.set('page', String(page))
    const response = await fetch(`/api/meeting/backfill/history/employee?${params.toString()}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    personState.items = data.items ?? []
    personState.page = data.page ?? page
    personState.hasMore = data.hasMore === true
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    personState.loading = false
  }
}

function choosePerson(entry) {
  person.value = entry
  loadPerson(1)
}

function clearFilters() {
  for (const key of Object.keys(filters)) filters[key] = ''
  loadRounds(1)
  if (tab.value === 'person' && person.value) loadPerson(1)
}

watch(tab, (value) => {
  if (value === 'rounds') loadRounds(1)
})

onMounted(async () => {
  await loadMeta()
  await loadRounds(1)
})
</script>

<template>
  <div class="page">
    <ControllerNav />

    <main class="content">
      <div class="page-head">
        <div>
          <h1 class="page-title">ข้อมูลย้อนหลัง</h1>
          <p class="page-sub">
            สรุปการประชุมย้อนหลังรายรอบและรายคน พร้อมตัวกรองและส่งออกเป็นไฟล์ Excel ที่นำกลับเข้าได้
          </p>
        </div>
        <a class="export-link" :href="exportHref">
          <v-icon icon="download" size="18" />
          ส่งออก Excel ตามตัวกรอง
        </a>
      </div>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>

      <section class="card">
        <h2 class="card-title">ตัวกรอง</h2>
        <div class="filter-grid">
          <label class="field">
            <span>ปี (ค.ศ.)</span>
            <input v-model="filters.year" type="number" min="2000" max="2200" placeholder="2026" />
          </label>
          <label class="field">
            <span>เดือน</span>
            <input v-model="filters.month" type="month" />
          </label>
          <label class="field">
            <span>ตั้งแต่วันที่</span>
            <input v-model="filters.from" type="date" />
          </label>
          <label class="field">
            <span>ถึงวันที่</span>
            <input v-model="filters.to" type="date" />
          </label>
          <label class="field">
            <span>ประเภท</span>
            <select v-model="filters.type">
              <option value="">ทั้งหมด</option>
              <option v-for="type in meta.types" :key="type.code" :value="type.code">{{ type.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>สถานที่</span>
            <input v-model="filters.location" type="text" maxlength="120" />
          </label>
          <label class="field">
            <span>แผนก</span>
            <select v-model="filters.dept">
              <option value="">ทั้งหมด</option>
              <option v-for="dept in meta.departments" :key="dept.id" :value="dept.id">{{ dept.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>ระดับ</span>
            <select v-model="filters.position">
              <option value="">ทั้งหมด</option>
              <option v-for="position in meta.positions" :key="position.id" :value="position.id">{{ position.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>สถานะ</span>
            <select v-model="filters.status">
              <option value="">ทั้งหมด</option>
              <option v-for="status in meta.statuses" :key="status.code" :value="status.code">{{ status.label }}</option>
            </select>
          </label>
          <label class="field">
            <span>กะ (ลาประชุม)</span>
            <select v-model="filters.shift">
              <option value="">ทั้งหมด</option>
              <option v-for="shift in meta.shifts" :key="shift" :value="shift">{{ shift }}</option>
            </select>
          </label>
        </div>

        <div class="actions">
          <v-btn color="primary" size="small" @click="loadRounds(1); person && loadPerson(1)">ใช้ตัวกรอง</v-btn>
          <v-btn variant="text" size="small" @click="clearFilters">ล้างตัวกรอง</v-btn>
          <span class="hint-inline">ค่าเริ่มต้นไม่กรองวันที่ และแสดงทีละ 20 รอบ</span>
        </div>
      </section>

      <div class="tabs">
        <button type="button" class="tab" :class="{ 'tab-active': tab === 'rounds' }" @click="tab = 'rounds'">
          สรุปรายรอบ
        </button>
        <button type="button" class="tab" :class="{ 'tab-active': tab === 'person' }" @click="tab = 'person'">
          ประวัติรายคน
        </button>
      </div>

      <section v-if="tab === 'rounds'" class="card">
        <h2 class="card-title">สรุปรายรอบ</h2>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>วันที่</th><th>ประเภท</th><th>เวลา</th><th>สถานที่</th>
                <th>เข้าร่วม</th><th>ลาประชุม (A/B)</th><th>ไม่เข้าร่วม</th><th>ติดงานด่วน</th><th>รวม</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="round in roundsState.rows" :key="round.id">
                <td>{{ round.date || '—' }}</td>
                <td>{{ round.typeName || '—' }}</td>
                <td>{{ round.time || '—' }}</td>
                <td>{{ round.location || '—' }}</td>
                <td>{{ round.counts.attended }}</td>
                <td>{{ round.counts.leave }} ({{ round.counts.leaveShift['กะ A'] }}/{{ round.counts.leaveShift['กะ B'] }})</td>
                <td>{{ round.counts.not_attended }}</td>
                <td>{{ round.counts.urgent_busy }}</td>
                <td>{{ round.counts.total }}</td>
              </tr>
              <tr v-if="roundsState.rows.length === 0">
                <td colspan="9" class="empty">{{ roundsState.loading ? 'กำลังโหลด…' : 'ไม่พบข้อมูลตามตัวกรอง' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="actions">
          <v-btn variant="text" size="small" :disabled="roundsState.page <= 1 || roundsState.loading" @click="loadRounds(roundsState.page - 1)">
            ก่อนหน้า
          </v-btn>
          <span class="hint-inline">หน้า {{ roundsState.page }}</span>
          <v-btn variant="text" size="small" :disabled="!roundsState.hasMore || roundsState.loading" @click="loadRounds(roundsState.page + 1)">
            ถัดไป
          </v-btn>
        </div>
      </section>

      <section v-else class="card">
        <h2 class="card-title">ประวัติรายคน</h2>
        <div class="search-row">
          <input
            v-model="personQuery"
            type="text"
            placeholder="พิมพ์ชื่อพนักงานอย่างน้อย 2 ตัวอักษร"
            maxlength="120"
            @keyup.enter="searchPeople"
          />
          <v-btn color="primary" size="small" @click="searchPeople">ค้นหา</v-btn>
        </div>
        <p v-if="peopleError" class="hint">{{ peopleError }}</p>

        <ul v-if="people.length" class="people-list">
          <li v-for="entry in people" :key="entry.id">
            <button type="button" class="person-button" :class="{ 'person-selected': person?.id === entry.id }" @click="choosePerson(entry)">
              <span class="person-name">{{ entry.name }}</span>
              <span class="person-sub">{{ entry.departmentName || '—' }} · {{ entry.positionName || '—' }}</span>
            </button>
          </li>
        </ul>

        <div v-if="person" class="block">
          <h3 class="block-title">ประวัติของ {{ person.name }}</h3>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr><th>วันที่</th><th>ประเภท</th><th>เวลา</th><th>สถานที่</th><th>สถานะ</th><th>กะ</th><th>เหตุผล</th></tr>
              </thead>
              <tbody>
                <tr v-for="item in personState.items" :key="item.attendanceId">
                  <td>{{ item.date || '—' }}</td>
                  <td>{{ item.typeName || '—' }}</td>
                  <td>{{ item.time || '—' }}</td>
                  <td>{{ item.location || '—' }}</td>
                  <td>{{ item.statusLabel || '—' }}</td>
                  <td>{{ item.shift || '—' }}</td>
                  <td>{{ item.reason || '—' }}</td>
                </tr>
                <tr v-if="personState.items.length === 0">
                  <td colspan="7" class="empty">{{ personState.loading ? 'กำลังโหลด…' : 'ไม่พบข้อมูลตามตัวกรอง' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="actions">
            <v-btn variant="text" size="small" :disabled="personState.page <= 1 || personState.loading" @click="loadPerson(personState.page - 1)">
              ก่อนหน้า
            </v-btn>
            <span class="hint-inline">หน้า {{ personState.page }}</span>
            <v-btn variant="text" size="small" :disabled="!personState.hasMore || personState.loading" @click="loadPerson(personState.page + 1)">
              ถัดไป
            </v-btn>
            <a class="export-link" :href="exportHref">ส่งออก Excel ของคนนี้</a>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
  display: flex;
  gap: 18px;
  padding: 20px;
  align-items: flex-start;
}

.content {
  flex: 1;
  min-width: 0;
  max-width: 1120px;
  padding-bottom: 48px;
}

.page-head {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 6px;
}

.page-sub {
  margin: 0;
  max-width: 640px;
  color: #4c6167;
  font-size: 14px;
  line-height: 1.6;
}

.export-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid #cfdcda;
  color: #10504e;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.card {
  background: #ffffff;
  border-radius: 14px;
  border: 1px solid #e0e8e6;
  padding: 20px;
  margin-bottom: 18px;
}

.card-title {
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
  margin: 0 0 12px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #5c7176;
}

.field input,
.field select,
.search-row input {
  padding: 8px 10px;
  border: 1px solid #cfdcda;
  border-radius: 8px;
  font-size: 14px;
  color: #12343b;
  background: #ffffff;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.tab {
  padding: 9px 16px;
  border-radius: 999px;
  border: 1px solid #cfdcda;
  background: #ffffff;
  color: #18564a;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.tab-active {
  background: #176c5b;
  border-color: #176c5b;
  color: #ffffff;
}

.search-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 10px;
}

.search-row input {
  flex: 1;
  min-width: 220px;
}

.people-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.person-button {
  width: 100%;
  text-align: left;
  border: 1px solid #e6edeb;
  border-radius: 10px;
  background: #ffffff;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.person-selected {
  border-color: #176c5b;
  background: #eef6f2;
}

.person-name {
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.person-sub {
  font-size: 12px;
  color: #5c7176;
}

.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th,
.table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #e6edeb;
  vertical-align: top;
}

.table th {
  background: #f4f8f7;
  font-weight: 700;
  color: #12343b;
  white-space: nowrap;
}

.empty {
  text-align: center;
  color: #5c7176;
}

.block {
  margin-top: 6px;
}

.block-title {
  font-size: 14px;
  font-weight: 700;
  color: #12343b;
  margin: 8px 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 14px;
}

.hint-inline {
  font-size: 12px;
  color: #5c7176;
}

.hint {
  font-size: 13px;
  color: #5c7176;
}

@media (max-width: 900px) {
  .page {
    flex-direction: column;
    padding: 12px;
  }
}
</style>
