<script setup>
import AppLoader from './AppLoader.vue'
// The employee's own quota position for the current year, one card per leave
// type that has a quota and a quiet line for a type without one.
//
// The ring is the existing ProgressDonut primitive (a painted conic arc plus a
// rotating marker); this panel adds no animation of its own. The numbers come
// from GET /api/leave/balance, which reads the caller's id from the session, and
// the day counts are the stored request days, so they match the list below.
import { computed, onMounted, ref } from 'vue'
import ProgressDonut from './ProgressDonut.vue'

const LOAD_ERROR = 'โหลดโควตาวันลาไม่สำเร็จ กรุณาลองใหม่'
const FIX = 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง'
const EMPTY = 'ยังไม่มีประเภทการลาในระบบ'
const NO_QUOTA = 'ไม่กำหนดโควตา'

const loading = ref(true)
const errorMessage = ref('')
const year = ref(new Date().getFullYear())
const rows = ref([])

const withQuota = computed(() => rows.value.filter((row) => row.quota !== null))
const withoutQuota = computed(() => rows.value.filter((row) => row.quota === null))

/** Whole days print without a decimal; a half day keeps its .5. */
function formatDays(value) {
  const days = Number(value)
  if (Number.isFinite(days) === false) return '0'
  return Number.isInteger(days) ? String(days) : days.toFixed(1)
}

/** The ring shows approved days out of the quota, clamped to the primitive. */
function usedPercent(row) {
  const quota = Number(row.quota)
  if (Number.isFinite(quota) === false || quota <= 0) return 0
  const used = Number(row.used)
  if (Number.isFinite(used) === false || used <= 0) return 0
  return Math.min((used / quota) * 100, 100)
}

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/leave/balance?year=${year.value}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      rows.value = []
      return
    }
    year.value = Number(data.year) || year.value
    rows.value = Array.isArray(data.results) ? data.results : []
  } catch {
    errorMessage.value = LOAD_ERROR
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="quota-panel" aria-labelledby="quota-title">
    <header class="quota-head">
      <h2 id="quota-title" class="quota-title">โควตาวันลา</h2>
      <p class="quota-year">ปี {{ year }}</p>
    </header>

    <AppLoader v-if="loading" label="กำลังโหลด…" />

    <div v-else-if="errorMessage" class="quota-error" role="alert">
      <p class="quota-error-text">{{ errorMessage }}</p>
      <p class="quota-fix">{{ FIX }}</p>
    </div>

    <p v-else-if="rows.length === 0" class="quota-hint">{{ EMPTY }}</p>

    <template v-else>
      <div v-if="withQuota.length > 0" class="quota-cards">
        <article v-for="row in withQuota" :key="row.leaveTypeId" class="quota-card">
          <ProgressDonut :value="usedPercent(row)" label="ใช้ไป" :size="56" />
          <div class="quota-copy">
            <h3 class="quota-type">{{ row.name || 'ไม่ระบุประเภท' }}</h3>
            <p class="quota-used">
              ใช้ไป {{ formatDays(row.used) }} จาก {{ formatDays(row.quota) }} วัน
            </p>
            <p class="quota-remaining">คงเหลือ {{ formatDays(row.remaining) }} วัน</p>
          </div>
        </article>
      </div>

      <ul v-if="withoutQuota.length > 0" class="quota-none">
        <li v-for="row in withoutQuota" :key="row.leaveTypeId">
          <span class="quota-type">{{ row.name || 'ไม่ระบุประเภท' }}</span>
          <span class="quota-none-label">{{ NO_QUOTA }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
/* Glass on the page's own tier tokens. No keyframes and no transition: the only
   motion on this panel is the ring the ProgressDonut primitive already owns. */
.quota-panel {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 20px 22px;
  background-color: var(--leave-home-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--leave-home-edge);
  border-radius: var(--radius-panel, 22px);
  box-shadow: var(--leave-home-shadow);
  -webkit-backdrop-filter: var(--leave-home-filter);
  backdrop-filter: var(--leave-home-filter);
}

.quota-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.quota-title {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.quota-year {
  margin: 0;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink-muted);
}

.quota-hint {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.quota-error {
  display: grid;
  gap: 4px;
}

.quota-error-text {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 600;
  color: #8a1c1c;
}

.quota-fix {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.quota-cards {
  display: grid;
  gap: 12px;
}

.quota-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px 16px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-row, 14px);
}

.quota-copy {
  min-width: 0;
}

.quota-type {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.quota-used {
  margin: 4px 0 0;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-body);
  font-variant-numeric: tabular-nums;
}

.quota-remaining {
  margin: 2px 0 0;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.quota-none {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.quota-none li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 8px 0 0;
  border-top: 1px solid var(--line);
}

.quota-none-label {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-muted);
}

@media (min-width: 760px) {
  .quota-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .quota-panel {
    padding: 16px 16px 18px;
    border-radius: 18px;
  }
}
</style>
