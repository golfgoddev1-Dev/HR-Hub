<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import { postJson } from '../api.js'
import { peekCached } from '../lib/data-cache.js'
import {
  APPROVALS_TTL_MS,
  DATA_KEYS,
  applyApprovalDecision,
  errorTextOf,
  invalidateDecidedLeave,
  loaders,
  loadShared,
} from '../lib/shared-data.js'

const LOAD_ERROR = 'โหลดรายการรออนุมัติไม่สำเร็จ กรุณาลองใหม่'
const ACTION_ERROR = 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'
const EMPTY = 'ไม่มีใบลาที่รอคุณอนุมัติ'

const loading = ref(true)
const errorMessage = ref('')
const actionError = ref('')
const results = ref([])
const busyId = ref(null)
const notes = reactive({})

const route = useRoute()
const focusId = computed(() => (typeof route.query.focus === 'string' ? route.query.focus : ''))

const count = computed(() => results.value.length)

function daysText(item) {
  const days = Number(item.days)
  if (!Number.isFinite(days)) return '—'
  return Number.isInteger(days) ? `${days} วัน` : `${days} วัน (ครึ่งวัน)`
}

async function load() {
  loading.value = !peekCached(DATA_KEYS.approvals)
  errorMessage.value = ''
  try {
    await loadShared(DATA_KEYS.approvals, loaders.approvals, {
      ttlMs: APPROVALS_TTL_MS,
      onData: (data) => {
        results.value = Array.isArray(data.results) ? data.results : []
      },
    })
  } catch (error) {
    errorMessage.value = errorTextOf(error, LOAD_ERROR)
  } finally {
    loading.value = false
  }
}

async function decide(item, action) {
  if (busyId.value) return
  actionError.value = ''

  const body = action === 'reject' ? { reason: (notes[item.id] ?? '').trim() } : {}
  if (action === 'reject' && body.reason.length === 0) {
    actionError.value = 'กรุณาระบุเหตุผลที่ไม่อนุมัติ'
    return
  }

  busyId.value = item.id
  try {
    const { status, data } = await postJson(
      `/api/leave/requests/${encodeURIComponent(item.id)}/${action}`,
      body
    )
    if (status !== 200 || data.ok !== true) {
      actionError.value = typeof data.message === 'string' ? data.message : ACTION_ERROR
      return
    }
    results.value = results.value.filter((row) => row.id !== item.id)
    delete notes[item.id]
    // The badge drops here at once and in every other tab of this browser, and
    // the cached queue loses this row: no refetch is needed for the count.
    applyApprovalDecision(item.id)
    invalidateDecidedLeave()
  } catch {
    actionError.value = ACTION_ERROR
  } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<template>
    <main class="content">
      <div class="head">
        <div>
          <h1 class="title">รออนุมัติ</h1>
          <p class="sub">
            เฉพาะใบลาที่คุณเป็นผู้อนุมัติ · อนุมัติหรือไม่อนุมัติได้ครั้งเดียวต่อใบลา
          </p>
        </div>
        <span class="count">{{ count }} รายการ</span>
      </div>

      <p v-if="loading" class="hint">กำลังโหลด…</p>

      <v-alert v-else-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>

      <p v-else-if="count === 0" class="empty">{{ EMPTY }}</p>

      <template v-else>
        <v-alert v-if="actionError" type="warning" variant="tonal" class="mb-4">
          {{ actionError }}
        </v-alert>

        <section class="list">
          <article
            v-for="item in results"
            :key="item.id"
            :class="['card', { 'card-focus': item.id === focusId }]"
          >
            <div class="card-head">
              <div>
                <span class="code">{{ item.requestCode || '—' }}</span>
                <h2 class="type">{{ item.leaveTypeName || 'ไม่ระบุประเภท' }}</h2>
                <p class="requester">
                  {{ item.requester?.fullName || '—' }}
                  <span v-if="item.requester?.employeeCode">· {{ item.requester.employeeCode }}</span>
                  <span v-if="item.requester?.departmentName">· {{ item.requester.departmentName }}</span>
                </p>
              </div>
              <span class="badge">รออนุมัติ</span>
            </div>

            <dl class="facts">
              <div class="fact">
                <dt>ช่วงวันที่</dt>
                <dd>{{ formatThaiDateRange(item.startDate, item.endDate) }}</dd>
              </div>
              <div class="fact">
                <dt>จำนวนวัน</dt>
                <dd>{{ daysText(item) }}</dd>
              </div>
              <div class="fact">
                <dt>กลับมาทำงาน</dt>
                <dd>
                  {{ item.returnDate ? `${formatThaiDate(item.returnDate)} ${item.returnTime || ''}` : '—' }}
                </dd>
              </div>
              <div class="fact">
                <dt>กะ / OT</dt>
                <dd>{{ item.shiftCode || '—' }} · {{ item.otOption || '—' }}</dd>
              </div>
            </dl>

            <p v-if="item.otherTypeDetail" class="note">ประเภทอื่น ๆ: {{ item.otherTypeDetail }}</p>
            <p v-if="item.reason" class="note">เหตุผล: {{ item.reason }}</p>
            <div class="decision">
              <textarea
                v-model="notes[item.id]"
                class="input textarea"
                rows="2"
                maxlength="500"
                placeholder="เหตุผล (จำเป็นเมื่อไม่อนุมัติ)"
              ></textarea>

              <div class="actions">
                <button
                  type="button"
                  class="primary-btn"
                  :disabled="busyId === item.id"
                  @click="decide(item, 'approve')"
                >
                  อนุมัติ
                </button>
                <button
                  type="button"
                  class="danger-btn"
                  :disabled="busyId === item.id"
                  @click="decide(item, 'reject')"
                >
                  ไม่อนุมัติ
                </button>
              </div>
            </div>
          </article>
        </section>
      </template>
    </main>
</template>

<style scoped>

.content {
  max-width: 960px;
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
  max-width: 560px;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.count {
  font-size: 13px;
  font-weight: 700;
  color: #10504e;
  background: #e4efec;
  border-radius: 999px;
  padding: 6px 12px;
}

.hint,
.empty {
  font-size: 14px;
  color: #5c7176;
  padding: 8px 4px;
}

.list {
  display: grid;
  gap: 14px;
}

.card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 16px 20px;
}

.card-focus {
  border-color: #10504e;
  box-shadow: 0 0 0 2px rgba(16, 80, 78, 0.18);
}

.card-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #5c7176;
}

.type {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.requester {
  margin: 4px 0 0;
  font-size: 13px;
  color: #5c7176;
}

.badge {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: #fff2df;
  color: #8a4b06;
  white-space: nowrap;
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  margin: 14px 0 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f6faf9;
}

.fact dt {
  font-size: 12px;
  color: #5c7176;
}

.fact dd {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
}

.note {
  margin: 10px 0 0;
  font-size: 13px;
  color: #5c7176;
  line-height: 1.6;
}

.note a {
  color: #10504e;
  font-weight: 600;
}

.decision {
  margin-top: 14px;
}

.input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 14px;
}

.textarea {
  resize: vertical;
  line-height: 1.6;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}

.primary-btn,
.danger-btn {
  min-height: 44px;
  min-width: 120px;
  padding: 0 18px;
  border: 0;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn {
  background: #10504e;
  color: #ffffff;
}

.danger-btn {
  background: #fdecec;
  color: #a01b1b;
  border: 1px solid #f3c6c6;
}

.primary-btn:disabled,
.danger-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
