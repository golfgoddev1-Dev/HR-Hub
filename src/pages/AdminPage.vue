<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getSession } from '../api.js'
import {
  ADMIN_NO_VALUE,
  ADMIN_SHORTCUTS,
  ADMIN_STATS,
  adminRoleLabel,
  allStatsUnavailable,
  formatStatValue,
  loadAdminStats,
} from '../lib/admin-overview.js'
import { canOpenPath } from '../lib/route-access.js'

// Landing page for the system_admin role. All four numbers come from one
// read-only endpoint (/api/admin/overview, system_admin only); when that call
// fails the cards stay "—" instead of showing a substitute value.
const values = ref({})
const loading = ref(true)
const role = ref('')

const shortcuts = computed(() =>
  ADMIN_SHORTCUTS.map((item) => ({ ...item, openable: canOpenPath(role.value, item.to) }))
)

const emptyState = computed(() => loading.value === false && allStatsUnavailable(values.value))

/** Reads a JSON body, or null for any non-2xx answer (403 included). */
async function readJson(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) return null
  return response.json().catch(() => null)
}

onMounted(async () => {
  const session = await getSession()
  role.value = typeof session?.role === 'string' ? session.role : ''

  try {
    values.value = await loadAdminStats(readJson)
  } finally {
    loading.value = false
  }
})
</script>

<template>
    <div class="page-loader-bar" aria-hidden="true"></div>

    <main class="content">
      <header class="head">
        <span class="eyebrow">
          <span class="material-symbols-outlined eyebrow-icon">shield_person</span>
          ศูนย์ควบคุมระบบ
        </span>
        <h1 class="title">ภาพรวมผู้ดูแล</h1>
        <p class="sub">
          สรุปสถานะสำคัญของระบบงานบุคคล พร้อมทางลัดไปยังหน้าที่ดูแลอยู่
          ตัวเลขทุกใบมาจากรายการที่มีอยู่จริงในระบบ ไม่มีการประมาณหรือสร้างค่าขึ้นเอง
        </p>
        <p v-if="role" class="role-chip">
          <span class="material-symbols-outlined role-icon">badge</span>
          สิทธิ์: {{ adminRoleLabel(role) }}
        </p>
      </header>

      <section class="stats" :aria-busy="loading ? 'true' : 'false'">
        <article
          v-for="(stat, index) in ADMIN_STATS"
          :key="stat.key"
          class="stat-card"
          :style="{ '--stagger': index }"
        >
          <span class="stat-icon">
            <span class="material-symbols-outlined">{{ stat.icon }}</span>
          </span>
          <span
            class="stat-value"
            :class="{ 'is-empty': loading === false && formatStatValue(values[stat.key]) === ADMIN_NO_VALUE }"
          >
            {{ loading ? '…' : formatStatValue(values[stat.key]) }}
          </span>
          <span class="stat-label">{{ stat.label }}</span>
          <span class="stat-caption">{{ stat.caption }}</span>
        </article>
      </section>

      <p v-if="loading" class="state-line" role="status">กำลังโหลดข้อมูล…</p>
      <p v-else-if="emptyState" class="state-line state-line-empty">
        <span class="material-symbols-outlined state-icon">info</span>
        <span>
          ยังไม่มีตัวเลขที่แสดงได้ในขณะนี้
          <span class="state-hint">ระบบจะแสดงตัวเลขเมื่อบัญชีนี้เข้าถึงข้อมูลส่วนนั้นได้</span>
        </span>
      </p>

      <section class="shortcuts">
        <div class="section-head">
          <h2 class="section-title">ทางลัด</h2>
          <p class="section-sub">เปิดหน้าที่ใช้บ่อยได้ทันที</p>
        </div>

        <div class="shortcut-grid">
          <component
            :is="item.openable ? RouterLink : 'div'"
            v-for="(item, index) in shortcuts"
            :key="item.to"
            v-bind="item.openable ? { to: item.to } : { 'aria-disabled': 'true' }"
            class="shortcut"
            :class="{ 'shortcut-locked': !item.openable }"
            :style="{ '--stagger': index }"
          >
            <span class="shortcut-icon">
              <span class="material-symbols-outlined">{{ item.icon }}</span>
            </span>
            <span class="shortcut-text">
              <span class="shortcut-title">{{ item.label }}</span>
              <span class="shortcut-desc">{{ item.description }}</span>
            </span>
            <span class="shortcut-go">
              <template v-if="item.openable">เปิดหน้านี้ →</template>
              <template v-else>ต้องใช้สิทธิ์ HR</template>
            </span>
          </component>
        </div>
      </section>
    </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: 'liga';
}

.page-loader-bar {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, #10504e 0%, #28807d 40%, #85f8c4 70%, #10504e 100%);
  background-size: 200% 100%;
  z-index: 9999;
  transform-origin: left;
  animation: admin-progress-sweep 1.8s cubic-bezier(0.65, 0, 0.35, 1) forwards,
    admin-gradient-move 1.5s linear infinite;
}

.content {
  position: relative;
  z-index: 1;
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 0 64px;
}

.head {
  margin-bottom: 22px;
  animation: admin-fade-slide-down 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.05s both;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(133, 248, 196, 0.18);
  border: 1px solid rgba(16, 80, 78, 0.12);
  color: #10504e;
  font-size: 12px;
  font-weight: 600;
}

.eyebrow-icon {
  font-size: 15px;
}

.title {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 700;
  color: #12343b;
  letter-spacing: -0.01em;
}

.sub {
  margin: 0;
  max-width: 660px;
  font-size: 13px;
  line-height: 1.65;
  color: #5c7176;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid #dfe7e5;
  background: #ffffff;
  color: #12343b;
  font-size: 12px;
  font-weight: 600;
}

.role-icon {
  font-size: 15px;
  color: #10504e;
}

.stats {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  margin-bottom: 18px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 18px 20px 16px;
  border: 1px solid #e0e8e6;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(18, 52, 59, 0.05);
  animation: admin-card-entrance 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--stagger, 0) * 0.08s + 0.15s);
  transition: box-shadow 0.3s ease, border-color 0.3s ease;
}

.stat-card:hover {
  border-color: #c9dcda;
  box-shadow: 0 10px 22px -10px rgba(18, 52, 59, 0.18);
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  margin-bottom: 12px;
  border-radius: 11px;
  background: #f0f7f6;
  color: #10504e;
}

.stat-icon .material-symbols-outlined {
  font-size: 21px;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  color: #10343b;
  letter-spacing: -0.02em;
}

.stat-value.is-empty {
  color: #94a5a7;
}

.stat-label {
  margin-top: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: #12343b;
}

.stat-caption {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: #7c8f93;
}

.state-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 18px;
  padding: 12px 16px;
  border: 1px solid #e0e8e6;
  border-radius: 12px;
  background: #ffffff;
  color: #5c7176;
  font-size: 13px;
  line-height: 1.6;
}

.state-line-empty {
  border-style: dashed;
  color: #4d6468;
}

.state-icon {
  font-size: 18px;
  color: #10504e;
}

.state-hint {
  display: block;
  color: #7c8f93;
  font-size: 12px;
}

.shortcuts {
  margin-top: 6px;
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.section-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #12343b;
}

.section-sub {
  margin: 0;
  font-size: 12.5px;
  color: #7c8f93;
}

.shortcut-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.shortcut {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 132px;
  padding: 18px;
  border: 1px solid #dfe7e5;
  border-radius: 14px;
  background: #ffffff;
  color: inherit;
  text-decoration: none;
  box-shadow: 0 1px 3px rgba(18, 52, 59, 0.04);
  animation: admin-card-entrance 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--stagger, 0) * 0.08s + 0.3s);
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease,
    border-color 0.25s ease, background-color 0.25s ease;
}

a.shortcut:hover {
  border-color: #b7cecb;
  transform: translateY(-3px);
  box-shadow: 0 14px 26px -12px rgba(18, 52, 59, 0.22);
}

a.shortcut:hover .shortcut-go {
  gap: 8px;
  color: #0b3837;
}

a.shortcut:focus-visible {
  outline: 3px solid #0f6f63;
  outline-offset: 2px;
}

a.shortcut:active {
  transform: translateY(-1px);
}

.shortcut-locked {
  background: #fafbfb;
  border-style: dashed;
  cursor: default;
}

.shortcut-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: #f0f7f6;
  color: #10504e;
}

.shortcut-icon .material-symbols-outlined {
  font-size: 22px;
}

.shortcut-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.shortcut-title {
  font-size: 15px;
  font-weight: 600;
  color: #12343b;
}

.shortcut-desc {
  font-size: 12.5px;
  line-height: 1.55;
  color: #5c7176;
}

.shortcut-go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
  padding-top: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #10504e;
  transition: gap 0.25s ease, color 0.25s ease;
}

.shortcut-locked .shortcut-go {
  color: #94a5a7;
  font-weight: 500;
}

@keyframes admin-progress-sweep {
  0% { transform: scaleX(0); opacity: 1; }
  40% { transform: scaleX(0.55); }
  80% { transform: scaleX(0.92); opacity: 1; }
  100% { transform: scaleX(1); opacity: 0; }
}

@keyframes admin-gradient-move {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

@keyframes admin-fade-slide-down {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes admin-card-entrance {
  from { opacity: 0; transform: translateY(18px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 640px) {
  .content {
    padding: 20px 0 56px;
  }

  .stats,
  .shortcut-grid {
    grid-template-columns: 1fr;
  }

  .title {
    font-size: 21px;
  }
}

/* หยุดแอนิเมชันเมื่อผู้ใช้ตั้งค่า reduced motion */
@media (prefers-reduced-motion: reduce) {
  .page-loader-bar,
  .head,
  .stat-card,
  .shortcut {
    animation: none !important;
  }

  .stat-card,
  .shortcut,
  .shortcut-go,
  a.shortcut:hover {
    transition: none !important;
    transform: none !important;
  }
}
</style>
