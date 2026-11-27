<script setup>
// System-admin only: every organisation-wide setting the system runs on, read-only.
// HR edits the leave values and holidays on its own pages; the sign-in rules
// are fixed in the Worker. Wording and parsing live in src/lib/admin-settings.js.
import { onMounted, ref } from 'vue'
import {
  SECURITY_ROWS,
  SETTINGS_LOAD_ERROR,
  SETTINGS_URL,
  daysText,
  readSettings,
} from '../lib/admin-settings.js'
import { formatBangkokDate, formatBangkokTime } from '../time.js'

const settings = ref(null)
const loading = ref(true)
const errorMessage = ref('')

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(SETTINGS_URL, { credentials: 'same-origin' })
    const data = await response.json().catch(() => null)
    const parsed = response.ok ? readSettings(data) : null
    if (!parsed) {
      settings.value = null
      errorMessage.value = typeof data?.message === 'string' ? data.message : SETTINGS_LOAD_ERROR
      return
    }
    settings.value = parsed
  } catch {
    settings.value = null
    errorMessage.value = SETTINGS_LOAD_ERROR
  } finally {
    loading.value = false
  }
}

function changedText(leave) {
  if (!leave.configured || !leave.updatedAt) return 'ฝ่ายบุคคลยังไม่เคยแก้ ระบบใช้ค่าเริ่มต้น'
  const when = `${formatBangkokDate(leave.updatedAt)} เวลา ${formatBangkokTime(leave.updatedAt)}`
  if (!leave.updatedBy) return `แก้ล่าสุด ${when}`
  return `แก้ล่าสุด ${when} โดย ${leave.updatedBy.fullName} (${leave.updatedBy.employeeCode})`
}

onMounted(load)
</script>

<template>
  <main class="content settings">
    <header class="head">
      <h1 class="title">ตั้งค่าระบบ</h1>
      <p class="sub">
        ค่าที่ระบบใช้อยู่ตอนนี้ หน้านี้ดูได้อย่างเดียว การเก็บข้อมูลการลาและวันหยุดแก้ได้ที่เมนูของฝ่ายบุคคล
      </p>
    </header>

    <p v-if="loading && !settings" class="hint" role="status">กำลังโหลดค่าตั้งค่า…</p>
    <div v-else-if="errorMessage" class="hint hint-error" role="alert">
      <p class="hint-text">{{ errorMessage }}</p>
      <button type="button" class="retry" :disabled="loading" @click="load">โหลดอีกครั้ง</button>
    </div>

    <template v-if="settings">
      <section class="card group" aria-labelledby="group-leave">
        <h2 id="group-leave" class="group-title">การเก็บข้อมูลการลา</h2>

        <div class="purge" :class="{ 'purge-on': settings.leave.leaveRetentionEnabled }">
          <p class="purge-label">ลบใบลาเก่าอัตโนมัติ</p>
          <p class="purge-value">
            <template v-if="settings.leave.leaveRetentionEnabled">
              เปิดอยู่ ลบใบลาที่เก่ากว่า {{ daysText(settings.leave.leaveRetentionDays) }}
            </template>
            <template v-else>ปิดอยู่ ระบบเก็บใบลาไว้ทั้งหมด</template>
          </p>
        </div>

        <dl class="rows">
          <div class="row">
            <dt class="row-label">เก็บไฟล์ใบรับรองแพทย์</dt>
            <dd class="row-value">{{ daysText(settings.leave.certificateRetentionDays) }}</dd>
          </div>
        </dl>

        <p class="note">{{ changedText(settings.leave) }}</p>
      </section>

      <section class="card group" aria-labelledby="group-holidays">
        <h2 id="group-holidays" class="group-title">วันหยุดบริษัท</h2>
        <dl class="rows">
          <div class="row">
            <dt class="row-label">วันหยุดในปีนี้</dt>
            <dd class="row-value">{{ settings.holidays.count }} วัน</dd>
          </div>
          <div class="row">
            <dt class="row-label">วันหยุดถัดไป</dt>
            <dd class="row-value">
              <template v-if="settings.holidays.next">
                {{ formatBangkokDate(settings.holidays.next.date) }}
                <span class="row-detail">{{ settings.holidays.next.name }}</span>
              </template>
              <template v-else>ยังไม่มีวันหยุดที่จะถึง</template>
            </dd>
          </div>
        </dl>
        <p v-if="settings.holidays.count === 0" class="note">
          ยังไม่มีวันหยุดของปีนี้ ฝ่ายบุคคลเพิ่มได้ที่หน้าวันหยุดบริษัท
        </p>
      </section>

      <section class="card group" aria-labelledby="group-security">
        <h2 id="group-security" class="group-title">การเข้าสู่ระบบ</h2>
        <dl class="rows">
          <div v-for="row in SECURITY_ROWS" :key="row.key" class="row">
            <dt class="row-label">{{ row.label }}</dt>
            <dd class="row-value">{{ settings.security[row.key] }} {{ row.unit }}</dd>
          </div>
        </dl>
        <p class="note">ค่าในส่วนนี้เปลี่ยนได้เมื่อแก้โค้ดของระบบเท่านั้น</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.settings {
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-strong: #4338ca;
  --accent-ink: #ffffff;
  --focus: #8b5cf6;
  --line: rgba(30, 27, 75, 0.16);
  --error-ink: #a01b1b;
  --tap-target: 44px;

  max-width: 880px;
  margin: 0 auto;
  padding: 24px 0 64px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-family: 'Sarabun', sans-serif;
  color: var(--ink-body);
}

.settings,
.settings * {
  box-sizing: border-box;
}

.title {
  margin: 0 0 8px;
  font-family: 'Prompt', sans-serif;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--ink);
}

.sub {
  margin: 0;
  max-width: 68ch;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.hint {
  margin: 0;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.hint-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  color: var(--error-ink);
}

.hint-text {
  margin: 0;
}

.retry {
  min-height: var(--tap-target);
  padding: 8px 24px;
  border: 1px solid var(--accent);
  border-radius: 12px;
  background: var(--accent);
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 500;
  color: var(--accent-ink);
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.retry:disabled {
  cursor: progress;
  opacity: 0.7;
}

.retry:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.group {
  padding: 24px;
  border-radius: 20px;
}

.group-title {
  margin: 0 0 16px;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
}

/* The one bold element: the only setting here that deletes data. */
.purge {
  margin: 0 0 16px;
  padding: 16px;
  border-left: 4px solid var(--line);
  border-radius: 4px;
}

.purge-on {
  border-left-color: var(--accent);
}

.purge-label {
  margin: 0 0 4px;
  font-size: 15px;
  color: var(--ink-muted);
}

.purge-value {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.rows {
  margin: 0;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.row-label {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.row-value {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.55;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.row-detail {
  display: block;
  font-weight: 400;
  color: var(--ink-body);
}

.note {
  margin: 12px 0 0;
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

@media (hover: hover) and (pointer: fine) {
  .retry:hover:not(:disabled) {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
  }
}

@media (max-width: 480px) {
  .settings {
    padding-top: 16px;
  }

  .group {
    padding: 16px;
  }

  .row {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .purge-value {
    font-size: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .retry {
    transition: none;
  }
}
</style>
