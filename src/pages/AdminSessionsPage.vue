<script setup>
// System-admin only: who is signed in right now, and which accounts are locked by
// failed PIN attempts. Signing someone out takes a second press to confirm; an
// unlock is one press because it only lets the person try their PIN again.
// Wording and reply reading live in src/lib/admin-sessions.js.
import { computed, onMounted, ref } from 'vue'
import { adminRoleLabel } from '../lib/admin-overview.js'
import {
  IDLE_MINUTES,
  REVOKE_ERROR,
  SESSIONS_LOAD_ERROR,
  SESSIONS_URL,
  UNLOCK_ERROR,
  isListTruncated,
  personName,
  readSessions,
  revokeUrl,
  unlockUrl,
} from '../lib/admin-sessions.js'
import { formatBangkokTime } from '../time.js'

const data = ref(null)
const loading = ref(true)
const loadError = ref('')
const busyKey = ref('')
const confirmId = ref('')
const statusMessage = ref('')
const errorMessage = ref('')

const truncated = computed(() => isListTruncated(data.value))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await fetch(SESSIONS_URL, { credentials: 'same-origin' })
    const body = await response.json().catch(() => null)
    const parsed = response.ok ? readSessions(body) : null
    if (!parsed) {
      data.value = null
      loadError.value = typeof body?.message === 'string' ? body.message : SESSIONS_LOAD_ERROR
      return
    }
    data.value = parsed
  } catch {
    data.value = null
    loadError.value = SESSIONS_LOAD_ERROR
  } finally {
    loading.value = false
  }
}

async function post(url, key, failMessage, doneMessage) {
  if (busyKey.value) return
  busyKey.value = key
  statusMessage.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch(url, { method: 'POST', credentials: 'same-origin' })
    const body = await response.json().catch(() => ({}))
    // 404 means someone else already signed it out: the list just needs a refresh.
    if (!response.ok && response.status !== 404) {
      errorMessage.value = typeof body.message === 'string' ? body.message : failMessage
      return
    }
    statusMessage.value = response.ok ? doneMessage : body.message
    confirmId.value = ''
    await load()
  } catch {
    errorMessage.value = failMessage
  } finally {
    busyKey.value = ''
  }
}

function revoke(session) {
  return post(
    revokeUrl(session.id),
    session.id,
    REVOKE_ERROR,
    `ออกจากระบบให้ ${personName(session)} แล้ว`
  )
}

function unlock(person) {
  return post(
    unlockUrl(person.employeeId),
    person.employeeId,
    UNLOCK_ERROR,
    `ปลดล็อกบัญชีของ ${personName(person)} แล้ว`
  )
}

onMounted(load)
</script>

<template>
  <main class="content sessions">
    <header class="head">
      <h1 class="title">เซสชันผู้ใช้</h1>
      <p class="sub">
        ดูว่าใครกำลังใช้งานระบบอยู่ ออกจากระบบให้ผู้ใช้ที่น่าสงสัย และปลดล็อกบัญชีที่ใส่ PIN ผิดครบ 5 ครั้ง
        รายชื่อแสดงเฉพาะผู้ที่ใช้งานภายใน {{ IDLE_MINUTES }} นาทีล่าสุด
      </p>
    </header>

    <p v-if="statusMessage" class="notice notice-ok" role="status">{{ statusMessage }}</p>
    <p v-if="errorMessage" class="notice notice-error" role="alert">{{ errorMessage }}</p>

    <p v-if="loading && !data" class="hint" role="status">กำลังโหลด…</p>
    <p v-else-if="loadError" class="hint hint-error" role="alert">{{ loadError }}</p>

    <template v-if="data">
      <section class="card block" aria-labelledby="locked-title">
        <h2 id="locked-title" class="block-title">บัญชีที่ถูกล็อก</h2>
        <p v-if="data.locked.length === 0" class="none">ไม่มีบัญชีที่ถูกล็อกในตอนนี้</p>
        <ul v-else class="rows">
          <li v-for="person in data.locked" :key="person.employeeId" class="row">
            <div class="who">
              <p class="name">{{ personName(person) }}</p>
              <p class="meta">ล็อกถึง {{ formatBangkokTime(person.lockedUntil) }}</p>
            </div>
            <div class="actions">
              <button
                type="button"
                class="btn btn-primary"
                :disabled="busyKey !== ''"
                @click="unlock(person)"
              >
                {{ busyKey === person.employeeId ? 'กำลังปลดล็อก…' : 'ปลดล็อก' }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="card block" aria-labelledby="sessions-title">
        <h2 id="sessions-title" class="block-title">ผู้ที่กำลังใช้งาน</h2>
        <p v-if="data.sessions.length === 0" class="none">ไม่มีผู้ใช้งานในช่วง {{ IDLE_MINUTES }} นาทีล่าสุด</p>
        <ul v-else class="rows">
          <li v-for="session in data.sessions" :key="session.id" class="row">
            <div class="who">
              <p class="name">{{ personName(session) }}</p>
              <p class="meta meta-split">
                <span>{{ adminRoleLabel(session.role) }}</span>
                <span>ใช้งานล่าสุด {{ formatBangkokTime(session.lastActiveAt) }}</span>
                <span>เข้าสู่ระบบ {{ formatBangkokTime(session.createdAt) }}</span>
              </p>
            </div>
            <div class="actions">
              <span v-if="session.isOwn" class="own">เซสชันของคุณ</span>
              <template v-else-if="confirmId === session.id">
                <button
                  type="button"
                  class="btn btn-primary"
                  :disabled="busyKey !== ''"
                  @click="revoke(session)"
                >
                  {{ busyKey === session.id ? 'กำลังดำเนินการ…' : 'ยืนยันออกจากระบบ' }}
                </button>
                <button type="button" class="btn btn-quiet" :disabled="busyKey !== ''" @click="confirmId = ''">
                  ยกเลิก
                </button>
              </template>
              <button
                v-else
                type="button"
                class="btn btn-quiet"
                :disabled="busyKey !== ''"
                @click="confirmId = session.id"
              >
                ออกจากระบบ
              </button>
            </div>
          </li>
        </ul>
        <p v-if="truncated" class="none">
          แสดง {{ data.sessionsLimit }} รายการล่าสุดเท่านั้น อาจมีผู้ใช้งานอยู่อีก
        </p>
      </section>
    </template>

    <div class="refresh">
      <button type="button" class="btn btn-quiet" :disabled="loading || busyKey !== ''" @click="load">
        {{ loading ? 'กำลังโหลด…' : 'โหลดใหม่' }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.sessions {
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-strong: #4338ca;
  --accent-ink: #ffffff;
  --focus: #8b5cf6;
  --line: rgba(30, 27, 75, 0.16);
  --ok-fill: #e6f4ec;
  --ok-ink: #1c6b3f;
  --error-fill: #fdecec;
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

.sessions,
.sessions * {
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
  color: var(--error-ink);
}

.notice {
  margin: 0;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 16px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.notice-ok {
  background: var(--ok-fill);
  color: var(--ok-ink);
}

.notice-error {
  background: var(--error-fill);
  color: var(--error-ink);
}

.block {
  padding: 24px;
  border-radius: 20px;
}

.block-title {
  margin: 0 0 8px;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
}

.none {
  margin: 8px 0 0;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.row:first-child {
  border-top: 0;
}

.who {
  flex: 1 1 260px;
  min-width: 0;
}

.name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.meta {
  margin: 4px 0 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.meta-split {
  display: flex;
  flex-wrap: wrap;
  column-gap: 16px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.own {
  font-size: 15px;
  color: var(--ink-muted);
}

.btn {
  min-height: var(--tap-target);
  padding: 8px 16px;
  border-radius: 12px;
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.btn-primary {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}

.btn-quiet {
  border: 1px solid var(--accent);
  background: #ffffff;
  color: var(--accent-strong);
}

.btn:disabled {
  cursor: progress;
  opacity: 0.7;
}

.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.refresh {
  display: flex;
}

@media (hover: hover) and (pointer: fine) {
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
  }

  .btn-quiet:hover:not(:disabled) {
    background: #eef2ff;
  }
}

@media (max-width: 480px) {
  .sessions {
    padding-top: 16px;
  }

  .block {
    padding: 16px;
  }

  .actions,
  .actions .btn {
    width: 100%;
  }

  .actions .btn {
    flex: 1 1 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }
}
</style>
