<script setup>
// Read-only contacts for the signed-in employee's own leave route. The Worker
// takes the employee id from the session; this page never sends one.
import { onMounted, ref } from 'vue'
import { DATA_KEYS, PAGE_TTL_MS, errorTextOf, loaders, loadShared } from '../lib/shared-data.js'

const LOAD_ERROR = 'โหลดข้อมูลผู้อนุมัติไม่สำเร็จ กรุณาลองใหม่'
const NOTE = 'ข้อมูลนี้ให้ไว้เพื่อการติดต่อเท่านั้น หากต้องการแก้ไขข้อมูลกรุณาติดต่อฝ่ายบุคคล (HR)'
const NO_PHONE = 'ยังไม่มีข้อมูล'

const loading = ref(true)
const loadError = ref('')
const approvers = ref([])
const shiftLeads = ref([])

function personName(person) {
  return [person?.firstName, person?.lastName].filter(Boolean).join(' ') || '—'
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    await loadShared(DATA_KEYS.myApprovers, loaders.myApprovers, {
      ttlMs: PAGE_TTL_MS,
      onData: (data) => {
        approvers.value = Array.isArray(data.approvers) ? data.approvers : []
        shiftLeads.value = Array.isArray(data.shiftLeads) ? data.shiftLeads : []
      },
    })
  } catch (error) {
    loadError.value = errorTextOf(error, LOAD_ERROR)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="content">
    <div class="head">
      <div>
        <h1 class="title">ผู้อนุมัติของฉัน</h1>
        <p class="sub">ผู้ที่อนุมัติใบลาของคุณ และหัวหน้ากะของแผนกคุณ</p>
      </div>
    </div>

    <section class="readonly-note" role="note">
      <span class="readonly-badge">อ่านอย่างเดียว</span>
      <p>{{ NOTE }}</p>
    </section>

    <p v-if="loading" class="hint">กำลังโหลด…</p>
    <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>

    <template v-else>
      <section class="block">
        <h2 class="section-title">ผู้อนุมัติใบลาของฉัน</h2>
        <p v-if="approvers.length === 0" class="empty">ยังไม่มีข้อมูลผู้อนุมัติใบลา</p>
        <div v-else class="people">
          <article v-for="(person, index) in approvers" :key="`approver-${index}`" class="person-card">
            <h3 class="person-name">{{ personName(person) }}</h3>
            <dl class="rows">
              <div class="row">
                <dt>แผนก</dt>
                <dd>{{ person.departmentName || '—' }}</dd>
              </div>
              <div class="row">
                <dt>ตำแหน่ง</dt>
                <dd>{{ person.positionName || '—' }}</dd>
              </div>
              <div class="row">
                <dt>โทรศัพท์</dt>
                <dd :class="{ muted: !person.phone }">{{ person.phone || NO_PHONE }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <section class="block">
        <h2 class="section-title">หัวหน้ากะของฉัน</h2>
        <p v-if="shiftLeads.length === 0" class="empty">ยังไม่มีข้อมูลหัวหน้ากะ</p>
        <div v-else class="people">
          <article v-for="(person, index) in shiftLeads" :key="`shift-${index}`" class="person-card">
            <h3 class="person-name">{{ personName(person) }}</h3>
            <dl class="rows">
              <div class="row">
                <dt>แผนก</dt>
                <dd>{{ person.departmentName || '—' }}</dd>
              </div>
              <div class="row">
                <dt>ตำแหน่ง</dt>
                <dd>{{ person.positionName || '—' }}</dd>
              </div>
              <div class="row">
                <dt>โทรศัพท์</dt>
                <dd :class="{ muted: !person.phone }">{{ person.phone || NO_PHONE }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.content {
  max-width: 960px;
  margin: 0 auto;
  padding: 16px 0 48px;
}

.head {
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

.readonly-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin: 0 0 20px;
  padding: 16px 18px;
  border: 2px solid #b7791f;
  border-radius: 14px;
  background: #fff8e8;
}

.readonly-note p {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.6;
  color: #6b4300;
}

.readonly-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: #b7791f;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.hint,
.empty {
  font-size: 14px;
  color: #5c7176;
  padding: 8px 4px;
}

.block {
  margin-bottom: 24px;
}

.section-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
  color: #12343b;
}

.people {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.person-card {
  background: #ffffff;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  padding: 16px 20px;
}

.person-name {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.rows {
  display: grid;
  gap: 8px;
  margin: 0;
}

.row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  justify-content: space-between;
  min-width: 0;
}

.row dt {
  flex: 0 0 auto;
  font-size: 12.5px;
  color: #5c7176;
}

.row dd {
  margin: 0;
  min-width: 0;
  text-align: right;
  font-size: 14px;
  font-weight: 600;
  color: #12343b;
  overflow-wrap: anywhere;
}

.row dd.muted {
  font-weight: 500;
  color: #5c7176;
}
</style>
