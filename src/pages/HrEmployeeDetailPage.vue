<script setup>
// One employee's own page: /hr/employees/:id.
//
// The list opens this as a full page, never a panel or a sheet, so the page owns
// its own header and its own way back. The back control is a link, not
// router.back(): a deep link or a new tab has no list entry behind it, and the
// search the person was running travels in ?q= on both the row link and this
// button, so the list returns with the same results.
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const employee = ref(null)
const loading = ref(true)
const errorMessage = ref('')
const revealError = ref('')
const revealing = ref(false)
const revealedId = ref('')

const LOAD_ERROR = 'ไม่พบข้อมูลพนักงาน หรือคุณไม่มีสิทธิ์เข้าถึง'
const REVEAL_ERROR = 'ไม่สามารถแสดงเลขบัตรประชาชนได้'

const employeeId = computed(() => {
  const id = route?.params?.id
  if (typeof id === 'string') return id
  if (Array.isArray(id)) return String(id[0] ?? '')
  return ''
})

/** Back to the list, carrying the search that opened this page. */
const backTarget = computed(() => {
  const q = typeof route?.query?.q === 'string' ? route.query.q : ''
  return q.length > 0 ? { path: '/hr/employees', query: { q } } : { path: '/hr/employees' }
})

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch(`/api/hr/employees/${encodeURIComponent(employeeId.value)}`, {
      credentials: 'same-origin',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      errorMessage.value = typeof data.message === 'string' ? data.message : LOAD_ERROR
      return
    }
    employee.value = data.employee
  } catch {
    errorMessage.value = LOAD_ERROR
  } finally {
    loading.value = false
  }
}

// Audit-only action, unchanged from the page this replaces: one POST that the
// API counts as one access for the day.
async function reveal() {
  if (revealing.value || revealedId.value) return
  revealing.value = true
  revealError.value = ''
  try {
    const response = await fetch(
      `/api/hr/employees/${encodeURIComponent(employeeId.value)}/reveal-national-id`,
      { method: 'POST', credentials: 'same-origin' }
    )
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.ok !== true) {
      revealError.value = typeof data.message === 'string' ? data.message : REVEAL_ERROR
      return
    }
    revealedId.value = String(data.nationalId ?? '')
  } catch {
    revealError.value = REVEAL_ERROR
  } finally {
    revealing.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="page">
    <header class="head">
      <div class="heading">
        <p class="eyebrow">ฝ่ายบุคคล</p>
        <h1 class="title">รายละเอียดพนักงาน</h1>
        <p class="sub">
          ข้อมูลสำหรับ HR · เลขบัตรประชาชนแสดงเฉพาะ 4 หลักท้ายตามค่าเริ่มต้น
        </p>
      </div>

      <div class="controls">
        <RouterLink :to="backTarget" class="control control-back">
          <span class="control-arrow" aria-hidden="true">←</span>
          <span>กลับไปหน้าค้นหารายชื่อพนักงาน</span>
        </RouterLink>
        <RouterLink to="/hr/employees/import" class="control">
          <span>กลับไปหน้านำเข้า</span>
        </RouterLink>
      </div>
    </header>

    <v-alert v-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>
    <p v-else-if="loading" class="hint">กำลังโหลด…</p>

    <section v-if="employee" class="panel" aria-labelledby="employee-title">
      <div class="panel-head">
        <h2 id="employee-title" class="panel-title">
          {{ employee.fullName || 'พนักงาน' }}
        </h2>
        <span class="panel-code">{{ employee.employeeCode || '—' }}</span>
      </div>

      <dl class="facts">
        <div class="fact">
          <dt>รหัสพนักงาน</dt>
          <dd>{{ employee.employeeCode || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>ชื่อ-สกุล</dt>
          <dd>{{ employee.fullName || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>คำนำหน้า</dt>
          <dd>{{ employee.namePrefix || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>แผนก</dt>
          <dd>{{ employee.departmentName || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>ตำแหน่ง</dt>
          <dd>{{ employee.positionName || '—' }}</dd>
        </div>
        <div class="fact">
          <dt>สถานะ</dt>
          <dd>
            <span class="badge" :class="employee.isActive ? 'badge-on' : 'badge-off'">
              {{ employee.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน' }}
            </span>
          </dd>
        </div>
        <div class="fact">
          <dt>เลขบัตรประชาชน</dt>
          <dd>
            <span class="mono">{{ revealedId || employee.nationalIdMasked || 'ไม่พร้อมแสดง' }}</span>
            <span v-if="revealedId" class="note">
              การดูเลขเต็มถูกนับเป็นการเข้าถึงหนึ่งครั้งในวันนี้
            </span>
            <span v-else-if="!employee.nationalIdAvailable" class="note">
              รายการนี้ยังไม่มีเลขบัตรที่เข้ารหัสด้วยกุญแจของระบบปัจจุบัน
            </span>
          </dd>
        </div>
      </dl>

      <p v-if="revealError" class="note error">{{ revealError }}</p>

      <div v-if="employee.nationalIdAvailable && !revealedId" class="actions">
        <button type="button" class="reveal-btn" :disabled="revealing" @click="reveal">
          {{ revealing ? 'กำลังแสดง…' : 'ดูเลขเต็ม' }}
        </button>
      </div>
    </section>
  </main>
</template>

<!-- Glass tiers. Unscoped so the tint and blur can live on :root next to the tier
     flag AppBackground3D.vue publishes (data-bg-tier). Tint 0.88, the same recipe
     as the list page this page is opened from. -->
<style>
:root {
  --emp-glass: rgba(255, 255, 255, 0.88);
  --emp-blur: 18px;
  --emp-filter: blur(var(--emp-blur)) saturate(1.1);
  --emp-edge: rgba(255, 255, 255, 0.66);
  --emp-shadow: 0 16px 38px rgba(23, 32, 84, 0.13);
}

:root[data-bg-tier='medium'],
:root[data-bg-tier='low'] {
  --emp-blur: 8px;
}

:root[data-bg-tier='static'] {
  --emp-blur: 0px;
  --emp-filter: none;
  --emp-glass: rgba(255, 255, 255, 0.9);
}
</style>

<style scoped>
.page {
  /* The page palette, declared once. Contrast is measured in the browser at 390
     and 1280 in the high and static tiers (reported with the change):
       indigo-900 on glass 15.9, slate-600 7.1, indigo-700 7.6,
       control border 3.3, white on indigo-600 6.29, error 8.0 on glass. */
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-deep: #4338ca;
  --focus: #8b5cf6;
  --line: rgba(30, 27, 75, 0.12);
  --control-line: rgba(30, 27, 75, 0.52);
  --tap: 44px;
  --radius-panel: 22px;

  position: relative;
  display: grid;
  gap: 20px;
  max-width: 820px;
  margin: 0 auto;
  padding: 28px 0 64px;
  color: var(--ink);
  background: transparent;
}

/* Two controls in the header on a wide screen, stacked under the title on a
   phone. Both are real links with a 44px target. */
.head {
  display: grid;
  gap: 16px;
  padding: 0 4px;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: var(--tap);
  padding: 0 14px;
  border: 1px solid var(--control-line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--accent-deep);
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background-color var(--motion-release) ease,
    border-color var(--motion-release) ease;
}

.control:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.control-arrow {
  display: inline-block;
  transition: transform var(--motion-release) ease;
}

@media (min-width: 760px) {
  .head {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .controls {
    justify-content: flex-end;
    max-width: 340px;
  }
}

.eyebrow {
  margin: 0 0 8px;
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.08em;
  color: var(--ink-muted);
}

.title {
  margin: 0 0 8px;
  font-family: 'Prompt', sans-serif;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.sub {
  margin: 0;
  max-width: 56ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink-body);
}

.hint {
  margin: 0;
  padding: 8px 4px;
  font-size: 14px;
  color: var(--ink-muted);
}

.panel {
  position: relative;
  padding: 20px 22px;
  background-color: var(--emp-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--emp-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--emp-shadow);
  -webkit-backdrop-filter: var(--emp-filter);
  backdrop-filter: var(--emp-filter);
}

.panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.panel-title {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.panel-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
}

.facts {
  margin: 0;
}

.fact {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.fact:last-child {
  border-bottom: none;
}

.fact dt {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.fact dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
}

.note {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-muted);
}

.note.error {
  color: #8a1c1c;
  font-size: 14px;
}

.badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}

.badge-on {
  background: #e6f4ec;
  color: #1c6b3f;
}

.badge-off {
  background: #f1f1f1;
  color: #5f5f5f;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.reveal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  padding: 0 16px;
  border: 1px solid var(--accent);
  border-radius: 12px;
  background: var(--accent);
  color: #ffffff;
  font-family: 'Prompt', sans-serif;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--motion-release) ease;
}

.reveal-btn:disabled {
  cursor: progress;
  opacity: 0.7;
}

.reveal-btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (hover: hover) and (pointer: fine) {
  .control:hover {
    background-color: rgba(79, 70, 229, 0.07);
    border-color: rgba(79, 70, 229, 0.35);
  }

  .control-back:hover .control-arrow {
    transform: translateX(-3px);
  }

  .reveal-btn:hover:not(:disabled) {
    background: var(--accent-deep);
  }
}

@media (max-width: 640px) {
  .page {
    gap: 16px;
    padding: 20px 0 56px;
  }

  .title {
    font-size: 28px;
  }

  .panel {
    padding: 16px 16px 18px;
    border-radius: 18px;
  }

  .fact {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }

  .control {
    width: 100%;
    justify-content: center;
  }
}

/* The entrance: a short rise and fade. It lives inside no-preference, so a
   reduced-motion visitor gets the finished page with no animation at all. */
@media (prefers-reduced-motion: no-preference) {
  @keyframes emp-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 12px, 0);
    }
  }

  .head {
    animation: emp-rise var(--motion-entrance) var(--motion-ease) backwards;
  }

  .panel {
    animation: emp-rise 0.42s var(--motion-ease) 80ms backwards;
  }
}

@media (prefers-reduced-motion: reduce) {
  .head,
  .panel,
  .control,
  .control-arrow,
  .reveal-btn {
    animation: none;
    transition: none;
  }
}
</style>
