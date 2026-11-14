<script setup>
import { onMounted, ref } from 'vue'
import { getSession } from '../api.js'
import { formatEmail, readProfile } from '../lib/profile-form.js'
import { DATA_KEYS, PAGE_TTL_MS, errorTextOf, loaders, loadShared } from '../lib/shared-data.js'
import PushToggle from '../components/PushToggle.vue'
import HrMenuShortcutSettings from '../components/HrMenuShortcutSettings.vue'

const LOAD_ERROR = 'โหลดข้อมูลส่วนตัวไม่สำเร็จ กรุณาลองใหม่'

const loading = ref(true)
const loadError = ref('')
const isApprover = ref(false)
const isHr = ref(false)
const profile = ref(readProfile({}))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    await loadShared(DATA_KEYS.profile, loaders.profile, {
      ttlMs: PAGE_TTL_MS,
      onData: (data) => {
        profile.value = readProfile(data)
      },
    })
  } catch (error) {
    loadError.value = errorTextOf(error, LOAD_ERROR)
  } finally {
    loading.value = false
  }
}

async function loadApprover() {
  const session = await getSession()
  isApprover.value = session?.isApprover === true
  // Only HR has an HR home to arrange, so only HR sees the menu picker.
  isHr.value = session?.role === 'hr'
}

onMounted(() => {
  load()
  loadApprover()
})
</script>

<template>
  <main class="content">
    <div class="head">
      <div>
        <h1 class="title">ข้อมูลส่วนตัว</h1>
        <p class="sub">ข้อมูลส่วนตัวของคุณเป็นแบบอ่านอย่างเดียว</p>
      </div>
    </div>

    <section class="readonly-note" role="note" aria-label="ข้อมูลส่วนตัวอ่านอย่างเดียว">
      <span class="readonly-badge">อ่านอย่างเดียว</span>
      <p>หากต้องการแก้ไขข้อมูล กรุณาติดต่อฝ่ายบุคคล (HR) เท่านั้น</p>
    </section>

    <p v-if="loading" class="hint">กำลังโหลด…</p>
    <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>

    <PushToggle v-if="!loading && !loadError" :approver="isApprover" />

    <HrMenuShortcutSettings
      v-if="!loading && !loadError && isHr"
      :saved="profile.hrMenuShortcuts"
    />

    <section v-if="!loading && !loadError" class="card" aria-readonly="true">
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
  </main>
</template>

<style scoped>
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

.readonly-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin: 0 0 16px;
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
  /* 5.13:1 with white; the old #b7791f only reached 3.64:1. */
  background: #98620f;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
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
  /* Was #8b9c9a: 2.87:1 on the white card. */
  color: #5c7176;
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

@media (min-width: 620px) {
  .rows {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .card {
    padding: 14px;
  }

  .head {
    flex-direction: column;
  }

  .readonly-note {
    padding: 14px;
  }
}
</style>
