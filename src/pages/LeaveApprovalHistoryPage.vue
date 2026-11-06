<script setup>
// Approval history: the decision log. An active approver sees the requests they
// decided; HR sees every decision. The list never carries a reason — opening a
// row reads the scoped detail, which may.
import { onMounted, ref } from 'vue'
import { formatThaiDateRange, todayBangkokIso } from '../lib/thai-date.js'
import {
  HISTORY_DECISIONS,
  currentMonthRange,
  decisionLabel,
  formatHistoryDate,
  formatHistoryTime,
  historyQuery,
  mergeHistoryPages,
} from '../lib/approval-history.js'
import { errorTextOf, requestJson } from '../lib/shared-data.js'
import LeaveRequestDetail from '../components/LeaveRequestDetail.vue'

const LOAD_ERROR = 'โหลดประวัติการอนุมัติไม่สำเร็จ กรุณาลองใหม่'
const DETAIL_ERROR = 'โหลดรายละเอียดใบลาไม่สำเร็จ กรุณาลองใหม่'
const EMPTY = 'ไม่พบประวัติการอนุมัติในช่วงนี้'

const initial = currentMonthRange(todayBangkokIso())
const filters = ref({
  from: initial.from,
  to: initial.to,
  decision: 'all',
  search: '',
})

const rows = ref([])
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const errorMessage = ref('')

const detail = ref(null)
const detailError = ref('')
const detailLoading = ref(false)
const detailClose = ref(null)

function daysText(row) {
  const days = Number(row.days)
  if (!Number.isFinite(days)) return '—'
  return Number.isInteger(days) ? `${days} วัน` : `${days} วัน (ครึ่งวัน)`
}

async function load({ append = false } = {}) {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''

  const nextPage = append ? page.value + 1 : 1
  try {
    const data = await requestJson(
      historyQuery({
        from: filters.value.from,
        to: filters.value.to,
        decision: filters.value.decision,
        search: filters.value.search,
        page: nextPage,
      })
    )
    const incoming = Array.isArray(data.results) ? data.results : []
    rows.value = append ? mergeHistoryPages(rows.value, incoming) : incoming
    page.value = nextPage
    hasMore.value = data.hasMore === true
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  load()
}

function loadMore() {
  load({ append: true })
}

async function openDetail(row) {
  if (!row?.id || detailLoading.value) return
  detailError.value = ''
  detail.value = null
  detailLoading.value = true

  try {
    const data = await requestJson(`/api/leave/requests/${encodeURIComponent(row.id)}`)
    detail.value = data.request
    requestAnimationFrame(() => detailClose.value?.focus())
  } catch (error) {
    detailError.value = errorTextOf(error, DETAIL_ERROR)
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  detail.value = null
  detailError.value = ''
}

function onDetailKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDetail()
  }
}

onMounted(load)
</script>

<template>
  <main class="content">
    <div class="head">
      <div>
        <h1 class="title">ประวัติการอนุมัติ</h1>
        <p class="sub">ใบลาที่ตัดสินแล้ว · ไม่รวมใบลาที่รออนุมัติ</p>
      </div>
    </div>

    <form class="filters" aria-label="ตัวกรองประวัติการอนุมัติ" @submit.prevent="applyFilters">
      <label class="filter">
        <span class="filter-label">ตั้งแต่วันที่</span>
        <input v-model="filters.from" type="date" class="filter-input" />
      </label>

      <label class="filter">
        <span class="filter-label">ถึงวันที่</span>
        <input v-model="filters.to" type="date" class="filter-input" />
      </label>

      <label class="filter">
        <span class="filter-label">การตัดสินใจ</span>
        <select v-model="filters.decision" class="filter-input">
          <option value="all">ทั้งหมด</option>
          <option
            v-for="decision in HISTORY_DECISIONS.filter((value) => value !== 'all')"
            :key="decision"
            :value="decision"
          >
            {{ decisionLabel(decision) }}
          </option>
        </select>
      </label>

      <label class="filter filter-search">
        <span class="filter-label">ค้นหาชื่อ</span>
        <input
          v-model="filters.search"
          type="search"
          class="filter-input"
          maxlength="100"
          placeholder="ชื่อพนักงาน"
        />
      </label>

      <button type="submit" class="apply-btn" :disabled="loading">ค้นหา</button>
    </form>

    <p v-if="loading && rows.length === 0" class="hint">กำลังโหลด…</p>
    <v-alert v-else-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>
    <p v-else-if="rows.length === 0" class="hint">{{ EMPTY }}</p>

    <section v-else class="history" aria-label="รายการประวัติการอนุมัติ">
      <div class="history-head" aria-hidden="true">
        <span>วันที่ตัดสิน</span>
        <span>พนักงาน</span>
        <span>แผนก</span>
        <span>ประเภทการลา</span>
        <span>ช่วงวันที่</span>
        <span>จำนวนวัน</span>
        <span>การตัดสินใจ</span>
      </div>

      <button
        v-for="row in rows"
        :key="row.id"
        type="button"
        class="history-row"
        @click="openDetail(row)"
      >
        <span class="cell cell-when">
          <span class="when-date">{{ formatHistoryDate(row.decidedAt) }}</span>
          <span class="when-time">{{ formatHistoryTime(row.decidedAt) }}</span>
        </span>
        <span class="cell cell-name">{{ row.employeeName || '—' }}</span>
        <span class="cell">{{ row.departmentName || '—' }}</span>
        <span class="cell">{{ row.leaveTypeName || '—' }}</span>
        <span class="cell">{{ formatThaiDateRange(row.startDate, row.endDate) }}</span>
        <span class="cell">{{ daysText(row) }}</span>
        <span
          class="cell decision"
          :class="row.decision === 'approved' ? 'is-approved' : 'is-rejected'"
        >
          {{ decisionLabel(row.decision) }}
        </span>
      </button>

      <button v-if="hasMore" type="button" class="more-btn" :disabled="loading" @click="loadMore">
        {{ loading ? 'กำลังโหลด…' : 'โหลดเพิ่ม' }}
      </button>
    </section>

    <p v-if="detailError" class="hint hint-error">{{ detailError }}</p>

    <div v-if="detailLoading || detail" class="detail-layer">
      <div class="detail-backdrop" aria-hidden="true" @click="closeDetail"></div>
      <section
        class="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="รายละเอียดใบลา"
        @keydown="onDetailKeydown"
      >
        <header class="detail-head">
          <h2 class="detail-title">รายละเอียดใบลา</h2>
          <button
            ref="detailClose"
            type="button"
            class="detail-close"
            aria-label="ปิด"
            @click="closeDetail"
          >
            ปิด
          </button>
        </header>

        <div class="detail-body">
          <p v-if="detailLoading" class="hint">กำลังโหลด…</p>
          <LeaveRequestDetail v-else-if="detail" :request="detail" />
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.content {
  padding: 8px 0 48px;
}

.head {
  margin-bottom: 12px;
}

.title {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
}

.sub {
  margin: 0;
  font-size: 13px;
  color: #5c7176;
}

.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  align-items: end;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid #e2e9e7;
  border-radius: 14px;
  background: #ffffff;
}

.filter {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.filter-label {
  font-size: 12px;
  font-weight: 600;
  color: #48615e;
}

.filter-input {
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  box-sizing: border-box;
  border: 1px solid #d8e3e1;
  border-radius: 10px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 14px;
}

.apply-btn {
  min-height: 44px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  background: #10504e;
  color: #ffffff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.apply-btn:disabled,
.more-btn:disabled {
  opacity: 0.65;
  cursor: progress;
}

.filter-input:focus-visible,
.apply-btn:focus-visible,
.history-row:focus-visible,
.more-btn:focus-visible,
.detail-close:focus-visible {
  outline: 3px solid #10504e;
  outline-offset: 2px;
}

.hint {
  margin: 12px 4px;
  font-size: 13px;
  color: #5c7176;
}

.hint-error {
  color: #a01b1b;
}

.history {
  display: grid;
  gap: 6px;
}

.history-head {
  display: none;
}

.history-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  width: 100%;
  min-height: 44px;
  padding: 12px;
  border: 1px solid #e2e9e7;
  border-radius: 12px;
  background: #ffffff;
  color: #12343b;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.history-row:hover {
  background: #f6faf9;
}

.cell {
  min-width: 0;
  overflow-wrap: anywhere;
}

.cell-when {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 6px;
  grid-column: 1 / -1;
}

.when-date {
  font-weight: 700;
}

.when-time {
  color: #5c7176;
}

.cell-name {
  font-weight: 700;
}

.decision {
  justify-self: start;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.is-approved {
  background: #e7f2f0;
  color: #10504e;
}

.is-rejected {
  background: #fdecec;
  color: #a01b1b;
}

.more-btn {
  min-height: 44px;
  margin-top: 6px;
  border: 1px solid #d8e3e1;
  border-radius: 10px;
  background: #ffffff;
  color: #10504e;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.detail-layer {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.detail-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(11, 28, 24, 0.45);
}

.detail-dialog {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 80vh;
  overflow: hidden;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 24px 60px -24px rgba(11, 28, 24, 0.55);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e2e9e7;
}

.detail-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.detail-close {
  min-width: 44px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid #d8e3e1;
  border-radius: 10px;
  background: #f3f8f6;
  color: #10504e;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.detail-body {
  padding: 14px 16px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

@media (min-width: 768px) {
  .history-head,
  .history-row {
    grid-template-columns: 120px 1.3fr 0.9fr 1fr 1.6fr 80px 96px;
    align-items: center;
  }

  .history-head {
    display: grid;
    gap: 10px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 700;
    color: #48615e;
  }

  .history-row {
    gap: 10px;
  }

  .cell-when {
    grid-column: auto;
    display: grid;
  }
}

@media (max-width: 767px) {
  .detail-layer {
    align-items: flex-end;
    padding: 0;
  }

  .detail-dialog {
    width: 100%;
    max-height: 80vh;
    border-radius: 16px 16px 0 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .history-row,
  .apply-btn,
  .more-btn {
    transition: none;
  }
}
</style>
