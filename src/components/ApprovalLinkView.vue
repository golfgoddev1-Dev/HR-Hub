<script setup>
// The public approval page body. It is deliberately outside the signed-in
// shell: the email link is the whole authority, so there is no session read and
// no redirect to the sign-in page. Opening the page only reads; a decision is
// one POST.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import {
  APPROVAL_ACTION_ERROR,
  APPROVAL_APPROVED_MESSAGE,
  APPROVAL_LOAD_ERROR,
  APPROVAL_LINK_MESSAGE,
  APPROVAL_REJECTED_MESSAGE,
  approvalPathForToken,
  daysLabel,
  invalidLinkLabel,
  normalizeReason,
  reasonError,
  REJECT_REASON_REQUIRED,
  REJECT_REASON_TOO_LONG,
} from '../lib/approval-link.js'

const props = defineProps({
  token: { type: String, default: '' },
})

const PAGE_TITLE = 'อนุมัติใบลา · HR Hub'
const APP_TITLE = 'HR Hub'

const loading = ref(true)
const loadError = ref('')
const request = ref(null)
const invalidCategory = ref('')
const decision = ref('')
const busy = ref(false)
const rejecting = ref(false)
const reason = ref('')
const formError = ref('')

const reasonMessage = computed(() => reasonError(reason.value))
const canSubmitReject = computed(() => !busy.value && reasonError(reason.value) === '')

async function load() {
  loading.value = true
  loadError.value = ''
  invalidCategory.value = ''

  try {
    const response = await fetch(approvalPathForToken(props.token), {
      credentials: 'omit',
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))

    if (response.status === 410 || data.code === 'link_unusable') {
      invalidCategory.value = typeof data.category === 'string' ? data.category : 'invalid'
      return
    }
    if (!response.ok || data.ok !== true || !data.request) {
      loadError.value = APPROVAL_LOAD_ERROR
      return
    }
    request.value = data.request
  } catch {
    loadError.value = APPROVAL_LOAD_ERROR
  } finally {
    loading.value = false
  }
}

function errorForCode(code) {
  if (code === 'reason_required') return REJECT_REASON_REQUIRED
  if (code === 'reason_too_long') return REJECT_REASON_TOO_LONG
  return APPROVAL_ACTION_ERROR
}

async function decide(action) {
  // One request at a time: a second press while this one is in flight does
  // nothing, and a decided request cannot be decided again.
  if (busy.value || decision.value !== '' || !request.value) return
  formError.value = ''

  const body = { decision: action }
  if (action === 'reject') {
    const problem = reasonError(reason.value)
    if (problem !== '') {
      formError.value = problem
      return
    }
    body.reason = normalizeReason(reason.value)
  }

  busy.value = true
  try {
    const response = await fetch(`${approvalPathForToken(props.token)}/decision`, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))

    if (response.status === 410 || data.code === 'link_unusable') {
      invalidCategory.value = typeof data.category === 'string' ? data.category : 'invalid'
      return
    }
    if (!response.ok || data.ok !== true) {
      formError.value = errorForCode(data.code)
      return
    }

    decision.value = data.status === 'rejected' ? 'rejected' : 'approved'
  } catch {
    formError.value = APPROVAL_ACTION_ERROR
  } finally {
    busy.value = false
  }
}

function cancelReject() {
  rejecting.value = false
  reason.value = ''
  formError.value = ''
}

onMounted(() => {
  document.title = PAGE_TITLE
  load()
})

onBeforeUnmount(() => {
  document.title = APP_TITLE
})
</script>

<template>
  <div class="approve-page">
    <main class="card">
      <header class="head">
        <p class="brand">HR Hub</p>
        <h1 class="title">อนุมัติใบลา</h1>
      </header>

      <p v-if="loading" class="hint">กำลังโหลด…</p>

      <section v-else-if="invalidCategory" class="notice" role="alert">
        <h2 class="notice-title">{{ APPROVAL_LINK_MESSAGE }}</h2>
        <p class="notice-sub">{{ invalidLinkLabel(invalidCategory) }}</p>
      </section>

      <section v-else-if="loadError" class="notice" role="alert">
        <h2 class="notice-title">{{ loadError }}</h2>
        <button type="button" class="btn btn-ghost" @click="load">ลองใหม่</button>
      </section>

      <section v-else-if="decision" class="notice" role="status">
        <h2 class="notice-title">
          {{ decision === 'approved' ? APPROVAL_APPROVED_MESSAGE : APPROVAL_REJECTED_MESSAGE }}
        </h2>
      </section>

      <template v-else-if="request">
        <dl class="facts">
          <div class="fact">
            <dt>พนักงาน</dt>
            <dd>
              {{ request.employeeName || '—' }}
              <span v-if="request.employeeCode" class="sub-value">{{ request.employeeCode }}</span>
            </dd>
          </div>
          <div class="fact">
            <dt>แผนก</dt>
            <dd>{{ request.departmentName || '—' }}</dd>
          </div>
          <div class="fact">
            <dt>ประเภทการลา</dt>
            <dd>
              {{ request.leaveTypeName || '—' }}
              <span v-if="request.otherTypeDetail" class="sub-value">
                {{ request.otherTypeDetail }}
              </span>
            </dd>
          </div>
          <div class="fact">
            <dt>ช่วงวันที่</dt>
            <dd>{{ formatThaiDateRange(request.startDate, request.endDate) }}</dd>
          </div>
          <div class="fact">
            <dt>จำนวนวัน</dt>
            <dd>{{ daysLabel(request.days) }}</dd>
          </div>
          <div class="fact">
            <dt>กลับมาทำงาน</dt>
            <dd>
              {{
                request.returnDate
                  ? `${formatThaiDate(request.returnDate)} ${request.returnTime || ''}`
                  : '—'
              }}
            </dd>
          </div>
          <div class="fact">
            <dt>กะ / OT</dt>
            <dd>{{ request.shiftCode || '—' }} · {{ request.otOption || '—' }}</dd>
          </div>
          <div class="fact">
            <dt>ใบรับรองแพทย์</dt>
            <dd>{{ request.hasMedicalCertificate ? 'มี' : 'ไม่มี' }}</dd>
          </div>
        </dl>

        <p v-if="request.reason" class="note">
          <strong>เหตุผล:</strong> {{ request.reason }}
        </p>

        <p v-if="formError" class="error" role="alert">{{ formError }}</p>

        <div v-if="!rejecting" class="actions">
          <button type="button" class="btn btn-primary" :disabled="busy" @click="decide('approve')">
            อนุมัติ
          </button>
          <button type="button" class="btn btn-danger" :disabled="busy" @click="rejecting = true">
            ไม่อนุมัติ
          </button>
        </div>

        <form v-else class="reject" @submit.prevent="decide('reject')">
          <label class="label" for="reject-reason">เหตุผลที่ไม่อนุมัติ (จำเป็น)</label>
          <textarea
            id="reject-reason"
            v-model="reason"
            class="textarea"
            rows="4"
            maxlength="500"
            autocomplete="off"
            placeholder="อธิบายเหตุผลสั้น ๆ"
          ></textarea>
          <p v-if="reason.length > 0" class="hint small">{{ reasonMessage }}</p>

          <div class="actions">
            <button type="submit" class="btn btn-danger" :disabled="!canSubmitReject">
              ยืนยันไม่อนุมัติ
            </button>
            <button type="button" class="btn btn-ghost" :disabled="busy" @click="cancelReject">
              ยกเลิก
            </button>
          </div>
        </form>
      </template>
    </main>
  </div>
</template>

<style scoped>
.approve-page {
  min-height: 100dvh;
  padding: 16px;
  box-sizing: border-box;
  background: #f4f7f6;
  color: #12343b;
}

.card {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 16px;
  box-sizing: border-box;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
}

.head {
  margin-bottom: 12px;
}

.brand {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #10504e;
}

.title {
  margin: 2px 0 0;
  font-size: 22px;
  font-weight: 700;
  color: #12343b;
}

.hint {
  margin: 8px 0;
  font-size: 14px;
  color: #5c7176;
}

.hint.small {
  font-size: 13px;
}

.notice {
  display: grid;
  gap: 10px;
  padding: 18px;
  border-radius: 12px;
  background: #f6faf9;
  border: 1px solid #e2e9e7;
}

.notice-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #12343b;
}

.notice-sub {
  margin: 0;
  font-size: 14px;
  color: #5c7176;
}

.facts {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  margin: 0;
  padding: 12px;
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
  overflow-wrap: anywhere;
}

.sub-value {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  font-weight: 400;
  color: #5c7176;
}

.note {
  margin: 12px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: #48615e;
  overflow-wrap: anywhere;
}

.error {
  margin: 12px 0 0;
  font-size: 13.5px;
  font-weight: 600;
  color: #a01b1b;
}

.actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.btn {
  width: 100%;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 10px;
  border: 0;
  font-family: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.btn-primary {
  background: #10504e;
  color: #ffffff;
}

.btn-danger {
  background: #fdecec;
  color: #a01b1b;
  border: 1px solid #f3c6c6;
}

.btn-ghost {
  background: #ffffff;
  color: #12343b;
  border: 1px solid #cfdcda;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.reject {
  margin-top: 14px;
}

.label {
  display: block;
  margin-bottom: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12343b;
}

.textarea {
  width: 100%;
  min-height: 110px;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid #cfdcda;
  border-radius: 10px;
  background: #f8fbfa;
  color: #12343b;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.6;
  resize: vertical;
}

@media (max-width: 480px) {
  .actions {
    grid-template-columns: 1fr;
  }
}
</style>
