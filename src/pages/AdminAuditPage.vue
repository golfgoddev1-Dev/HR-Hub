<script setup>
// System-admin only: the audit log as a ledger, newest first, grouped by Bangkok
// day. Read-only. Filters apply on change; "โหลดเพิ่ม" asks for the next page with
// the cursor the server returned. Rules and labels live in src/lib/admin-audit.js.
import { computed, onMounted, ref } from 'vue'
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_LOAD_ERROR,
  auditHeadline,
  buildAuditUrl,
  groupByDay,
  isRangeReversed,
  personLabel,
  readAuditPage,
} from '../lib/admin-audit.js'
import { formatBangkokDate, formatBangkokTime } from '../time.js'

const action = ref('')
const from = ref('')
const to = ref('')

const items = ref([])
const nextBefore = ref(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMessage = ref('')
const loaded = ref(false)

let ticket = 0

const groups = computed(() => groupByDay(items.value))
const rangeReversed = computed(() => isRangeReversed(from.value, to.value))
const hasFilter = computed(() => Boolean(action.value || from.value || to.value))

async function fetchPage(before) {
  const response = await fetch(
    buildAuditUrl({ action: action.value, from: from.value, to: to.value, before }),
    { credentials: 'same-origin' }
  )
  const data = await response.json().catch(() => null)
  const page = response.ok ? readAuditPage(data) : null
  if (!page) {
    const error = new Error('audit read failed')
    error.userMessage = typeof data?.message === 'string' ? data.message : AUDIT_LOAD_ERROR
    throw error
  }
  return page
}

async function reload() {
  if (rangeReversed.value) return
  const mine = ++ticket
  loading.value = true
  errorMessage.value = ''
  try {
    const page = await fetchPage('')
    if (mine !== ticket) return
    items.value = page.items
    nextBefore.value = page.nextBefore
    loaded.value = true
  } catch (error) {
    if (mine !== ticket) return
    items.value = []
    nextBefore.value = null
    errorMessage.value = error.userMessage ?? AUDIT_LOAD_ERROR
  } finally {
    if (mine === ticket) loading.value = false
  }
}

async function loadMore() {
  if (!nextBefore.value || loadingMore.value) return
  const mine = ticket
  loadingMore.value = true
  errorMessage.value = ''
  try {
    const page = await fetchPage(nextBefore.value)
    if (mine !== ticket) return
    items.value = [...items.value, ...page.items]
    nextBefore.value = page.nextBefore
  } catch (error) {
    if (mine !== ticket) return
    errorMessage.value = error.userMessage ?? AUDIT_LOAD_ERROR
  } finally {
    loadingMore.value = false
  }
}

function clearFilters() {
  action.value = ''
  from.value = ''
  to.value = ''
  reload()
}

onMounted(reload)
</script>

<template>
  <main class="content audit">
    <header class="head">
      <h1 class="title">ประวัติการใช้งานระบบ</h1>
      <p class="sub">
        ใครทำอะไร เมื่อไหร่ เรียงจากล่าสุด ไม่แสดงรายละเอียดส่วนบุคคล เช่น เลขบัตรประชาชนหรือ PIN
      </p>
    </header>

    <section class="filters" aria-label="ตัวกรอง">
      <div class="field field-action">
        <label class="label" for="audit-action">การกระทำ</label>
        <select id="audit-action" v-model="action" class="control" @change="reload">
          <option value="">ทุกการกระทำ</option>
          <option v-for="option in AUDIT_ACTION_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label class="label" for="audit-from">ตั้งแต่วันที่</label>
        <input id="audit-from" v-model="from" class="control" type="date" @change="reload" />
      </div>
      <div class="field">
        <label class="label" for="audit-to">ถึงวันที่</label>
        <input id="audit-to" v-model="to" class="control" type="date" @change="reload" />
      </div>
      <button
        v-if="hasFilter"
        type="button"
        class="clear"
        @click="clearFilters"
      >
        ล้างตัวกรอง
      </button>
      <p v-if="rangeReversed" class="range-error" role="alert">
        วันที่เริ่มอยู่หลังวันที่สิ้นสุด กรุณาเลือกช่วงวันที่ใหม่
      </p>
    </section>

    <p v-if="loading" class="hint" role="status">กำลังโหลดประวัติ…</p>
    <p v-else-if="errorMessage && items.length === 0" class="hint hint-error" role="alert">
      {{ errorMessage }}
    </p>
    <p v-else-if="loaded && items.length === 0" class="empty">
      {{
        hasFilter
          ? 'ไม่มีรายการที่ตรงกับตัวกรอง ลองเลือกการกระทำอื่นหรือขยายช่วงวันที่'
          : 'ยังไม่มีประวัติการใช้งาน รายการจะขึ้นที่นี่เมื่อมีคนใช้งานระบบ'
      }}
    </p>

    <section
      v-for="group in loading ? [] : groups"
      :key="group.key"
      class="card day"
      :aria-labelledby="`day-${group.key}`"
    >
      <h2 :id="`day-${group.key}`" class="day-title">
        {{ formatBangkokDate(group.iso) }}
      </h2>
      <ol class="ledger">
        <li v-for="item in group.items" :key="item.id" class="entry">
          <time class="entry-time" :datetime="item.createdAt">
            {{ formatBangkokTime(item.createdAt) }}
          </time>
          <div class="entry-body">
            <p class="entry-headline">{{ auditHeadline(item) }}</p>
            <p class="entry-people">
              <span>{{ personLabel(item.actor) ? `โดย ${personLabel(item.actor)}` : 'โดยระบบ' }}</span>
              <span v-if="personLabel(item.target)">ให้กับ {{ personLabel(item.target) }}</span>
            </p>
          </div>
        </li>
      </ol>
    </section>

    <div v-if="!loading && (nextBefore || (errorMessage && items.length > 0))" class="more">
      <p v-if="errorMessage && items.length > 0" class="more-error" role="alert">{{ errorMessage }}</p>
      <button
        v-if="nextBefore"
        type="button"
        class="more-button"
        :disabled="loadingMore"
        @click="loadMore"
      >
        {{ loadingMore ? 'กำลังโหลด…' : 'โหลดรายการก่อนหน้า' }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.audit {
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-strong: #4338ca;
  --accent-ink: #ffffff;
  --focus: #8b5cf6;
  --line: rgba(30, 27, 75, 0.16);
  --control-line: #64748b;
  --error: #a01b1b;
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

.audit,
.audit * {
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

.filters {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  padding: 16px;
  border-radius: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}

.control {
  width: 100%;
  min-width: 0;
  min-height: var(--tap-target);
  padding: 8px 12px;
  border: 1px solid var(--control-line);
  border-radius: 12px;
  background: #ffffff;
  font-family: inherit;
  font-size: 16px;
  color: var(--ink);
}

.clear,
.more-button {
  min-height: var(--tap-target);
  padding: 8px 16px;
  border-radius: 12px;
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.clear {
  border: 1px solid var(--accent);
  background: #ffffff;
  color: var(--accent-strong);
}

.control:focus-visible,
.clear:focus-visible,
.more-button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.range-error {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 15px;
  color: var(--error);
}

.hint,
.empty {
  margin: 0;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.hint-error {
  color: var(--error);
}

.day {
  padding: 16px 24px;
  border-radius: 20px;
}

.day-title {
  margin: 0 0 8px;
  font-family: 'Prompt', sans-serif;
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
}

.ledger {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* The time rail: one fixed column and a rule that marks the day's sequence. */
.entry {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.entry:first-child {
  border-top: 0;
}

.entry-time {
  padding-top: 2px;
  font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', sans-serif;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
  border-right: 2px solid rgba(79, 70, 229, 0.28);
}

.entry-body {
  min-width: 0;
}

.entry-headline {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.entry-people {
  display: flex;
  flex-wrap: wrap;
  column-gap: 12px;
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-body);
  overflow-wrap: anywhere;
}

.more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.more-error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 12px;
  background: #fdecec;
  font-size: 15px;
  color: var(--error);
}

.more-button {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.more-button:disabled {
  cursor: progress;
  opacity: 0.7;
}

@media (hover: hover) and (pointer: fine) {
  .clear:hover {
    background: #eef2ff;
  }

  .more-button:hover:not(:disabled) {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
  }
}

@media (max-width: 767px) {
  .filters {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .field-action,
  .clear {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .audit {
    padding-top: 16px;
  }

  .filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .day {
    padding: 16px;
  }

  .entry {
    grid-template-columns: 64px minmax(0, 1fr);
    gap: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .clear,
  .more-button {
    transition: none;
  }
}
</style>
