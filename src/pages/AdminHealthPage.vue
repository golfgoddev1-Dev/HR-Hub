<script setup>
// System-admin only: are the push and email queues keeping up? Read-only; one
// request on open and one each time "ตรวจอีกครั้ง" is pressed. Wording and rules
// live in src/lib/admin-health.js.
import { onMounted, ref } from 'vue'
import {
  HEALTH_FIGURES,
  HEALTH_LEVELS,
  HEALTH_LOAD_ERROR,
  HEALTH_QUEUES,
  HEALTH_URL,
  queueLevel,
  readHealth,
} from '../lib/admin-health.js'
import { formatBangkokDate, formatBangkokTime } from '../time.js'

const health = ref(null)
const loading = ref(true)
const errorMessage = ref('')

async function check() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(HEALTH_URL, { credentials: 'same-origin' })
    const data = await response.json().catch(() => null)
    const parsed = response.ok ? readHealth(data) : null
    if (!parsed) {
      health.value = null
      errorMessage.value = typeof data?.message === 'string' ? data.message : HEALTH_LOAD_ERROR
      return
    }
    health.value = parsed
  } catch {
    health.value = null
    errorMessage.value = HEALTH_LOAD_ERROR
  } finally {
    loading.value = false
  }
}

function lastSent(queue) {
  if (!queue.lastSentAt) return 'ยังไม่เคยส่ง'
  return `${formatBangkokDate(queue.lastSentAt)} เวลา ${formatBangkokTime(queue.lastSentAt)}`
}

onMounted(check)
</script>

<template>
  <main class="content health">
    <header class="head">
      <h1 class="title">สถานะการส่งแจ้งเตือน</h1>
      <p class="sub">
        ดูว่าแจ้งเตือนและอีเมลของระบบใบลาส่งทันหรือไม่ ถ้ามีรายการค้างหรือส่งไม่สำเร็จ
        ให้ตรวจที่ Cloudflare และ Supabase ตามคู่มือ deploy
      </p>
      <p v-if="health" class="checked">
        ตรวจเมื่อ {{ formatBangkokTime(health.checkedAt) }}
      </p>
    </header>

    <p v-if="loading && !health" class="hint" role="status">กำลังตรวจสถานะ…</p>
    <p v-else-if="errorMessage" class="hint hint-error" role="alert">{{ errorMessage }}</p>

    <template v-if="health">
      <section
        v-for="meta in HEALTH_QUEUES"
        :key="meta.key"
        class="card queue"
        :class="`level-${queueLevel(health.queues[meta.key])}`"
        :aria-labelledby="`queue-${meta.key}`"
      >
        <div class="queue-head">
          <div class="queue-name">
            <h2 :id="`queue-${meta.key}`" class="queue-title">{{ meta.title }}</h2>
            <p class="queue-note">{{ meta.note }}</p>
          </div>
          <p class="status" role="status">
            <span class="material-symbols-outlined status-icon" aria-hidden="true">
              {{ HEALTH_LEVELS[queueLevel(health.queues[meta.key])].icon }}
            </span>
            {{ HEALTH_LEVELS[queueLevel(health.queues[meta.key])].label }}
          </p>
        </div>

        <dl class="figures">
          <div v-for="figure in HEALTH_FIGURES" :key="figure.key" class="figure">
            <dt class="figure-label">{{ figure.label }}</dt>
            <dd class="figure-value">{{ health.queues[meta.key][figure.key] }}</dd>
          </div>
        </dl>

        <p class="last">ส่งสำเร็จล่าสุด {{ lastSent(health.queues[meta.key]) }}</p>
      </section>
    </template>

    <div class="actions">
      <button type="button" class="recheck" :disabled="loading" @click="check">
        {{ loading ? 'กำลังตรวจ…' : 'ตรวจอีกครั้ง' }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.health {
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
  --late-fill: #fff2df;
  --late-ink: #8a4b06;
  --failed-fill: #fdecec;
  --failed-ink: #a01b1b;
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

.health,
.health * {
  box-sizing: border-box;
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'liga';
}

.title {
  margin: 0 0 8px;
  font-family: 'Prompt', sans-serif;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.15;
  color: var(--ink);
}

.sub,
.checked {
  margin: 0;
  max-width: 68ch;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.checked {
  margin-top: 8px;
  font-size: 15px;
}

.hint {
  margin: 0;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-muted);
}

.hint-error {
  color: var(--failed-ink);
}

.queue {
  padding: 24px;
  border-radius: 20px;
}

.queue-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.queue-name {
  flex: 1 1 260px;
  min-width: 0;
}

.queue-title {
  margin: 0 0 4px;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--ink);
}

.queue-note {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink-muted);
}

/* The one bold element: the state, in its own semantic fill. */
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 8px 16px;
  border-radius: 999px;
  font-family: 'Prompt', sans-serif;
  font-size: 16px;
  font-weight: 600;
}

.status-icon {
  font-size: 22px;
}

.level-ok .status {
  background: var(--ok-fill);
  color: var(--ok-ink);
}

.level-late .status {
  background: var(--late-fill);
  color: var(--late-ink);
}

.level-failed .status {
  background: var(--failed-fill);
  color: var(--failed-ink);
}

.figures {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 0 0 16px;
}

.figure {
  min-width: 0;
  padding-top: 8px;
  border-top: 2px solid rgba(79, 70, 229, 0.28);
}

.figure-label {
  font-size: 14px;
  line-height: 1.4;
  color: var(--ink-muted);
  overflow-wrap: anywhere;
}

.figure-value {
  margin: 4px 0 0;
  font-family: 'IBM Plex Sans Thai', 'IBM Plex Sans', sans-serif;
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  color: var(--ink);
}

.last {
  margin: 0;
  font-size: 15px;
  color: var(--ink-body);
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
}

.recheck {
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

.recheck:disabled {
  cursor: progress;
  opacity: 0.7;
}

.recheck:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .recheck:hover:not(:disabled) {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
  }
}

@media (max-width: 767px) {
  .figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .health {
    padding-top: 16px;
  }

  .queue {
    padding: 16px;
  }

  .actions .recheck {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .recheck {
    transition: none;
  }
}
</style>
