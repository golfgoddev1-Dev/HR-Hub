<script setup>
// One read-only request card, shared by the calendar day panel and the approval
// history page. It shows exactly the fields the approvals page shows and reads
// them from data already in memory; it never fetches.
import { computed } from 'vue'
import { formatThaiDate, formatThaiDateRange } from '../lib/thai-date.js'
import { CERTIFICATE_OPEN_LABEL, certificateStatus } from '../leave-certificate.js'

const props = defineProps({
  request: { type: Object, required: true },
})

const daysText = computed(() => {
  const days = Number(props.request.days)
  if (!Number.isFinite(days)) return '—'
  return Number.isInteger(days) ? `${days} วัน` : `${days} วัน (ครึ่งวัน)`
})

const requesterLine = computed(() => {
  const requester = props.request.requester ?? {}
  return [requester.fullName, requester.employeeCode, requester.departmentName]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' · ')
})

const certificate = computed(() => certificateStatus(props.request))
const canOpenCertificate = computed(
  () => certificate.value.has && certificate.value.canOpen
)
</script>

<template>
  <section class="request-detail" aria-label="รายละเอียดใบลา">
    <header class="request-head">
      <span class="request-code">{{ request.requestCode || '—' }}</span>
      <h3 class="request-type">{{ request.leaveTypeName || 'ไม่ระบุประเภท' }}</h3>
      <p class="request-person">{{ requesterLine || '—' }}</p>
    </header>

    <dl class="request-facts">
      <div class="request-fact">
        <dt>ช่วงวันที่</dt>
        <dd>{{ formatThaiDateRange(request.startDate, request.endDate) }}</dd>
      </div>
      <div class="request-fact">
        <dt>จำนวนวัน</dt>
        <dd>{{ daysText }}</dd>
      </div>
      <div class="request-fact">
        <dt>กลับมาทำงาน</dt>
        <dd>
          {{
            request.returnDate
              ? `${formatThaiDate(request.returnDate)} ${request.returnTime || ''}`
              : '—'
          }}
        </dd>
      </div>
      <div class="request-fact">
        <dt>กะ / OT</dt>
        <dd>{{ request.shiftCode || '—' }} · {{ request.otOption || '—' }}</dd>
      </div>
    </dl>

    <p v-if="request.otherTypeDetail" class="request-note">
      ประเภทอื่น ๆ: {{ request.otherTypeDetail }}
    </p>
    <p v-if="request.reason" class="request-note">เหตุผล: {{ request.reason }}</p>
    <p v-if="certificate.has" class="request-note">
      <span>{{ canOpenCertificate ? CERTIFICATE_OPEN_LABEL : certificate.label }}</span>
    </p>
    <p v-if="request.decisionNote" class="request-note">
      หมายเหตุการตัดสินใจ: {{ request.decisionNote }}
    </p>
  </section>
</template>

<style scoped>
.request-detail {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e2e9e7;
  border-radius: 12px;
  background: #f6faf9;
}

.request-head {
  display: grid;
  gap: 2px;
}

.request-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: #5c7176;
}

.request-type {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #12343b;
}

.request-person {
  margin: 0;
  font-size: 13px;
  color: #48615e;
  overflow-wrap: anywhere;
}

.request-facts {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #ffffff;
}

.request-fact dt {
  font-size: 12px;
  color: #5c7176;
}

.request-fact dd {
  margin: 2px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: #12343b;
}

.request-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #48615e;
  overflow-wrap: anywhere;
}
</style>
