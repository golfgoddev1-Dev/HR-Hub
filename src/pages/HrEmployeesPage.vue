<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import HrNav from '../components/HrNav.vue'

const MIN_LENGTH = 2
const SEARCH_ERROR = 'ไม่สามารถค้นหาได้ กรุณาลองใหม่'
const TOO_SHORT = 'พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา'
const EMPTY = 'ไม่พบพนักงานที่ตรงกับคำค้น'

const router = useRouter()
const query = ref('')
const results = ref([])
const loading = ref(false)
const errorMessage = ref('')
const hint = ref('')
const searched = ref(false)

let timer = null

async function search() {
  const text = query.value.replace(/\s+/g, ' ').trim()
  errorMessage.value = ''

  if (text.length < MIN_LENGTH) {
    results.value = []
    searched.value = false
    hint.value = text.length === 0 ? '' : TOO_SHORT
    return
  }

  hint.value = ''
  loading.value = true
  try {
    const response = await fetch(`/api/hr/employees?q=${encodeURIComponent(text)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      results.value = []
      searched.value = false
      errorMessage.value = typeof data.message === 'string' ? data.message : SEARCH_ERROR
      return
    }
    results.value = Array.isArray(data.results) ? data.results : []
    searched.value = true
  } catch {
    results.value = []
    searched.value = false
    errorMessage.value = SEARCH_ERROR
  } finally {
    loading.value = false
  }
}

watch(query, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(search, 300)
})

function openEmployee(id) {
  if (!id) return
  router.push(`/hr/employees/${encodeURIComponent(id)}`)
}

// full_name of older rows already starts with the prefix; do not repeat it.
function displayName(item) {
  const name = item.fullName || '—'
  const prefix = item.namePrefix
  if (!prefix || name.startsWith(prefix)) return name
  return `${prefix} ${name}`
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="page">
    <HrNav />

    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">รายชื่อพนักงาน</h1>
          <p class="sub">
            ค้นด้วยชื่อหรือรหัสพนักงาน อย่างน้อย 2 ตัวอักษร · แสดงสูงสุด 50 รายการ ·
            ไม่แสดงเลขบัตรประชาชนในหน้านี้
          </p>
        </div>
        <RouterLink to="/hr/employees/import" class="link">นำเข้าข้อมูลพนักงาน →</RouterLink>
      </div>

      <section class="card">
        <label class="search">
          <v-icon icon="search" size="20" />
          <input
            v-model="query"
            type="search"
            placeholder="พิมพ์ชื่อ หรือรหัสพนักงาน"
            autocomplete="off"
            aria-label="ค้นหาพนักงาน"
          />
        </label>
        <p v-if="hint" class="hint">{{ hint }}</p>
        <p v-if="loading" class="hint">กำลังค้นหา…</p>
      </section>

      <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">
        {{ errorMessage }}
      </v-alert>

      <section v-if="results.length" class="card">
        <div class="list-head">
          <span>รหัสพนักงาน</span>
          <span>ชื่อ-สกุล</span>
          <span>แผนก</span>
          <span>สถานะ</span>
        </div>

        <button
          v-for="item in results"
          :key="item.id"
          type="button"
          class="list-row"
          @click="openEmployee(item.id)"
        >
          <span class="cell code" data-label="รหัส">{{ item.employeeCode || '—' }}</span>
          <span class="cell name" data-label="ชื่อ-สกุล">{{ displayName(item) }}</span>
          <span class="cell dept" data-label="แผนก">{{ item.departmentName || '—' }}</span>
          <span class="cell" data-label="สถานะ">
            <span class="badge" :class="item.isActive ? 'badge-on' : 'badge-off'">
              {{ item.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน' }}
            </span>
          </span>
        </button>
      </section>

      <p v-else-if="searched && !loading" class="empty">{{ EMPTY }}</p>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f6f5;
}

.content {
  max-width: 1120px;
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
  max-width: 640px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.link {
  color: #10504e;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 16px;
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

.hint {
  margin: 10px 0 0;
  font-size: 13px;
  color: #5c7176;
}

.empty {
  font-size: 14px;
  color: #5c7176;
  padding: 8px 4px;
}

.list-head,
.list-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1.6fr) minmax(0, 1fr) 130px;
  gap: 12px;
  align-items: center;
  text-align: left;
}

.list-head {
  font-size: 12px;
  font-weight: 700;
  color: #5c7176;
  padding: 6px 8px 10px;
  border-bottom: 1px solid #e6edeb;
}

.list-row {
  width: 100%;
  background: none;
  border: none;
  border-bottom: 1px solid #eef3f2;
  padding: 12px 8px;
  font-family: inherit;
  font-size: 14px;
  color: #12343b;
  cursor: pointer;
}

.list-row:last-child {
  border-bottom: none;
}

.list-row:hover,
.list-row:focus-visible {
  background: #f4f8f7;
  outline: none;
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

.dept {
  color: #4c6167;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.badge-on {
  background: #e6f4ec;
  color: #1c6b3f;
}

.badge-off {
  background: #f1f1f1;
  color: #6a6a6a;
}

@media (max-width: 640px) {
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
    grid-template-columns: 88px 1fr;
    gap: 8px;
  }

  .cell::before {
    content: attr(data-label);
    font-size: 12px;
    color: #5c7176;
    font-weight: 500;
  }
}
</style>
