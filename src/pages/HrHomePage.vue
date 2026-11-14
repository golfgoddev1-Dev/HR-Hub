<script setup>
// No summary API exists for HR yet, so this page is links only: every row goes
// to a page that already works (employees list, import, directory management).
const cards = [
  {
    to: '/hr/employees',
    icon: 'groups',
    title: 'รายชื่อพนักงาน',
    description: 'ค้นหาพนักงานด้วยชื่อหรือรหัสพนักงาน (อย่างน้อย 2 ตัวอักษร) และเปิดดูข้อมูลรายคน',
  },
  {
    to: '/hr/employees/import',
    icon: 'upload_file',
    title: 'นำเข้าพนักงาน',
    description: 'อัปโหลดไฟล์ .xlsx หรือ .csv ตรวจตัวอย่างก่อนบันทึก และดาวน์โหลดแม่แบบไฟล์',
  },
  {
    to: '/hr/employees/manage',
    icon: 'edit',
    title: 'จัดการข้อมูลพนักงาน',
    description: 'เปลี่ยนแผนกและตำแหน่งของพนักงานรายคน และเปลี่ยนชื่อรายการแผนกหรือตำแหน่งที่ใช้ร่วมกัน',
  },
]
</script>

<template>
  <main class="page">
    <!-- The desk: who the page is for, in one breath. No numbers exist to show. -->
    <section class="hero" aria-labelledby="home-title">
      <p class="eyebrow">ฝ่ายบุคคล</p>
      <h1 id="home-title" class="title">หน้าหลัก</h1>
      <p class="lead">เลือกงานที่ต้องการทำ — แต่ละหน้าแสดงเฉพาะข้อมูลที่จำเป็น</p>
      <p class="note">ไม่แสดงเลขบัตรประชาชน ยกเว้นหน้าที่ขอเปิดดูรายคน</p>
      <p class="state">
        <span class="state-dot" aria-hidden="true"></span>
        <span class="state-text">ระบบพร้อมใช้งาน</span>
      </p>
    </section>

    <!-- The work: three rows, not three equal boxes. Each row is one link. -->
    <nav class="menu" aria-label="งานของฝ่ายบุคคล">
      <div class="menu-head">
        <h2 class="menu-title">งานประจำวัน</h2>
        <span class="menu-count">{{ cards.length }} หน้า</span>
      </div>
      <ul class="tasks">
        <li v-for="(card, index) in cards" :key="card.to" class="task-row">
          <RouterLink :to="card.to" class="task" :style="{ '--stagger': index }">
            <span class="task-icon" aria-hidden="true">
              <span class="material-symbols-outlined">{{ card.icon }}</span>
            </span>
            <span class="task-copy">
              <span class="task-title">{{ card.title }}</span>
              <span class="task-desc">{{ card.description }}</span>
            </span>
            <span class="task-go">
              <span class="go-label">เปิดหน้านี้</span>
              <span class="go-arrow" aria-hidden="true">→</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </nav>
  </main>
</template>

<!-- Glass tiers. Unscoped so the tint and blur can live on :root next to the tier
     flag AppBackground3D.vue publishes (data-bg-tier). Tint 0.88 on both panels:
     low enough that the field reads through the glass, high enough that slate-600
     keeps 4.5:1 over the darkest scene pixel (measured in
     tests/hr-home-page.test.js). Blur follows the tier: 18px at high, 8px at
     medium and low, none at static. -->
<style>
:root {
  --home-glass: rgba(255, 255, 255, 0.88);
  --home-glass-blur: 18px;
  --home-glass-filter: blur(var(--home-glass-blur)) saturate(1.1);
  --home-edge: rgba(255, 255, 255, 0.66);
  --home-shadow: 0 16px 38px rgba(23, 32, 84, 0.13);
}

:root[data-bg-tier='medium'],
:root[data-bg-tier='low'] {
  --home-glass-blur: 8px;
}

/* No scene to frost on the static tier: the same contrast floor, a slightly
   stronger tint and no backdrop filter at all. */
:root[data-bg-tier='static'] {
  --home-glass-blur: 0px;
  --home-glass-filter: none;
  --home-glass: rgba(255, 255, 255, 0.9);
}
</style>

<style scoped>
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

.page {
  /* The page palette, declared once. Contrast (WCAG AA, normal text) is asserted
     in tests/hr-home-page.test.js, against the frosted backdrop over the darkest
     scene pixel and against every opaque fill:
       indigo-900 on glass 13.4, slate-700 8.4, slate-600 6.2
       indigo-600 on indigo-50 5.60, white on indigo-600 6.29
       indigo-700 on glass 6.4, violet-500 is a focus ring only (3:1 rule) */
  --ink: #1e1b4b;
  --ink-body: #334155;
  --ink-muted: #475569;
  --accent: #4f46e5;
  --accent-deep: #4338ca;
  --focus: #8b5cf6;
  --tile: #eef2ff;
  --line: rgba(30, 27, 75, 0.12);
  --tap: 44px;
  --radius-panel: 22px;
  --radius-row: 14px;

  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  max-width: 1120px;
  margin: 0 auto;
  padding: 28px 0 64px;
  color: var(--ink);
  /* No page background: the field is the backdrop and every block of text sits
     on one of the two frosted panels below. */
  background: transparent;
}

/* Desktop keeps the asymmetry: a narrow desk beside the wider work list. */
@media (min-width: 960px) {
  .page {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    align-items: start;
    gap: 24px;
    padding-top: 32px;
  }
}

.hero,
.menu {
  position: relative;
  background-color: var(--home-glass);
  background-image: linear-gradient(150deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 60%);
  border: 1px solid var(--home-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--home-shadow);
  -webkit-backdrop-filter: var(--home-glass-filter);
  backdrop-filter: var(--home-glass-filter);
}

.hero {
  overflow: hidden;
  padding: 28px;
}

/* Decoration only: a soft violet glow in the empty corner of the desk. */
.hero::after {
  content: '';
  position: absolute;
  right: -60px;
  bottom: -70px;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(139, 92, 246, 0.22) 0%,
    rgba(79, 70, 229, 0.1) 45%,
    rgba(255, 255, 255, 0) 70%
  );
  pointer-events: none;
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
  margin: 0 0 12px;
  font-family: 'Prompt', sans-serif;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: var(--ink);
}

.lead {
  margin: 0 0 8px;
  max-width: 44ch;
  font-size: 16px;
  line-height: 1.6;
  color: var(--ink-body);
}

.note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-muted);
}

.state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
}

.state-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.14);
}

.menu {
  padding: 18px 8px 8px;
}

.menu-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px 12px;
}

.menu-title {
  margin: 0;
  font-family: 'Prompt', sans-serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
}

.menu-count {
  font-family: 'IBM Plex Sans Thai', 'Sarabun', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tasks {
  margin: 0;
  padding: 0;
  list-style: none;
}

.task-row + .task-row {
  border-top: 1px solid var(--line);
}

/* One row is one link: the whole block is the tap target, not just the arrow. */
.task {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  min-height: var(--tap);
  padding: 16px;
  border-radius: var(--radius-row);
  color: inherit;
  text-decoration: none;
  transition:
    background-color 0.18s ease,
    box-shadow 0.24s ease;
}

.task-icon {
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  border-radius: 12px;
  background: var(--tile);
  color: var(--accent);
  transition:
    background-color 0.18s ease,
    color 0.18s ease;
}

.task-icon .material-symbols-outlined {
  font-size: 24px;
}

.task-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.task-title {
  font-family: 'Prompt', sans-serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.task-desc {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-body);
  overflow-wrap: anywhere;
}

.task-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-family: 'Prompt', sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--accent-deep);
  white-space: nowrap;
}

.go-arrow {
  display: inline-block;
  transition: transform 0.18s ease;
}

/* Full-width rows take the focus ring inside their own box. */
.task:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

/* Hover and press are for a real mouse only: a finger gets no hover state. */
@media (hover: hover) and (pointer: fine) {
  .task {
    transition:
      background-color 0.18s ease,
      box-shadow 0.24s ease,
      transform 0.24s ease;
  }

  .task:hover {
    background-color: rgba(79, 70, 229, 0.055);
    transform: translateY(-2px);
    box-shadow: 0 10px 24px rgba(23, 32, 84, 0.1);
  }

  .task:hover .task-icon {
    background: var(--accent);
    color: #ffffff;
  }

  .task:hover .go-arrow {
    transform: translateX(3px);
  }

  .task:active {
    transform: translateY(-1px) scale(0.995);
  }
}

/* Phones: one column, the row keeps its icon and copy, the words beside the
   arrow step aside so the description stays at 16px. */
@media (max-width: 599px) {
  .page {
    gap: 16px;
    padding: 20px 0 56px;
  }

  .hero {
    padding: 20px;
    border-radius: 18px;
  }

  .title {
    font-size: 28px;
  }

  .menu {
    padding: 14px 6px 6px;
    border-radius: 18px;
  }

  .task {
    gap: 12px;
    padding: 14px 10px;
  }

  .task-title {
    font-size: 16px;
  }

  .go-label {
    display: none;
  }
}

/* The entrance: fourteen pixels of rise and a fade, 50ms apart. It lives
   entirely inside no-preference, so a reduced-motion visitor gets the finished
   page with no animation at all. Transform and opacity only, and the rows are
   already in the DOM at their final state (backwards fill). */
@media (prefers-reduced-motion: no-preference) {
  @keyframes home-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 14px, 0);
    }
  }

  .hero {
    animation: home-rise 0.44s cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }

  .task {
    animation: home-rise 0.42s cubic-bezier(0.16, 1, 0.3, 1) backwards;
    animation-delay: calc(var(--stagger, 0) * 50ms + 80ms);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero,
  .task,
  .task-icon,
  .go-arrow {
    animation: none;
    transition: none;
  }
}
</style>
